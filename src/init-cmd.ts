/**
 * Init command — scaffold new apcore modules (Phase 1).
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import { EXIT_CODES } from "./errors.js";

/**
 * Wrap a filesystem operation and exit with MODULE_EXECUTE_ERROR on failure.
 * Unwrapped mkdirSync/writeFileSync would surface raw Node stack traces to the
 * user; this helper funnels them through the CLI's standard stderr/exit path.
 */
function runFsOp<T>(op: string, targetPath: string, fn: () => T, partial?: string[]): T {
  try {
    return fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: failed to ${op} ${targetPath}: ${msg}\n`);
    if (partial && partial.length > 0) {
      process.stderr.write(
        `  Partial scaffold left on disk — you may want to remove: ${partial.join(", ")}\n`,
      );
    }
    process.exit(EXIT_CODES.MODULE_EXECUTE_ERROR);
  }
}

const DECORATOR_TEMPLATE = `\
import { module } from "apcore-js";
import { Type } from "@sinclair/typebox";

export const {varName} = module({
  id: "{moduleId}",
  description: "{description}",
  inputSchema: Type.Object({}),
  outputSchema: Type.Object({ status: Type.String() }),
  execute: (_inputs) => {
    // TODO: implement
    return { status: "ok" };
  },
});
`;

const CONVENTION_TEMPLATE = `\
/**
 * {description}
 */
{cliGroupLine}
export function {funcName}(): Record<string, unknown> {
  // TODO: implement
  return { status: "ok" };
}
`;

const BINDING_TEMPLATE = `\
spec_version: "1.0"
bindings:
  - module_id: "{moduleId}"
    target: "{target}"
    description: "{description}"
    auto_schema: true
`;

/**
 * Simple template rendering: replaces {key} with values from the context.
 */
function renderTemplate(template: string, context: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(context)) {
    // Replace all occurrences of {key} with the value
    result = result.split(`{${key}}`).join(value);
  }
  return result;
}

/**
 * Register the init command group on the CLI program.
 */
export function registerInitCommand(cli: Command): void {
  const initGroup = cli.command("init").description("Scaffold new apcore modules.");

  initGroup
    .command("module <module-id>")
    .description("Create a new module from a template.\n\nMODULE_ID is the module identifier (e.g., ops.deploy, user.create).")
    .option(
      "--style <style>",
      "Module style: decorator (@module), convention (plain function), or binding (YAML).",
      "convention",
    )
    .option("--dir <path>", "Output directory. Default: extensions/ or commands/.")
    .option("-d, --description <text>", "Module description.", "TODO: add description")
    .action((moduleId: string, opts: { style: string; dir?: string; description: string }) => {
      // Parse module_id into parts
      const lastDot = moduleId.lastIndexOf(".");
      const prefix = lastDot >= 0 ? moduleId.substring(0, lastDot) : moduleId;
      const funcName = lastDot >= 0 ? moduleId.substring(lastDot + 1) : moduleId;

      const style = opts.style;
      const description = opts.description;

      // Validate --dir to prevent path traversal
      const dir = opts.dir ?? (style === "decorator" ? "extensions" : style === "binding" ? "bindings" : "commands");
      if (dir.split(path.sep).includes("..") || dir.split("/").includes("..")) {
        process.stderr.write(`Error: Output directory must not contain '..' path components.\n`);
        process.exit(2);
      }

      switch (style) {
        case "decorator":
          createDecoratorModule(moduleId, prefix, funcName, description, dir);
          break;
        case "convention":
          createConventionModule(moduleId, prefix, funcName, description, dir);
          break;
        case "binding":
          createBindingModule(moduleId, prefix, funcName, description, dir);
          break;
        default:
          process.stderr.write(`Error: Unknown style '${style}'\n`);
          process.exit(2);
      }
    });
}

function createDecoratorModule(
  moduleId: string,
  _prefix: string,
  funcName: string,
  description: string,
  outputDir: string,
): void {
  runFsOp("create directory", outputDir, () => fs.mkdirSync(outputDir, { recursive: true }));
  const filename = moduleId.replace(/\./g, "_") + ".ts";
  const filepath = path.join(outputDir, filename);

  const varName = funcName + "Module";
  const content = renderTemplate(DECORATOR_TEMPLATE, {
    moduleId,
    varName,
    funcName,
    description,
  });
  runFsOp("write file", filepath, () => fs.writeFileSync(filepath, content));
  process.stdout.write(`Created ${filepath}\n`);
}

function createConventionModule(
  moduleId: string,
  prefix: string,
  funcName: string,
  description: string,
  outputDir: string,
): void {
  // If prefix has dots, create subdirectories
  const prefixParts = prefix.split(".");
  const dirPath = prefixParts.length > 1
    ? path.join(outputDir, ...prefixParts.slice(0, -1))
    : outputDir;
  runFsOp("create directory", dirPath, () => fs.mkdirSync(dirPath, { recursive: true }));

  let filename: string;
  if (prefixParts.length > 1) {
    filename = prefixParts[prefixParts.length - 1] + ".ts";
  } else {
    filename = prefix + ".ts";
  }
  // If the file would be the same as the function name, use prefix as filename
  if (prefix === funcName) {
    filename = prefix + ".ts";
  }
  const filepath = path.join(dirPath, filename);

  const cliGroupLine = moduleId.includes(".")
    ? `export const CLI_GROUP = "${prefixParts[0]}";\n`
    : "";

  const content = renderTemplate(CONVENTION_TEMPLATE, {
    funcName,
    description,
    cliGroupLine,
  });
  runFsOp("write file", filepath, () => fs.writeFileSync(filepath, content));
  process.stdout.write(`Created ${filepath}\n`);
}

function createBindingModule(
  moduleId: string,
  prefix: string,
  funcName: string,
  description: string,
  outputDir: string,
): void {
  const partial: string[] = [];
  runFsOp("create directory", outputDir, () => fs.mkdirSync(outputDir, { recursive: true }));

  const yamlFile = path.join(outputDir, moduleId.replace(/\./g, "_") + ".binding.yaml");
  const target = `commands.${prefix}:${funcName}`;

  const yamlContent = renderTemplate(BINDING_TEMPLATE, {
    moduleId,
    target,
    description,
  });
  runFsOp("write file", yamlFile, () => fs.writeFileSync(yamlFile, yamlContent));
  partial.push(yamlFile);
  process.stdout.write(`Created ${yamlFile}\n`);

  // Also create the target function file
  const baseSrc = "commands";
  runFsOp("create directory", baseSrc, () => fs.mkdirSync(baseSrc, { recursive: true }), partial);
  const srcFile = path.join(baseSrc, prefix.replace(/\./g, "_") + ".ts");
  if (!fs.existsSync(srcFile)) {
    const srcContent =
      `export function ${funcName}(): Record<string, unknown> {\n` +
      `  /** ${description} */\n` +
      "  // TODO: implement\n" +
      '  return { status: "ok" };\n' +
      "}\n";
    runFsOp("write file", srcFile, () => fs.writeFileSync(srcFile, srcContent), partial);
    process.stdout.write(`Created ${srcFile}\n`);
  }
}
