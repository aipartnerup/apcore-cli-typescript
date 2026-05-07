/**
 * Tests for src/system-usage.ts (audit log aggregator + usage-driven sort).
 *
 * The module aggregates `~/.apcore-cli/audit.jsonl` into per-module call /
 * error / latency summaries, and exposes `sortModulesByUsage()` so the
 * discovery layer can sort the module table by real usage.
 *
 * These tests cover (per audit finding D5-003):
 *   1. Counter aggregation and read-back from a freshly written audit log.
 *   2. Time-period filtering — entries older than the cutoff must be dropped.
 *   3. Empty-state behaviour when the audit file does not exist.
 *   4. Tolerance of malformed / partial JSONL lines (file-corruption recovery).
 *   5. `sortModulesByUsage` ordering + `used` flag (registry fallback signal).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { computeSummary, sortModulesByUsage } from "../src/system-usage.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;
let auditPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apcore-usage-test-"));
  auditPath = path.join(tmpDir, "audit.jsonl");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

interface AuditRow {
  timestamp: string;
  module_id: string;
  status?: string;
  duration_ms?: number;
}

function writeAudit(rows: Array<AuditRow | string>): void {
  const lines = rows.map((row) =>
    typeof row === "string" ? row : JSON.stringify(row),
  );
  fs.writeFileSync(auditPath, lines.join("\n") + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// computeSummary
// ---------------------------------------------------------------------------

describe("computeSummary", () => {
  it("aggregates calls, errors, and average latency per module", () => {
    const now = new Date("2025-01-15T12:00:00Z");
    writeAudit([
      { timestamp: "2025-01-15T11:59:00Z", module_id: "users.create", status: "ok", duration_ms: 100 },
      { timestamp: "2025-01-15T11:59:30Z", module_id: "users.create", status: "ok", duration_ms: 200 },
      { timestamp: "2025-01-15T11:59:45Z", module_id: "users.create", status: "error", duration_ms: 300 },
      { timestamp: "2025-01-15T11:59:50Z", module_id: "orders.list", status: "ok", duration_ms: 50 },
    ]);

    const summary = computeSummary({ auditPath, period: "1h", now });

    expect(summary.size).toBe(2);
    const users = summary.get("users.create");
    expect(users).toEqual({
      module_id: "users.create",
      calls: 3,
      errors: 1,
      latency_ms: (100 + 200 + 300) / 3,
    });
    const orders = summary.get("orders.list");
    expect(orders).toEqual({
      module_id: "orders.list",
      calls: 1,
      errors: 0,
      latency_ms: 50,
    });
  });

  it("filters out entries older than the configured period", () => {
    const now = new Date("2025-01-15T12:00:00Z");
    writeAudit([
      // 30h ago — outside the default 24h window.
      { timestamp: "2025-01-14T06:00:00Z", module_id: "stale.module", status: "ok", duration_ms: 999 },
      // 30 min ago — inside.
      { timestamp: "2025-01-15T11:30:00Z", module_id: "fresh.module", status: "ok", duration_ms: 10 },
    ]);

    const summary = computeSummary({ auditPath, period: "24h", now });

    expect(summary.has("stale.module")).toBe(false);
    expect(summary.get("fresh.module")?.calls).toBe(1);
  });

  it("returns an empty map when the audit log does not exist", () => {
    const missing = path.join(tmpDir, "does-not-exist.jsonl");
    const summary = computeSummary({ auditPath: missing, period: "24h" });
    expect(summary.size).toBe(0);
  });

  it("tolerates malformed JSONL lines and missing fields without throwing", () => {
    const now = new Date("2025-01-15T12:00:00Z");
    fs.writeFileSync(
      auditPath,
      [
        "",
        // Corrupt last-write tail — must be skipped silently.
        '{"timestamp":"2025-01-15T11:00:00Z","module_id":"trunc',
        // Missing module_id — must be skipped.
        JSON.stringify({ timestamp: "2025-01-15T11:30:00Z", status: "ok" }),
        // Missing timestamp — must be skipped (NaN < cutoff branch).
        JSON.stringify({ module_id: "no.ts", status: "ok" }),
        // Valid entry — must be counted.
        JSON.stringify({
          timestamp: "2025-01-15T11:45:00Z",
          module_id: "good.module",
          status: "ok",
          duration_ms: 42,
        }),
        "",
      ].join("\n"),
      "utf-8",
    );

    const summary = computeSummary({ auditPath, period: "1h", now });

    expect(summary.size).toBe(1);
    expect(summary.get("good.module")?.calls).toBe(1);
    expect(summary.get("good.module")?.latency_ms).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// sortModulesByUsage
// ---------------------------------------------------------------------------

describe("sortModulesByUsage", () => {
  it("orders modules by call count (descending) and reports used=true", () => {
    // sortModulesByUsage does not accept a `now` override, so write entries
    // close to the real current time and use a generous period.
    const now = new Date().toISOString();
    writeAudit([
      { timestamp: now, module_id: "a.popular", status: "ok", duration_ms: 10 },
      { timestamp: now, module_id: "a.popular", status: "ok", duration_ms: 10 },
      { timestamp: now, module_id: "a.popular", status: "ok", duration_ms: 10 },
      { timestamp: now, module_id: "b.medium", status: "ok", duration_ms: 10 },
      { timestamp: now, module_id: "b.medium", status: "ok", duration_ms: 10 },
      { timestamp: now, module_id: "c.rare", status: "ok", duration_ms: 10 },
    ]);

    const modules = [
      { id: "c.rare" },
      { id: "a.popular" },
      { id: "b.medium" },
      // Module with no audit data — must sort to the end (key=0) and not crash.
      { id: "z.unused" },
    ];

    const result = sortModulesByUsage(modules, "calls", { auditPath, period: "24h" });

    expect(result.used).toBe(true);
    expect(modules.map((m) => m.id)).toEqual([
      "a.popular",
      "b.medium",
      "c.rare",
      "z.unused",
    ]);
  });

  it("falls back to id-sort with used=false when no audit data exists", () => {
    const missing = path.join(tmpDir, "missing.jsonl");
    const modules = [{ id: "charlie" }, { id: "alpha" }, { id: "bravo" }];

    const result = sortModulesByUsage(modules, "calls", {
      auditPath: missing,
      period: "24h",
    });

    expect(result.used).toBe(false);
    // reverse=true (default) on the id-sorted list yields descending alpha.
    expect(modules.map((m) => m.id)).toEqual(["charlie", "bravo", "alpha"]);
  });
});
