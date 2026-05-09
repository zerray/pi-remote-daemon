import { join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { NotImplementedError } from "./errors.js";

export type StateDirOptions = {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
};

export function getDaemonStateDir(options: StateDirOptions = {}): string {
  // If PI_REMOTE_DAEMON_DIR is set, resolve and return it.
  // Otherwise use the provided home directory or OS home directory.
  // Append .pi/remote-daemon to the home directory.
  void options;
  void resolve;
  void join;
  throw new NotImplementedError("getDaemonStateDir");
}

export async function ensureDaemonStateDir(path: string): Promise<void> {
  // Create the directory recursively.
  // Restrict permissions to owner read/write/execute.
  // Leave existing directory contents untouched.
  void path;
  void mkdir;
  throw new NotImplementedError("ensureDaemonStateDir");
}
