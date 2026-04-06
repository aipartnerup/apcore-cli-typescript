/**
 * Discovery commands — list, describe, validate (FE-04, FE-11).
 *
 * Protocol spec: Module discovery & introspection
 */

import { Command, Option } from "commander";
import type { Executor, ModuleDescriptor, Registry } from "./cli.js";
import { EXIT_CODES } from "./errors.js";
import { validateModuleId, collectInput } from "./main.js";
import {
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
 * Register list and describe commands on the CLI group.
 */
export function registerDiscoveryCommands(
  cli: Command,
  registry: Registry,
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

      const fmt = resolveFormat(opts.format);
      const filterTagsArg = opts.tag.length > 0 ? opts.tag : undefined;
      formatModuleList(modules, fmt, filterTagsArg, opts.deps);
    });
  cli.addCommand(listCmd);

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
  cli.addCommand(describeCmd);
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
        process.exit(1);
      }

      const preflight = await executor.validate(moduleId, merged);
      formatPreflightResult(preflight, opts.format);
      process.exit(preflight.valid ? 0 : firstFailedExitCode(preflight));
    });
  cli.addCommand(validateCmd);
}
