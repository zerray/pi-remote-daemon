import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { NotImplementedError } from "../errors.js";

export type IssuedDeviceToken = {
  rawToken: string;
  tokenHash: string;
};

export function issueDeviceToken(): IssuedDeviceToken {
  const rawToken = `prd_${randomBytes(32).toString("base64url")}`;
  const salt = randomBytes(16).toString("base64url");
  const derived = scryptSync(rawToken, salt, 32).toString("base64url");
  return { rawToken, tokenHash: `scrypt:${salt}:${derived}` };
}

export async function hashDeviceToken(rawToken: string, salt = randomBytes(16).toString("base64url")): Promise<string> {
  const derive = promisify(scrypt) as (password: string, salt: string, keylen: number) => Promise<Buffer>;
  const derived = await derive(rawToken, salt, 32);
  return `scrypt:${salt}:${derived.toString("base64url")}`;
}

export async function verifyDeviceToken(rawToken: string, encodedHash: string): Promise<boolean> {
  const [algorithm, salt, expected] = encodedHash.split(":");
  if (algorithm !== "scrypt" || !salt || !expected) return false;

  const actual = await hashDeviceToken(rawToken, salt);
  const actualKey = Buffer.from(actual.split(":")[2] ?? "");
  const expectedKey = Buffer.from(expected);
  return actualKey.length === expectedKey.length && timingSafeEqual(actualKey, expectedKey);
}
