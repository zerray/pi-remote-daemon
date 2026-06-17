import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RemoteTuiCommand } from "../active-session-registry.js";
import type { RemoteCompactResultEvent, RemoteForkResultEvent, RemoteSessionReplacedEvent, RemoteTreeNavigationResultEvent } from "../types.js";
import { loadDaemonConfig } from "../config.js";
import { getDaemonStateDir } from "../paths.js";
import { collectRuntimeStatus } from "../runtime-status.js";
import { projectIdForPath } from "../session-index.js";
import { buildTreeSnapshot } from "../tree-snapshot.js";
import { createTranscriptEventCanonicalizer } from "./transcript-event-canonicalizer.js";

export { collectRuntimeStatus } from "../runtime-status.js";

export default function remoteControlExtension(pi: ExtensionAPI): void {
  const activeSessionIds = new Set<string>();
  const pollTimers = new Map<string, NodeJS.Timeout>();
  const runtimeStatusCache = new Map<string, string>();
  const transcriptEventCanonicalizers = new Map<string, ReturnType<typeof createTranscriptEventCanonicalizer>>();
  const transcriptRetryTimers = new Map<string, NodeJS.Timeout>();
  const forward = (event: unknown, ctx: ExtensionContext) => {
    const sessionId = daemonSessionId(ctx);
    if (activeSessionIds.has(sessionId)) {
      const canonicalizer = transcriptEventCanonicalizers.get(sessionId) ?? createTranscriptEventCanonicalizer();
      transcriptEventCanonicalizers.set(sessionId, canonicalizer);
      const sessionNameEvent = sessionNameEventForDaemon(event);
      const events = sessionNameEvent ? [sessionNameEvent] : canonicalizer.canonicalize(event, ctx);
      events.forEach((daemonEvent) => void postTuiEvent(sessionId, daemonEvent));
      if (events.length > 0) void postTreeStateAfterMessageAppend(event, ctx, sessionId);
      scheduleTranscriptRetry(sessionId, ctx, canonicalizer, activeSessionIds, transcriptRetryTimers);
      void postRuntimeStatusIfChanged(pi, ctx, sessionId, runtimeStatusCache);
    }
  };
  const resetLocalState = (ctx: ExtensionContext) => {
    const sessionId = daemonSessionId(ctx);
    runtimeStatusCache.delete(sessionId);
    transcriptEventCanonicalizers.get(sessionId)?.reset();
    transcriptEventCanonicalizers.delete(sessionId);
    clearTimeout(transcriptRetryTimers.get(sessionId));
    transcriptRetryTimers.delete(sessionId);
    deactivateLocalSession(ctx, sessionId, activeSessionIds, pollTimers);
  };
  const cleanup = async (ctx: ExtensionContext) => {
    const sessionId = daemonSessionId(ctx);
    resetLocalState(ctx);
    await unregisterTuiSession(sessionId).catch(() => undefined);
  };

  registerEventForwarders(pi, forward, cleanup, resetLocalState);

  pi.registerCommand("remote-control", {
    description: "Toggle Pi remote control for this TUI session",
    handler: async (_args, ctx) => {
      try {
        await ensureDaemonStarted(pi);
      } catch (error) {
        ctx.ui.notify(`${error instanceof Error ? error.message : String(error)}; see /tmp/pi-remote-control.log`, "error");
        return;
      }
      const sessionId = daemonSessionId(ctx);
      if (activeSessionIds.has(sessionId)) {
        try {
          await unregisterTuiSession(sessionId);
        } catch (error) {
          ctx.ui.notify(`Remote control disable failed: ${error instanceof Error ? error.message : String(error)}`, "error");
          return;
        }
        runtimeStatusCache.delete(sessionId);
        transcriptEventCanonicalizers.get(sessionId)?.reset();
        transcriptEventCanonicalizers.delete(sessionId);
        clearTimeout(transcriptRetryTimers.get(sessionId));
        transcriptRetryTimers.delete(sessionId);
        deactivateLocalSession(ctx, sessionId, activeSessionIds, pollTimers);
        ctx.ui.notify("Remote control disabled for this session", "info");
        return;
      }

      let response: Response;
      try {
        response = await fetch(`${await daemonBaseUrl()}/v1/tui/sessions`, {
          method: "POST",
          headers: await tuiHeaders(),
          body: JSON.stringify(toRegistration(pi, ctx)),
        });
      } catch (error) {
        ctx.ui.notify(`Remote control enable failed: ${error instanceof Error ? error.message : String(error)}`, "error");
        return;
      }
      if (!response.ok) {
        ctx.ui.notify(`Remote control enable failed: HTTP ${response.status}`, "error");
        return;
      }
      runtimeStatusCache.set(sessionId, comparableRuntimeStatus(collectRuntimeStatus(pi, ctx)));
      activateLocalSession(pi, ctx, sessionId, activeSessionIds, pollTimers, runtimeStatusCache);
      ctx.ui.notify("Remote control enabled for this session", "info");
    },
  });

  pi.registerCommand("remote-control-pair", {
    description: "Display a QR pairing link for Pi Remote Control",
    handler: async (_args, ctx) => {
      try {
        await ensureDaemonStarted(pi);
      } catch (error) {
        ctx.ui.notify(`${error instanceof Error ? error.message : String(error)}; see /tmp/pi-remote-control.log`, "error");
        return;
      }
      const cli = cliCommand();
      const result = await pi.exec(cli.command, [...cli.args, "pair"]);
      const stdout = result.stdout.trim();
      const stderr = result.stderr.trim();
      const output = stdout || stderr || `pi-remote-control pair exited ${result.code}`;
      ctx.ui.notify(output, result.code === 0 ? "info" : "error");
    },
  });
}

