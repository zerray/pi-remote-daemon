import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { DEFAULT_BIND_ADDRESS, defaultDaemonConfig, loadDaemonConfig, saveDaemonConfig } from "../src/config.js";

describe("daemon config", () => {
  it("has a safe localhost default", () => {
    expect(defaultDaemonConfig()).toEqual({ bindAddress: DEFAULT_BIND_ADDRESS, allowedProjects: [] });
  });

  it("loads defaults when config.json does not exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-remote-control-config-"));
    try {
      await expect(loadDaemonConfig(root)).resolves.toEqual({ bindAddress: DEFAULT_BIND_ADDRESS, allowedProjects: [] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("round-trips saved config", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-remote-control-config-"));
    const config = {
      bindAddress: "100.64.0.1:17373",
      allowedProjects: [{ id: "proj_abc", name: "example", path: "/repo/example" }],
    };

    try {
      await saveDaemonConfig(root, config);
      await expect(loadDaemonConfig(root)).resolves.toEqual(config);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
