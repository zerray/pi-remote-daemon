import { createHash } from "node:crypto";
import { NotImplementedError } from "./errors.js";
import type { ProjectRecord, SessionIndexRecord } from "./types.js";

export type PiSessionSummary = {
  piSessionId: string;
  sessionFile: string;
  name?: string;
  updatedAt: string;
  messageCount: number;
};

export function daemonSessionIdForFile(sessionFile: string): string {
  return `sess_${stableHexId(sessionFile)}`;
}

export function projectIdForPath(projectPath: string): string {
  return `proj_${stableHexId(projectPath)}`;
}

function stableHexId(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export function toSessionIndexRecord(project: ProjectRecord, piSession: PiSessionSummary): SessionIndexRecord {
  return {
    id: daemonSessionIdForFile(piSession.sessionFile),
    projectId: project.id,
    piSessionId: piSession.piSessionId,
    sessionFile: piSession.sessionFile,
    nameCache: piSession.name,
    updatedAt: piSession.updatedAt,
    messageCountCache: piSession.messageCount,
  };
}
