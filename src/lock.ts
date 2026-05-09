import { open, rm } from "node:fs/promises";
import { join } from "node:path";

export type DaemonLock = {
  path: string;
  release(): Promise<void>;
};

export async function acquireDaemonLock(stateDir: string, pid = process.pid): Promise<DaemonLock | undefined> {
  const path = join(stateDir, "daemon.lock");
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") return undefined;
    throw error;
  }

  await handle.writeFile(`${pid}\n`, "utf8");
  await handle.close();

  return {
    path,
    release: () => rm(path, { force: true }),
  };
}
