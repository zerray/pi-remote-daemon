import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RemoteTuiCommand } from "../active-session-registry.js";
import { loadDaemonConfig } from "../config.js";
import { getDaemonStateDir } from "../paths.js";
import { projectIdForPath } from "../session-index.js";

export default function remoteControlExtension(pi: ExtensionAPI): void {
  const activeSessionIds = new Set<string>();
  const pollTimers = new Map<string, NodeJS.Timeout>();
  const forward = (event: unknown, ctx: ExtensionContext) => {
    const sessionId = daemonSessionId(ctx);
    if (activeSessionIds.has(sessionId)) void postTuiEvent(sessionId, event);
  };
  const cleanup = (ctx: ExtensionContext) => {
    const sessionId = daemonSessionId(ctx);
    deactivateLocalSession(ctx, sessionId, activeSessionIds, pollTimers);
    void unregisterTuiSession(sessionId).catch(() => undefined);
  };
  const sync = (ctx: ExtensionCommandContext) => {
    void syncRemoteControlStatus(pi, ctx, activeSessionIds, pollTimers).catch(() => undefined);
  };

  registerEventForwarders(pi, forward, cleanup, sync);

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
        deactivateLocalSession(ctx, sessionId, activeSessionIds, pollTimers);
        ctx.ui.notify("Remote control disabled for this session", "info");
        return;
      }

      let response: Response;
      try {
        response = await fetch(`${await daemonBaseUrl()}/v1/tui/sessions`, {
          method: "POST",
          headers: await tuiHeaders(),
          body: JSON.stringify(toRegistration(ctx)),
        });
      } catch (error) {
        ctx.ui.notify(`Remote control enable failed: ${error instanceof Error ? error.message : String(error)}`, "error");
        return;
      }
      if (!response.ok) {
        ctx.ui.notify(`Remote control enable failed: HTTP ${response.status}`, "error");
        return;
      }
      activateLocalSession(pi, ctx, sessionId, activeSessionIds, pollTimers);
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
  cleanup: (ctx: ExtensionContext) => void,
  sync: (ctx: ExtensionCommandContext) => void,
): void {
  pi.on("session_start", (_event, ctx) => sync(ctx as ExtensionCommandContext));
  pi.on("session_shutdown", (_event, ctx) => cleanup(ctx));
  pi.on("message_start", forward);
  pi.on("message_update", forward);
  pi.on("message_end", forward);
  pi.on("tool_execution_start", forward);
  pi.on("tool_execution_update", forward);
  pi.on("tool_execution_end", forward);
  pi.on("agent_start", forward);
  pi.on("agent_end", forward);
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

async function syncRemoteControlStatus(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  activeSessionIds: Set<string>,
  pollTimers: Map<string, NodeJS.Timeout>,
): Promise<void> {
  const sessionId = daemonSessionId(ctx);
  deactivateLocalSession(ctx, sessionId, activeSessionIds, pollTimers);
  const response = await fetch(`${await daemonBaseUrl()}/v1/tui/sessions/${encodeURIComponent(sessionId)}`, {
    headers: await tuiHeaders(false),
  });
  if (!response.ok) return;

  const registerResponse = await fetch(`${await daemonBaseUrl()}/v1/tui/sessions`, {
    method: "POST",
    headers: await tuiHeaders(),
    body: JSON.stringify(toRegistration(ctx)),
  });
  if (registerResponse.ok) activateLocalSession(pi, ctx, sessionId, activeSessionIds, pollTimers);
}

function activateLocalSession(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  sessionId: string,
  activeSessionIds: Set<string>,
  pollTimers: Map<string, NodeJS.Timeout>,
): void {
  activeSessionIds.add(sessionId);
  setRemoteControlStatus(ctx);
  if (pollTimers.has(sessionId)) return;
  const timer = setInterval(() => void pollRemoteCommands(pi, ctx, sessionId).catch(() => undefined), 1000);
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

function toRegistration(ctx: ExtensionCommandContext): unknown {
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
    updatedAt: new Date().toISOString(),
  };
}

function daemonSessionId(ctx: Pick<ExtensionContext, "sessionManager">): string {
  return `sess_${ctx.sessionManager.getSessionId()}`;
}

async function pollRemoteCommands(pi: ExtensionAPI, ctx: ExtensionCommandContext, sessionId: string): Promise<void> {
  const response = await fetch(`${await daemonBaseUrl()}/v1/tui/sessions/${encodeURIComponent(sessionId)}/commands`, {
    headers: await tuiHeaders(false),
  });
  if (!response.ok) return;
  const body = (await response.json()) as { commands?: RemoteTuiCommand[] };
  for (const command of body.commands ?? []) handleRemoteCommand(pi, ctx, command);
}

export function handleRemoteCommand(pi: Pick<ExtensionAPI, "sendUserMessage">, ctx: Pick<ExtensionCommandContext, "abort">, command: RemoteTuiCommand): void {
  if (command.type === "remote_prompt") {
    pi.sendUserMessage(command.text, command.streamingBehavior ? { deliverAs: command.streamingBehavior } : undefined);
    return;
  }
  if (command.type === "remote_abort") ctx.abort();
}

async function postTuiEvent(sessionId: string, event: unknown): Promise<void> {
  await fetch(`${await daemonBaseUrl()}/v1/tui/sessions/${encodeURIComponent(sessionId)}/events`, {
    method: "POST",
    headers: await tuiHeaders(),
    body: JSON.stringify(event),
  });
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