function registerEventForwarders(
  pi: ExtensionAPI,
  forward: (event: unknown, ctx: ExtensionContext) => void,
  cleanup: (ctx: ExtensionContext) => void | Promise<void>,
  resetLocalState: (ctx: ExtensionContext) => void,
): void {
  pi.on("session_start", (_event, ctx) => resetLocalState(ctx));
  pi.on("session_shutdown", (_event, ctx) => cleanup(ctx));
  pi.on("session_info_changed" as never, forward as never);
  pi.on("turn_start", forward);
  pi.on("turn_end", forward);
  pi.on("message_start", forward);
  pi.on("message_update", forward);
  pi.on("message_end", forward);
  pi.on("tool_execution_start", forward);
  pi.on("tool_execution_update", forward);
  pi.on("tool_execution_end", forward);
  pi.on("agent_start", forward);
  pi.on("agent_end", forward);
}

function scheduleTranscriptRetry(
  sessionId: string,
  ctx: ExtensionContext,
  canonicalizer: ReturnType<typeof createTranscriptEventCanonicalizer>,
  activeSessionIds: Set<string>,
  retryTimers: Map<string, NodeJS.Timeout>,
): void {
  if (!canonicalizer.hasPending() || retryTimers.has(sessionId)) return;
  const timer = setTimeout(() => {
    retryTimers.delete(sessionId);
    if (!activeSessionIds.has(sessionId)) return;
    canonicalizer.drain(ctx).forEach((event) => void postTuiEvent(sessionId, event));
    scheduleTranscriptRetry(sessionId, ctx, canonicalizer, activeSessionIds, retryTimers);
  }, 100);
  timer.unref?.();
  retryTimers.set(sessionId, timer);
}

async function postTreeStateAfterMessageAppend(event: unknown, ctx: ExtensionContext, sessionId: string): Promise<void> {
  if (asRecord(event).type !== "message_end") return;
  const sessionManager = ctx.sessionManager as typeof ctx.sessionManager & { getLeafId?: () => string | null };
  const leafId = sessionManager.getLeafId?.() ?? null;
  await postTuiEvent(sessionId, {
    type: "tree_state",
    leafId,
    branchVersion: branchVersionForContext(ctx, leafId),
  });
}

function branchVersionForContext(ctx: Pick<ExtensionContext, "sessionManager">, leafId: string | null): string {
  const entries = ctx.sessionManager.getEntries();
  const latestId = readString(asRecord(entries.at(-1)).id) ?? "none";
  return `branchv_${Buffer.from(`${leafId ?? "root"}:${entries.length}:${latestId}`, "utf8").toString("base64url")}`;
}

function sessionNameEventForDaemon(event: unknown): unknown | undefined {
  const name = readString(asRecord(event).name);
  return name ? { type: "session_name", name } : undefined;
}

