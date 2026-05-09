export type PairingLinkOptions = {
  advertisedBaseUrl?: string;
  pairCode: string;
  expiresAt: string;
};

export function buildPairingLink(options: PairingLinkOptions): string {
  if (!options.advertisedBaseUrl) throw new Error("advertisedBaseUrl is required for QR pairing");
  const params = new URLSearchParams({
    baseUrl: options.advertisedBaseUrl,
    code: options.pairCode,
    expiresAt: options.expiresAt,
  });
  return `pi-remote://pair?${params.toString()}`;
}
