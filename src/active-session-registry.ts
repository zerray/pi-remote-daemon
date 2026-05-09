import type { ToolCallStatus } from "./types.js";

export type ActiveProject = {
  id: string;
  name: string;
  path: string;
};

export type ActiveSessionRegistration = {
  id: string;
  piSessionId: string;
  project: ActiveProject;
  sessionFile: string;
  name?: string;
  pid: number;
  messageCount: number;
  isStreaming: boolean;
  updatedAt: string;
  entries?: unknown[];
};

export type ActiveSessionSummary = {
  id: string;
  piSessionId: string;
  projectId: string;
  name: string | null;
  path: string;
  updatedAt: string;
  messageCount: number;
  isActive: boolean;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "toolResult" | "system";
  text: string;
  createdAt: string;
  toolCallId?: string;
  isStreaming: boolean;
};

export type RemoteTuiCommand =
  | { type: "remote_prompt"; requestId: string; text: string; streamingBehavior?: "steer" | "followUp" | null }
  | { type: "remote_abort"; requestId: string };

export type ActiveSessionState = {
  session: ActiveSessionSummary;
  messages: ChatMessage[];
  tools: ToolCallStatus[];
  isStreaming: boolean;
  pendingMessageCount: number;
};

export type ActiveSessionRegistry = {
  registerSession(session: ActiveSessionRegistration): ActiveSessionSummary;
  replaceSessionMessages(sessionId: string, entries: unknown[]): boolean;
  unregisterSession(sessionId: string): boolean;
  listProjects(): ActiveProject[];
  listProjectSessions(projectId: string): ActiveSessionSummary[];
  getSessionState(sessionId: string): ActiveSessionState | undefined;
  enqueueCommand(sessionId: string, command: RemoteTuiCommand): boolean;
  takeCommands(sessionId: string): RemoteTuiCommand[];
};

type StoredActiveSession = ActiveSessionRegistration & {
  summary: ActiveSessionSummary;
  messages: ChatMessage[];
  tools: ToolCallStatus[];
  pendingMessageCount: number;
  commands: RemoteTuiCommand[];
};

export function createActiveSessionRegistry(): ActiveSessionRegistry {
  const sessions = new Map<string, StoredActiveSession>();

  return {
    registerSession(session) {
      const summary = toSummary(session);
      sessions.set(session.id, { ...session, summary, messages: messagesFromEntries(session.entries ?? []), tools: [], pendingMessageCount: 0, commands: [] });
      return summary;
    },

    replaceSessionMessages(sessionId, entries) {
      const session = sessions.get(sessionId);
      if (!session) return false;
      session.messages = messagesFromEntries(entries);
      return true;
    },

    unregisterSession(sessionId) {
      return sessions.delete(sessionId);
    },

    listProjects() {
      const projects = new Map<string, ActiveProject>();
      for (const session of sessions.values()) projects.set(session.project.id, session.project);
      return [...projects.values()].sort((left, right) => left.name.localeCompare(right.name));
    },

    listProjectSessions(projectId) {
      return [...sessions.values()]
        .filter((session) => session.project.id === projectId)
        .map((session) => session.summary)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },

    getSessionState(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) return undefined;
      return {
        session: session.summary,
        messages: session.messages,
        tools: session.tools,
        isStreaming: session.isStreaming,
        pendingMessageCount: session.pendingMessageCount,
      };
    },

    enqueueCommand(sessionId, command) {
      const session = sessions.get(sessionId);
      if (!session) return false;
      session.commands.push(command);
      return true;
    },

    takeCommands(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) return [];
      const commands = session.commands;
      session.commands = [];
      return commands;
    },
  };
}

function messagesFromEntries(entries: unknown[]): ChatMessage[] {
  return entries.flatMap((entry) => {
    const record = asRecord(entry);
    if (record.type !== "message") return [];
    const message = asRecord(record.message);
    const role = messageRole(message.role);
    if (!role) return [];
    return [{
      id: readString(record.id) ?? `msg_${Math.random().toString(36).slice(2, 10)}`,
      role,
      text: messageText(message.content),
      createdAt: readString(record.timestamp) ?? new Date().toISOString(),
      isStreaming: false,
    }];
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function messageRole(value: unknown): ChatMessage["role"] | undefined {
  return value === "user" || value === "assistant" || value === "toolResult" || value === "system" ? value : undefined;
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((item) => {
    const record = asRecord(item);
    return readString(record.text) ?? "";
  }).join("");
}

function toSummary(session: ActiveSessionRegistration): ActiveSessionSummary {
  return {
    id: session.id,
    piSessionId: session.piSessionId,
    projectId: session.project.id,
    name: session.name ?? null,
    path: session.sessionFile,
    updatedAt: session.updatedAt,
    messageCount: session.messageCount,
    isActive: true,
  };
}