export function enrichTuiEventForDaemon(event: unknown, ctx: Pick<ExtensionContext, "sessionManager">): unknown {
  const record = asRecord(event);
  if (record.type !== "message_start" && record.type !== "message_update" && record.type !== "message_end") return event;
  const message = asRecord(record.message);
  const entry = [...ctx.sessionManager.getEntries()].reverse().find((candidate) => {
    const candidateRecord = asRecord(candidate);
    return candidateRecord.type === "message" && messagesMatch(candidateRecord.message, message);
  });
  const entryRecord = asRecord(entry);
  const id = readString(entryRecord.id);
  if (!id) return event;
  return {
    ...record,
    id,
    timestamp: readString(entryRecord.timestamp) ?? record.timestamp,
    message: { ...message, id },
  };
}

function messagesMatch(left: unknown, right: unknown): boolean {
  const leftRecord = asRecord(left);
  const rightRecord = asRecord(right);
  if (leftRecord.role !== rightRecord.role) return false;
  if (leftRecord.timestamp !== undefined && rightRecord.timestamp !== undefined) return leftRecord.timestamp === rightRecord.timestamp;
  return JSON.stringify(leftRecord.content) === JSON.stringify(rightRecord.content);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function setRemoteControlStatus(ctx: ExtensionContext): void {
  ctx.ui.setStatus("remote-control", ctx.ui.theme.fg("success", "Remote Control Active"));
}

function clearRemoteControlStatus(ctx: ExtensionContext): void {
  ctx.ui.setStatus("remote-control", undefined);
}

async function unregisterTuiSession(sessionId: string): Promise<void> {
  await fetch(`${await daemonBaseUrl()}/v1/tui/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    headers: await tuiHeaders(false),
  });
}

function activateLocalSession(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  sessionId: string,
  activeSessionIds: Set<string>,
  pollTimers: Map<string, NodeJS.Timeout>,
  runtimeStatusCache: Map<string, string>,
): void {
  activeSessionIds.add(sessionId);
  setRemoteControlStatus(ctx);
  if (pollTimers.has(sessionId)) return;
  const timer = setInterval(() => void pollRemoteCommands(pi, ctx, sessionId, activeSessionIds, pollTimers, runtimeStatusCache).catch(() => undefined), 1000);
  timer.unref?.();
  pollTimers.set(sessionId, timer);
}

function deactivateLocalSession(
  ctx: ExtensionContext,
  sessionId: string,
  activeSessionIds: Set<string>,
  pollTimers: Map<string, NodeJS.Timeout>,
): void {
  activeSessionIds.delete(sessionId);
  clearInterval(pollTimers.get(sessionId));
  pollTimers.delete(sessionId);
  clearRemoteControlStatus(ctx);
}

async function ensureDaemonStarted(pi: ExtensionAPI): Promise<void> {
  const cli = cliCommand();
  const status = await pi.exec(cli.command, [...cli.args, "status"]);
  if (status.code === 0) return;

  const shellLine = `nohup ${shellQuote(cli.command)} ${[...cli.args, "start"].map(shellQuote).join(" ")} </dev/null >/tmp/pi-remote-control.log 2>&1 &`;
  await pi.exec("sh", ["-lc", shellLine]);
  await waitForDaemonReady();
}

async function waitForDaemonReady(attempts = Number.parseInt(process.env.PI_REMOTE_CONTROL_READY_ATTEMPTS ?? "100", 10), delayMs = 100): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${await daemonBaseUrl()}/v1/health`);
      if (response.ok) return;
    } catch {
      // The daemon may not have bound its HTTP port yet.
    }
    await delay(delayMs);
  }
  throw new Error("pi-remote-control did not become ready");
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function toRegistration(pi: unknown, ctx: ExtensionCommandContext): unknown {
  const cwd = ctx.cwd;
  const piSessionId = ctx.sessionManager.getSessionId();
  const sessionFile = ctx.sessionManager.getSessionFile() ?? "";
  return {
    id: daemonSessionId(ctx),
    piSessionId,
    project: { id: projectIdForPath(cwd), name: basename(cwd), path: cwd },
    sessionFile,
    name: ctx.sessionManager.getSessionName(),
    pid: process.pid,
    messageCount: ctx.sessionManager.getEntries().length,
    entries: ctx.sessionManager.getEntries(),
    isStreaming: !ctx.isIdle(),
    runtimeStatus: collectRuntimeStatus(pi, ctx),
    treeSnapshot: treeSnapshotForContext(ctx),
    updatedAt: new Date().toISOString(),
  };
}

