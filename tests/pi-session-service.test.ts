import { describe, expect, it } from "vitest";
import { createPiSessionService, findProject, toRemoteSessionSummary } from "../src/pi-session-service.js";

describe("Pi session service", () => {
  it("lists sessions for a configured project using Pi SessionManager", async () => {
    const config = {
      bindAddress: "127.0.0.1:17373",
      allowedProjects: [{ id: "proj_1", name: "Example", path: "/repo/example" }],
    };
    const calls: string[] = [];
    const service = createPiSessionService(config, {
      async list(cwd) {
        calls.push(cwd);
        return [
          {
            id: "pi-session-1",
            name: "Fix bug",
            path: "/Users/me/.pi/sessions/example.jsonl",
            modified: new Date("2026-05-09T10:00:00.000Z"),
            messageCount: 12,
          },
        ];
      },
    });

    await expect(service.listProjectSessions?.("missing")).resolves.toEqual([]);
    await expect(service.listProjectSessions?.("proj_1")).resolves.toEqual([
      {
        id: "sess_pi-session-1",
        piSessionId: "pi-session-1",
        projectId: "proj_1",
        name: "Fix bug",
        path: "/Users/me/.pi/sessions/example.jsonl",
        updatedAt: "2026-05-09T10:00:00.000Z",
        messageCount: 12,
      },
    ]);
    expect(calls).toEqual(["/repo/example"]);
  });

  it("finds configured projects by id", () => {
    const config = {
      bindAddress: "127.0.0.1:17373",
      allowedProjects: [{ id: "proj_1", name: "Example", path: "/repo/example" }],
    };

    expect(findProject(config, "proj_1")).toEqual({ id: "proj_1", name: "Example", path: "/repo/example" });
    expect(findProject(config, "missing")).toBeUndefined();
  });

  it("maps Pi SDK session summaries to remote session summaries", () => {
    const project = { id: "proj_1", name: "Example", path: "/repo/example" };
    const piSession = {
      id: "pi-session-1",
      name: "Fix bug",
      path: "/Users/me/.pi/sessions/example.jsonl",
      updatedAt: "2026-05-09T10:00:00.000Z",
      messageCount: 12,
    };

    expect(toRemoteSessionSummary(project, piSession)).toEqual({
      id: "sess_pi-session-1",
      piSessionId: "pi-session-1",
      projectId: "proj_1",
      name: "Fix bug",
      path: "/Users/me/.pi/sessions/example.jsonl",
      updatedAt: "2026-05-09T10:00:00.000Z",
      messageCount: 12,
    });
  });

  it("accepts common Pi SDK field aliases when mapping sessions", () => {
    const project = { id: "proj_1", name: "Example", path: "/repo/example" };
    const piSession = {
      sessionId: "pi-session-2",
      title: "Continue work",
      file: "/Users/me/.pi/sessions/example-2.jsonl",
      mtime: new Date("2026-05-09T11:00:00.000Z"),
      messages: [{}, {}, {}],
    };

    expect(toRemoteSessionSummary(project, piSession)).toEqual({
      id: "sess_pi-session-2",
      piSessionId: "pi-session-2",
      projectId: "proj_1",
      name: "Continue work",
      path: "/Users/me/.pi/sessions/example-2.jsonl",
      updatedAt: "2026-05-09T11:00:00.000Z",
      messageCount: 3,
    });
  });
});
