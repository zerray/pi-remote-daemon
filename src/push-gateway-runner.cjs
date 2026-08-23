#!/usr/bin/env node
const { createJiti } = require("jiti");

const jiti = createJiti(__filename);
const { main } = jiti("./push-gateway/cli.ts");

main(process.env).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
