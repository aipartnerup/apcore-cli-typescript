/**
 * Tests for AuditLogger.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AuditLogger, setAuditLogger, getAuditLogger } from "../../src/security/audit.js";

describe("AuditLogger", () => {
  let tmpDir: string;
  let logPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-test-"));
    logPath = path.join(tmpDir, "audit.jsonl");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  it("creates parent directory if missing", () => {
    const nested = path.join(tmpDir, "sub", "dir", "audit.jsonl");
    const logger = new AuditLogger(nested);
    logger.logExecution("test.mod", {}, "success", 0, 100);
    expect(fs.existsSync(nested)).toBe(true);
  });

  it("appends JSONL entry with correct fields", () => {
    const logger = new AuditLogger(logPath);
    logger.logExecution("math.add", { a: 1 }, "success", 0, 42);
    const line = fs.readFileSync(logPath, "utf-8").trim();
    const entry = JSON.parse(line);
    expect(entry.module_id).toBe("math.add");
    expect(entry.status).toBe("success");
    expect(entry.exit_code).toBe(0);
    expect(entry.duration_ms).toBe(42);
    expect(entry.timestamp).toBeDefined();
    expect(entry.user).toBeDefined();
    expect(entry.input_hash).toBeDefined();
  });

  it("hashes input with random salt (different hashes for same input)", () => {
    const logger = new AuditLogger(logPath);
    logger.logExecution("mod", { x: 1 }, "success", 0, 10);
    logger.logExecution("mod", { x: 1 }, "success", 0, 10);
    const lines = fs.readFileSync(logPath, "utf-8").trim().split("\n");
    const hash1 = JSON.parse(lines[0]).input_hash;
    const hash2 = JSON.parse(lines[1]).input_hash;
    expect(hash1).not.toBe(hash2);
  });

  it("handles write errors gracefully", () => {
    // Warnings now flow through ./logger.js (stderr) per review fix #4, not console.warn.
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = new AuditLogger("/nonexistent/path/audit.jsonl");
    logger.logExecution("mod", {}, "error", 1, 0);
    const calls = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(calls).toMatch(/WARNING: Could not write audit log/);
    stderrSpy.mockRestore();
  });

  it("uses default path based on home directory", () => {
    expect(AuditLogger.DEFAULT_PATH).toContain(".apcore-cli");
    expect(AuditLogger.DEFAULT_PATH).toContain("audit.jsonl");
  });

  it("constructor parameter is named 'path' (not 'logPath')", () => {
    // Regression: A-002 — param name must match spec canonical name
    const logger = new AuditLogger(logPath);
    expect(logger).toBeInstanceOf(AuditLogger);
  });
});

describe("setAuditLogger / getAuditLogger", () => {
  afterEach(() => {
    setAuditLogger(null);
  });

  it("sets and gets a module-level audit logger", () => {
    // Regression: A-001 — setAuditLogger must be exported
    expect(getAuditLogger()).toBeNull();
    const logger = new AuditLogger("/tmp/test-audit.jsonl");
    setAuditLogger(logger);
    expect(getAuditLogger()).toBe(logger);
  });

  it("clears the logger when set to null", () => {
    const logger = new AuditLogger("/tmp/test-audit.jsonl");
    setAuditLogger(logger);
    setAuditLogger(null);
    expect(getAuditLogger()).toBeNull();
  });
});
