import { describe, expect, it } from "vitest";
import remoteDaemonExtension from "../src/extension/index.js";

type Registered = {
  name: string;
  description?: string;
  handler: (args: string, ctx: { ui: { notify(message: string, type?: "info" | "warning" | "error"): void } }) => Promise<void>;
};

type ExecCall = { command: string; args: string[] };

function createFakePi(execCalls: ExecCall[] = []) {
  const commands: Registered[] = [];
  return {
    commands,
    pi: {
      registerCommand(name: string, options: Omit<Registered, "name">) {
        commands.push({ name, ...options });
      },
      exec: async (command: string, args: string[]) => {
        execCalls.push({ command, args });
        return { stdout: "ok\n", stderr: "", code: 0, killed: false };
      },
    },
  };
}

function createContext() {
  const notifications: Array<{ message: string; type?: "info" | "warning" | "error" }> = [];
  return {
    notifications,
    ctx: {
      ui: {
        notify(message: string, type?: "info" | "warning" | "error") {
          notifications.push({ message, type });
        },
      },
    },
  };
}

describe("remote control extension", () => {
  it("registers the remote-control command", () => {
    const { pi, commands } = createFakePi();

    remoteDaemonExtension(pi as never);

    expect(commands.map((command) => command.name)).toEqual(["remote-control"]);
    expect(commands[0]?.description).toContain("Pi remote control");
  });

  it("runs status through the daemon CLI", async () => {
    const execCalls: ExecCall[] = [];
    const { pi, commands } = createFakePi(execCalls);
    const { ctx, notifications } = createContext();
    remoteDaemonExtension(pi as never);

    await commands[0]!.handler("status", ctx);

    expect(execCalls).toEqual([
      { command: process.execPath, args: [expect.stringContaining("src/cli-runner.cjs"), "status"] },
    ]);
    expect(notifications).toEqual([{ message: "ok", type: "info" }]);
  });

  it("starts daemon in the background", async () => {
    const commands: Registered[] = [];
    const execCalls: ExecCall[] = [];
    const { ctx, notifications } = createContext();
    const pi = {
      registerCommand(name: string, options: Omit<Registered, "name">) {
        commands.push({ name, ...options });
      },
      exec: async (command: string, args: string[]) => {
        execCalls.push({ command, args });
        if (args.includes("status")) return { stdout: "pi-remote-control is stopped\n", stderr: "", code: 1, killed: false };
        return { stdout: "", stderr: "", code: 0, killed: false };
      },
    };
    remoteDaemonExtension(pi as never);

    await commands[0]!.handler("start --bind 127.0.0.1:17373", ctx);

    expect(execCalls[0]).toEqual({ command: process.execPath, args: [expect.stringContaining("src/cli-runner.cjs"), "status"] });
    expect(execCalls[1]?.command).toBe("sh");
    expect(execCalls[1]?.args).toHaveLength(2);
    expect(execCalls[1]?.args[1]).toContain("'start' '--bind' '127.0.0.1:17373'");
    expect(execCalls[1]?.args[1]).toContain("&");
    expect(notifications).toEqual([{ message: "pi-remote-control start requested", type: "info" }]);
  });

  it("does not start daemon when status says it is already running", async () => {
    const commands: Registered[] = [];
    const execCalls: ExecCall[] = [];
    const notifications: Array<{ message: string; type?: "info" | "warning" | "error" }> = [];
    const pi = {
      registerCommand(name: string, options: Omit<Registered, "name">) {
        commands.push({ name, ...options });
      },
      exec: async (command: string, args: string[]) => {
        execCalls.push({ command, args });
        return { stdout: "pi-remote-control is running (pid 1234)\n", stderr: "", code: 0, killed: false };
      },
    };
    remoteDaemonExtension(pi as never);

    await commands[0]!.handler("start --bind 127.0.0.1:17373", {
      ui: { notify: (message, type) => notifications.push({ message, type }) },
    });

    expect(execCalls).toEqual([
      { command: process.execPath, args: [expect.stringContaining("src/cli-runner.cjs"), "status"] },
    ]);
    expect(notifications).toEqual([{ message: "pi-remote-control is running (pid 1234)", type: "warning" }]);
  });

  it("shows daemon CLI failures as errors", async () => {
    const commands: Registered[] = [];
    const notifications: Array<{ message: string; type?: "info" | "warning" | "error" }> = [];
    const pi = {
      registerCommand(name: string, options: Omit<Registered, "name">) {
        commands.push({ name, ...options });
      },
      exec: async () => ({ stdout: "", stderr: "boom\n", code: 1, killed: false }),
    };
    remoteDaemonExtension(pi as never);

    await commands[0]!.handler("status", {
      ui: { notify: (message, type) => notifications.push({ message, type }) },
    });

    expect(notifications).toEqual([{ message: "boom", type: "error" }]);
  });

  it("shows nonzero status output as a warning", async () => {
    const commands: Registered[] = [];
    const notifications: Array<{ message: string; type?: "info" | "warning" | "error" }> = [];
    const pi = {
      registerCommand(name: string, options: Omit<Registered, "name">) {
        commands.push({ name, ...options });
      },
      exec: async () => ({ stdout: "pi-remote-control is stopped\n", stderr: "", code: 1, killed: false }),
    };
    remoteDaemonExtension(pi as never);

    await commands[0]!.handler("status", {
      ui: { notify: (message, type) => notifications.push({ message, type }) },
    });

    expect(notifications).toEqual([{ message: "pi-remote-control is stopped", type: "warning" }]);
  });
});
