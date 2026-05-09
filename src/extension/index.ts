import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function remoteDaemonExtension(pi: ExtensionAPI): void {
  pi.registerCommand("remote-daemon", {
    description: "Control the Pi remote daemon",
    handler: async (args, ctx) => {
      ctx.ui.notify(`remote-daemon ${args || "status"} is not implemented yet`, "warning");
    },
  });
}
