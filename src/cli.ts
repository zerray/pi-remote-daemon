#!/usr/bin/env node
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
  readTextFile?: (path: string) => Promise<string>;
  writeTextFile?: (path: string, content: string) => Promise<void>;
  removeFile?: (path: string) => Promise<void>;
  isProcessRunning?: (pid: number) => boolean;
  sendSignal?: (pid: number, signal: NodeJS.Signals) => void;
  writeLine?: (line: string) => void;
  env?: NodeJS.ProcessEnv;
};

export async function main(argv = process.argv.slice(2), deps: CliDependencies = {}): Promise<number> {
  const command = argv[0];
  const env = deps.env ?? process.env;
  if (command === "status") return statusCommand(argv.slice(1), deps, env);
  if (command === "stop") return stopCommand(argv.slice(1), deps, env);
  if (command !== "start") {
    (deps.writeLine ?? console.log)("Usage: pi-remote-daemon start|stop|status|pair [options]");
    return command === "--help" || command === "-h" ? 0 : 1;
  }

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
  const pidFile = join(stateDir, "daemon.pid");
  await (deps.writeTextFile ?? writeFile)(pidFile, `${process.pid}\n`);

  (deps.writeLine ?? console.log)(`pi-remote-daemon listening on http://${server.address}`);
  if (devToken) (deps.writeLine ?? console.log)("dev token authentication is enabled");

  await (deps.waitForShutdown ?? waitForInterrupt)();
  await server.close();
  await (deps.removeFile ?? ((path: string) => rm(path, { force: true })))(pidFile);
  return 0;
}

async function stopCommand(args: string[], deps: CliDependencies, env: NodeJS.ProcessEnv): Promise<number> {
  const stateDir = parseStateDirArg(args) ?? (deps.getStateDir ?? getDaemonStateDir)({ env });
  const writeLine = deps.writeLine ?? console.log;
  const readTextFile = deps.readTextFile ?? ((path: string) => readFile(path, "utf8"));

  const pidFile = join(stateDir, "daemon.pid");
  try {
    const pid = Number.parseInt((await readTextFile(pidFile)).trim(), 10);
    (deps.sendSignal ?? process.kill)(pid, "SIGTERM");
    await (deps.removeFile ?? ((path: string) => rm(path, { force: true })))(pidFile);
    writeLine(`pi-remote-daemon stop requested (pid ${pid})`);
    return 0;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      writeLine("pi-remote-daemon is not running");
      return 1;
    }
    throw error;
  }
}

async function statusCommand(args: string[], deps: CliDependencies, env: NodeJS.ProcessEnv): Promise<number> {
  const stateDir = parseStateDirArg(args) ?? (deps.getStateDir ?? getDaemonStateDir)({ env });
  const writeLine = deps.writeLine ?? console.log;
  const readTextFile = deps.readTextFile ?? ((path: string) => readFile(path, "utf8"));

  try {
    const pid = Number.parseInt((await readTextFile(join(stateDir, "daemon.pid"))).trim(), 10);
    const running = (deps.isProcessRunning ?? isProcessRunning)(pid);
    writeLine(running ? `pi-remote-daemon is running (pid ${pid})` : "pi-remote-daemon is stopped");
    return running ? 0 : 1;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      writeLine("pi-remote-daemon is stopped");
      return 1;
    }
    throw error;
  }
}

function parseStateDirArg(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--state-dir") return args[index + 1];
  }
  return undefined;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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
