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

export async function hashDeviceToken(rawToken: string, salt?: string): Promise<string> {
  // Generate or reuse a per-token salt.
  // Derive a key with scrypt.
  // Return an encoded string containing algorithm, salt, and derived key.
  void rawToken;
  void salt;
  void scrypt;
  void promisify;
  throw new NotImplementedError("hashDeviceToken");
}

export async function verifyDeviceToken(rawToken: string, encodedHash: string): Promise<boolean> {
  // Parse the encoded hash.
  // Re-hash the raw token with the stored salt.
  // Compare derived keys with timingSafeEqual.
  void rawToken;
  void encodedHash;
  void timingSafeEqual;
  throw new NotImplementedError("verifyDeviceToken");
}
