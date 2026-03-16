/**
 * TTY-adaptive output formatting (table/json).
 *
 * Protocol spec: Output formatting
 */

import type { ModuleDescriptor } from "./cli.js";

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
    const rows = modules.map((m) => [
      m.id,
      truncate(m.description, 80),
      (m.tags ?? []).join(", "),
    ]);
    process.stdout.write(formatTable(headers, rows));
  } else if (format === "json") {
    const result = modules.map((m) => ({
      id: m.id,
      description: m.description,
      tags: m.tags ?? [],
    }));
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
 * Format and print module execution result.
 */
export function formatExecResult(
  result: unknown,
  format?: string,
): void {
  if (result === null || result === undefined) {
    return;
  }
  const effective = resolveFormat(format);
  if (
    effective === "table" &&
    typeof result === "object" &&
    !Array.isArray(result)
  ) {
    // Key-value table
    const entries = Object.entries(result as Record<string, unknown>);
    const headers = ["Key", "Value"];
    const rows = entries.map(([k, v]) => [String(k), String(v)]);
    process.stdout.write(formatTable(headers, rows));
  } else if (typeof result === "object") {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else if (typeof result === "string") {
    process.stdout.write(result + "\n");
  } else {
    process.stdout.write(String(result) + "\n");
  }
}
