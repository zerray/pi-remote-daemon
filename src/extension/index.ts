import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { projectIdForPath } from "../session-index.js";

export default function remoteControlExtension(pi: ExtensionAPI): void {
  const activeSessionIds = new Set<string>();
  pi.registerCommand("remote-control", {
    description: "Toggle Pi remote control for this TUI session",
    handler: async (_args, ctx) => {
      await ensureDaemonStarted(pi);
      const sessionId = daemonSessionId(ctx);
      if (activeSessionIds.has(sessionId)) {
        await fetch(`${daemonBaseUrl()}/v1/tui/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
        activeSessionIds.delete(sessionId);
        ctx.ui.notify("Remote control disabled for this session", "info");
        return;
      }

      const response = await fetch(`${daemonBaseUrl()}/v1/tui/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toRegistration(ctx)),
      });
      if (!response.ok) {
        ctx.ui.notify(`Remote control enable failed: HTTP ${response.status}`, "error");
        return;
      }
      activeSessionIds.add(sessionId);
      ctx.ui.notify("Remote control enabled for this session", "info");
    },
  });

  pi.registerCommand("remote-control-pair", {
    description: "Display a QR pairing link for Pi Remote Control",
    handler: async (_args, ctx) => {
      await ensureDaemonStarted(pi);
      const cli = cliCommand();
      const result = await pi.exec(cli.command, [...cli.args, "pair"]);
      const stdout = result.stdout.trim();
      const stderr = result.stderr.trim();
      const output = stdout || stderr || `pi-remote-control pair exited ${result.code}`;
      ctx.ui.notify(output, result.code === 0 ? "info" : "error");
    },
  });
}

async function ensureDaemonStarted(pi: ExtensionAPI): Promise<void> {
  const cli = cliCommand();
  const status = await pi.exec(cli.command, [...cli.args, "status"]);
  if (status.code === 0) return;

  const shellLine = `${shellQuote(cli.command)} ${[...cli.args, "start"].map(shellQuote).join(" ")} >/tmp/pi-remote-control.log 2>&1 &`;
  await pi.exec("sh", ["-lc", shellLine]);
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
    isStreaming: !ctx.isIdle(),
    updatedAt: new Date().toISOString(),
  };
}

function daemonSessionId(ctx: ExtensionCommandContext): string {
  return `sess_${ctx.sessionManager.getSessionId()}`;
}

function daemonBaseUrl(): string {
  return process.env.PI_REMOTE_CONTROL_URL ?? "http://127.0.0.1:17373";
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
