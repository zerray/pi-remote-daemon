import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { RemoteSessionSummary, SessionService } from "./server/http.js";
import type { DaemonConfig, ProjectRecord } from "./types.js";

type SessionLister = {
  list(cwd: string): Promise<unknown[]>;
};

export function createPiSessionService(config: DaemonConfig, sessionManager: SessionLister = SessionManager): SessionService {
  return {
    async listProjectSessions(projectId: string): Promise<RemoteSessionSummary[]> {
      const project = findProject(config, projectId);
      if (!project) return [];

      const sessions = await sessionManager.list(project.path);
      return sessions.map((session) => toRemoteSessionSummary(project, session));
    },
  };
}

export function findProject(config: DaemonConfig, projectId: string): ProjectRecord | undefined {
  return config.allowedProjects.find((project) => project.id === projectId);
}

export function toRemoteSessionSummary(project: ProjectRecord, session: unknown): RemoteSessionSummary {
  const record = asRecord(session);
  const piSessionId = readString(record, "id") ?? readString(record, "sessionId") ?? readString(record, "piSessionId");
  const path = readString(record, "path") ?? readString(record, "file") ?? readString(record, "sessionFile");
  if (!piSessionId) throw new Error("Pi session is missing id");
  if (!path) throw new Error("Pi session is missing path");

  const updatedAt = readDate(record, "modified") ?? readDate(record, "updatedAt") ?? readDate(record, "mtime") ?? new Date(0);
  const messageCount = readNumber(record, "messageCount") ?? readArrayLength(record, "messages") ?? 0;

  return {
    id: `sess_${piSessionId}`,
    piSessionId,
    projectId: project.id,
    name: readString(record, "name") ?? readString(record, "title") ?? null,
    path,
    updatedAt: updatedAt.toISOString(),
    messageCount,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error("Pi session must be an object");
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function readDate(record: Record<string, unknown>, key: string): Date | undefined {
  const value = record[key];
  if (value instanceof Date) return value;
  if (typeof value === "string") return new Date(value);
  return undefined;
}

function readArrayLength(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return Array.isArray(value) ? value.length : undefined;
}
