/**
 * system.usage aggregator — reads ~/.apcore-cli/audit.jsonl and groups by
 * module_id.
 *
 * Implements the `system.usage.summary` data pipeline described in
 * aiperceivable/apcore-cli#17:
 *
 *   Read audit.jsonl
 *     -> filter by time period (timestamp >= now - period; default 24h)
 *     -> group by module_id
 *     -> aggregate: calls, errors, avg latency_ms
 *
 * Module-protocol registration of `system.usage.summary` and
 * `system.usage.module` as registry-callable built-ins is tracked as a
 * follow-up; today the readers are invoked directly by the discovery layer.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface UsageSummary {
  module_id: string;
  calls: number;
  errors: number;
  latency_ms: number;
}

export type UsagePeriod = "1h" | "24h" | "7d" | "30d";

const PERIOD_TO_MS: Record<UsagePeriod, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const DEFAULT_AUDIT_PATH = path.join(
  os.homedir(),
  ".apcore-cli",
  "audit.jsonl",
);

/**
 * Aggregate the audit log per-module over the given period.
 *
 * Returns an empty Map when the log is missing or empty — callers are
 * expected to fall back to id-sort with a visible message in that case.
 */
export function computeSummary(
  options: { auditPath?: string; period?: UsagePeriod; now?: Date } = {},
): Map<string, UsageSummary> {
  const auditPath = options.auditPath ?? DEFAULT_AUDIT_PATH;
  const period: UsagePeriod = options.period ?? "24h";
  const cutoff = (options.now ?? new Date()).getTime() - PERIOD_TO_MS[period];

  if (!fs.existsSync(auditPath)) {
    return new Map();
  }

  let raw: string;
  try {
    raw = fs.readFileSync(auditPath, "utf-8");
  } catch {
    return new Map();
  }

  const counts = new Map<string, number>();
  const errors = new Map<string, number>();
  const latencySum = new Map<string, number>();

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      // Tolerate a partial last line from a crashed write rather than
      // failing the sort (audit log is append-only JSONL).
      continue;
    }
    const ts = typeof entry.timestamp === "string"
      ? Date.parse(entry.timestamp)
      : NaN;
    if (Number.isNaN(ts) || ts < cutoff) continue;
    const moduleId = typeof entry.module_id === "string" ? entry.module_id : null;
    if (!moduleId) continue;
    counts.set(moduleId, (counts.get(moduleId) ?? 0) + 1);
    if (entry.status === "error") {
      errors.set(moduleId, (errors.get(moduleId) ?? 0) + 1);
    }
    const duration = entry.duration_ms;
    if (typeof duration === "number") {
      latencySum.set(moduleId, (latencySum.get(moduleId) ?? 0) + duration);
    }
  }

  const out = new Map<string, UsageSummary>();
  for (const [id, calls] of counts) {
    out.set(id, {
      module_id: id,
      calls,
      errors: errors.get(id) ?? 0,
      latency_ms: calls > 0 ? (latencySum.get(id) ?? 0) / calls : 0,
    });
  }
  return out;
}

/**
 * Sort `modules` in place by `calls` | `errors` | `latency` using audit-log
 * data. Returns whether real usage data was used; when false, callers should
 * surface a visible message that explains the fallback (issue #17 AC).
 *
 * @param modules    Array of objects exposing an `id` (or `module_id`) field.
 * @param field      One of `calls`, `errors`, `latency`.
 * @param reverse    Defaults to true (descending — biggest first).
 */
export function sortModulesByUsage<T extends { id?: string; module_id?: string }>(
  modules: T[],
  field: "calls" | "errors" | "latency",
  options: { reverse?: boolean; auditPath?: string; period?: UsagePeriod } = {},
): { used: boolean } {
  const reverse = options.reverse ?? true;
  const summary = computeSummary({
    auditPath: options.auditPath,
    period: options.period,
  });

  if (summary.size === 0) {
    modules.sort((a, b) => (a.id ?? a.module_id ?? "").localeCompare(b.id ?? b.module_id ?? ""));
    if (reverse) modules.reverse();
    return { used: false };
  }

  const key = (m: T): number => {
    const id = m.id ?? m.module_id ?? "";
    const s = summary.get(id);
    if (!s) return 0;
    return field === "latency" ? s.latency_ms : (field === "calls" ? s.calls : s.errors);
  };

  modules.sort((a, b) => {
    const diff = key(a) - key(b);
    if (diff !== 0) return reverse ? -diff : diff;
    // Stable secondary sort by id for deterministic output when counts tie.
    return (a.id ?? a.module_id ?? "").localeCompare(b.id ?? b.module_id ?? "");
  });
  return { used: true };
}
