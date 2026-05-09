export type IsoTimestamp = string;

export type DaemonConfig = {
  bindAddress: string;
  advertisedBaseUrl?: string;
};

export type DaemonState = {
  pid: number;
  startedAt: IsoTimestamp;
  version: string;
  piVersion: string;
  bindAddress: string;
  stateDir: string;
};

export type PairedDevice = {
  id: string;
  name: string;
  tokenHash: string;
  createdAt: IsoTimestamp;
  lastSeenAt?: IsoTimestamp;
  revokedAt?: IsoTimestamp;
};

export type PairingCode = {
  id: string;
  codeHash: string;
  createdAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
  consumedAt?: IsoTimestamp;
};

export type ToolCallStatus = {
  id: string;
  name: string;
  status: "pending" | "running" | "succeeded" | "failed" | "aborted";
  summary?: string;
  updatedAt: IsoTimestamp;
};
