import { NotImplementedError } from "../errors.js";

export const SCHEMA_VERSION = 1;

export function createSchemaSql(): string[] {
  // Return idempotent SQL statements for all daemon tables.
  // Include meta, projects, devices, pairing_codes, and session_index.
  throw new NotImplementedError("createSchemaSql");
}

export function migrateSchemaSql(fromVersion: number, toVersion = SCHEMA_VERSION): string[] {
  // Validate the requested migration range.
  // Return ordered migration SQL statements.
  // For version 1, create the initial schema and store schema version in meta.
  void fromVersion;
  void toVersion;
  throw new NotImplementedError("migrateSchemaSql");
}
