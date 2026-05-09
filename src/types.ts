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

export type ProjectRecord = {
  id: string;
  name: string;
  path: string;
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

export type SessionIndexRecord = {
  id: string;
  projectId: string;
  piSessionId: string;
  sessionFile: string;
  nameCache?: string;
  updatedAt: IsoTimestamp;
  messageCountCache: number;
  lastOpenedAt?: IsoTimestamp;
};

export type LiveSessionStatus = "idle" | "streaming" | "aborting" | "disposed";

export type LiveSessionController = {
  sessionId: string;
  projectId: string;
  piSessionId: string;
  sessionFile: string;
  status: LiveSessionStatus;
  lastUsedAt: IsoTimestamp;
};

export type ToolCallStatusValue = "pending" | "running" | "succeeded" | "failed" | "aborted";

export type ToolCallStatus = {
  id: string;
  name: string;
  status: ToolCallStatusValue;
  summary?: string;
  updatedAt: IsoTimestamp;
};
