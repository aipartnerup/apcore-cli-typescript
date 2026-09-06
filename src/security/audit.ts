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

/**
 * One ACL decision, in the wire form written to the audit log (FE-14 §4.8).
 *
 * These are apcore's own 13 `AuditEntry` fields, carried verbatim: the CLI
 * MUST NOT rename or drop any of them, `handler_error` and `approval_required`
 * included. The names are `snake_case` even though apcore-js surfaces the
 * object camelCased, because the log is a cross-language artifact — a reader
 * of `~/.apcore-cli/audit.jsonl` must not have to know which SDK wrote the
 * line. Declaration order matches apcore-python's `AuditEntry` dataclass, so
 * the serialized key order matches too.
 */
export interface AclAuditRecord {
  timestamp: string;
  caller_id: string;
  target_id: string;
  decision: string;
  reason: string;
  matched_rule: string | null;
  matched_rule_index: number | null;
  identity_type: string | null;
  roles: string[];
  call_depth: number | null;
  trace_id: string | null;
  handler_error: string | null;
  approval_required: boolean;
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
    this.append(entry);
  }

  /**
   * Append one ACL decision (FE-14 §4.8).
   *
   * Written to the same `~/.apcore-cli/audit.jsonl` as execution records, so
   * ACL decisions land beside the calls they governed. The record is written
   * exactly as given — the 13 apcore fields in their `snake_case` wire form —
   * because the log is read by tooling that is not this SDK.
   *
   * Note §7.5: `roles` and `identity_type` reach the file, which FE-05 already
   * treats as sensitive. Hence the same owner-only hardening as every other
   * line.
   */
  logAclDecision(record: AclAuditRecord): void {
    this.append(record);
  }

  private append(entry: AuditEntry | AclAuditRecord): void {
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
      // Spec security.md (D11-W1): canonical fallback chain is
      //   getlogin → pwd.getpwuid(getuid).pw_name → USER → LOGNAME → USERNAME → unknown
      // os.userInfo() collapses the first two POSIX steps in Node; the env-var
      // tail must include LOGNAME between USER and USERNAME for cross-SDK parity.
      return (
        process.env.USER ??
        process.env.LOGNAME ??
        process.env.USERNAME ??
        "unknown"
      );
    }
  }
}
