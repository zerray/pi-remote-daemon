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

describe("remote daemon extension", () => {
  it("registers the remote-daemon command", () => {
    const { pi, commands } = createFakePi();

    remoteDaemonExtension(pi as never);

    expect(commands.map((command) => command.name)).toEqual(["remote-daemon"]);
    expect(commands[0]?.description).toContain("Pi remote daemon");
  });

  it("runs status through the daemon CLI", async () => {
    const execCalls: ExecCall[] = [];
    const { pi, commands } = createFakePi(execCalls);
    const { ctx, notifications } = createContext();
    remoteDaemonExtension(pi as never);

    await commands[0]!.handler("status", ctx);

    expect(execCalls).toEqual([{ command: "pi-remote-daemon", args: ["status"] }]);
    expect(notifications).toEqual([{ message: "ok", type: "info" }]);
  });

  it("passes start options to the daemon CLI", async () => {
    const execCalls: ExecCall[] = [];
    const { pi, commands } = createFakePi(execCalls);
    const { ctx } = createContext();
    remoteDaemonExtension(pi as never);

    await commands[0]!.handler("start --bind 127.0.0.1:17373", ctx);

    expect(execCalls).toEqual([
      { command: "pi-remote-daemon", args: ["start", "--bind", "127.0.0.1:17373"] },
    ]);
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
});
