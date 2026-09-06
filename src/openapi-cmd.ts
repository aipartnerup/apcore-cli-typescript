/**
 * `apcli openapi` — read an OpenAPI 3.x document into `ScannedModule` form and
 * materialize it as binding artifacts (FE-15a §4.2 / §4.4).
 *
 * Two subcommands:
 *   - `scan`     shows what a document would produce; writes nothing
 *   - `generate` writes the scan to disk through the toolkit's writers
 *
 * Neither registers a module, builds an executor, or issues a request to the
 * described API — which is why this group needs no registry and carries
 * `requiresExecutor: false` in the registrar table (FE-15a §4.7).
 *
 * !!! warning "FE-15a does not make an API callable"
 *     `generate` produces binding files. Passing those files to `--binding`
 *     does NOT yet produce working commands — the dispatch half is FE-15b.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Command, Option } from "commander";
import yaml from "js-yaml";
import {
  OpenAPIScanner,
  InvalidSpecError,
  YAMLWriter,
  formatCsv,
  formatJsonl,
  formatModules,
  modulesToDicts,
  type ScannedModule,
  type OpenAPIScanOptions,
  type WriteResult,
} from "apcore-toolkit";
import { EXIT_CODES } from "./errors.js";
import { formatBoxTable, resolveFormat } from "./output.js";
import {
  DEFAULT_OPENAPI_TIMEOUT_SECONDS,
  InvalidHeaderError,
  OpenapiSourceError,
  detectProxyHazards,
  hazardToWire,
  loadOpenapiSource,
  type ProxyHazard,
} from "./openapi-source.js";

/**
 * The FE-15b limitation, stated plainly wherever a user could infer otherwise.
 * Stating it is part of the deliverable (FE-15a §1.1).
 */
const FE15B_NOTE =
  "Note: generated bindings are not yet executable — HTTP proxy dispatch arrives in a later release.";

interface ScanFlags {
  include?: string;
  exclude?: string;
  prefix?: string;
  deprecated: boolean;
  header: string[];
  openapiTimeout?: number;
}

// ---------------------------------------------------------------------------
// Shared option wiring
// ---------------------------------------------------------------------------

