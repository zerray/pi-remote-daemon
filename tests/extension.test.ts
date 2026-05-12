import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import remoteControlExtension, { collectRuntimeStatus, enrichTuiEventForDaemon, handleRemoteCommand } from "../src/extension/index.js";

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
  model?: unknown;
  getContextUsage?(): unknown;
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
  const handlers = new Map<string, (event: unknown, ctx: ExtensionTestContext) => void | Promise<unknown>>();
  return {
    commands,
    handlers,
    pi: {
      registerCommand(name: string, options: Omit<Registered, "name">) {
        commands.push({ name, ...options });
      },
      on(name: string, handler: (event: unknown, ctx: ExtensionTestContext) => void | Promise<unknown>) {
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
      model: { provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", contextWindow: 200000, maxTokens: 8192, reasoning: true },
      getContextUsage: () => ({ tokens: 65000, contextWindow: 200000, percent: 32.5 }),
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("remote control extension", () => {
  it("collects runtime status from the live Pi context", () => {
    const ctx = {
      model: { provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", contextWindow: 200000, maxTokens: 8192, reasoning: true },
      getContextUsage: () => ({ tokens: 65000, contextWindow: 200000, percent: 32.5 }),
      sessionManager: {
        entries: [
          { type: "message", message: { role: "user", content: "hello" } },
          { type: "message", message: { role: "assistant" }, usage: { input: 12, output: 3, cacheRead: 50, cacheWrite: 10, cost: { input: 0.036, output: 0.045, cacheRead: 0.015, cacheWrite: 0.0375, total: 0.1335 } } },
        ],
        getEntries() {
          return this.entries;
        },
      },
    };
    const pi = { getThinkingLevel: () => "medium" };

    expect(collectRuntimeStatus(pi, ctx, () => new Date("2026-05-09T09:47:00.000Z"))).toEqual({
      model: { provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", contextWindow: 200000, maxTokens: 8192, reasoning: true },
      thinkingLevel: "medium",
      usage: { input: 12, output: 3, cacheRead: 50, cacheWrite: 10, cost: { input: 0.036, output: 0.045, cacheRead: 0.015, cacheWrite: 0.0375, total: 0.1335 } },
      context: { tokens: 65000, contextWindow: 200000, percent: 32.5 },
      updatedAt: "2026-05-09T09:47:00.000Z",
    });
  });

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
          body: expect.objectContaining({
            id: "sess_pi_1",
            piSessionId: "pi_1",
            sessionFile: "/tmp/session.jsonl",
            runtimeStatus: expect.objectContaining({ model: expect.objectContaining({ id: "claude-sonnet-4-5" }), context: expect.objectContaining({ percent: 32.5 }) }),
          }),
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

  it("re-registers a locally active TUI session when daemon heartbeat state is missing", async () => {
    vi.useFakeTimers();
    const { pi, commands } = createFakePi();
    const { ctx, statuses } = createContext();
    const fetchCalls: Array<{ url: string; method: string; body?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (url.endsWith("/commands")) return new Response(JSON.stringify({ error: "session_not_found" }), { status: 404 });
        return new Response(JSON.stringify({ session: { id: "sess_pi_1" } }), { status: 200 });
      }),
    );
    remoteControlExtension(pi as never);

    await commands.find((command) => command.name === "remote-control")!.handler("", ctx);
    await vi.advanceTimersByTimeAsync(1000);

    expect(fetchCalls).toEqual([
      {
        url: "http://127.0.0.1:17373/v1/tui/sessions",
        method: "POST",
        body: expect.objectContaining({ id: "sess_pi_1", piSessionId: "pi_1", sessionFile: "/tmp/session.jsonl" }),
      },
      { url: "http://127.0.0.1:17373/v1/tui/sessions/sess_pi_1/commands", method: "GET", body: undefined },
      {
        url: "http://127.0.0.1:17373/v1/tui/sessions",
        method: "POST",
        body: expect.objectContaining({ id: "sess_pi_1", piSessionId: "pi_1", sessionFile: "/tmp/session.jsonl" }),
      },
    ]);
    expect(statuses).toEqual([{ key: "remote-control", text: "\u001b[32mRemote Control Active\u001b[39m" }]);
  });

  it("clears local active state when heartbeat re-registration fails", async () => {
    vi.useFakeTimers();
    const { pi, commands } = createFakePi();
    const { ctx, statuses, notifications } = createContext();
    const fetchCalls: Array<{ url: string; method: string }> = [];
    let registrationAttempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, method: init?.method ?? "GET" });
        if (url.endsWith("/commands")) return new Response(JSON.stringify({ error: "session_not_found" }), { status: 404 });
        registrationAttempts += 1;
        return new Response(JSON.stringify({ session: { id: "sess_pi_1" } }), { status: registrationAttempts === 1 ? 200 : 503 });
      }),
    );
    remoteControlExtension(pi as never);

    await commands.find((command) => command.name === "remote-control")!.handler("", ctx);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(statuses).toEqual([
      { key: "remote-control", text: "\u001b[32mRemote Control Active\u001b[39m" },
      { key: "remote-control", text: undefined },
    ]);
    expect(notifications.at(-1)).toEqual({ message: "Remote control disconnected; run /remote-control to re-enable", type: "warning" });
    expect(fetchCalls.filter((call) => call.url.endsWith("/commands"))).toHaveLength(1);
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

    await handlers.get("session_shutdown")?.({ type: "session_shutdown", reason: "quit" }, ctx);

    expect(fetchCalls.at(-1)).toEqual({
      url: "http://127.0.0.1:17373/v1/tui/sessions/sess_pi_1",
      init: { method: "DELETE" },
    });
    expect(statuses.at(-1)).toEqual({ key: "remote-control", text: undefined });
  });

  it("awaits proactive deactivation before session shutdown completes", async () => {
    const { pi, commands, handlers } = createFakePi();
    const { ctx } = createContext();
    let resolveDelete: (() => void) | undefined;
    const fetchCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        fetchCalls.push(`${init?.method ?? "GET"} ${url}`);
        if (init?.method === "DELETE") await new Promise<void>((resolve) => { resolveDelete = resolve; });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
    remoteControlExtension(pi as never);
    await commands.find((command) => command.name === "remote-control")!.handler("", ctx);

    let completed = false;
    const shutdownPromise = Promise.resolve(handlers.get("session_shutdown")?.({ type: "session_shutdown", reason: "quit" }, ctx)).then(() => { completed = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fetchCalls.at(-1)).toBe("DELETE http://127.0.0.1:17373/v1/tui/sessions/sess_pi_1");
    expect(completed).toBe(false);
    resolveDelete?.();
    await shutdownPromise;
    expect(completed).toBe(true);
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

  it("enriches message events with stable session entry ids before daemon normalization", () => {
    const event = { type: "message_update", message: { role: "assistant", timestamp: 1778284801000, content: [{ type: "text", text: "hello" }] }, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "hello" } };
    const ctx = {
      sessionManager: {
        getEntries: () => [
          { type: "message", id: "msg_1", timestamp: "2026-05-09T00:00:01.000Z", message: { role: "assistant", timestamp: 1778284801000, content: [{ type: "text", text: "hello" }] } },
        ],
      },
    };

    expect(enrichTuiEventForDaemon(event, ctx as never)).toEqual({
      ...event,
      id: "msg_1",
      timestamp: "2026-05-09T00:00:01.000Z",
      message: { ...event.message, id: "msg_1" },
    });
  });

  it("forwards turn lifecycle events while remote control is active", async () => {
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

    handlers.get("turn_start")?.({ type: "turn_start", turnIndex: 0, timestamp: 1778284801000 }, ctx);
    handlers.get("turn_end")?.({ type: "turn_end", turnIndex: 0, message: { role: "assistant", content: [] }, toolResults: [] }, ctx);
    await vi.waitFor(() => expect(fetchCalls).toHaveLength(3));

    expect(fetchCalls.slice(1)).toEqual([
      {
        url: "http://127.0.0.1:17373/v1/tui/sessions/sess_pi_1/events",
        init: { method: "POST", body: { type: "turn_start", turnIndex: 0, timestamp: 1778284801000 } },
      },
      {
        url: "http://127.0.0.1:17373/v1/tui/sessions/sess_pi_1/events",
        init: { method: "POST", body: { type: "turn_end", turnIndex: 0, message: { role: "assistant", content: [] }, toolResults: [] } },
      },
    ]);
  });

  it("forwards runtime status changes while remote control is active", async () => {
    const { pi, commands, handlers } = createFakePi();
    const entries = [{ type: "message", message: { role: "assistant" }, usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0.01 } } }];
    const { ctx } = createContext();
    ctx.sessionManager.getEntries = () => entries;
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

    entries.push({ type: "message", message: { role: "assistant" }, usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, cost: { total: 0.02 } } });
    handlers.get("message_end")?.({ type: "message_end", message: { id: "msg_1", role: "assistant" } }, ctx);
    await vi.waitFor(() => expect(fetchCalls).toContainEqual(expect.objectContaining({
      url: "http://127.0.0.1:17373/v1/tui/sessions/sess_pi_1/events",
      init: expect.objectContaining({ method: "POST", body: expect.objectContaining({ type: "runtime_status", status: expect.objectContaining({ usage: expect.objectContaining({ input: 3, output: 3 }) }) }) }),
    })));
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

  it("applies queued remote prompt and abort commands to the TUI runtime", () => {
    const sendUserMessage = vi.fn();
    const abort = vi.fn();
    const compact = vi.fn();
    handleRemoteCommand({ sendUserMessage } as never, { abort, compact } as never, {
      type: "remote_prompt",
      requestId: "req_1",
      text: "hello",
      streamingBehavior: "followUp",
    });
    handleRemoteCommand({ sendUserMessage } as never, { abort, compact } as never, { type: "remote_abort", requestId: "req_2" });

    expect(sendUserMessage).toHaveBeenCalledWith("hello", { deliverAs: "followUp" });
    expect(abort).toHaveBeenCalledOnce();
    expect(compact).not.toHaveBeenCalled();
  });

  it("posts remote compact success and failure results from TUI callbacks", async () => {
    const fetchCalls: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, init: { method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined } });
        return new Response(JSON.stringify({ accepted: true }), { status: 200 });
      }),
    );
    const compact = vi.fn();

    handleRemoteCommand({ sendUserMessage: vi.fn() } as never, { abort: vi.fn(), compact } as never, { type: "remote_compact", requestId: "req_3" }, "sess_pi_1");
    const options = compact.mock.calls[0]?.[0] as {
      onComplete(result: unknown): void;
      onError(error: Error): void;
    };
    options.onComplete({ summary: "Summary", firstKeptEntryId: "entry_1", tokensBefore: 12345 });
    options.onError(new Error("No compaction needed"));

    await vi.waitFor(() => expect(fetchCalls).toHaveLength(2));
    expect(fetchCalls).toEqual([
      {
        url: "http://127.0.0.1:17373/v1/tui/sessions/sess_pi_1/events",
        init: { method: "POST", body: { type: "remote_compact_result", requestId: "req_3", ok: true, summary: "Summary", firstKeptEntryId: "entry_1", tokensBefore: 12345 } },
      },
      {
        url: "http://127.0.0.1:17373/v1/tui/sessions/sess_pi_1/events",
        init: { method: "POST", body: { type: "remote_compact_result", requestId: "req_3", ok: false, message: "No compaction needed" } },
      },
    ]);
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
