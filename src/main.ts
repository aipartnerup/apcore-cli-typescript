/**
 * CLI entry point — createCli / main equivalents.
 *
 * Protocol spec: CLI bootstrapping & command registration
 */

import { Command } from "commander";
import { EXIT_CODES, exitCodeForError } from "./errors.js";
import type { Executor, ModuleDescriptor } from "./cli.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for a single Commander option derived from a JSON Schema property. */
export interface OptionConfig {
  /** The property name from the schema. */
  name: string;
  /** Commander flags string (e.g. "--my-flag <value>" or "--flag, --no-flag"). */
  flags: string;
  /** Help text for the option. */
  description: string;
  /** Default value. */
  defaultValue?: unknown;
  /** Whether the field is required (for display only). */
  required: boolean;
  /** Enum choices (string values). */
  choices?: string[];
  /** Whether this is a boolean flag pair (--flag/--no-flag). */
  isBooleanFlag?: boolean;
  /** Maps string enum value → original type name ("int", "float", "bool"). */
  enumOriginalTypes?: Record<string, string>;
  /** Parser function for Commander (e.g. parseInt, parseFloat). */
  parseArg?: (value: string) => unknown;
}

// ---------------------------------------------------------------------------
// createCli
// ---------------------------------------------------------------------------

/**
 * Build and return the top-level Commander program.
 *
 * @param extensionsDir  Path to the extensions directory (default: ./extensions)
 * @param progName       Program name shown in help (default: apcore-cli)
 *
 * TODO: Wire up Registry, Executor, LazyModuleGroup, discovery, and shell commands.
 */
export function createCli(
  extensionsDir?: string,
  progName?: string,
): Command {
  const program = new Command(progName ?? "apcore-cli")
    .version("0.1.0")
    .description("apcore CLI — execute apcore modules from the command line");

  // TODO: Instantiate Registry from extensionsDir
  // TODO: Instantiate Executor
  // TODO: Register LazyModuleGroup commands
  // TODO: Register discovery commands (list, describe)
  // TODO: Register shell commands (completions, man)

  void extensionsDir; // placeholder

  return program;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

/**
 * Parse argv and run the CLI. Handles top-level error catching and exit codes.
 *
 * TODO: Implement full error handling with exit code mapping.
 */
export function main(progName?: string): void {
  const program = createCli(undefined, progName);

  try {
    program.parse(process.argv);
  } catch (error: unknown) {
    const code = exitCodeForError(error);
    process.exit(code);
  }
}

// ---------------------------------------------------------------------------
// buildModuleCommand
// ---------------------------------------------------------------------------

/**
 * Build a Commander Command for a single apcore module.
 *
 * TODO: Implement schema-to-options mapping and execution wiring.
 */
export function buildModuleCommand(
  moduleDef: ModuleDescriptor,
  executor: Executor,
): Command {
  const cmd = new Command(moduleDef.id).description(moduleDef.description);
  void executor; // placeholder
  return cmd;
}

// ---------------------------------------------------------------------------
// validateModuleId
// ---------------------------------------------------------------------------

/**
 * Validate that a module ID conforms to the expected format.
 * Pattern: [a-z][a-z0-9_]*(.[a-z][a-z0-9_])* — max 128 chars.
 */
export function validateModuleId(moduleId: string): void {
  if (moduleId.length > 128) {
    process.stderr.write(
      `Error: Invalid module ID format: '${moduleId}'. Maximum length is 128 characters.\n`,
    );
    process.exit(EXIT_CODES.INVALID_CLI_INPUT);
  }
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(moduleId)) {
    process.stderr.write(
      `Error: Invalid module ID format: '${moduleId}'.\n`,
    );
    process.exit(EXIT_CODES.INVALID_CLI_INPUT);
  }
}

// ---------------------------------------------------------------------------
// collectInput
// ---------------------------------------------------------------------------

/**
 * Collect module input from stdin and/or CLI keyword arguments.
 */
export async function collectInput(
  stdinFlag?: string,
  cliKwargs: Record<string, unknown> = {},
  largeInput?: boolean,
): Promise<Record<string, unknown>> {
  // Remove null/undefined values from CLI kwargs
  const cliKwargsNonNull: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cliKwargs)) {
    if (v !== null && v !== undefined) {
      cliKwargsNonNull[k] = v;
    }
  }

  if (!stdinFlag) {
    return cliKwargsNonNull;
  }

  if (stdinFlag === "-") {
    const raw = await readStdin();
    const rawSize = Buffer.byteLength(raw, "utf-8");

    if (rawSize > 10_485_760 && !largeInput) {
      process.stderr.write(
        "Error: STDIN input exceeds 10MB limit. Use --large-input to override.\n",
      );
      process.exit(EXIT_CODES.INVALID_CLI_INPUT);
    }

    if (!raw) {
      return cliKwargsNonNull;
    }

    let stdinData: unknown;
    try {
      stdinData = JSON.parse(raw);
    } catch {
      process.stderr.write(
        "Error: STDIN does not contain valid JSON.\n",
      );
      process.exit(EXIT_CODES.INVALID_CLI_INPUT);
    }

    if (typeof stdinData !== "object" || stdinData === null || Array.isArray(stdinData)) {
      process.stderr.write(
        `Error: STDIN JSON must be an object, got ${Array.isArray(stdinData) ? "array" : typeof stdinData}.\n`,
      );
      process.exit(EXIT_CODES.INVALID_CLI_INPUT);
    }

    // CLI flags override STDIN for duplicate keys
    return { ...(stdinData as Record<string, unknown>), ...cliKwargsNonNull };
  }

  return cliKwargsNonNull;
}

/**
 * Read all data from stdin.
 */
function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    process.stdin.on("error", (err: Error) => reject(err));
    process.stdin.resume();
  });
}

// ---------------------------------------------------------------------------
// resolveFormat — re-export from output.ts
// ---------------------------------------------------------------------------

export { resolveFormat } from "./output.js";

// ---------------------------------------------------------------------------
// reconvertEnumValues
// ---------------------------------------------------------------------------

/**
 * Re-convert CLI string values back to their schema-typed equivalents
 * based on the option configs.
 */
export function reconvertEnumValues(
  kwargs: Record<string, unknown>,
  options: OptionConfig[],
): Record<string, unknown> {
  const result = { ...kwargs };
  for (const opt of options) {
    if (!opt.enumOriginalTypes) continue;
    const paramName = opt.name;
    if (!(paramName in result) || result[paramName] === null || result[paramName] === undefined) {
      continue;
    }
    const strVal = String(result[paramName]);
    const origType = opt.enumOriginalTypes[strVal];
    if (origType === "int") {
      result[paramName] = parseInt(strVal, 10);
    } else if (origType === "float") {
      result[paramName] = parseFloat(strVal);
    } else if (origType === "bool") {
      result[paramName] = strVal.toLowerCase() === "true";
    }
  }
  return result;
}