function treeSnapshotForContext(ctx: ExtensionCommandContext): unknown {
  const sessionManager = ctx.sessionManager as typeof ctx.sessionManager & {
    getTree?: () => unknown[];
    getLeafId?: () => string | null;
  };
  const roots = sessionManager.getTree?.();
  if (!roots) return undefined;
  return buildTreeSnapshot({
    sessionId: daemonSessionId(ctx),
    roots: roots as never,
    leafId: sessionManager.getLeafId?.() ?? null,
  });
}

function daemonSessionId(ctx: Pick<ExtensionContext, "sessionManager">): string {
  return `sess_${ctx.sessionManager.getSessionId()}`;
}

async function pollRemoteCommands(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  sessionId: string,
  activeSessionIds: Set<string>,
  pollTimers: Map<string, NodeJS.Timeout>,
  runtimeStatusCache: Map<string, string>,
): Promise<void> {
  const response = await fetch(`${await daemonBaseUrl()}/v1/tui/sessions/${encodeURIComponent(sessionId)}/commands`, {
    headers: await tuiHeaders(false),
  });
  if (response.status === 404) {
    await reRegisterTuiSessionAfterHeartbeatMiss(pi, ctx, sessionId, activeSessionIds, pollTimers, runtimeStatusCache);
    return;
  }
  if (!response.ok) return;
  const body = (await response.json()) as { commands?: RemoteTuiCommand[] };
  for (const command of body.commands ?? []) handleRemoteCommand(pi, ctx, command, sessionId);
}

async function reRegisterTuiSessionAfterHeartbeatMiss(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  sessionId: string,
  activeSessionIds: Set<string>,
  pollTimers: Map<string, NodeJS.Timeout>,
  runtimeStatusCache: Map<string, string>,
): Promise<void> {
  if (!activeSessionIds.has(sessionId)) return;

  let response: Response;
  try {
    response = await fetch(`${await daemonBaseUrl()}/v1/tui/sessions`, {
      method: "POST",
      headers: await tuiHeaders(),
      body: JSON.stringify(toRegistration(pi, ctx)),
    });
  } catch {
    disconnectLocalSession(ctx, sessionId, activeSessionIds, pollTimers);
    return;
  }

  if (response.ok) {
    runtimeStatusCache.set(sessionId, comparableRuntimeStatus(collectRuntimeStatus(pi, ctx)));
    return;
  }
  disconnectLocalSession(ctx, sessionId, activeSessionIds, pollTimers);
}

function disconnectLocalSession(
  ctx: ExtensionContext,
  sessionId: string,
  activeSessionIds: Set<string>,
  pollTimers: Map<string, NodeJS.Timeout>,
): void {
  if (!activeSessionIds.has(sessionId)) return;
  deactivateLocalSession(ctx, sessionId, activeSessionIds, pollTimers);
  ctx.ui.notify("Remote control disconnected; run /remote-control to re-enable", "warning");
}

export function handleRemoteCommand(
  pi: Pick<ExtensionAPI, "sendUserMessage">,
  ctx: Pick<ExtensionCommandContext, "abort" | "compact" | "fork" | "isIdle" | "navigateTree" | "sessionManager">,
  command: RemoteTuiCommand,
  sessionId?: string,
): void {
  if (command.type === "remote_prompt") {
    pi.sendUserMessage(command.text, remotePromptDeliveryOptions(ctx, command.streamingBehavior));
    return;
  }
  if (command.type === "remote_abort") ctx.abort();
  if (command.type === "remote_compact") handleRemoteCompactCommand(ctx, command.requestId, sessionId);
  if (command.type === "remote_tree_refresh") handleRemoteTreeRefreshCommand(ctx, command.requestId, sessionId);
  if (command.type === "remote_tree_navigate") handleRemoteTreeNavigateCommand(ctx, command, sessionId);
  if (command.type === "remote_fork") handleRemoteForkCommand(pi, ctx, command, sessionId);
}

function remotePromptDeliveryOptions(ctx: Pick<ExtensionCommandContext, "isIdle">, streamingBehavior: "steer" | "followUp" | null | undefined): { deliverAs: "steer" | "followUp" } | undefined {
  if (streamingBehavior) return { deliverAs: streamingBehavior };
  return ctx.isIdle() ? undefined : { deliverAs: "followUp" };
}

