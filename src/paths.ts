import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";
import { NotImplementedError } from "./errors.js";

export type StateDirOptions = {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
};

export function getDaemonStateDir(options: StateDirOptions = {}): string {
  const env = options.env ?? process.env;
  if (env.PI_REMOTE_DAEMON_DIR) return resolve(env.PI_REMOTE_DAEMON_DIR);

  const home = options.homeDir ?? homedir();
  return join(home, ".pi", "remote-daemon");
}

export async function ensureDaemonStateDir(path: string): Promise<void> {
  // Create the directory recursively.
  // Restrict permissions to owner read/write/execute.
  // Leave existing directory contents untouched.
  void path;
  void mkdir;
  throw new NotImplementedError("ensureDaemonStateDir");
}
