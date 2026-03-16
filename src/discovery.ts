/**
 * Discovery commands — list and describe modules.
 *
 * Protocol spec: Module discovery & introspection
 */

import { Command } from "commander";
import type { ModuleDescriptor, Registry } from "./cli.js";
import { EXIT_CODES } from "./errors.js";
import { validateModuleId } from "./main.js";
import {
  formatModuleDetail,
  formatModuleList,
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
 * Register list and describe commands on the CLI group.
 */
export function registerDiscoveryCommands(
  cli: Command,
  registry: Registry,
): void {
  const listCmd = new Command("list")
    .description("List available modules in the registry.")
    .option("--tag <tag>", "Filter modules by tag (AND logic). Repeatable.", collectTag, [])
    .option("--format <format>", "Output format.", undefined)
    .action((opts: { tag: string[]; format?: string }) => {
      // Validate tags
      for (const t of opts.tag) {
        validateTag(t);
      }

      const modules: ModuleDescriptor[] = [];
      for (const m of registry.listModules()) {
        modules.push(m);
      }

      let filtered = modules;
      if (opts.tag.length > 0) {
        const filterTags = new Set(opts.tag);
        filtered = modules.filter((m) => {
          const mTags = m.tags ?? [];
          return [...filterTags].every((t) => mTags.includes(t));
        });
      }

      const fmt = resolveFormat(opts.format);
      formatModuleList(filtered, fmt, opts.tag.length > 0 ? opts.tag : undefined);
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
