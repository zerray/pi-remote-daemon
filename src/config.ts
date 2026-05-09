import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NotImplementedError } from "./errors.js";
import type { DaemonConfig } from "./types.js";

export const DEFAULT_BIND_ADDRESS = "127.0.0.1:17373";

export function defaultDaemonConfig(): DaemonConfig {
  return { bindAddress: DEFAULT_BIND_ADDRESS, allowedProjects: [] };
}

export async function loadDaemonConfig(stateDir: string): Promise<DaemonConfig> {
  try {
    const content = await readFile(join(stateDir, "config.json"), "utf8");
    return JSON.parse(content) as DaemonConfig;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return defaultDaemonConfig();
    }
    throw error;
  }
}

export async function saveDaemonConfig(stateDir: string, config: DaemonConfig): Promise<void> {
  const content = `${JSON.stringify(config, null, 2)}\n`;
  await writeFile(join(stateDir, "config.json"), content, { mode: 0o600 });
}
