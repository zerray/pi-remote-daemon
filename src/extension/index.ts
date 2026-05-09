import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { NotImplementedError } from "../errors.js";

export default function remoteDaemonExtension(pi: ExtensionAPI): void {
  // Register /remote-daemon status.
  // Register /remote-daemon start.
  // Register /remote-daemon stop.
  // Register /remote-daemon pair.
  // Do not start the daemon automatically on extension load.
  void pi;
  throw new NotImplementedError("remoteDaemonExtension");
}
