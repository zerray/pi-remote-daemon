# Data model

## Daemon process state

```ts
type DaemonState = {
  pid: number;
  startedAt: string;
  version: string;
  piVersion: string;
  bindAddress: string;
  stateDir: string;
};
```

Stored process state is used for health checks and singleton detection. It is not session history.

## Pairing code

```ts
type PairingCode = {
  codeHash: string;
  expiresAt: string;
  createdAt: string;
  consumedAt?: string;
};
```

Pairing codes are short-lived. The daemon stores code hashes, not raw codes.

## Paired device

```ts
type PairedDevice = {
  id: string;
  name: string;
  tokenHash: string;
  createdAt: string;
  lastSeenAt?: string;
  revokedAt?: string;
};
```

The iOS app stores the bearer token in Keychain. The daemon stores only token hashes.

## Project registry

```ts
type ProjectRecord = {
  id: string;
  name: string;
  path: string;
};
```

Projects are daemon-approved working directories. The daemon never lets a mobile client browse arbitrary host paths outside configured projects.

## Live session controller

```ts
type LiveSessionController = {
  sessionId: string;
  projectId: string;
  piSessionId: string;
  sessionFile: string;
  status: "idle" | "streaming" | "aborting" | "disposed";
  lastUsedAt: string;
};
```

A live controller wraps the Pi SDK runtime or RPC subprocess for one open session. Controllers are daemon-owned and may be disposed when idle.

## Tool call status

```ts
type ToolCallStatus = {
  id: string;
  name: string;
  status: "pending" | "running" | "succeeded" | "failed" | "aborted";
  summary?: string;
  updatedAt: string;
};
```

Tool call status is derived from Pi tool execution events and streamed to the iOS app in compact form.
