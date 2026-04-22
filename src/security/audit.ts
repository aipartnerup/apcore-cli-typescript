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

export class AuditLogger {
  static readonly DEFAULT_PATH = path.join(
    os.homedir(),
    ".apcore-cli",
    "audit.jsonl",
  );

  private readonly logPath: string;

  constructor(path?: string) {
    this.logPath = path ?? AuditLogger.DEFAULT_PATH;
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    try {
      fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
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
    } catch (err) {
      logWarn(`Could not write audit log: ${err}`);
    }
  }

  private hashInput(inputData: Record<string, unknown>): string {
    const salt = crypto.randomBytes(16);
    const sortedKeys = Object.keys(inputData).sort();
    const payload = JSON.stringify(inputData, sortedKeys);
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
