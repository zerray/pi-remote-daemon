import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NotImplementedError } from "./errors.js";
import type { DaemonConfig } from "./types.js";

export const DEFAULT_BIND_ADDRESS = "127.0.0.1:17373";

export function defaultDaemonConfig(): DaemonConfig {
  // Return the safe default bind address.
  // Start with no allowed projects.
  throw new NotImplementedError("defaultDaemonConfig");
}

export async function loadDaemonConfig(stateDir: string): Promise<DaemonConfig> {
  // Read config.json from the state directory.
  // If it does not exist, return defaultDaemonConfig().
  // Validate the parsed JSON shape before returning it.
  void stateDir;
  void readFile;
  void join;
  throw new NotImplementedError("loadDaemonConfig");
}

export async function saveDaemonConfig(stateDir: string, config: DaemonConfig): Promise<void> {
  // Validate the config shape.
  // Serialize as pretty JSON.
  // Write config.json with owner-readable permissions only.
  void stateDir;
  void config;
  void writeFile;
  void join;
  throw new NotImplementedError("saveDaemonConfig");
}
