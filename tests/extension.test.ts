import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  ui: {
    theme: { fg(color: string, text: string): string };
    notify(message: string, type?: "info" | "warning" | "error"): void;
    setStatus(key: string, text: string | undefined): void;
  };
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
  const statuses: Array<{ key: string; text: string | undefined }> = [];
  return {
    statuses,
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
        theme: { fg: (color: string, text: string) => (color === "success" ? `\u001b[32m${text}\u001b[39m` : text) },
        notify(message: string, type?: "info" | "warning" | "error") {
          notifications.push({ message, type });
        },
        setStatus(key: string, text: string | undefined) {
          statuses.push({ key, text });
        },
      },
    },
  };
}

beforeEach(() => {
  vi.stubEnv("PI_REMOTE_CONTROL_LOCAL_URL", "http://127.0.0.1:17373");
  vi.stubEnv("PI_REMOTE_CONTROL_DEV_TOKEN", "test-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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
    const healthOutcomes = [new TypeError("fetch failed"), new Response(JSON.stringify({ status: "ok" }), { status: 200 })];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/v1/health")) {
          fetchCalls.push({ url, init: undefined });
          const outcome = healthOutcomes.shift();
          if (outcome instanceof Error) throw outcome;
          return outcome!;
        }
        fetchCalls.push({ url, init: { method: init?.method, body: JSON.parse(String(init?.body)) } });
        return new Response(JSON.stringify({ session: { id: "sess_pi_1" } }), { status: 200 });
      }),
    );
    remoteControlExtension(pi as never);

    await commands.find((command) => command.name === "remote-control")!.handler("", ctx);

    expect(execCalls[0]).toEqual({ command: process.execPath, args: [expect.stringContaining("src/cli-runner.cjs"), "status"] });
    expect(execCalls[1]?.command).toBe("sh");
    expect(execCalls[1]?.args[1]).toContain("nohup");
    expect(fetchCalls).toEqual([
      { url: "http://127.0.0.1:17373/v1/health", init: undefined },
      { url: "http://127.0.0.1:17373/v1/health", init: undefined },
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

  it("reports startup readiness failure without throwing", async () => {
    const commands: Registered[] = [];
    const { ctx, notifications } = createContext();
    const pi = {
      registerCommand(name: string, options: Omit<Registered, "name">) {
        commands.push({ name, ...options });
      },
      on: vi.fn(),
      sendUserMessage: vi.fn(),
      exec: async (command: string, args: string[]) => {
        if (args.includes("status")) return { stdout: "pi-remote-control is stopped\n", stderr: "", code: 1, killed: false };
        return { stdout: "", stderr: "", code: 0, killed: false };
      },
    };
    vi.stubEnv("PI_REMOTE_CONTROL_READY_ATTEMPTS", "1");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    remoteControlExtension(pi as never);

    await expect(commands.find((command) => command.name === "remote-control")!.handler("", ctx)).resolves.toBeUndefined();

    expect(notifications.at(-1)).toEqual({
      message: "pi-remote-control did not become ready; see /tmp/pi-remote-control.log",
      type: "error",
    });
  });

  it("reports registration network failures without throwing", async () => {
    const { pi, commands } = createFakePi();
    const { ctx, notifications } = createContext();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/v1/health")) return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      throw new TypeError("fetch failed");
    }));
    remoteControlExtension(pi as never);

    await expect(commands.find((command) => command.name === "remote-control")!.handler("", ctx)).resolves.toBeUndefined();

    expect(notifications.at(-1)).toEqual({ message: "Remote control enable failed: fetch failed", type: "error" });
  });

  it("uses localhost with the configured port for TUI control when no local override is set", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-remote-control-extension-"));
    try {
      await writeFile(join(root, "config.json"), JSON.stringify({ bindAddress: "100.86.12.34:17373" }));
      vi.unstubAllEnvs();
      vi.stubEnv("PI_REMOTE_CONTROL_DIR", root);
      vi.stubEnv("PI_REMOTE_CONTROL_URL", "https://macbook.tailnet.ts.net:17373");
      const { pi, commands } = createFakePi();
      const { ctx } = createContext();
      const urls: string[] = [];
      vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        urls.push(url);
        return new Response(JSON.stringify({ session: { id: "sess_pi_1" } }), { status: 200 });
      }));
      remoteControlExtension(pi as never);

      await commands.find((command) => command.name === "remote-control")!.handler("", ctx);

      expect(urls.at(-1)).toBe("http://127.0.0.1:17373/v1/tui/sessions");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("updates TUI status when toggling remote control", async () => {
    const { pi, commands } = createFakePi();
    const { ctx, statuses } = createContext();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    remoteControlExtension(pi as never);
    const command = commands.find((registered) => registered.name === "remote-control")!;

    await command.handler("", ctx);
    await command.handler("", ctx);

    expect(statuses).toEqual([
      { key: "remote-control", text: "\u001b[32mRemote Control Active\u001b[39m" },
      { key: "remote-control", text: undefined },
    ]);
  });

  it("clears active status and unregisters on session shutdown", async () => {
    const { pi, commands, handlers } = createFakePi();
    const { ctx, statuses } = createContext();
    const fetchCalls: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, init: { method: init?.method } });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
    remoteControlExtension(pi as never);
    await commands.find((command) => command.name === "remote-control")!.handler("", ctx);

    handlers.get("session_shutdown")?.({ type: "session_shutdown", reason: "quit" }, ctx);
    await vi.waitFor(() => expect(fetchCalls.at(-1)).toEqual({
      url: "http://127.0.0.1:17373/v1/tui/sessions/sess_pi_1",
      init: { method: "DELETE" },
    }));
    expect(statuses.at(-1)).toEqual({ key: "remote-control", text: undefined });
  });

  it("deactivates local remote-control state on session start", async () => {
    const { pi, commands, handlers } = createFakePi();
    const { ctx, statuses } = createContext();
    const fetchCalls: Array<{ url: string; init: { method?: string; body?: unknown } }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, init: { method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined } });
        return new Response(JSON.stringify({ session: { id: "sess_pi_1" } }), { status: 200 });
      }),
    );
    remoteControlExtension(pi as never);
    await commands.find((command) => command.name === "remote-control")!.handler("", ctx);

    handlers.get("session_start")?.({ type: "session_start", reason: "resume" }, ctx);
    handlers.get("message_start")?.({ type: "message_start", message: { id: "msg_1", role: "user" } }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(statuses.at(-1)).toEqual({ key: "remote-control", text: undefined });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toBe("http://127.0.0.1:17373/v1/tui/sessions");
  });

  it("does not automatically re-enable remote control on resumed sessions", async () => {
    const { pi, handlers } = createFakePi();
    const { ctx, statuses } = createContext();
    const fetch = vi.fn(async () => new Response(JSON.stringify({ session: { id: "sess_pi_1" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    remoteControlExtension(pi as never);

    handlers.get("session_start")?.({ type: "session_start", reason: "resume" }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(statuses).toEqual([{ key: "remote-control", text: undefined }]);
    expect(fetch).not.toHaveBeenCalled();
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
    await vi.waitFor(() => expect(fetchCalls.at(-1)).toMatchObject({ url: "http://127.0.0.1:17373/v1/tui/sessions/sess_pi_1/events" }));

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
