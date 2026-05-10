import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type { ActiveSessionRegistry } from "../active-session-registry.js";
import {
  DEFAULT_TRANSCRIPT_PAGE_LIMIT,
  decodeTranscriptCursor,
  InvalidTranscriptCursorError,
  MAX_TRANSCRIPT_PAGE_LIMIT,
  type TranscriptPage,
} from "../transcript-pagination.js";
import type { DaemonConfig } from "../types.js";

export type RemoteSessionSummary = {
  id: string;
  piSessionId: string;
  projectId: string;
  name: string | null;
  path: string;
  updatedAt: string;
  messageCount: number;
};

export type RemoteSessionState = {
  session: unknown;
  messages: unknown[];
  olderMessagesCursor: string | null;
  hasOlderMessages: boolean;
  tools: unknown[];
  isStreaming: boolean;
  pendingMessageCount: number;
};

export type PromptSessionRequest = {
  text: string;
  streamingBehavior?: "steer" | "followUp" | null;
};

export type SessionService = {
  listProjectSessions?(projectId: string): Promise<RemoteSessionSummary[]>;
  createProjectSession?(projectId: string): Promise<RemoteSessionSummary>;
  getSessionState?(sessionId: string, options?: { messageLimit: number }): Promise<RemoteSessionState>;
  getSessionMessages?(sessionId: string, request: { before: string; limit: number }): Promise<TranscriptPage>;
  promptSession?(sessionId: string, request: PromptSessionRequest): Promise<void>;
  abortSession?(sessionId: string): Promise<void>;
  streamSession?(sessionId: string, send: (event: unknown) => void): Promise<void>;
};

export type DaemonServer = {
  address: string;
  close(): Promise<void>;
};

export type PairClaimRequest = {
  pairCode: string;
  deviceName: string;
};

export type PairClaimResponse = {
  deviceId: string;
  token: string;
  daemonName: string;
};

export type PairCodeResponse = {
  pairCode: string;
  expiresAt: string;
};

export type PairService = {
  createPairingCode?(): Promise<PairCodeResponse>;
  claimPairingCode(request: PairClaimRequest): Promise<PairClaimResponse>;
};

export type StartServerOptions = {
  stateDir: string;
  config: DaemonConfig;
  piVersion?: string;
  daemonVersion?: string;
  authenticateToken?: (token: string) => boolean | Promise<boolean>;
  sessionService?: SessionService;
  activeSessions?: ActiveSessionRegistry;
  pairService?: PairService;
};

type StreamHub = Map<string, Set<WebSocket>>;

export function bindAddressesForConfig(bindAddress: string): string[] {
  const { host, port } = parseBindAddress(bindAddress);
  if (isLoopbackHost(host) || isWildcardHost(host)) return [bindAddress];
  return [bindAddress, `127.0.0.1:${port}`];
}

export async function startDaemonServer(options: StartServerOptions): Promise<DaemonServer> {
  const streamHub: StreamHub = new Map();
  const webSockets = new WebSocketServer({ noServer: true });
  const servers = bindAddressesForConfig(options.config.bindAddress).map(() => createHttpServer(options, streamHub, webSockets));
  const bindAddresses = bindAddressesForConfig(options.config.bindAddress);

  for (let index = 0; index < servers.length; index += 1) {
    const { host, port } = parseBindAddress(bindAddresses[index] ?? options.config.bindAddress);
    await listen(servers[index]!, host, port);
  }

  const address = servers[0]!.address() as AddressInfo;
  return {
    address: `${address.address}:${address.port}`,
    close: async () => {
      webSockets.close();
      await Promise.all(servers.map((server) => closeServer(server)));
    },
  };
}

function createHttpServer(options: StartServerOptions, streamHub: StreamHub, webSockets: WebSocketServer): Server {
  const server = createServer((request, response) => {
    void handleHttpRequest(request, response, options, streamHub);
  });
  server.on("upgrade", (request, socket, head) => {
    void handleUpgrade(request, socket, head, webSockets, options, streamHub);
  });
  return server;
}

