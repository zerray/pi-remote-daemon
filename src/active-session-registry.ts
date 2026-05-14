import { existsSync } from "node:fs";
import { readSessionTranscriptMessages, visibleConversationMessageCount } from "./session-transcript.js";
import { DEFAULT_TRANSCRIPT_PAGE_LIMIT, olderTranscriptPage, recentTranscriptWindow, type TranscriptPage } from "./transcript-pagination.js";
import type { RuntimeStatus, ToolCallStatus } from "./types.js";

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
  runtimeStatus?: RuntimeStatus;
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

export type RemoteTuiCommand =
  | { type: "remote_prompt"; requestId: string; text: string; streamingBehavior?: "steer" | "followUp" | null }
  | { type: "remote_abort"; requestId: string }
  | { type: "remote_compact"; requestId: string };

export type ActiveSessionState = TranscriptPage & {
  session: ActiveSessionSummary;
  tools: ToolCallStatus[];
  isStreaming: boolean;
  pendingMessageCount: number;
  runtimeStatus: RuntimeStatus | null;
};

export type ActiveSessionRegistry = {
  registerSession(session: ActiveSessionRegistration): ActiveSessionSummary;
  unregisterSession(sessionId: string): boolean;
  touchSession(sessionId: string): boolean;
  pruneInactiveSessions(): string[];
  listProjects(): ActiveProject[];
  listProjectSessions(projectId: string): ActiveSessionSummary[];
  getSessionState(sessionId: string, options?: { messageLimit?: number }): ActiveSessionState | undefined;
  getSessionMessages(sessionId: string, beforeCursor: string, options?: { limit?: number }): TranscriptPage | undefined;
  updateRuntimeStatus(sessionId: string, status: RuntimeStatus): boolean;
  enqueueCommand(sessionId: string, command: RemoteTuiCommand): boolean;
  takeCommands(sessionId: string): RemoteTuiCommand[];
};

export type ActiveSessionRegistryOptions = {
  now?: () => number;
  staleSessionTimeoutMs?: number;
  isProcessRunning?: (pid: number) => boolean;
};

export const DEFAULT_ACTIVE_SESSION_STALE_TIMEOUT_MS = 5_000;

type StoredActiveSession = ActiveSessionRegistration & {
  summary: ActiveSessionSummary;
  tools: ToolCallStatus[];
  pendingMessageCount: number;
  commands: RemoteTuiCommand[];
  lastSeenAtMs: number;
};

export function createActiveSessionRegistry(options: ActiveSessionRegistryOptions = {}): ActiveSessionRegistry {
  const sessions = new Map<string, StoredActiveSession>();
  const now = options.now ?? Date.now;
  const staleSessionTimeoutMs = options.staleSessionTimeoutMs ?? DEFAULT_ACTIVE_SESSION_STALE_TIMEOUT_MS;
  const isProcessRunning = options.isProcessRunning;

  const pruneInactiveSessions = (): string[] => {
    const cutoff = now() - staleSessionTimeoutMs;
    const removed: string[] = [];
    for (const [sessionId, session] of sessions) {
      if (session.lastSeenAtMs <= cutoff || (isProcessRunning ? !isProcessRunning(session.pid) : false)) {
        sessions.delete(sessionId);
        removed.push(sessionId);
      }
    }
    return removed;
  };

  return {
    registerSession(session) {
      const summary = toSummary(session);
      sessions.set(session.id, {
        ...session,
        summary,
        tools: [],
        pendingMessageCount: 0,
        commands: [],
        lastSeenAtMs: now(),
      });
      return summary;
    },

    unregisterSession(sessionId) {
      return sessions.delete(sessionId);
    },

    touchSession(sessionId) {
      pruneInactiveSessions();
      const session = sessions.get(sessionId);
      if (!session) return false;
      session.lastSeenAtMs = now();
      return true;
    },

    pruneInactiveSessions,

    listProjects() {
      pruneInactiveSessions();
      const projects = new Map<string, ActiveProject>();
      for (const session of sessions.values()) projects.set(session.project.id, session.project);
      return [...projects.values()].sort((left, right) => left.name.localeCompare(right.name));
    },

    listProjectSessions(projectId) {
      pruneInactiveSessions();
      return [...sessions.values()]
        .filter((session) => session.project.id === projectId)
        .map((session) => currentSummary(session))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },

    getSessionState(sessionId, options) {
      pruneInactiveSessions();
      const session = sessions.get(sessionId);
      if (!session) return undefined;
      const messages = readSessionTranscriptMessages(session.sessionFile);
      return {
        session: {
          ...session.summary,
          messageCount: sessionFileExists(session) ? visibleConversationMessageCount(messages) : session.summary.messageCount,
          updatedAt: messages.at(-1)?.createdAt ?? session.summary.updatedAt,
        },
        ...recentTranscriptWindow(messages, options?.messageLimit ?? DEFAULT_TRANSCRIPT_PAGE_LIMIT),
        tools: session.tools,
        isStreaming: session.isStreaming,
        pendingMessageCount: session.pendingMessageCount,
        runtimeStatus: session.runtimeStatus ?? null,
      };
    },

    getSessionMessages(sessionId, beforeCursor, options) {
      pruneInactiveSessions();
      const session = sessions.get(sessionId);
      if (!session) return undefined;
      return olderTranscriptPage(readSessionTranscriptMessages(session.sessionFile), beforeCursor, options?.limit ?? DEFAULT_TRANSCRIPT_PAGE_LIMIT);
    },

    updateRuntimeStatus(sessionId, status) {
      pruneInactiveSessions();
      const session = sessions.get(sessionId);
      if (!session) return false;
      if (JSON.stringify(session.runtimeStatus ?? null) === JSON.stringify(status)) return false;
      session.runtimeStatus = status;
      return true;
    },

    enqueueCommand(sessionId, command) {
      pruneInactiveSessions();
      const session = sessions.get(sessionId);
      if (!session) return false;
      session.commands.push(command);
      return true;
    },

    takeCommands(sessionId) {
      pruneInactiveSessions();
      const session = sessions.get(sessionId);
      if (!session) return [];
      const commands = session.commands;
      session.commands = [];
      return commands;
    },
  };
}

function currentSummary(session: StoredActiveSession): ActiveSessionSummary {
  const messages = readSessionTranscriptMessages(session.sessionFile);
  return {
    ...session.summary,
    messageCount: sessionFileExists(session) ? visibleConversationMessageCount(messages) : session.summary.messageCount,
    updatedAt: messages.at(-1)?.createdAt ?? session.summary.updatedAt,
  };
}

function sessionFileExists(session: Pick<ActiveSessionRegistration, "sessionFile">): boolean {
  return session.sessionFile.length > 0 && existsSync(session.sessionFile);
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