function collectHeader(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

/**
 * Attach the scan options shared by `scan` and `generate`.
 *
 * They map one-to-one onto `OpenAPIScanner.scan` keyword arguments and are
 * forwarded verbatim. The hooks (`transformOperation`, `deriveModuleId`,
 * `transformModule`) are deliberately NOT exposed: overriding derivation hands
 * back the cross-SDK naming guarantee, which is not a thing a command-line
 * flag should be able to do silently (FE-15a §4.2).
 */
function addScanOptions(cmd: Command): Command {
  return cmd
    .option("--include <regex>", "Keep only module IDs matching this regex.")
    .option("--exclude <regex>", "Drop module IDs matching this regex.")
    .option("--prefix <prefix>", "Prepend '<prefix>.' to every derived module ID.")
    .option("--no-deprecated", "Omit operations marked `deprecated: true`.")
    .option(
      "--header <header>",
      'Extra request header for a URL source, as "Key: Value". Repeatable. Never written to a generated file.',
      collectHeader,
      [] as string[],
    )
    .option(
      "--openapi-timeout <secs>",
      `Request timeout in SECONDS for a URL source [default: ${DEFAULT_OPENAPI_TIMEOUT_SECONDS}].`,
      (v: string) => Number.parseFloat(v),
    );
}

/** Compile-check a user regex, exiting 2 with the flag named (FE-15a §6). */
function assertValidRegex(flag: string, pattern: string | undefined): void {
  if (pattern === undefined) return;
  try {
    new RegExp(pattern);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: Invalid regex for --${flag}: ${detail}\n`);
    process.exit(EXIT_CODES.INVALID_CLI_INPUT);
  }
}

function toScanOptions(flags: ScanFlags): OpenAPIScanOptions {
  return {
    include: flags.include,
    exclude: flags.exclude,
    basePathPrefix: flags.prefix,
    // Commander's `--no-deprecated` sets `deprecated: false`.
    includeDeprecated: flags.deprecated,
  };
}

/**
 * Load the document and scan it, mapping every documented failure onto its
 * exit code. Returns the raw document alongside the modules, because
 * hazard detection reads `parameters[].in` — information `ScannedModule`
 * deliberately does not carry.
 */
async function loadAndScan(
  source: string,
  flags: ScanFlags,
): Promise<{ spec: Record<string, unknown>; modules: ScannedModule[] }> {
  assertValidRegex("include", flags.include);
  assertValidRegex("exclude", flags.exclude);

  let spec: Record<string, unknown>;
  try {
    spec = await loadOpenapiSource(
      source,
      flags.header,
      flags.openapiTimeout ?? DEFAULT_OPENAPI_TIMEOUT_SECONDS,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(
      err instanceof InvalidHeaderError
        ? EXIT_CODES.INVALID_CLI_INPUT
        : err instanceof OpenapiSourceError
          ? EXIT_CODES.CONFIG_INVALID
          : EXIT_CODES.MODULE_EXECUTE_ERROR,
    );
  }

  let modules: ScannedModule[];
  try {
    modules = new OpenAPIScanner().scan(spec, toScanOptions(flags));
  } catch (err) {
    if (err instanceof InvalidSpecError) {
      // The toolkit's message names the offending `openapi` value and states
      // that Swagger 2.0 is unsupported — reproduced verbatim (FE-15a §6).
      process.stderr.write(`Error: ${err.message}\n`);
      process.exit(EXIT_CODES.CONFIG_INVALID);
    }
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(EXIT_CODES.MODULE_EXECUTE_ERROR);
  }

  return { spec, modules };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** `3 operations from ./x.yaml (OpenAPI 3.1.0, Petstore 1.0.0)` */
function scanHeadline(
  source: string,
  spec: Record<string, unknown>,
  count: number,
): string {
  const parts: string[] = [];
  const version = spec.openapi;
  if (typeof version === "string" && version) parts.push(`OpenAPI ${version}`);
  const info = spec.info;
  if (info && typeof info === "object" && !Array.isArray(info)) {
    const rec = info as Record<string, unknown>;
    const title = typeof rec.title === "string" ? rec.title : "";
    const docVersion = typeof rec.version === "string" ? rec.version : "";
    const joined = [title, docVersion].filter(Boolean).join(" ");
    if (joined) parts.push(joined);
  }
  const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  return `${pluralize(count, "operation")} from ${source}${suffix}`;
}

/** Route descriptor as the artifact spells it: `GET /pets`. */
function routeOf(mod: ScannedModule): string {
  const meta = (mod.metadata ?? {}) as Record<string, unknown>;
  const method = typeof meta.http_method === "string" ? meta.http_method : "";
  const urlPath = typeof meta.url_path === "string" ? meta.url_path : "";
  return `${method} ${urlPath}`.trim() || mod.target;
}

/**
 * Render scanner warnings.
 *
 * Warnings MUST be rendered, not dropped: the scanner is a degrade-with-warning
 * design, and an operation with an unresolvable `$ref` still yields a module —
 * just a less useful one, whose incomplete flags the warning is the only signal
 * for (FE-15a §4.2).
 */
function renderWarnings(modules: readonly ScannedModule[], write: (s: string) => void): void {
  const rows: Array<[string, string]> = [];
  for (const mod of modules) {
    for (const w of mod.warnings ?? []) rows.push([mod.moduleId, w]);
  }
  if (rows.length === 0) return;
  const idWidth = Math.max(...rows.map(([id]) => id.length));
  write(`\n${pluralize(rows.length, "warning")}:\n`);
  for (const [id, w] of rows) write(`  ${id.padEnd(idWidth)}  ${w}\n`);
}

/**
 * Render proxy hazards.
 *
 * Counted separately from scanner warnings and never changing the exit code in
 * FE-15a: a hazard is a statement about a FUTURE execution path, not about the
 * scan that just ran (FE-15a §4.3).
 */
function renderHazards(hazards: readonly ProxyHazard[], write: (s: string) => void): void {
  if (hazards.length === 0) return;
  const verb = hazards.length === 1 ? "operation cannot" : "operations cannot";
  const idWidth = Math.max(...hazards.map((h) => h.moduleId.length));
  write(`\n${hazards.length} ${verb} be proxied by FE-15b (deferred HTTP proxy dispatch):\n`);
  for (const h of hazards) {
    write(
      `  ${h.moduleId.padEnd(idWidth)}  ${h.httpMethod} with ` +
        `${pluralize(h.parameters.length, "`in: query` parameter")} ` +
        `(${h.parameters.join(", ")})\n`,
    );
  }
}

// ---------------------------------------------------------------------------
// openapi scan (FE-15a §4.2)
// ---------------------------------------------------------------------------

function registerScanSubcommand(group: Command): void {
  const cmd = new Command("scan")
    .description(
      "Show the modules an OpenAPI 3.x document would produce. Writes nothing.",
    )
    .argument("<source>", "Local path or http(s):// URL, taken verbatim.");
  addScanOptions(cmd);
  cmd
    .addOption(
      new Option("--format <format>", "Output format.")
        .choices(["table", "json", "csv", "yaml", "jsonl", "markdown", "skill"]),
    )
    .action(async (source: string, flags: ScanFlags & { format?: string }) => {
      const { spec, modules } = await loadAndScan(source, flags);
      const hazards = detectProxyHazards(spec, modules);
      const fmt = resolveFormat(flags.format);

      if (fmt === "json" || fmt === "yaml") {
        const payload = {
          source,
          openapi_version: typeof spec.openapi === "string" ? spec.openapi : null,
          // Each module carries its own `warnings` array; hazards sit under a
          // top-level key because they describe a future execution path
          // (FE-15a §4.3).
          modules: modulesToDicts([...modules]),
          hazards: hazards.map(hazardToWire),
        };
        process.stdout.write(
          fmt === "json"
            ? JSON.stringify(payload, null, 2) + "\n"
            : yaml.dump(payload, { lineWidth: -1 }),
        );
        return;
      }

      if (fmt === "markdown" || fmt === "skill") {
        // Rendered through the toolkit's own formatter with no adaptation
        // layer: `scan()` already returns `ScannedModule` values, the exact
        // type `formatModules` accepts (FE-15a §4.2).
        process.stdout.write(
          (formatModules([...modules], { style: fmt, display: true }) as string) + "\n",
        );
        renderWarnings(modules, (s) => process.stderr.write(s));
        renderHazards(hazards, (s) => process.stderr.write(s));
        return;
      }

      if (fmt === "csv" || fmt === "jsonl") {
        const rows = modules.map((m) => ({
          module_id: m.moduleId,
          route: routeOf(m),
          description: m.description,
          tags: [...m.tags].join(","),
          warnings: [...(m.warnings ?? [])].join("; "),
        }));
        if (rows.length > 0) {
          process.stdout.write(fmt === "csv" ? formatCsv(rows) : formatJsonl(rows));
        }
        renderHazards(hazards, (s) => process.stderr.write(s));
        return;
      }

      // table
      process.stdout.write(scanHeadline(source, spec, modules.length) + "\n\n");
      if (modules.length > 0) {
        process.stdout.write(
          formatBoxTable(
            ["Module ID", "Route", "Description", "Tags"],
            modules.map((m) => [
              m.moduleId,
              routeOf(m),
              m.description,
              [...m.tags].join(", "),
            ]),
          ),
        );
      }
      renderWarnings(modules, (s) => process.stdout.write(s));
      renderHazards(hazards, (s) => process.stdout.write(s));
      // Exit 0 even when warnings or hazards are present — a
      // partially-understood document is a successful scan (FE-15a §4.2).
    });
  group.addCommand(cmd);
}

// ---------------------------------------------------------------------------
// openapi generate (FE-15a §4.4)
// ---------------------------------------------------------------------------

/**
 * Reproduce `YAMLWriter`'s filename derivation so the CLI can list `--dry-run`
 * paths and honour `--force` before handing the batch over.
 *
 * The writer overwrites unconditionally, so the non-destructive default
 * (`apcli init`'s precedent) has to be applied here, on the module list, and
 * that needs the same names the writer will pick — including its in-batch
 * collision counter.
 */
function plannedFilenames(modules: readonly ScannedModule[]): string[] {
  const taken = new Set<string>();
  const out: string[] = [];
  for (const mod of modules) {
    const base = mod.moduleId
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/\.{2,}/g, "_");
    let filename = `${base}.binding.yaml`;
    let counter = 0;
    while (taken.has(filename)) {
      counter++;
      filename = `${base}_${counter}.binding.yaml`;
    }
    taken.add(filename);
    out.push(filename);
  }
  return out;
}

function registerGenerateSubcommand(group: Command): void {
  const cmd = new Command("generate")
    .description(
      "Write the scanned modules to disk as <id>.binding.yaml artifacts.",
    )
    .argument("<source>", "Local path or http(s):// URL, taken verbatim.")
    .requiredOption("-o, --output <dir>", "Directory to write artifacts into.");
  addScanOptions(cmd);
  cmd
    .option("--dry-run", "List the paths that would be written; create nothing.", false)
    .option("--force", "Overwrite existing files.", false)
    .action(async (
      source: string,
      flags: ScanFlags & {
        output: string;
        dryRun: boolean;
        force: boolean;
      },
    ) => {
      const { spec, modules } = await loadAndScan(source, flags);
      const hazards = detectProxyHazards(spec, modules);

      const filenames = plannedFilenames(modules);
      // Resolved, so the paths a `--dry-run` lists are the same ones the
      // writer reports back after a real run.
      const planned: Array<{ mod: ScannedModule; filePath: string }> = modules.map(
        (mod, i) => ({ mod, filePath: path.resolve(flags.output, filenames[i]) }),
      );

      // Non-destructive by default: an existing file is skipped with a warning
      // and the command still exits 0, matching `apcli init` (FE-15a §4.4).
      const toWrite: ScannedModule[] = [];
      const skipped: string[] = [];
      for (const { mod, filePath } of planned) {
        if (!flags.force && fs.existsSync(filePath)) {
          skipped.push(filePath);
          continue;
        }
        toWrite.push(mod);
      }
      for (const filePath of skipped) {
        process.stderr.write(
          `WARNING: ${filePath} already exists; skipped (use --force to overwrite).\n`,
        );
      }

      if (flags.dryRun) {
        for (const { filePath } of planned) {
          if (skipped.includes(filePath)) continue;
          process.stdout.write(`Would write: ${filePath}\n`);
        }
        renderHazards(hazards, (s) => process.stdout.write(s));
        process.stdout.write(`\n${FE15B_NOTE}\n`);
        return;
      }

      let results: WriteResult[] = [];
      if (toWrite.length > 0) {
        // Binding YAML only, in every SDK. There is deliberately no
        // host-language source writer: every toolkit source writer resolves
        // `target` as a `module.path:callable` import path and rejects
        // anything else, while an OpenAPI-derived target is always a route
        // descriptor like "GET /pets" (FE-15a §4.4 note, §4.5).
        try {
          // "collect": one module that cannot be serialised must not cost the
          // other forty their artifacts (FE-15a §8.2 / FR-15-10).
          results = new YAMLWriter().write(toWrite, flags.output, {
            errorMode: "collect",
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(`Error: ${msg}\n`);
          process.exit(EXIT_CODES.MODULE_EXECUTE_ERROR);
        }
      }

      const failures = results.filter((r) => r.verificationError !== null);
      for (const failure of failures) {
        process.stderr.write(
          `WARNING: ${failure.moduleId}: ${failure.verificationError}\n`,
        );
      }
      const written = results.filter((r) => r.verificationError === null);
      for (const result of written) {
        if (result.path) process.stdout.write(`Wrote ${result.path}\n`);
      }
      process.stdout.write(
        `\n${pluralize(written.length, "file")} written to ${flags.output}` +
          (skipped.length > 0 ? `, ${skipped.length} skipped` : "") +
          (failures.length > 0 ? `, ${failures.length} failed` : "") +
          ".\n",
      );
      renderHazards(hazards, (s) => process.stdout.write(s));
      process.stdout.write(`\n${FE15B_NOTE}\n`);

      // A write the user asked for and did not get is a real fault. Skipped
      // files are not — those are the documented non-destructive default.
      if (failures.length > 0) {
        process.exit(EXIT_CODES.MODULE_EXECUTE_ERROR);
      }
    });
  group.addCommand(cmd);
}

// ---------------------------------------------------------------------------
// registerOpenapiCommand
// ---------------------------------------------------------------------------

/**
 * Register the `openapi` nested group on the `apcli` group (FE-15a §4.7).
 *
 * There is no root-level entry point: root-level shims were retired in v0.8
 * and `RESERVED_GROUP_NAMES` keeps `apcli` the only reserved root name, so
 * `<cli> apcli openapi <sub>` is the sole path.
 */
export function registerOpenapiCommand(apcliGroup: Command): void {
  const group = new Command("openapi").description(
    "Import an OpenAPI 3.x document as apcore modules.",
  );
  registerScanSubcommand(group);
  registerGenerateSubcommand(group);
  apcliGroup.addCommand(group);
}
