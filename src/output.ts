/**
 * TTY-adaptive output formatting (table/json/csv/yaml/jsonl/markdown/skill).
 *
 * Protocol spec: Output formatting (FE-08 / FE-09 enhanced)
 */

import yaml from "js-yaml";
import { formatCsv, formatJsonl } from "apcore-toolkit";
import { EXIT_CODES } from "./errors.js";
import type { ModuleDescriptor, PreflightResult } from "./cli.js";

const TOOLKIT_MISSING_HINT =
  "The 'markdown' and 'skill' output formats require the apcore-toolkit " +
  "peer dependency. Install with: npm install apcore-toolkit@^0.7";

/**
 * Adapt the registry's `ModuleDescriptor` to the toolkit's `ScannedModule`
 * shape so the surface-aware formatters (`formatModule` / `formatModules`)
 * can render it. Both shapes share most fields; the toolkit additionally
 * needs `target`, `suggestedAlias`, `warnings`, and `display`.
 */
function descriptorToScanned(
  m: ModuleDescriptor,
): import("apcore-toolkit").ScannedModule {
  const metadata = (m.metadata ?? {}) as Record<string, unknown>;
  const display = (metadata["display"] ?? null) as
    | Record<string, unknown>
    | null;
  return {
    moduleId: m.id,
    description: m.description ?? "",
    inputSchema: (m.inputSchema ?? {}) as Record<string, unknown>,
    outputSchema: (m.outputSchema ?? {}) as Record<string, unknown>,
    tags: (m.tags ?? []) as readonly string[],
    target: "",
    version: "1.0.0",
    annotations:
      (m.annotations as unknown as import("apcore-toolkit").ScannedModule["annotations"]) ??
      null,
    documentation: null,
    suggestedAlias: null,
    examples: [],
    metadata,
    display,
    warnings: [],
  };
}

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
export async function formatModuleList(
  modules: ModuleDescriptor[],
  format: string,
  filterTags?: string[],
  showDeps = false,
  exposureFilter?: { isExposed(moduleId: string): boolean },
): Promise<void> {
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
  } else if (format === "markdown" || format === "skill") {
    let toolkit: typeof import("apcore-toolkit");
    try {
      toolkit = await import("apcore-toolkit");
    } catch {
      throw new Error(TOOLKIT_MISSING_HINT);
    }
    const scanned = modules.map(descriptorToScanned);
    process.stdout.write(
      (toolkit.formatModules(scanned, { style: format, display: true }) as string) + "\n",
    );
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
export async function formatModuleDetail(
  moduleDef: ModuleDescriptor,
  format: string,
): Promise<void> {
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
  } else if (format === "markdown" || format === "skill") {
    let toolkit: typeof import("apcore-toolkit");
    try {
      toolkit = await import("apcore-toolkit");
    } catch {
      throw new Error(TOOLKIT_MISSING_HINT);
    }
    process.stdout.write(
      (toolkit.formatModule(descriptorToScanned(moduleDef), { style: format, display: true }) as string) + "\n",
    );
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
    // Delegate to apcore-toolkit for byte-equivalent cross-SDK output.
    // Toolkit's formatCsv: header = union of keys across all rows (fixes the
    // prior heterogeneous-keys data-loss bug at this site).
    const rows = toRowsForTabular(effective_result);
    if (rows !== null) {
      process.stdout.write(formatCsv(rows));
    } else {
      process.stdout.write(JSON.stringify(effective_result) + "\n");
    }
  } else if (effective === "yaml") {
    // Use js-yaml to produce spec-conformant output for values containing
    // special YAML characters (':', leading '-', '@', '#', CR/LF, etc.).
    process.stdout.write(yaml.dump(effective_result, { lineWidth: -1 }));
  } else if (effective === "jsonl") {
    const rows = toRowsForTabular(effective_result);
    if (rows !== null) {
      process.stdout.write(formatJsonl(rows));
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
 * Coerce an exec result into the row-shape expected by the toolkit's tabular
 * formatters: an iterable of `Record<string, unknown>`. Returns `null` if the
 * shape doesn't fit (e.g. scalar, empty array, array of non-objects) so the
 * caller can fall back to JSON emission.
 */
function toRowsForTabular(
  value: unknown,
): Record<string, unknown>[] | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (!value.every((item) => typeof item === "object" && item !== null && !Array.isArray(item))) {
      return null;
    }
    return value as Record<string, unknown>[];
  }
  if (typeof value === "object") {
    return [value as Record<string, unknown>];
  }
  return null;
}

// ---------------------------------------------------------------------------
// formatPreflightResult
// ---------------------------------------------------------------------------

/**
 * Format and print a PreflightResult to stdout.
 *
 * @internal Cross-module helper consumed by main.ts and discovery.ts only.
 * Not part of the public package surface — `index.ts` does not re-export it.
 * Audit D1-W4 (2026-05-08).
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
 *
 * @internal Cross-module helper consumed by main.ts and discovery.ts only.
 * Not part of the public package surface — `index.ts` does not re-export it.
 * Audit D1-W4 (2026-05-08).
 */
export function firstFailedExitCode(result: PreflightResult): number {
  // Map preflight-check names (apcore-js PROTOCOL_SPEC) to CLI exit codes.
  // Symbolic references so renumbering in errors.ts EXIT_CODES stays in sync.
  const checkToExit: Record<string, number> = {
    module_id: EXIT_CODES.INVALID_CLI_INPUT,
    module_lookup: EXIT_CODES.MODULE_NOT_FOUND,
    call_chain: EXIT_CODES.MODULE_EXECUTE_ERROR,
    acl: EXIT_CODES.ACL_DENIED,
    schema: EXIT_CODES.SCHEMA_VALIDATION_ERROR,
    approval: EXIT_CODES.APPROVAL_DENIED,
    module_preflight: EXIT_CODES.MODULE_EXECUTE_ERROR,
  };
  for (const check of result.checks) {
    if (!check.passed) {
      return checkToExit[check.check] ?? EXIT_CODES.MODULE_EXECUTE_ERROR;
    }
  }
  return EXIT_CODES.MODULE_EXECUTE_ERROR;
}