async function listen(server: Server, host: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: StartServerOptions,
  streamHub: StreamHub,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  if (request.method === "GET" && pathname === "/v1/health") {
    writeJson(response, 200, {
      status: "ok",
      piVersion: options.piVersion ?? "unknown",
      daemonVersion: options.daemonVersion ?? "0.1.0",
    });
    return;
  }

  if (request.method === "POST" && pathname === "/v1/tui/sessions") {
    if (!(await isTuiAuthorized(request, options))) {
      writeJson(response, 401, { error: "unauthorized" });
      return;
    }
    const body = (await readJsonBody(request)) as Parameters<ActiveSessionRegistry["registerSession"]>[0];
    const session = options.activeSessions?.registerSession(body);
    writeJson(response, session ? 200 : 503, session ? { session } : { error: "active_sessions_unavailable" });
    return;
  }

  const tuiSessionMatch = pathname.match(/^\/v1\/tui\/sessions\/([^/]+)$/);
  if (request.method === "DELETE" && tuiSessionMatch) {
    if (!(await isTuiAuthorized(request, options))) {
      writeJson(response, 401, { error: "unauthorized" });
      return;
    }
    const sessionId = decodeURIComponent(tuiSessionMatch[1] ?? "");
    const unregistered = options.activeSessions?.unregisterSession(sessionId) ?? false;
    streamHub.get(sessionId)?.forEach((webSocket) => sendWebSocketJson(webSocket, { type: "session_closed" }));
    streamHub.delete(sessionId);
    writeJson(response, 200, { unregistered });
    return;
  }

  const tuiCommandsMatch = pathname.match(/^\/v1\/tui\/sessions\/([^/]+)\/commands$/);
  if (request.method === "GET" && tuiCommandsMatch) {
    if (!(await isTuiAuthorized(request, options))) {
      writeJson(response, 401, { error: "unauthorized" });
      return;
    }
    const sessionId = decodeURIComponent(tuiCommandsMatch[1] ?? "");
    writeJson(response, 200, { commands: options.activeSessions?.takeCommands(sessionId) ?? [] });
    return;
  }

  const tuiEventMatch = pathname.match(/^\/v1\/tui\/sessions\/([^/]+)\/events$/);
  if (request.method === "POST" && tuiEventMatch) {
    if (!(await isTuiAuthorized(request, options))) {
      writeJson(response, 401, { error: "unauthorized" });
      return;
    }
    const sessionId = decodeURIComponent(tuiEventMatch[1] ?? "");
    const event = await readJsonBody(request);
    streamHub.get(sessionId)?.forEach((webSocket) => sendWebSocketJson(webSocket, event));
    writeJson(response, 200, { accepted: true });
    return;
  }

  if (request.method === "POST" && pathname === "/v1/pair/claim") {
    try {
      const body = (await readJsonBody(request)) as PairClaimRequest;
      const result = await options.pairService?.claimPairingCode(body);
      writeJson(response, 200, result ?? { error: "pairing_unavailable" });
    } catch (error) {
      if (error instanceof Error && error.message === "Invalid or expired pairing code") {
        writeJson(response, 400, { error: "invalid_pairing_code" });
      } else {
        writeJson(response, 500, { error: "internal_error" });
      }
    }
    return;
  }

  if (request.method === "GET" && pathname === "/v1/projects") {
    if (!(await isAuthorized(request, options))) {
      writeJson(response, 401, { error: "unauthorized" });
      return;
    }

    writeJson(response, 200, { projects: options.activeSessions?.listProjects() ?? [] });
    return;
  }

  const abortMatch = pathname.match(/^\/v1\/sessions\/([^/]+)\/abort$/);
  if (request.method === "POST" && abortMatch) {
    if (!(await isAuthorized(request, options))) {
      writeJson(response, 401, { error: "unauthorized" });
      return;
    }

    const sessionId = decodeURIComponent(abortMatch[1] ?? "");
    if (options.activeSessions) {
      if (!options.activeSessions.enqueueCommand(sessionId, { type: "remote_abort", requestId: nextRequestId() })) {
        writeJson(response, 409, { error: "session_not_active" });
        return;
      }
    } else {
      await options.sessionService?.abortSession?.(sessionId);
    }
    writeJson(response, 200, { aborted: true });
    return;
  }

  const promptMatch = pathname.match(/^\/v1\/sessions\/([^/]+)\/prompt$/);
  if (request.method === "POST" && promptMatch) {
    if (!(await isAuthorized(request, options))) {
      writeJson(response, 401, { error: "unauthorized" });
      return;
    }

    const sessionId = decodeURIComponent(promptMatch[1] ?? "");
    const body = (await readJsonBody(request)) as PromptSessionRequest;
    if (options.activeSessions) {
      if (!options.activeSessions.enqueueCommand(sessionId, {
        type: "remote_prompt",
        requestId: nextRequestId(),
        text: body.text,
        streamingBehavior: body.streamingBehavior,
      })) {
        writeJson(response, 409, { error: "session_not_active" });
        return;
      }
    } else {
      await options.sessionService?.promptSession?.(sessionId, body);
    }
    writeJson(response, 200, { accepted: true });
    return;
  }

  const sessionMessagesMatch = pathname.match(/^\/v1\/sessions\/([^/]+)\/messages$/);
  if (request.method === "GET" && sessionMessagesMatch) {
    if (!(await isAuthorized(request, options))) {
      writeJson(response, 401, { error: "unauthorized" });
      return;
    }

    const limit = parsePositiveLimit(url.searchParams.get("limit"));
    if (!limit.valid) {
      writeJson(response, 400, { error: "invalid_limit" });
      return;
    }
    const before = url.searchParams.get("before");
    if (!before) {
      writeJson(response, 400, { error: "invalid_cursor" });
      return;
    }

    try {
      decodeTranscriptCursor(before);
      const sessionId = decodeURIComponent(sessionMessagesMatch[1] ?? "");
      const page = options.activeSessions?.getSessionMessages(sessionId, before, { limit: limit.value })
        ?? (await options.sessionService?.getSessionMessages?.(sessionId, { before, limit: limit.value }));
      if (!page) {
        writeJson(response, 404, { error: "session_not_found" });
        return;
      }
      writeJson(response, 200, page);
    } catch (error) {
      if (error instanceof InvalidTranscriptCursorError) writeJson(response, 400, { error: "invalid_cursor" });
      else writeJson(response, 500, { error: "internal_error" });
    }
    return;
  }

  const sessionMatch = pathname.match(/^\/v1\/sessions\/([^/]+)$/);
  if (request.method === "GET" && sessionMatch) {
    if (!(await isAuthorized(request, options))) {
      writeJson(response, 401, { error: "unauthorized" });
      return;
    }

    const limit = parsePositiveLimit(url.searchParams.get("messageLimit"));
    if (!limit.valid) {
      writeJson(response, 400, { error: "invalid_limit" });
      return;
    }

    const sessionId = decodeURIComponent(sessionMatch[1] ?? "");
    const state = options.activeSessions?.getSessionState(sessionId, { messageLimit: limit.value })
      ?? (await options.sessionService?.getSessionState?.(sessionId, { messageLimit: limit.value }));
    if (!state) {
      writeJson(response, 404, { error: "session_not_found" });
      return;
    }
    writeJson(response, 200, state);
    return;
  }

  const projectSessionsMatch = pathname.match(/^\/v1\/projects\/([^/]+)\/sessions$/);
  if ((request.method === "GET" || request.method === "POST") && projectSessionsMatch) {
    if (!(await isAuthorized(request, options))) {
      writeJson(response, 401, { error: "unauthorized" });
      return;
    }

    const projectId = decodeURIComponent(projectSessionsMatch[1] ?? "");
    if (request.method === "POST") {
      writeJson(response, 405, { error: "method_not_allowed" });
      return;
    }

    const sessions = options.activeSessions?.listProjectSessions(projectId) ?? (await options.sessionService?.listProjectSessions?.(projectId));
    writeJson(response, 200, { sessions: sessions ?? [] });
    return;
  }

  writeJson(response, 404, { error: "not_found" });
}

