import { createHash } from "node:crypto";

export function projectIdForPath(projectPath: string): string {
  return `proj_${stableHexId(projectPath)}`;
}

function stableHexId(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}
