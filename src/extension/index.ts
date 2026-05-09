import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function remoteDaemonExtension(pi: ExtensionAPI): void {
  pi.registerCommand("remote-daemon", {
    description: "Control the Pi remote daemon",
    handler: async (args, ctx) => {
      const commandArgs = splitArgs(args.trim() || "status");
      const result = await pi.exec("pi-remote-daemon", commandArgs);
      const output = result.stdout.trim() || result.stderr.trim() || `pi-remote-daemon ${commandArgs.join(" ")} exited ${result.code}`;
      ctx.ui.notify(output, result.code === 0 ? "info" : "error");
    },
  });
}

function splitArgs(input: string): string[] {
  return input.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, "")) ?? [];
}
