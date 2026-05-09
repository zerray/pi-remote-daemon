import { describe, expect, it } from "vitest";
import { createSchemaSql, migrateSchemaSql, SCHEMA_VERSION } from "../src/persistence/schema.js";

describe("database schema", () => {
  it("declares the expected initial tables", () => {
    const sql = createSchemaSql().join("\n");

    expect(sql).toContain("create table if not exists meta");
    expect(sql).toContain("create table if not exists devices");
    expect(sql).toContain("create table if not exists pairing_codes");
    expect(sql).not.toContain("create table if not exists projects");
    expect(sql).not.toContain("create table if not exists session_index");
  });

  it("creates initial schema from version zero", () => {
    expect(migrateSchemaSql(0, SCHEMA_VERSION).length).toBeGreaterThan(0);
  });
});
