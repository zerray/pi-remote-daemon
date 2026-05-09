import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { DaemonConfig } from "../types.js";

export type DaemonServer = {
  address: string;
  close(): Promise<void>;
};

export type StartServerOptions = {
  stateDir: string;
  config: DaemonConfig;
  piVersion?: string;
  daemonVersion?: string;
  authenticateToken?: (token: string) => boolean | Promise<boolean>;
};

export async function startDaemonServer(options: StartServerOptions): Promise<DaemonServer> {
  const server = createServer((request, response) => {
    void handleHttpRequest(request, response, options);
  });

  const { host, port } = parseBindAddress(options.config.bindAddress);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  return {
    address: `${address.address}:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: StartServerOptions,
): Promise<void> {
  if (request.method === "GET" && request.url === "/v1/health") {
    writeJson(response, 200, {
      status: "ok",
      piVersion: options.piVersion ?? "unknown",
      daemonVersion: options.daemonVersion ?? "0.1.0",
    });
    return;
  }

  if (request.method === "GET" && request.url === "/v1/projects") {
    if (!(await isAuthorized(request, options))) {
      writeJson(response, 401, { error: "unauthorized" });
      return;
    }

    writeJson(response, 200, { projects: options.config.allowedProjects });
    return;
  }

  writeJson(response, 404, { error: "not_found" });
}

async function isAuthorized(request: IncomingMessage, options: StartServerOptions): Promise<boolean> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return false;
  const token = authorization.slice("Bearer ".length);
  return options.authenticateToken ? Boolean(await options.authenticateToken(token)) : false;
}

function parseBindAddress(bindAddress: string): { host: string; port: number } {
  const index = bindAddress.lastIndexOf(":");
  if (index === -1) throw new Error(`Invalid bind address: ${bindAddress}`);
  return {
    host: bindAddress.slice(0, index),
    port: Number.parseInt(bindAddress.slice(index + 1), 10),
  };
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
