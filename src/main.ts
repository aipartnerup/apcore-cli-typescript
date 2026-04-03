/**
 * CLI entry point — createCli / main equivalents.
 *
 * Protocol spec: CLI bootstrapping & command registration
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { Command, CommanderError, Option } from "commander";
import { EXIT_CODES, exitCodeForError } from "./errors.js";
import { resolveRefs } from "./ref-resolver.js";
import { schemaToCliOptions } from "./schema-parser.js";
import { checkApproval } from "./approval.js";
import { formatExecResult } from "./output.js";
import { setLogLevel } from "./logger.js";
import { registerInitCommand } from "./init-cmd.js";
import { getDisplay } from "./display-helpers.js";
import { registerConfigNamespace } from "./config.js";
import { configureManHelp } from "./shell.js";
import type { Executor, ModuleDescriptor, Registry } from "./cli.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Whether --verbose was passed (controls help detail level). */
export let verboseHelp = false;

/** Set the verbose help flag. When false, built-in options are hidden from help. */
export function setVerboseHelp(verbose: boolean): void {
  verboseHelp = verbose;
}

/** Base URL for online documentation. Null means no docs link shown. */
export let docsUrl: string | null = null;

/**
 * Set the base URL for online documentation links shown in help and man pages.
 * Pass null to disable. Command-level help appends `/commands/{name}` automatically.
 *
 * @example setDocsUrl("https://docs.apcore.dev/cli");
 */
export function setDocsUrl(url: string | null): void {
  docsUrl = url;
}

/** Check if --verbose is present in process.argv (pre-parse, before Commander). */
function hasVerboseFlag(): boolean {
  return process.argv.includes("--verbose");
}

let VERSION = "0.0.0";
try {
  const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "../package.json"), "utf-8"));
  VERSION = pkg.version;
} catch {
  // Bundled environments (e.g., Bun compile) may not have package.json accessible
}

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

/** Options for createCli. */
export interface CreateCliOptions {
  extensionsDir?: string;
  progName?: string;
  verbose?: boolean;
  /** Pre-populated Registry instance. Skips filesystem discovery when provided. */
  registry?: Registry;
  /** Pre-built Executor instance. Used alongside registry. */
  executor?: Executor;
}

/**
 * Build and return the top-level Commander program.
 *
 * @param extensionsDirOrOpts  Path to extensions directory, or a CreateCliOptions object.
 * @param progName       Program name shown in help (default: apcore-cli)
 * @param verbose        Show verbose help output
 */
export function createCli(
  extensionsDirOrOpts?: string | CreateCliOptions,
  progName?: string,
  verbose = false,
): Command {
  // Normalise overloaded first argument.
  let extensionsDir: string | undefined;
  let registry: Registry | undefined;
  let executor: Executor | undefined;
  if (typeof extensionsDirOrOpts === "object" && extensionsDirOrOpts !== null) {
    extensionsDir = extensionsDirOrOpts.extensionsDir;
    progName = extensionsDirOrOpts.progName ?? progName;
    verbose = extensionsDirOrOpts.verbose ?? verbose;
    registry = extensionsDirOrOpts.registry;
    executor = extensionsDirOrOpts.executor;
  } else {
    extensionsDir = extensionsDirOrOpts;
  }

  verboseHelp = verbose;
  // Register Config Bus namespace (apcore >= 0.15.0)
  registerConfigNamespace();
  // Resolve program name
  const resolvedProgName = progName ?? path.basename(process.argv[1] ?? "apcore-cli") ?? "apcore-cli";

  // Resolve log level
  const cliLogLevel = process.env.APCORE_CLI_LOGGING_LEVEL ?? process.env.APCORE_LOGGING_LEVEL ?? "WARNING";
  setLogLevel(cliLogLevel);

  const program = new Command(resolvedProgName)
    .exitOverride()
    .version(VERSION, "--version", `Show ${resolvedProgName} version`)
    .description("apcore CLI — execute apcore modules from the command line")
    .option("--extensions-dir <path>", "Path to extensions directory")
    .option("--commands-dir <path>", "Path to convention-based commands directory")
    .option("--binding <path>", "Path to binding.yaml for display overlay")
    .option("--log-level <level>", "Logging level (DEBUG|INFO|WARNING|ERROR)", "WARNING")
    .option("--verbose", "Show all options in help output (including built-in apcore options)");

  // Validate parameter combination: executor without registry is invalid.
  if (executor && !registry) {
    throw new Error("executor requires registry — pass both or neither");
  }

  // Registry/executor wiring: use pre-populated instances if provided,
  // otherwise fall back to extensions-dir discovery (requires apcore-js).
  if (registry) {
    // Pre-populated registry provided — skip filesystem discovery.
    // TODO: Wire LazyModuleGroup/GroupedModuleGroup with provided registry+executor
    // once apcore-js is available and Executor can be auto-built from registry.
    (program as unknown as Record<string, unknown>)._registry = registry;
    if (executor) {
      (program as unknown as Record<string, unknown>)._executor = executor;
    }
  } else {
    const resolvedExtDir = extensionsDir
      ?? process.env.APCORE_EXTENSIONS_ROOT
      ?? "./extensions";
    void resolvedExtDir; // Will be used when apcore-js registry is wired
  }

  // Footer hints for discoverability
  program.addHelpText("after", [
    "",
    "Use --help --verbose to show all options (including built-in apcore options).",
    "Use --help --man to display a formatted man page.",
  ].join("\n"));

  // Register init command for scaffolding
  registerInitCommand(program);

  // Register --help --man support
  configureManHelp(program, resolvedProgName, VERSION);

  // Hook to apply optional toolkit integration before command execution.
  // Commander actions are async, so we can set up toolkit state lazily.
  program.hook("preAction", async (thisCommand) => {
    const opts = thisCommand.opts();
    const commandsDir = opts.commandsDir as string | undefined;
    const bindingPath = opts.binding as string | undefined;
    await applyToolkitIntegration(commandsDir, bindingPath);
  });

  return program;
}

