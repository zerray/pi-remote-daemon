import { NotImplementedError } from "../errors.js";
import type { DaemonConfig } from "../types.js";

export type DaemonServer = {
  address: string;
  close(): Promise<void>;
};

export type StartServerOptions = {
  stateDir: string;
  config: DaemonConfig;
};

export async function startDaemonServer(options: StartServerOptions): Promise<DaemonServer> {
  // Initialize persistence and session services.
  // Bind the HTTP/WebSocket listener to config.bindAddress.
  // Register health, pairing, project, session, prompt, abort, and stream routes.
  void options;
  throw new NotImplementedError("startDaemonServer");
}
