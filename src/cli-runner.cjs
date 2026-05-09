#!/usr/bin/env node
const { createJiti } = require("jiti");

const jiti = createJiti(__filename);
const { main } = jiti("./cli.ts");

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
