#!/usr/bin/env node
import { defaultDaemonConfig, loadDaemonConfig } from "./config.js";
import { ensureDaemonStateDir, getDaemonStateDir } from "./paths.js";
import { startDaemonServer, type DaemonServer, type StartServerOptions } from "./server/http.js";
import type { DaemonConfig } from "./types.js";

export type CliDependencies = {
  getStateDir?: (options?: { env?: NodeJS.ProcessEnv }) => string;
  ensureStateDir?: (stateDir: string) => Promise<void>;
  loadConfig?: (stateDir: string) => Promise<DaemonConfig>;
  startServer?: (options: StartServerOptions) => Promise<DaemonServer>;
  waitForShutdown?: () => Promise<void>;
  writeLine?: (line: string) => void;
  env?: NodeJS.ProcessEnv;
};

export async function main(argv = process.argv.slice(2), deps: CliDependencies = {}): Promise<number> {
  const command = argv[0];
  if (command !== "start") {
    (deps.writeLine ?? console.log)("Usage: pi-remote-daemon start [--state-dir DIR] [--bind HOST:PORT]");
    return command === "--help" || command === "-h" ? 0 : 1;
  }

  const env = deps.env ?? process.env;
  const parsed = parseStartArgs(argv.slice(1));
  const stateDir = parsed.stateDir ?? (deps.getStateDir ?? getDaemonStateDir)({ env });
  await (deps.ensureStateDir ?? ensureDaemonStateDir)(stateDir);

  const loadedConfig = await (deps.loadConfig ?? loadDaemonConfig)(stateDir).catch((error) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return defaultDaemonConfig();
    }
    throw error;
  });
  const config = { ...loadedConfig, bindAddress: parsed.bindAddress ?? loadedConfig.bindAddress };
  const devToken = env.PI_REMOTE_DAEMON_DEV_TOKEN;
  const server = await (deps.startServer ?? startDaemonServer)({
    stateDir,
    config,
    authenticateToken: devToken ? (token) => token === devToken : undefined,
  });

  (deps.writeLine ?? console.log)(`pi-remote-daemon listening on http://${server.address}`);
  if (devToken) (deps.writeLine ?? console.log)("dev token authentication is enabled");

  await (deps.waitForShutdown ?? waitForInterrupt)();
  await server.close();
  return 0;
}

function parseStartArgs(args: string[]): { stateDir?: string; bindAddress?: string } {
  const parsed: { stateDir?: string; bindAddress?: string } = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--state-dir") parsed.stateDir = args[++index];
    else if (arg === "--bind") parsed.bindAddress = args[++index];
    else throw new Error(`Unknown start option: ${arg}`);
  }
  return parsed;
}

async function waitForInterrupt(): Promise<void> {
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
