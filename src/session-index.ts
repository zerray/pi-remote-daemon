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
  // Derive a stable daemon-facing session id from the canonical session file path.
  // Use a prefix suitable for API responses.
  void sessionFile;
  throw new NotImplementedError("daemonSessionIdForFile");
}

export function projectIdForPath(projectPath: string): string {
  // Derive a stable project id from the canonical project path.
  // Use a prefix suitable for API responses.
  void projectPath;
  throw new NotImplementedError("projectIdForPath");
}

export function toSessionIndexRecord(project: ProjectRecord, piSession: PiSessionSummary): SessionIndexRecord {
  // Convert a Pi SDK session listing item into a daemon session index record.
  // Keep Pi transcript data as a file reference only.
  void project;
  void piSession;
  throw new NotImplementedError("toSessionIndexRecord");
}
