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
  | { type: "text"; text: string; truncated?: boolean; originalBytes?: number }
  | { type: "thinking"; thinking: string; truncated?: boolean; originalBytes?: number }
  | { type: "toolCall"; id: string; name: string; arguments: unknown; argumentsTruncated?: boolean; argumentsOriginalBytes?: number }
  | { type: "image"; data: string; mimeType: string; truncated?: boolean; originalBytes?: number };

export type TranscriptMessage = {
  id: string;
  role: "user" | "assistant" | "toolResult" | "system";
  content: TranscriptContentBlock[];
  text: string;
  textTruncated?: boolean;
  textOriginalBytes?: number;
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

export type TreeFilter = "default" | "no-tools" | "user-only" | "labeled-only" | "all";

export type TreeSnapshot = {
  sessionId: string;
  leafId: string | null;
  snapshotVersion: string;
  branchVersion: string;
  entries: TreeEntry[];
  defaultFilter: "default";
  filters: TreeFilter[];
  generatedAt: IsoTimestamp;
  stale?: boolean;
};

export type TreeEntry = {
  id: string;
  parentId: string | null;
  type: "message" | "custom_message" | "branch_summary" | "compaction" | "model_change" | "thinking_level_change" | "label" | "session_info" | "custom" | "other";
  role?: "user" | "assistant" | "toolResult" | "system" | "custom";
  customType?: string;
  title: string;
  preview: string;
  previewTruncated?: boolean;
  timestamp: IsoTimestamp;
  label?: string;
  isCurrentLeaf: boolean;
  isOnActiveBranch: boolean;
  isForkable: boolean;
  navigationBehavior: "edit_prompt" | "navigate";
};

export type RuntimeStatus = {
  model: null | {
    provider: string;
    id: string;
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
    reasoning?: boolean;
  };
  thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | null;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
  };
  context: null | {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
  };
  updatedAt: IsoTimestamp;
};

export type RemoteCompactResultEvent =
  | { type: "remote_compact_result"; requestId: string; ok: true; summary: string; firstKeptEntryId: string; tokensBefore: number }
  | { type: "remote_compact_result"; requestId: string; ok: false; message: string };

export type TranscriptStreamEvent =
  | { type: "session_state"; state: unknown }
  | { type: "runtime_status"; status: RuntimeStatus }
  | RemoteCompactResultEvent
  | { type: "turn_start"; turnIndex: number; createdAt?: IsoTimestamp }
  | { type: "turn_end"; turnIndex: number }
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
