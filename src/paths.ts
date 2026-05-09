import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { chmod, mkdir } from "node:fs/promises";

export type StateDirOptions = {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
};

export function getDaemonStateDir(options: StateDirOptions = {}): string {
  const env = options.env ?? process.env;
  if (env.PI_REMOTE_CONTROL_DIR) return resolve(env.PI_REMOTE_CONTROL_DIR);

  const home = options.homeDir ?? homedir();
  return join(home, ".pi", "remote-control");
}

export async function ensureDaemonStateDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}
