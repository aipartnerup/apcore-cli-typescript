/**
 * TTY-adaptive output formatting (table/json/csv/yaml/jsonl).
 *
 * Protocol spec: Output formatting (FE-09 enhanced)
 */

import type { ModuleDescriptor, PreflightResult } from "./cli.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve output format with TTY-adaptive default.
 */
export function resolveFormat(explicitFormat?: string): string {
  if (explicitFormat !== undefined) {
    return explicitFormat;
  }
  return process.stdout.isTTY ? "table" : "json";
}

/**
 * Truncate text to maxLength, appending '...' if needed.
 */
export function truncate(text: string, maxLength = 80): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + "...";
}

/**
 * Render a simple plain-text table with column headers.
 */
function formatTable(
  headers: string[],
  rows: string[][],
): string {
  // Calculate column widths
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );

  const sep = colWidths.map((w) => "-".repeat(w)).join("  ");
  const headerLine = headers
    .map((h, i) => h.padEnd(colWidths[i]))
    .join("  ");
  const dataLines = rows.map((row) =>
    row.map((cell, i) => (cell ?? "").padEnd(colWidths[i])).join("  "),
  );

  return [headerLine, sep, ...dataLines].join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// formatModuleList
// ---------------------------------------------------------------------------

/**
 * Format and print a list of modules.
 */
export function formatModuleList(
  modules: ModuleDescriptor[],
  format: string,
  filterTags?: string[],
  showDeps = false,
  exposureFilter?: { isExposed(moduleId: string): boolean },
): void {
  if (format === "table") {
    if (modules.length === 0 && filterTags && filterTags.length > 0) {
      process.stdout.write(
        `No modules found matching tags: ${filterTags.join(", ")}.\n`,
      );
      return;
    }
    if (modules.length === 0) {
      process.stdout.write("No modules found.\n");
      return;
    }

    const headers = ["ID", "Description", "Tags"];
    if (showDeps) headers.push("Deps");
    if (exposureFilter) headers.push("Exposure");
    const rows = modules.map((m) => {
      const base = [m.id, truncate(m.description, 80), (m.tags ?? []).join(", ")];
      if (showDeps) {
        const deps = (m as unknown as Record<string, unknown>).dependencies;
        base.push(String(Array.isArray(deps) ? deps.length : 0));
      }
      if (exposureFilter) {
        base.push(exposureFilter.isExposed(m.id ?? "") ? "\u2713" : "\u2014");
      }
      return base;
    });
    process.stdout.write(formatTable(headers, rows));
  } else if (format === "json") {
    const result = modules.map((m) => {
      const entry: Record<string, unknown> = {
        id: m.id,
        description: m.description,
        tags: m.tags ?? [],
      };
      if (showDeps) {
        const deps = (m as unknown as Record<string, unknown>).dependencies;
        entry.dependency_count = Array.isArray(deps) ? deps.length : 0;
      }
      if (exposureFilter) {
        entry.exposed = exposureFilter.isExposed(m.id ?? "");
      }
      return entry;
    });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  }
}

// ---------------------------------------------------------------------------
// formatModuleDetail
// ---------------------------------------------------------------------------

/**
 * Convert annotations to a plain dict, filtering out falsy/default values.
 */
