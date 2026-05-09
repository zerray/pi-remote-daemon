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
      sessions.set(session.id, { ...session, summary, messages: [], tools: [], pendingMessageCount: 0, commands: [] });
      return summary;
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
