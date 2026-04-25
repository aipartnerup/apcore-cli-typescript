/**
 * AuditLogger — JSONL audit trail.
 *
 * Protocol spec: Security — audit logging
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { warn as logWarn } from "../logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExecutionStatus = "success" | "error";

interface AuditEntry {
  timestamp: string;
  user: string;
  module_id: string;
  input_hash: string;
  status: ExecutionStatus;
  exit_code: number;
  duration_ms: number;
}

// ---------------------------------------------------------------------------
// AuditLogger
// ---------------------------------------------------------------------------

/**
 * Appends structured JSONL entries to an audit log file for every module
 * execution, supporting compliance and debugging.
 */
let _auditLogger: AuditLogger | null = null;

/**
 * Set the module-level audit logger instance.
 */
export function setAuditLogger(auditLogger: AuditLogger | null): void {
  _auditLogger = auditLogger;
}

/**
 * Get the current module-level audit logger instance.
 */
export function getAuditLogger(): AuditLogger | null {
  return _auditLogger;
}

/**
 * Produce a stable, key-order-independent JSON serialization at every nesting
 * level. Used by AuditLogger.hashInput to guarantee that logically-equal
 * inputs hash identically (modulo salt) regardless of source key ordering,
 * and that inputs differing only in nested fields produce distinct canonical
 * bytes.
 *
 * Exported for testability — do not rely on this as a general-purpose helper;
 * only AuditLogger's hash path is a supported caller.
 */
export function canonicalizeForHash(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalizeForHash);
  const src = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(src).sort()) {
    sorted[key] = canonicalizeForHash(src[key]);
  }
  return sorted;
}

export class AuditLogger {
  static readonly DEFAULT_PATH = path.join(
    os.homedir(),
    ".apcore-cli",
    "audit.jsonl",
  );

  private readonly logPath: string;
  private writeFailureWarned = false;

  constructor(path?: string) {
    this.logPath = path ?? AuditLogger.DEFAULT_PATH;
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    const dir = path.dirname(this.logPath);
    try {
      fs.mkdirSync(dir, { recursive: true });
      // Restrict to owner-only on Unix so audit log is not enumerable by
      // other local UIDs on shared systems (mirrors Rust's 0o700 hardening).
      try { fs.chmodSync(dir, 0o700); } catch { /* best-effort */ }
    } catch {
      // Silently ignore — we'll handle write errors in logExecution
    }
  }

  logExecution(
    moduleId: string,
    inputData: Record<string, unknown>,
    status: ExecutionStatus,
    exitCode: number,
    durationMs: number,
  ): void {
    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      user: this.getUser(),
      module_id: moduleId,
      input_hash: this.hashInput(inputData),
      status,
      exit_code: exitCode,
      duration_ms: durationMs,
    };
    try {
      fs.appendFileSync(this.logPath, JSON.stringify(entry) + "\n");
      // Restrict to owner read/write (mirrors Rust's 0o600 hardening).
      try { fs.chmodSync(this.logPath, 0o600); } catch { /* best-effort */ }
    } catch (err) {
      if (!this.writeFailureWarned) {
        this.writeFailureWarned = true;
        logWarn(`Could not write audit log: ${err}`);
      }
    }
  }

  private hashInput(inputData: Record<string, unknown>): string {
    const salt = crypto.randomBytes(16);
    const payload = JSON.stringify(canonicalizeForHash(inputData));
    return crypto
      .createHash("sha256")
      .update(Buffer.concat([salt, Buffer.from(payload, "utf-8")]))
      .digest("hex");
  }

  private getUser(): string {
    try {
      return os.userInfo().username;
    } catch {
      return process.env.USER ?? process.env.USERNAME ?? "unknown";
    }
  }
}