function handleRemoteForkCommand(pi: unknown, ctx: Pick<ExtensionCommandContext, "fork">, command: Extract<RemoteTuiCommand, { type: "remote_fork" }>, sessionId: string | undefined): void {
  if (!sessionId) return;
  void (async () => {
    try {
      let replacementSummary: unknown;
      const result = await ctx.fork(command.targetEntryId, {
        position: "before",
        withSession: async (replacementCtx) => {
          replacementCtx.ui.setEditorText("");
          const registration = toRegistration(pi, replacementCtx as ExtensionCommandContext);
          const response = await fetch(`${await daemonBaseUrl()}/v1/tui/sessions`, {
            method: "POST",
            headers: await tuiHeaders(),
            body: JSON.stringify(registration),
          });
          const responseBody = asRecord(await response.json().catch(() => ({})));
          replacementSummary = { ...asRecord(summaryFromRegistration(registration)), ...asRecord(responseBody.session) };
        },
      });
      const resultRecord = asRecord(result);
      if (result.cancelled) {
        await postTuiEvent(sessionId, { type: "remote_fork_result", requestId: command.requestId, ok: false, error: resultRecord.aborted === true ? "aborted" : "cancelled" } satisfies RemoteForkResultEvent);
        return;
      }
      const newSession = replacementSummary ?? {};
      const editorText = readString(resultRecord.selectedText) ?? readString(resultRecord.editorText) ?? "";
      await postTuiEvent(sessionId, { type: "remote_fork_result", requestId: command.requestId, ok: true, newSession, editorText } satisfies RemoteForkResultEvent);
      await postTuiEvent(sessionId, { type: "remote_session_replaced", requestId: command.requestId, oldSessionId: sessionId, newSession } satisfies RemoteSessionReplacedEvent);
    } catch (error) {
      await postTuiEvent(sessionId, { type: "remote_fork_result", requestId: command.requestId, ok: false, error: forkErrorCode(error) } satisfies RemoteForkResultEvent);
    }
  })().catch(() => undefined);
}

function forkErrorCode(error: unknown): Extract<RemoteForkResultEvent, { ok: false }>["error"] {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("not found")) return "target_not_found";
  if (message.toLowerCase().includes("forkable")) return "target_not_forkable";
  if (message.toLowerCase().includes("abort")) return "aborted";
  return "cancelled";
}

function summaryFromRegistration(registration: unknown): unknown {
  const record = asRecord(registration);
  const project = asRecord(record.project);
  return {
    id: readString(record.id) ?? "",
    piSessionId: readString(record.piSessionId) ?? "",
    projectId: readString(project.id) ?? "",
    name: readString(record.name) ?? null,
    path: readString(record.sessionFile) ?? "",
    updatedAt: readString(record.updatedAt) ?? new Date().toISOString(),
    messageCount: readNumber(record.messageCount) ?? 0,
    isActive: true,
  };
}

function handleRemoteTreeNavigateCommand(ctx: Pick<ExtensionCommandContext, "navigateTree" | "sessionManager">, command: Extract<RemoteTuiCommand, { type: "remote_tree_navigate" }>, sessionId: string | undefined): void {
  if (!sessionId) return;
  void (async () => {
    try {
      const result = await ctx.navigateTree(command.targetEntryId, { summarize: command.summaryMode === "default" });
      const resultRecord = asRecord(result);
      if (result.cancelled) {
        await postTuiEvent(sessionId, { type: "remote_tree_navigation_result", requestId: command.requestId, ok: false, error: resultRecord.aborted === true ? "aborted" : "cancelled" } satisfies RemoteTreeNavigationResultEvent);
        return;
      }
      const snapshot = treeSnapshotForContext({ sessionManager: ctx.sessionManager } as ExtensionCommandContext);
      const snapshotRecord = asRecord(snapshot);
      await postTuiEvent(sessionId, {
        type: "remote_tree_navigation_result",
        requestId: command.requestId,
        ok: true,
        leafId: readString(snapshotRecord.leafId) ?? null,
        snapshotVersion: readString(snapshotRecord.snapshotVersion) ?? "",
        branchVersion: readString(snapshotRecord.branchVersion) ?? "",
        ...(typeof resultRecord.editorText === "string" ? { editorText: resultRecord.editorText } : {}),
      } satisfies RemoteTreeNavigationResultEvent);
    } catch (error) {
      await postTuiEvent(sessionId, { type: "remote_tree_navigation_result", requestId: command.requestId, ok: false, error: navigationErrorCode(error) } satisfies RemoteTreeNavigationResultEvent);
    }
  })().catch(() => undefined);
}

