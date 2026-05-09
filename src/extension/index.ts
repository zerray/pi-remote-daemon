import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function remoteDaemonExtension(pi: ExtensionAPI): void {
  pi.registerCommand("remote-daemon", {
    description: "Control the Pi remote daemon",
    handler: async (args, ctx) => {
      const commandArgs = splitArgs(args.trim() || "status");
      if (commandArgs[0] === "start") {
        const shellLine = `${shellQuote(cliCommand().command)} ${[...cliCommand().args, ...commandArgs]
          .map(shellQuote)
          .join(" ")} >/tmp/pi-remote-daemon.log 2>&1 &`;
        await pi.exec("sh", ["-lc", shellLine]);
        ctx.ui.notify("pi-remote-daemon start requested", "info");
        return;
      }

      const cli = cliCommand();
      const result = await pi.exec(cli.command, [...cli.args, ...commandArgs]);
      const stdout = result.stdout.trim();
      const stderr = result.stderr.trim();
      const output = stdout || stderr || `pi-remote-daemon ${commandArgs.join(" ")} exited ${result.code}`;
      const type = result.code === 0 ? "info" : stdout ? "warning" : "error";
      ctx.ui.notify(output, type);
    },
  });
}

function cliCommand(): { command: string; args: string[] } {
  const extensionDir = dirname(fileURLToPath(import.meta.url));
  const packageRoot = resolve(extensionDir, "..", "..");
  const sourceRunner = resolve(packageRoot, "src", "cli-runner.cjs");
  if (existsSync(sourceRunner)) return { command: process.execPath, args: [sourceRunner] };

  const distCli = resolve(packageRoot, "dist", "cli.js");
  if (existsSync(distCli)) return { command: process.execPath, args: [distCli] };

  return { command: "pi-remote-daemon", args: [] };
}

function splitArgs(input: string): string[] {
  return input.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, "")) ?? [];
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
