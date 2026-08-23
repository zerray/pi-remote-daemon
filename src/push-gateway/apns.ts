import { randomUUID, sign } from "node:crypto";
import { connect } from "node:http2";
import type { APNsNotification } from "./service.js";

export class APNsProviderError extends Error {
  constructor(public readonly status: number, public readonly reason?: string) {
    super(`APNs ${status}${reason ? `: ${reason}` : ""}`);
    this.name = "APNsProviderError";
  }
}

export type APNsTransport = (request: {
  authority: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}) => Promise<{ status: number; reason?: string }>;

export function createAPNsProvider(options: {
  teamId: string;
  keyId: string;
  bundleId: string;
  privateKey: string;
  transport?: APNsTransport;
  now?: () => Date;
}): (notification: APNsNotification) => Promise<void> {
  const transport = options.transport ?? sendHTTP2Request;
  const now = options.now ?? (() => new Date());
  let cachedToken: { value: string; issuedAtMs: number } | undefined;

  return async (notification) => {
    const currentTime = now();
    if (!cachedToken || currentTime.getTime() - cachedToken.issuedAtMs >= 50 * 60_000) {
      const encodedHeader = Buffer.from(JSON.stringify({ alg: "ES256", kid: options.keyId }), "utf8").toString("base64url");
      const encodedClaims = Buffer.from(JSON.stringify({ iss: options.teamId, iat: Math.floor(currentTime.getTime() / 1000) }), "utf8").toString("base64url");
      const signingInput = `${encodedHeader}.${encodedClaims}`;
      const signature = sign("sha256", Buffer.from(signingInput), { key: options.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
      cachedToken = { value: `${signingInput}.${signature}`, issuedAtMs: currentTime.getTime() };
    }

    const result = await transport({
      authority: notification.environment === "development"
        ? "https://api.sandbox.push.apple.com"
        : "https://api.push.apple.com",
      path: `/3/device/${encodeURIComponent(notification.deviceToken)}`,
      headers: {
        authorization: `bearer ${cachedToken.value}`,
        "apns-topic": options.bundleId,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-id": randomUUID(),
      },
      body: JSON.stringify(notification.payload),
    });
    if (result.status !== 200) {
      throw new APNsProviderError(result.status, result.reason);
    }
  };
}

async function sendHTTP2Request(request: {
  authority: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}): Promise<{ status: number; reason?: string }> {
  const client = connect(request.authority);
  try {
    return await new Promise((resolve, reject) => {
      const stream = client.request({ ":method": "POST", ":path": request.path, ...request.headers });
      let status = 0;
      let responseBody = "";
      stream.setEncoding("utf8");
      stream.on("response", (headers) => {
        status = Number(headers[":status"] ?? 0);
      });
      stream.on("data", (chunk) => { responseBody += chunk; });
      stream.on("end", () => {
        let reason: string | undefined;
        try {
          const parsed = JSON.parse(responseBody) as { reason?: unknown };
          reason = typeof parsed.reason === "string" ? parsed.reason : undefined;
        } catch {
          reason = undefined;
        }
        resolve({ status, reason });
      });
      stream.on("error", reject);
      stream.end(request.body);
    });
  } finally {
    client.close();
  }
}