function navigationErrorCode(error: unknown): Extract<RemoteTreeNavigationResultEvent, { ok: false }>["error"] {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("not found")) return "target_not_found";
  if (message.toLowerCase().includes("abort")) return "aborted";
  return "summarization_failed";
}

function handleRemoteTreeRefreshCommand(ctx: Pick<ExtensionCommandContext, "sessionManager">, requestId: string, sessionId: string | undefined): void {
  if (!sessionId) return;
  const snapshot = treeSnapshotForContext({ sessionManager: ctx.sessionManager } as ExtensionCommandContext);
  if (!snapshot) return;
  void postTuiEvent(sessionId, { type: "remote_tree_snapshot", requestId, snapshot }).catch(() => undefined);
}

function handleRemoteCompactCommand(ctx: Pick<ExtensionCommandContext, "compact">, requestId: string, sessionId: string | undefined): void {
  const postResult = (event: RemoteCompactResultEvent) => {
    if (sessionId) void postTuiEvent(sessionId, event).catch(() => undefined);
  };
  try {
    ctx.compact({
      onComplete: (result) => postResult(toRemoteCompactSuccessEvent(requestId, result)),
      onError: (error) => postResult(toRemoteCompactErrorEvent(requestId, error)),
    });
  } catch (error) {
    postResult(toRemoteCompactErrorEvent(requestId, error));
  }
}

function toRemoteCompactSuccessEvent(requestId: string, result: unknown): RemoteCompactResultEvent {
  const record = asRecord(result);
  return {
    type: "remote_compact_result",
    requestId,
    ok: true,
    summary: readString(record.summary) ?? "",
    firstKeptEntryId: readString(record.firstKeptEntryId) ?? "",
    tokensBefore: readNumber(record.tokensBefore) ?? 0,
  };
}

function toRemoteCompactErrorEvent(requestId: string, error: unknown): RemoteCompactResultEvent {
  return {
    type: "remote_compact_result",
    requestId,
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  };
}

async function postTuiEvent(sessionId: string, event: unknown): Promise<void> {
  await fetch(`${await daemonBaseUrl()}/v1/tui/sessions/${encodeURIComponent(sessionId)}/events`, {
    method: "POST",
    headers: await tuiHeaders(),
    body: JSON.stringify(event),
  });
}

async function postRuntimeStatusIfChanged(pi: unknown, ctx: ExtensionContext, sessionId: string, runtimeStatusCache: Map<string, string>): Promise<void> {
  const status = collectRuntimeStatus(pi, ctx);
  const comparable = comparableRuntimeStatus(status);
  if (runtimeStatusCache.get(sessionId) === comparable) return;
  runtimeStatusCache.set(sessionId, comparable);
  await postTuiEvent(sessionId, { type: "runtime_status", status });
}

function comparableRuntimeStatus(status: ReturnType<typeof collectRuntimeStatus>): string {
  const { updatedAt: _updatedAt, ...rest } = status;
  return JSON.stringify(rest);
}

async function daemonBaseUrl(): Promise<string> {
  if (process.env.PI_REMOTE_CONTROL_LOCAL_URL) return process.env.PI_REMOTE_CONTROL_LOCAL_URL;

  try {
    const config = await loadDaemonConfig(getDaemonStateDir());
    return bindAddressToBaseUrl(config.bindAddress);
  } catch {
    return "http://127.0.0.1:17373";
  }
}

function bindAddressToBaseUrl(bindAddress: string): string {
  const index = bindAddress.lastIndexOf(":");
  if (index === -1) return `http://127.0.0.1:17373`;
  const port = bindAddress.slice(index + 1);
  return `http://127.0.0.1:${port}`;
}

async function tuiHeaders(includeContentType = true): Promise<Record<string, string>> {
  const headers: Record<string, string> = includeContentType ? { "content-type": "application/json" } : {};
  const token = process.env.PI_REMOTE_CONTROL_DEV_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function cliCommand(): { command: string; args: string[] } {
  const extensionDir = dirname(fileURLToPath(import.meta.url));
  const packageRoot = resolve(extensionDir, "..", "..");
  const sourceRunner = resolve(packageRoot, "src", "cli-runner.cjs");
  if (existsSync(sourceRunner)) return { command: process.execPath, args: [sourceRunner] };

  const distCli = resolve(packageRoot, "dist", "cli.js");
  if (existsSync(distCli)) return { command: process.execPath, args: [distCli] };

  return { command: "pi-remote-control", args: [] };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
