import { chmod, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createAPNsProvider } from "./apns.js";
import { startPushGatewayServer } from "./http.js";
import { createPushGatewayService } from "./service.js";

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const required = ["PI_APNS_TEAM_ID", "PI_APNS_KEY_ID", "PI_APNS_BUNDLE_ID", "PI_APNS_PRIVATE_KEY_PATH", "PI_PUSH_GATEWAY_STATE_DIR"] as const;
  const missing = required.filter((name) => !env[name]);
  if (missing.length > 0) {
    console.error(`Missing required Push Gateway configuration: ${missing.join(", ")}`);
    return 1;
  }

  const stateDir = env.PI_PUSH_GATEWAY_STATE_DIR!;
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await chmod(stateDir, 0o700);
  const privateKey = await readFile(env.PI_APNS_PRIVATE_KEY_PATH!, "utf8");
  const sendNotification = createAPNsProvider({
    teamId: env.PI_APNS_TEAM_ID!,
    keyId: env.PI_APNS_KEY_ID!,
    bundleId: env.PI_APNS_BUNDLE_ID!,
    privateKey,
  });
  const service = createPushGatewayService({
    databasePath: join(stateDir, "push-gateway.sqlite"),
    sendNotification,
    maxNotificationsPerHour: Number.parseInt(env.PI_PUSH_GATEWAY_MAX_PER_HOUR ?? "20", 10),
  });
  const server = await startPushGatewayServer({
    bindAddress: env.PI_PUSH_GATEWAY_BIND ?? "127.0.0.1:17473",
    service,
    maxRouteCreationsPerHour: Number.parseInt(env.PI_PUSH_GATEWAY_MAX_ROUTE_CREATIONS_PER_HOUR ?? "20", 10),
  });
  console.log(`pi-relay-push-gateway listening on http://${server.address}`);
  try {
    await new Promise<void>((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
  } finally {
    await server.close();
    service.close();
  }
  return 0;
}