// ---------------------------------------------------------------------------
// applyToolkitIntegration
// ---------------------------------------------------------------------------

/**
 * Optionally apply apcore-toolkit features (DisplayResolver, RegistryWriter).
 *
 * Uses dynamic import so the dependency remains optional — if apcore-toolkit
 * is not installed, a warning is printed and the CLI continues without it.
 */
export async function applyToolkitIntegration(
  commandsDir?: string,
  bindingPath?: string,
): Promise<void> {
  if (!commandsDir && !bindingPath) {
    return;
  }

  try {
    // Use a variable to prevent TypeScript from resolving the module at build time
    const toolkitModule = "apcore-toolkit";
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const toolkit = await import(/* @vite-ignore */ toolkitModule);

    // ConventionScanner is not yet available in the TypeScript toolkit
    if (commandsDir) {
      console.warn("Convention scanning not yet available in TypeScript toolkit");
    }

    // DisplayResolver for binding overlay
    if (bindingPath) {
      const resolver = new toolkit.DisplayResolver();
      // NOTE: Full integration requires registered modules from apcore-js.
      // For now, the resolver is instantiated and ready for when modules
      // are available through the registry.
      void resolver;
    }
  } catch {
    // apcore-toolkit not installed — graceful fallback
    console.warn("apcore-toolkit not installed — toolkit features unavailable");
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

/**
 * Parse argv and run the CLI. Handles top-level error catching and exit codes.
 */
export function main(progName?: string): void {
  verboseHelp = hasVerboseFlag();
  const program = createCli(undefined, progName, verboseHelp);

  try {
    program.parse(process.argv);
  } catch (error: unknown) {
    if (error instanceof CommanderError) {
      // Commander already printed the error message
      process.exit(error.exitCode);
    }
    const code = exitCodeForError(error);
    if (error instanceof Error) {
      process.stderr.write(`Error: ${error.message}\n`);
    }
    process.exit(code);
  }
}

// ---------------------------------------------------------------------------
// buildModuleCommand
// ---------------------------------------------------------------------------

/**
 * Build a Commander Command for a single apcore module.
 */
export function buildModuleCommand(
  moduleDef: ModuleDescriptor,
  executor: Executor,
  helpTextMaxLength = 1000,
  cmdName?: string,
  verbose = verboseHelp,
): Command {
  const moduleId = moduleDef.id;
  let resolvedSchema: Record<string, unknown> = {};
  let schemaOptions: OptionConfig[] = [];

  // Resolve display overlay fields
  const display = getDisplay(moduleDef);
  const cliDisplay = (display.cli && typeof display.cli === "object" && !Array.isArray(display.cli))
    ? (display.cli as Record<string, unknown>)
    : {};
  const effectiveCmdName: string = cmdName ?? (cliDisplay.alias as string | undefined) ?? moduleId;
  const cmdHelp: string = (cliDisplay.description as string | undefined) ?? moduleDef.description;

  // Resolve schema
  const inputSchema = moduleDef.inputSchema;
  if (inputSchema && typeof inputSchema === "object" && inputSchema.properties) {
    try {
      resolvedSchema = resolveRefs(inputSchema, 32, moduleId);
    } catch {
      resolvedSchema = inputSchema;
    }
    schemaOptions = schemaToCliOptions(resolvedSchema, helpTextMaxLength);
  }

  const cmd = new Command(effectiveCmdName).description(cmdHelp);

  // Built-in options (hidden unless --verbose)
  const inputOpt = new Option("--input <source>", "Read JSON input from a file path, or use '-' to read from stdin pipe");
  const yesOpt = new Option("-y, --yes", "Skip interactive approval prompts (for scripts and CI)").default(false);
  const largeInputOpt = new Option("--large-input", "Allow stdin input larger than 10MB (default limit protects against accidental pipes)").default(false);
  const formatOpt = new Option("--format <format>", "Set output format: 'json' for machine-readable, 'table' for human-readable");
  // --sandbox is always hidden (not yet implemented)
  const sandboxOpt = new Option("--sandbox", "Run module in an isolated subprocess with restricted filesystem and env access").default(false).hideHelp();

  if (!verbose) {
    inputOpt.hideHelp();
    yesOpt.hideHelp();
    largeInputOpt.hideHelp();
    formatOpt.hideHelp();
  }

  cmd.addOption(inputOpt);
  cmd.addOption(yesOpt);
  cmd.addOption(largeInputOpt);
  cmd.addOption(formatOpt);
  cmd.addOption(sandboxOpt);

  // Help footer: verbose hint + optional docs link
  const footerParts: string[] = [];
  if (!verbose) {
    footerParts.push("Use --verbose to show all options (including built-in apcore options).");
  }
  if (docsUrl) {
    footerParts.push(`Docs: ${docsUrl}/commands/${effectiveCmdName}`);
  }
  if (footerParts.length > 0) {
    cmd.addHelpText("after", "\n" + footerParts.join("\n") + "\n");
  }

  // Schema-generated options
  for (const opt of schemaOptions) {
    if (opt.parseArg) {
      cmd.option(opt.flags, opt.description, opt.parseArg, opt.defaultValue);
    } else {
      cmd.option(opt.flags, opt.description, opt.defaultValue as string | boolean | undefined);
    }
  }

  // Action callback
  cmd.action(async (options: Record<string, unknown>) => {
    // Pop built-in options
    const stdinFlag = options.input as string | undefined;
    const autoApprove = options.yes as boolean;
    const largeInput = options.largeInput as boolean;
    const outputFormat = options.format as string | undefined;
    const sandboxEnabled = options.sandbox as boolean;

    // Remove built-in keys from options to get schema kwargs
    const schemaKwargs: Record<string, unknown> = {};
    const builtinKeys = new Set(["input", "yes", "largeInput", "format", "sandbox", "verbose"]);
    for (const [k, v] of Object.entries(options)) {
      if (!builtinKeys.has(k)) {
        schemaKwargs[k] = v;
      }
    }

    try {
      // Collect and merge input
      const merged = await collectInput(stdinFlag, schemaKwargs, largeInput);

      // Reconvert enum values
      const reconverted = reconvertEnumValues(merged, schemaOptions);

      // Check approval
      await checkApproval(moduleDef, autoApprove);

      // Execute with timing
      const { Sandbox } = await import("./security/index.js");
      const sandbox = new Sandbox(sandboxEnabled);
      const startTime = performance.now();
      const result = await sandbox.execute(moduleId, reconverted, executor);
      const durationMs = Math.round(performance.now() - startTime);

      // Audit log (success)
      const { getAuditLogger } = await import("./security/audit.js");
      const auditLogger = getAuditLogger();
      if (auditLogger) {
        auditLogger.logExecution(moduleId, reconverted, "success", 0, durationMs);
      }

      // Format output
      formatExecResult(result, outputFormat);
    } catch (err: unknown) {
      // Audit log (error)
      const { getAuditLogger } = await import("./security/audit.js");
      const auditLogger = getAuditLogger();
      const code = exitCodeForError(err);
      if (auditLogger) {
        auditLogger.logExecution(moduleId, {}, "error", code, 0);
      }

      if (err instanceof Error) {
        process.stderr.write(`Error: ${err.message}\n`);
      }
      process.exit(code);
    }
  });

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
 * Read all data from stdin with proper cleanup.
 */
function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const onData = (chunk: Buffer) => chunks.push(chunk);
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks).toString("utf-8"));
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("end", onEnd);
      process.stdin.removeListener("error", onError);
    };
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.on("error", onError);
    process.stdin.resume();
  });
}

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
