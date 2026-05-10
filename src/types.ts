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

export type TranscriptContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "toolCall"; id: string; name: string; arguments: unknown }
  | { type: "image"; data: string; mimeType: string };

export type TranscriptMessage = {
  id: string;
  role: "user" | "assistant" | "toolResult" | "system";
  content: TranscriptContentBlock[];
  text: string;
  createdAt: IsoTimestamp;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  isStreaming: boolean;
};

export type TranscriptMessagePatch =
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  | { type: "toolCall"; toolCall: Extract<TranscriptContentBlock, { type: "toolCall" }> }
  | { type: "replace"; message: TranscriptMessage };

export type TranscriptStreamEvent =
  | { type: "session_state"; state: unknown }
  | { type: "transcript_message_start"; message: TranscriptMessage }
  | { type: "transcript_message_patch"; messageId: string; contentIndex?: number; patch: TranscriptMessagePatch }
  | { type: "transcript_message_end"; message: TranscriptMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; partialResult: unknown }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result?: unknown; isError: boolean }
  | { type: "session_closed" }
  | { type: "error"; error: string };

export type ToolCallStatus = {
  id: string;
  name: string;
  status: "pending" | "running" | "succeeded" | "failed" | "aborted";
  summary?: string;
  updatedAt: IsoTimestamp;
};
