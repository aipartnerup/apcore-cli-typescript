/**
 * Init command — scaffold new apcore modules (Phase 1).
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";

const DECORATOR_TEMPLATE = `\
"""Module: {moduleId}"""

from apcore import module


@module(id="{moduleId}", description="{description}")
def {funcName}() -> dict:
    """{description}"""
    # TODO: implement
    return {{"status": "ok"}}
`;

const CONVENTION_TEMPLATE = `\
"""{description}"""

{cliGroupLine}
def {funcName}() -> dict:
    """{description}"""
    # TODO: implement
    return {{"status": "ok"}}
`;

const BINDING_TEMPLATE = `\
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
      if (dir.includes("..")) {
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
  fs.mkdirSync(outputDir, { recursive: true });
  const filename = moduleId.replace(/\./g, "_") + ".py";
  const filepath = path.join(outputDir, filename);

  const content = renderTemplate(DECORATOR_TEMPLATE, {
    moduleId,
    funcName,
    description,
  });
  fs.writeFileSync(filepath, content);
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
  fs.mkdirSync(dirPath, { recursive: true });

  let filename: string;
  if (prefixParts.length > 1) {
    filename = prefixParts[prefixParts.length - 1] + ".py";
  } else {
    filename = prefix + ".py";
  }
  // If the file would be the same as the function name, use prefix as filename
  if (prefix === funcName) {
    filename = prefix + ".py";
  }
  const filepath = path.join(dirPath, filename);

  const cliGroupLine = moduleId.includes(".")
    ? `CLI_GROUP = "${prefixParts[0]}"\n`
    : "";

  const content = renderTemplate(CONVENTION_TEMPLATE, {
    funcName,
    description,
    cliGroupLine,
  });
  fs.writeFileSync(filepath, content);
  process.stdout.write(`Created ${filepath}\n`);
}

function createBindingModule(
  moduleId: string,
  prefix: string,
  funcName: string,
  description: string,
  outputDir: string,
): void {
  fs.mkdirSync(outputDir, { recursive: true });

  const yamlFile = path.join(outputDir, moduleId.replace(/\./g, "_") + ".binding.yaml");
  const target = `commands.${prefix}:${funcName}`;

  const yamlContent = renderTemplate(BINDING_TEMPLATE, {
    moduleId,
    target,
    description,
  });
  fs.writeFileSync(yamlFile, yamlContent);
  process.stdout.write(`Created ${yamlFile}\n`);

  // Also create the target function file
  const baseSrc = "commands";
  fs.mkdirSync(baseSrc, { recursive: true });
  const srcFile = path.join(baseSrc, prefix.replace(/\./g, "_") + ".py");
  if (!fs.existsSync(srcFile)) {
    const srcContent =
      `def ${funcName}() -> dict:\n` +
      `    """${description}"""\n` +
      "    # TODO: implement\n" +
      '    return {"status": "ok"}\n';
    fs.writeFileSync(srcFile, srcContent);
    process.stdout.write(`Created ${srcFile}\n`);
  }
}