async function handleUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  webSockets: WebSocketServer,
  options: StartServerOptions,
  streamHub: StreamHub,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const streamMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/stream$/);
  if (!streamMatch) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  if (!(await isAuthorized(request, options))) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  const sessionId = decodeURIComponent(streamMatch[1] ?? "");
  webSockets.handleUpgrade(request, socket, head, (webSocket) => {
    webSockets.emit("connection", webSocket, request);
    const subscribers = streamHub.get(sessionId) ?? new Set<WebSocket>();
    subscribers.add(webSocket);
    streamHub.set(sessionId, subscribers);
    webSocket.once("close", () => subscribers.delete(webSocket));

    const activeState = options.activeSessions?.getSessionState(sessionId, { messageLimit: DEFAULT_TRANSCRIPT_PAGE_LIMIT });
    if (activeState) sendWebSocketJson(webSocket, { type: "session_state", ...activeState });

    void options.sessionService?.streamSession?.(sessionId, (event) => {
      sendWebSocketJson(webSocket, event);
    });
  });
}

async function isTuiAuthorized(request: IncomingMessage, options: StartServerOptions): Promise<boolean> {
  if (isLoopbackRemoteAddress(request.socket.remoteAddress)) return true;
  return isAuthorized(request, options);
}

async function isAuthorized(request: IncomingMessage, options: StartServerOptions): Promise<boolean> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return false;
  const token = authorization.slice("Bearer ".length);
  return options.authenticateToken ? Boolean(await options.authenticateToken(token)) : false;
}

function isLoopbackRemoteAddress(address: string | undefined): boolean {
  return Boolean(address && (address === "::1" || address === "127.0.0.1" || address.startsWith("127.") || address.startsWith("::ffff:127.")));
}

function nextRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function parsePositiveLimit(rawLimit: string | null): { valid: true; value: number } | { valid: false } {
  if (rawLimit === null) return { valid: true, value: DEFAULT_TRANSCRIPT_PAGE_LIMIT };
  const parsed = Number(rawLimit);
  if (!Number.isInteger(parsed) || parsed <= 0) return { valid: false };
  return { valid: true, value: Math.min(parsed, MAX_TRANSCRIPT_PAGE_LIMIT) };
}

function parseBindAddress(bindAddress: string): { host: string; port: number } {
  const index = bindAddress.lastIndexOf(":");
  if (index === -1) throw new Error(`Invalid bind address: ${bindAddress}`);
  return {
    host: bindAddress.slice(0, index),
    port: Number.parseInt(bindAddress.slice(index + 1), 10),
  };
}

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "::1" || host === "[::1]" || host === "127.0.0.1" || host.startsWith("127.");
}

function isWildcardHost(host: string): boolean {
  return host === "0.0.0.0" || host === "::" || host === "[::]" || host === "";
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  return body ? JSON.parse(body) : {};
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function sendWebSocketJson(webSocket: WebSocket, event: unknown): void {
  if (webSocket.readyState === WebSocket.OPEN) webSocket.send(JSON.stringify(event));
}
