/**
 * Discovery commands — list, describe, exec, validate (FE-04, FE-11, FE-13).
 *
 * Protocol spec: Module discovery & introspection
 *
 * FE-13 (builtin-group): these registrars attach per-subcommand to an
 * `apcli` Commander sub-group rather than to the root program.
 */

import { Command, Option } from "commander";
import type { Executor, ModuleDescriptor, Registry } from "./cli.js";
import { EXIT_CODES } from "./errors.js";
import { validateModuleId, collectInput } from "./main.js";
import {
  formatExecResult,
  formatModuleDetail,
  formatModuleList,
  formatPreflightResult,
  firstFailedExitCode,
  resolveFormat,
} from "./output.js";

const TAG_PATTERN = /^[a-z][a-z0-9_-]*$/;

function validateTag(tag: string): void {
  if (!TAG_PATTERN.test(tag)) {
    process.stderr.write(
      `Error: Invalid tag format: '${tag}'. Tags must match [a-z][a-z0-9_-]*.\n`,
    );
    process.exit(EXIT_CODES.INVALID_CLI_INPUT);
  }
}

/**
 * Collect repeated --tag options into an array.
 */
function collectTag(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

/**
 * Collect repeated --annotation options into an array.
 */
function collectAnnotation(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

/**
 * Get an annotation value from a module descriptor.
 */
function getAnnotationFlag(moduleDef: ModuleDescriptor, flag: string): boolean {
  const annotations = moduleDef.annotations;
  if (!annotations || typeof annotations !== "object") return false;
  const ann = annotations as Record<string, unknown>;
  // Map CLI flag names to annotation property names
  const map: Record<string, string> = {
    "destructive": "destructive",
    "requires-approval": "requires_approval",
    "readonly": "readonly",
    "streaming": "streaming",
    "cacheable": "cacheable",
    "idempotent": "idempotent",
  };
  const attr = map[flag] ?? flag;
  return ann[attr] === true;
}

/**
 * Register the `list` subcommand on the given group (FE-13).
 */
export function registerListCommand(
  apcliGroup: Command,
  registry: Registry,
  exposureFilter?: import("./exposure.js").ExposureFilter,
): void {
  const listCmd = new Command("list")
    .description("List available modules in the registry.")
    .option("--tag <tag>", "Filter modules by tag (AND logic). Repeatable.", collectTag, [])
    .option("--flat", "Show flat list (no grouping).", false)
    .option("--format <format>", "Output format.", undefined)
    .option("-s, --search <query>", "Filter by substring match on ID and description.")
    .addOption(
      new Option("--status <status>", "Filter by module status.")
        .choices(["enabled", "disabled", "all"])
        .default("enabled"),
    )
    .option("-a, --annotation <flag>", "Filter by annotation flag (AND logic). Repeatable.", collectAnnotation, [])
    .addOption(
      new Option("--sort <field>", "Sort order.")
        .choices(["id", "calls", "errors", "latency"])
        .default("id"),
    )
    .option("--reverse", "Reverse sort order.", false)
    .option("--deprecated", "Include deprecated modules.", false)
    .option("--deps", "Show dependency count column.", false)
    .addOption(
      new Option("--exposure <mode>", "Filter by exposure status.")
        .choices(["exposed", "hidden", "all"])
        .default("exposed"),
    )
    .action((opts: {
      tag: string[];
      flat: boolean;
      format?: string;
      search?: string;
      status: string;
      annotation: string[];
      sort: string;
      reverse: boolean;
      deprecated: boolean;
      deps: boolean;
      exposure: string;
    }) => {
      // Validate tags
      for (const t of opts.tag) {
        validateTag(t);
      }

      let modules: ModuleDescriptor[] = [];
      for (const m of registry.listModules()) {
        modules.push(m);
      }

      // Tag filter (AND logic)
      if (opts.tag.length > 0) {
        const filterTags = new Set(opts.tag);
        modules = modules.filter((m) => {
          const mTags = m.tags ?? [];
          return [...filterTags].every((t) => mTags.includes(t));
        });
      }

      // Search filter (case-insensitive substring on id + description)
      if (opts.search) {
        const query = opts.search.toLowerCase();
        modules = modules.filter(
          (m) =>
            (m.id ?? "").toLowerCase().includes(query) ||
            (m.description ?? "").toLowerCase().includes(query),
        );
      }

      // Status filter
      if (opts.status === "enabled") {
        modules = modules.filter((m) => {
          const enabled = (m as unknown as Record<string, unknown>).enabled;
          return enabled !== false;
        });
      } else if (opts.status === "disabled") {
        modules = modules.filter((m) => {
          const enabled = (m as unknown as Record<string, unknown>).enabled;
          return enabled === false;
        });
      }
      // "all": no filter

      // Deprecated filter (excluded by default)
      if (!opts.deprecated) {
        modules = modules.filter((m) => {
          const deprecated = (m as unknown as Record<string, unknown>).deprecated;
          return deprecated !== true;
        });
      }

      // Annotation filter (AND logic)
      if (opts.annotation.length > 0) {
        for (const annFlag of opts.annotation) {
          modules = modules.filter((m) => getAnnotationFlag(m, annFlag));
        }
      }

      // Sort — usage-based sorts require system.usage modules
      if (opts.sort === "calls" || opts.sort === "errors" || opts.sort === "latency") {
        process.stderr.write(
          `Warning: Usage data not available; sorting by id. Sort by ${opts.sort} requires system.usage modules.\n`,
        );
      }
      modules.sort((a, b) => (a.id ?? "").localeCompare(b.id ?? ""));
      if (opts.reverse) {
        modules.reverse();
      }

      // Exposure filter (FE-12)
      let showExposureCol = false;
      if (exposureFilter && opts.exposure !== "all") {
        if (opts.exposure === "exposed") {
          modules = modules.filter((m) => exposureFilter.isExposed(m.id ?? ""));
        } else if (opts.exposure === "hidden") {
          modules = modules.filter((m) => !exposureFilter.isExposed(m.id ?? ""));
        }
      }
      if (opts.exposure === "all" && exposureFilter) {
        showExposureCol = true;
      }

      const fmt = resolveFormat(opts.format);
      const filterTagsArg = opts.tag.length > 0 ? opts.tag : undefined;
      formatModuleList(modules, fmt, filterTagsArg, opts.deps, showExposureCol ? exposureFilter : undefined);
    });
  apcliGroup.addCommand(listCmd);
}

/**
 * Register the `describe` subcommand on the given group (FE-13).
 */
export function registerDescribeCommand(
  apcliGroup: Command,
  registry: Registry,
): void {
  const describeCmd = new Command("describe")
    .description("Show metadata, schema, and annotations for a module.")
    .argument("<module-id>", "Module ID to describe")
    .option("--format <format>", "Output format.", undefined)
    .action((moduleId: string, opts: { format?: string }) => {
      validateModuleId(moduleId);

      const moduleDef = registry.getModule(moduleId);
      if (!moduleDef) {
        process.stderr.write(
          `Error: Module '${moduleId}' not found.\n`,
        );
        process.exit(EXIT_CODES.MODULE_NOT_FOUND);
      }

      const fmt = resolveFormat(opts.format);
      formatModuleDetail(moduleDef, fmt);
    });
  apcliGroup.addCommand(describeCmd);
}

/**
 * Register the `exec` subcommand on the given group (FE-13).
 *
 * Generic dispatch: `apcli exec <module-id> [--format fmt] [--input json]`.
 * Unlike the per-module commands built by `buildModuleCommand`, this command
 * does not derive options from the module's input schema — inputs are passed
 * as a JSON object via `--input`. This mirrors the apcli-flavoured generic
 * dispatch contract in the builtin-group feature spec.
 */
export function registerExecCommand(
  apcliGroup: Command,
  registry: Registry,
  executor: Executor,
): void {
  const execCmd = new Command("exec")
    .description("Execute a module by ID with JSON input.")
    .argument("<module-id>", "Module ID to execute")
    .option("--format <format>", "Output format (json, table, csv, yaml, jsonl).")
    .option("--fields <fields>", "Comma-separated dot-paths to select from the result.")
    .option(
      "--input <json>",
      "JSON object passed as input to the module. Use '-' to read JSON from stdin.",
    )
    .action(async (
      moduleId: string,
      opts: { format?: string; fields?: string; input?: string },
    ) => {
      validateModuleId(moduleId);

      const moduleDef = registry.getModule(moduleId);
      if (!moduleDef) {
        process.stderr.write(`Error: Module '${moduleId}' not found.\n`);
        process.exit(EXIT_CODES.MODULE_NOT_FOUND);
      }

      // Parse --input. Distinguish between a stdin marker ("-") — delegated
      // to collectInput — and an inline JSON literal, which we parse directly
      // here since collectInput only treats "-" specially.
      let merged: Record<string, unknown> = {};
      if (opts.input === "-") {
        merged = await collectInput("-", {}, false);
      } else if (opts.input !== undefined) {
        try {
          const parsed = JSON.parse(opts.input);
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            process.stderr.write(
              "Error: --input JSON must be an object.\n",
            );
            process.exit(EXIT_CODES.INVALID_CLI_INPUT);
          }
          merged = parsed as Record<string, unknown>;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(`Error: --input is not valid JSON: ${msg}\n`);
          process.exit(EXIT_CODES.INVALID_CLI_INPUT);
        }
      }

      const result = await executor.execute(moduleId, merged);
      const fmt = resolveFormat(opts.format);
      formatExecResult(result, fmt, opts.fields);
    });
  apcliGroup.addCommand(execCmd);
}

/**
 * Register the standalone validate command.
 */
export function registerValidateCommand(
  cli: Command,
  registry: Registry,
  executor: Executor,
): void {
  const validateCmd = new Command("validate")
    .description("Run preflight checks without executing a module.")
    .argument("<module-id>", "Module ID to validate")
    .option("--input <source>", "JSON input file or '-' for stdin.")
    .option("--format <format>", "Output format.")
    .action(async (moduleId: string, opts: { input?: string; format?: string }) => {
      validateModuleId(moduleId);

      const moduleDef = registry.getModule(moduleId);
      if (!moduleDef) {
        process.stderr.write(`Error: Module '${moduleId}' not found.\n`);
        process.exit(EXIT_CODES.MODULE_NOT_FOUND);
      }

      const merged = opts.input ? await collectInput(opts.input, {}, false) : {};

      if (!executor.validate) {
        process.stderr.write("Error: Executor does not support validate.\n");
        process.exit(EXIT_CODES.MODULE_EXECUTE_ERROR);
      }

      const preflight = await executor.validate(moduleId, merged);
      formatPreflightResult(preflight, opts.format);
      process.exit(preflight.valid ? 0 : firstFailedExitCode(preflight));
    });
  cli.addCommand(validateCmd);
}

// registerDiscoveryCommands was removed in FE-13 create-cli-integration.
// Call registerListCommand + registerDescribeCommand directly.
