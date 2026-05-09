import { describe, expect, it } from "vitest";
import remoteDaemonExtension from "../src/extension/index.js";

type Registered = {
  name: string;
  description?: string;
  handler: (args: string, ctx: { ui: { notify(message: string, type?: "info" | "warning" | "error"): void } }) => Promise<void>;
};

function createFakePi() {
  const commands: Registered[] = [];
  return {
    commands,
    pi: {
      registerCommand(name: string, options: Omit<Registered, "name">) {
        commands.push({ name, ...options });
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
});
