import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function remoteDaemonExtension(pi: ExtensionAPI): void {
  pi.registerCommand("remote-daemon", {
    description: "Control the Pi remote daemon",
    handler: async (args, ctx) => {
      const commandArgs = splitArgs(args.trim() || "status");
      const result = await pi.exec("pi-remote-daemon", commandArgs);
      const stdout = result.stdout.trim();
      const stderr = result.stderr.trim();
      const output = stdout || stderr || `pi-remote-daemon ${commandArgs.join(" ")} exited ${result.code}`;
      const type = result.code === 0 ? "info" : stdout ? "warning" : "error";
      ctx.ui.notify(output, type);
    },
  });
}

function splitArgs(input: string): string[] {
  return input.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, "")) ?? [];
}
