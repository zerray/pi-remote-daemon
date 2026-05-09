import { afterEach, describe, expect, it, vi } from "vitest";
import remoteControlExtension, { handleRemoteCommand } from "../src/extension/index.js";

type Registered = {
  name: string;
  description?: string;
  handler: (args: string, ctx: ExtensionTestContext) => Promise<void>;
};

type ExtensionTestContext = {
  cwd: string;
  sessionManager: {
    getSessionId(): string;
    getSessionFile(): string | undefined;
    getSessionName(): string | undefined;
    getEntries(): unknown[];
  };
  isIdle(): boolean;
  ui: { notify(message: string, type?: "info" | "warning" | "error"): void };
};

type ExecCall = { command: string; args: string[] };

function createFakePi(execCalls: ExecCall[] = []) {
  const commands: Registered[] = [];
  const handlers = new Map<string, (event: unknown, ctx: ExtensionTestContext) => void>();
  return {
    commands,
    handlers,
    pi: {
      registerCommand(name: string, options: Omit<Registered, "name">) {
        commands.push({ name, ...options });
      },
      on(name: string, handler: (event: unknown, ctx: ExtensionTestContext) => void) {
        handlers.set(name, handler);
      },
      sendUserMessage: vi.fn(),
      exec: async (command: string, args: string[]) => {
        execCalls.push({ command, args });
        return { stdout: "pi-remote-control is running (pid 1234)\n", stderr: "", code: 0, killed: false };
      },
    },
  };
}

function createContext() {
  const notifications: Array<{ message: string; type?: "info" | "warning" | "error" }> = [];
  return {
    notifications,
    ctx: {
      cwd: "/repo/example",
      sessionManager: {
        getSessionId: () => "pi_1",
        getSessionFile: () => "/tmp/session.jsonl",
        getSessionName: () => "Fix bug",
        getEntries: () => [{}, {}],
      },
      isIdle: () => true,
      ui: {
        notify(message: string, type?: "info" | "warning" | "error") {
          notifications.push({ message, type });
        },
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("remote control extension", () => {
  it("registers remote-control commands", () => {
    const { pi, commands } = createFakePi();

    remoteControlExtension(pi as never);

    expect(commands.map((command) => command.name)).toEqual(["remote-control", "remote-control-pair"]);
  });

  it("starts daemon if needed and registers the current TUI session", async () => {
    const commands: Registered[] = [];
    const execCalls: ExecCall[] = [];
    const fetchCalls: unknown[] = [];
    const { ctx, notifications } = createContext();
    const pi = {
      registerCommand(name: string, options: Omit<Registered, "name">) {
        commands.push({ name, ...options });
      },
      on: vi.fn(),
      sendUserMessage: vi.fn(),
      exec: async (command: string, args: string[]) => {
        execCalls.push({ command, args });
        if (args.includes("status")) return { stdout: "pi-remote-control is stopped\n", stderr: "", code: 1, killed: false };
        return { stdout: "", stderr: "", code: 0, killed: false };
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        fetchCalls.push({ url, init: { method: init.method, body: JSON.parse(String(init.body)) } });
        return new Response(JSON.stringify({ session: { id: "sess_pi_1" } }), { status: 200 });
      }),
    );
    remoteControlExtension(pi as never);

    await commands.find((command) => command.name === "remote-control")!.handler("", ctx);

    expect(execCalls[0]).toEqual({ command: process.execPath, args: [expect.stringContaining("src/cli-runner.cjs"), "status"] });
    expect(execCalls[1]?.command).toBe("sh");
    expect(fetchCalls).toEqual([
      {
        url: "http://127.0.0.1:17373/v1/tui/sessions",
        init: {
          method: "POST",
          body: expect.objectContaining({ id: "sess_pi_1", piSessionId: "pi_1", sessionFile: "/tmp/session.jsonl" }),
        },
      },
    ]);
    expect(notifications.at(-1)).toEqual({ message: "Remote control enabled for this session", type: "info" });
  });

  it("toggles off an already registered TUI session", async () => {
    const { pi, commands } = createFakePi();
    const { ctx, notifications } = createContext();
    const fetchCalls: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        fetchCalls.push({ url, init: { method: init.method } });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
    remoteControlExtension(pi as never);
    const command = commands.find((registered) => registered.name === "remote-control")!;

    await command.handler("", ctx);
    await command.handler("", ctx);

    expect(fetchCalls.at(-1)).toEqual({ url: "http://127.0.0.1:17373/v1/tui/sessions/sess_pi_1", init: { method: "DELETE" } });
    expect(notifications.at(-1)).toEqual({ message: "Remote control disabled for this session", type: "info" });
  });

  it("forwards TUI events while remote control is active", async () => {
    const { pi, commands, handlers } = createFakePi();
    const { ctx } = createContext();
    const fetchCalls: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        fetchCalls.push({ url, init: { method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined } });
        return new Response(JSON.stringify({ session: { id: "sess_pi_1" } }), { status: 200 });
      }),
    );
    remoteControlExtension(pi as never);
    await commands.find((command) => command.name === "remote-control")!.handler("", ctx);

    handlers.get("message_start")?.({ type: "message_start", message: { id: "msg_1", role: "user" } }, ctx);

    expect(fetchCalls.at(-1)).toEqual({
      url: "http://127.0.0.1:17373/v1/tui/sessions/sess_pi_1/events",
      init: { method: "POST", body: { type: "message_start", message: { id: "msg_1", role: "user" } } },
    });
  });

  it("applies queued remote commands to the TUI runtime", () => {
    const sendUserMessage = vi.fn();
    const abort = vi.fn();
    handleRemoteCommand({ sendUserMessage } as never, { abort } as never, {
      type: "remote_prompt",
      requestId: "req_1",
      text: "hello",
      streamingBehavior: "followUp",
    });
    handleRemoteCommand({ sendUserMessage } as never, { abort } as never, { type: "remote_abort", requestId: "req_2" });

    expect(sendUserMessage).toHaveBeenCalledWith("hello", { deliverAs: "followUp" });
    expect(abort).toHaveBeenCalledOnce();
  });

  it("runs local pairing command from remote-control-pair", async () => {
    const execCalls: ExecCall[] = [];
    const { pi, commands } = createFakePi(execCalls);
    const { ctx, notifications } = createContext();
    pi.exec = async (command: string, args: string[]) => {
      execCalls.push({ command, args });
      if (args.includes("pair")) return { stdout: "Pairing link: pi-remote://pair?...\n", stderr: "", code: 0, killed: false };
      return { stdout: "pi-remote-control is running (pid 1234)\n", stderr: "", code: 0, killed: false };
    };
    remoteControlExtension(pi as never);

    await commands.find((command) => command.name === "remote-control-pair")!.handler("", ctx);

    expect(execCalls).toEqual([
      { command: process.execPath, args: [expect.stringContaining("src/cli-runner.cjs"), "status"] },
      { command: process.execPath, args: [expect.stringContaining("src/cli-runner.cjs"), "pair"] },
    ]);
    expect(notifications).toEqual([{ message: "Pairing link: pi-remote://pair?...", type: "info" }]);
  });
});