function annotationsToDict(
  annotations: unknown,
): Record<string, unknown> | null {
  if (!annotations) return null;
  if (typeof annotations !== "object" || Array.isArray(annotations)) return null;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(annotations as Record<string, unknown>)) {
    if (v !== null && v !== undefined && v !== false && v !== 0 && !(Array.isArray(v) && v.length === 0)) {
      result[k] = v;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Format and print full module metadata.
 */
export function formatModuleDetail(
  moduleDef: ModuleDescriptor,
  format: string,
): void {
  if (format === "table") {
    process.stdout.write(`\nModule: ${moduleDef.id}\n`);
    process.stdout.write(`\nDescription:\n  ${moduleDef.description}\n`);

    if (moduleDef.inputSchema && Object.keys(moduleDef.inputSchema).length > 0) {
      process.stdout.write("\nInput Schema:\n");
      process.stdout.write(JSON.stringify(moduleDef.inputSchema, null, 2) + "\n");
    }

    if (moduleDef.outputSchema && Object.keys(moduleDef.outputSchema).length > 0) {
      process.stdout.write("\nOutput Schema:\n");
      process.stdout.write(JSON.stringify(moduleDef.outputSchema, null, 2) + "\n");
    }

    const annDict = annotationsToDict(
      moduleDef.annotations,
    );
    if (annDict) {
      process.stdout.write("\nAnnotations:\n");
      for (const [k, v] of Object.entries(annDict)) {
        process.stdout.write(`  ${k}: ${v}\n`);
      }
    }

    // Extension metadata (x- prefixed)
    const metadata = moduleDef.metadata;
    if (metadata) {
      const xFields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(metadata)) {
        if (k.startsWith("x-") || k.startsWith("x_")) {
          xFields[k] = v;
        }
      }
      if (Object.keys(xFields).length > 0) {
        process.stdout.write("\nExtension Metadata:\n");
        for (const [k, v] of Object.entries(xFields)) {
          process.stdout.write(`  ${k}: ${v}\n`);
        }
      }
    }

    const tags = moduleDef.tags ?? [];
    if (tags.length > 0) {
      process.stdout.write(`\nTags: ${tags.join(", ")}\n`);
    }
  } else if (format === "json") {
    const result: Record<string, unknown> = {
      id: moduleDef.id,
      description: moduleDef.description,
    };
    if (moduleDef.inputSchema) result.input_schema = moduleDef.inputSchema;
    if (moduleDef.outputSchema) result.output_schema = moduleDef.outputSchema;

    const annDict = annotationsToDict(
      moduleDef.annotations,
    );
    if (annDict) result.annotations = annDict;

    const tags = moduleDef.tags ?? [];
    if (tags.length > 0) result.tags = tags;

    // Extension metadata
    const metadata = moduleDef.metadata;
    if (metadata) {
      for (const [k, v] of Object.entries(metadata)) {
        if (k.startsWith("x-") || k.startsWith("x_")) {
          result[k] = v;
        }
      }
    }

    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  }
}

// ---------------------------------------------------------------------------
// formatExecResult
// ---------------------------------------------------------------------------

/**
 * Select fields from a result using dot-path notation.
 * E.g., fields="status,data.count" selects those paths.
 */
function selectFields(result: Record<string, unknown>, fields: string): Record<string, unknown> {
  const selected: Record<string, unknown> = {};
  for (const f of fields.split(",")) {
    const key = f.trim();
    let val: unknown = result;
    for (const part of key.split(".")) {
      if (val && typeof val === "object" && !Array.isArray(val)) {
        val = (val as Record<string, unknown>)[part];
      } else {
        val = undefined;
        break;
      }
    }
    selected[key] = val;
  }
  return selected;
}

/**
 * Format and print module execution result.
 *
 * Supports formats: json, table, csv, yaml, jsonl.
 * The `fields` option allows dot-path field selection on dict results.
 */
export function formatExecResult(
  result: unknown,
  format?: string,
  fields?: string,
): void {
  if (result === null || result === undefined) {
    return;
  }

  // Apply field selection if specified
  let effective_result = result;
  if (fields && typeof result === "object" && !Array.isArray(result) && result !== null) {
    effective_result = selectFields(result as Record<string, unknown>, fields);
  }

  const effective = resolveFormat(format);

  if (effective === "csv") {
    if (typeof effective_result === "object" && !Array.isArray(effective_result) && effective_result !== null) {
      const obj = effective_result as Record<string, unknown>;
      const keys = Object.keys(obj);
      const header = keys.map(escapeCsvField).join(",");
      const row = keys.map((k) => escapeCsvField(String(obj[k]))).join(",");
      process.stdout.write(header + "\n" + row + "\n");
    } else if (Array.isArray(effective_result) && effective_result.length > 0 && typeof effective_result[0] === "object") {
      const keys = Object.keys(effective_result[0] as Record<string, unknown>);
      const header = keys.map(escapeCsvField).join(",");
      const rows = effective_result.map((item) => {
        const obj = item as Record<string, unknown>;
        return keys.map((k) => escapeCsvField(String(obj[k]))).join(",");
      });
      process.stdout.write(header + "\n" + rows.join("\n") + "\n");
    } else {
      process.stdout.write(JSON.stringify(effective_result) + "\n");
    }
  } else if (effective === "yaml") {
    // Simple YAML-like output (no dependency required)
    if (typeof effective_result === "object" && !Array.isArray(effective_result) && effective_result !== null) {
      const obj = effective_result as Record<string, unknown>;
      const lines = Object.entries(obj).map(([k, v]) => {
        if (v === null || v === undefined) return `${k}: null`;
        if (typeof v === "object") return `${k}: ${JSON.stringify(v)}`;
        return `${k}: ${v}`;
      });
      process.stdout.write(lines.join("\n") + "\n");
    } else if (Array.isArray(effective_result)) {
      for (const item of effective_result) {
        if (typeof item === "object" && item !== null) {
          const obj = item as Record<string, unknown>;
          const lines = Object.entries(obj).map(([k, v]) => `  ${k}: ${v}`);
          process.stdout.write("- " + lines.join("\n  ") + "\n");
        } else {
          process.stdout.write(`- ${item}\n`);
        }
      }
    } else {
      process.stdout.write(String(effective_result) + "\n");
    }
  } else if (effective === "jsonl") {
    if (Array.isArray(effective_result)) {
      for (const item of effective_result) {
        process.stdout.write(JSON.stringify(item) + "\n");
      }
    } else {
      process.stdout.write(JSON.stringify(effective_result) + "\n");
    }
  } else if (
    effective === "table" &&
    typeof effective_result === "object" &&
    !Array.isArray(effective_result)
  ) {
    // Key-value table
    const entries = Object.entries(effective_result as Record<string, unknown>);
    const headers = ["Key", "Value"];
    const rows = entries.map(([k, v]) => [String(k), String(v)]);
    process.stdout.write(formatTable(headers, rows));
  } else if (typeof effective_result === "object") {
    process.stdout.write(JSON.stringify(effective_result, null, 2) + "\n");
  } else if (typeof effective_result === "string") {
    process.stdout.write(effective_result + "\n");
  } else {
    process.stdout.write(String(effective_result) + "\n");
  }
}

/**
 * Escape a CSV field value — wrap in quotes if it contains comma, quote, or newline.
 */
function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

// ---------------------------------------------------------------------------
// formatPreflightResult
// ---------------------------------------------------------------------------

/**
 * Format and print a PreflightResult to stdout.
 */
export function formatPreflightResult(result: PreflightResult, format?: string): void {
  const resolved = resolveFormat(format);
  if (resolved === "json" || !process.stdout.isTTY) {
    const payload: Record<string, unknown> = {
      valid: result.valid,
      // JSON output key stays snake_case for cross-language CLI contract;
      // runtime read uses camelCase to match apcore-js PreflightResult.
      requires_approval: result.requiresApproval,
      checks: result.checks.map((c) => {
        const entry: Record<string, unknown> = { check: c.check, passed: c.passed };
        if (c.error !== undefined && c.error !== null) {
          entry.error = c.error;
        }
        if (c.warnings && c.warnings.length > 0) {
          entry.warnings = c.warnings;
        }
        return entry;
      }),
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  } else {
    // TTY table format
    for (const c of result.checks) {
      const hasWarnings = (c.warnings?.length ?? 0) > 0;
      let sym: string;
      if (c.passed && hasWarnings) {
        sym = "\u26a0"; // ⚠ passed with warnings
      } else if (c.passed) {
        sym = "\u2713"; // ✓ passed
      } else if (c.passed === false) {
        sym = "\u2717"; // ✗ failed
      } else {
        sym = "\u25cb"; // ○ skipped
      }
      let status = `  ${sym} ${c.check.padEnd(20)}`;
      if (c.error) {
        const detail = typeof c.error === "object" ? JSON.stringify(c.error) : String(c.error);
        status += ` ${detail}`;
      } else if (c.passed && !hasWarnings) {
        status += " OK";
      } else if (!c.passed) {
        status += " Skipped";
      }
      process.stdout.write(status + "\n");
      for (const w of c.warnings ?? []) {
        process.stdout.write(`    Warning: ${w}\n`);
      }
    }
    const errors = result.checks.filter((c) => !c.passed).length;
    const warnings = result.checks.reduce((sum, c) => sum + (c.warnings?.length ?? 0), 0);
    const tag = result.valid ? "PASS" : "FAIL";
    process.stdout.write(`\nResult: ${tag} (${errors} error(s), ${warnings} warning(s))\n`);
  }
}

/**
 * Return the exit code for the first failed check in a PreflightResult.
 */
export function firstFailedExitCode(result: PreflightResult): number {
  const checkToExit: Record<string, number> = {
    module_id: 2,
    module_lookup: 44,
    call_chain: 1,
    acl: 77,
    schema: 45,
    approval: 46,
    module_preflight: 1,
  };
  for (const check of result.checks) {
    if (!check.passed) {
      return checkToExit[check.check] ?? 1;
    }
  }
  return 1;
}
