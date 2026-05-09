#!/usr/bin/env node
import { NotImplementedError } from "./errors.js";

export async function main(argv = process.argv.slice(2)): Promise<number> {
  // Parse start, stop, status, and pair subcommands.
  // Resolve and create the daemon state directory.
  // Dispatch to daemon server lifecycle commands.
  void argv;
  throw new NotImplementedError("cli main");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
