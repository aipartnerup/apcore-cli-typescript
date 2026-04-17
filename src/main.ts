/**
 * CLI entry point — createCli / main equivalents.
 *
 * Protocol spec: CLI bootstrapping & command registration
 * Implements: F1 (dry-run), F3 (enhanced errors), F4 (trace),
 * F5 (approval handler), F6 (stream), F8 (strategy), F9 (output formats),
 * F11 (extra commands)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { Command, CommanderError, Option } from "commander";
import { EXIT_CODES, exitCodeForError } from "./errors.js";
import { resolveRefs } from "./ref-resolver.js";
import { schemaToCliOptions } from "./schema-parser.js";
import { checkApproval } from "./approval.js";
import { formatExecResult, formatPreflightResult, firstFailedExitCode, resolveFormat } from "./output.js";
import { setLogLevel } from "./logger.js";
import { registerInitCommand } from "./init-cmd.js";
import { getDisplay } from "./display-helpers.js";
import { registerConfigNamespace } from "./config.js";
import { configureManHelp } from "./shell.js";
import { registerValidateCommand } from "./discovery.js";
import { registerSystemCommands } from "./system-cmd.js";
import { registerPipelineCommand } from "./strategy.js";
import { BUILTIN_COMMANDS } from "./cli.js";
import { ExposureFilter } from "./exposure.js";
import { AuditLogger, setAuditLogger } from "./security/audit.js";
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
// Error code mapping from apcore error codes to CLI exit codes
// ---------------------------------------------------------------------------

const ERROR_CODE_MAP: Record<string, number> = {
  MODULE_NOT_FOUND: 44,
  MODULE_LOAD_ERROR: 44,
  MODULE_DISABLED: 44,
  SCHEMA_VALIDATION_ERROR: 45,
  SCHEMA_CIRCULAR_REF: 48,
  APPROVAL_DENIED: 46,
  APPROVAL_TIMEOUT: 46,
  APPROVAL_PENDING: 46,
  CONFIG_NOT_FOUND: 47,
  CONFIG_INVALID: 47,
  MODULE_EXECUTE_ERROR: 1,
  MODULE_TIMEOUT: 1,
  ACL_DENIED: 77,
  CONFIG_NAMESPACE_RESERVED: 78,
  CONFIG_NAMESPACE_DUPLICATE: 78,
  CONFIG_ENV_PREFIX_CONFLICT: 78,
  CONFIG_ENV_MAP_CONFLICT: 78,
  CONFIG_MOUNT_ERROR: 66,
  CONFIG_BIND_ERROR: 65,
  ERROR_FORMATTER_DUPLICATE: 70,
};

// ---------------------------------------------------------------------------
// Enhanced error output (F3)
// ---------------------------------------------------------------------------

/**
 * Emit structured JSON error to stderr for AI agents.
 */
export function emitErrorJson(e: unknown, exitCode: number): void {
  const err = e instanceof Error ? e : new Error(String(e));
  const errRecord = err as unknown as Record<string, unknown>;
  const code = errRecord.code ?? "UNKNOWN";
  const payload: Record<string, unknown> = {
    error: true,
    code,
    message: err.message,
    exit_code: exitCode,
  };
  for (const field of ["details", "suggestion", "ai_guidance", "retryable", "user_fixable"]) {
    const val = errRecord[field];
    if (val !== undefined && val !== null) {
      payload[field] = val;
    }
  }
  process.stderr.write(JSON.stringify(payload) + "\n");
}

/**
 * Emit human-readable error to stderr with guidance fields.
 */
export function emitErrorTty(e: unknown, exitCode: number): void {
  const err = e instanceof Error ? e : new Error(String(e));
  const errRecord = err as unknown as Record<string, unknown>;
  const code = errRecord.code;
  const header = code ? `Error [${code}]: ${err.message}` : `Error: ${err.message}`;
  process.stderr.write(header + "\n");

  const details = errRecord.details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    process.stderr.write("\n  Details:\n");
    for (const [k, v] of Object.entries(details as Record<string, unknown>)) {
      process.stderr.write(`    ${k}: ${v}\n`);
    }
  }

  const suggestion = errRecord.suggestion;
  if (suggestion) {
    process.stderr.write(`\n  Suggestion: ${suggestion}\n`);
  }

  const retryable = errRecord.retryable;
  if (retryable !== undefined && retryable !== null) {
    const label = retryable ? "Yes" : "No (same input will fail again)";
    process.stderr.write(`  Retryable: ${label}\n`);
  }

  process.stderr.write(`\n  Exit code: ${exitCode}\n`);
}

// ---------------------------------------------------------------------------
// createCli
// ---------------------------------------------------------------------------

/**
 * APCore unified client facade (apcore-js >= 0.18.0).
 * Exposes registry and executor as top-level properties.
 */
export interface APCore {
  registry: Registry;
  executor: Executor;
}

/** Options for createCli. */
export interface CreateCliOptions {
  extensionsDir?: string;
  progName?: string;
  verbose?: boolean;
  /**
   * APCore unified client instance (apcore-js >= 0.18.0).
   * Mutually exclusive with registry/executor — providing app alongside
   * either of those will throw.
   */
  app?: APCore;
  /** Pre-populated Registry instance. Skips filesystem discovery when provided. */
  registry?: Registry;
  /** Pre-built Executor instance. Used alongside registry. */
  executor?: Executor;
  /** Extra commands to register after built-in commands (FE-11 F11). */
  extraCommands?: Command[];
  /** Exposure filter config or instance (FE-12). */
  expose?: Record<string, unknown> | import("./exposure.js").ExposureFilter;
  /** Path to convention-based commands directory (apcore-toolkit ConventionScanner). */
  commandsDir?: string;
  /** Path to binding.yaml for display overlay (apcore-toolkit DisplayResolver). */
  bindingPath?: string;
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
  let extraCommands: Command[] | undefined;
  let app: APCore | undefined;
  let expose: Record<string, unknown> | import("./exposure.js").ExposureFilter | undefined;
  if (typeof extensionsDirOrOpts === "object" && extensionsDirOrOpts !== null) {
    extensionsDir = extensionsDirOrOpts.extensionsDir;
    progName = extensionsDirOrOpts.progName ?? progName;
    verbose = extensionsDirOrOpts.verbose ?? verbose;
    app = extensionsDirOrOpts.app;
    registry = extensionsDirOrOpts.registry;
    executor = extensionsDirOrOpts.executor;
    extraCommands = extensionsDirOrOpts.extraCommands;
    expose = extensionsDirOrOpts.expose;
  } else {
    extensionsDir = extensionsDirOrOpts;
  }

  verboseHelp = verbose;
  // Register Config Bus namespace (apcore >= 0.15.0)
  registerConfigNamespace();

  // Initialize audit logger (parity with apcore-cli-python __main__.py).
  // Silently disabled if initialization fails (e.g., unwritable audit path).
  try {
    const auditLogger = new AuditLogger();
    setAuditLogger(auditLogger);
  } catch {
    // audit logging unavailable — non-fatal
  }

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

  // Validate parameter combination: app is mutually exclusive with registry/executor.
  if (app && (registry || executor)) {
    throw new Error("app is mutually exclusive with registry/executor");
  }

  // Extract registry/executor from APCore unified client when provided.
  if (app) {
    registry = app.registry;
    executor = app.executor;
  }

  // Validate parameter combination: executor without registry is invalid.
  if (executor && !registry) {
    throw new Error("executor requires registry — pass both or neither");
  }

  // Registry/executor wiring: use pre-populated instances if provided,
  // otherwise fall back to extensions-dir discovery (requires apcore-js).
  if (registry) {
    // Pre-populated registry provided — skip filesystem discovery.
    (program as unknown as Record<string, unknown>)._registry = registry;
    if (executor) {
      (program as unknown as Record<string, unknown>)._executor = executor;

      // Register validate command (F1)
      registerValidateCommand(program, registry, executor);

      // Register system commands (F2) — async but fire-and-forget during setup
      void registerSystemCommands(program, executor);

      // Register describe-pipeline command (F8)
      registerPipelineCommand(program, executor);
    }
  } else {
    const resolvedExtDir = extensionsDir
      ?? process.env.APCORE_EXTENSIONS_ROOT
      ?? "./extensions";
    void resolvedExtDir; // Will be used when apcore-js registry is wired
  }

  // Build exposure filter (FE-12)
  let exposureFilter: ExposureFilter;
  if (expose instanceof ExposureFilter) {
    exposureFilter = expose;
  } else if (typeof expose === "object" && expose !== null) {
    exposureFilter = ExposureFilter.fromConfig({ expose });
  } else {
    exposureFilter = new ExposureFilter();
  }
  (program as unknown as Record<string, unknown>)._exposureFilter = exposureFilter;

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

  // Register extra commands (F11) — validate no name collisions with builtins
  if (extraCommands && extraCommands.length > 0) {
    const existingNames = new Set([
      ...BUILTIN_COMMANDS,
      ...program.commands.map((c) => c.name()),
    ]);
    for (const cmd of extraCommands) {
      const cmdName = cmd.name();
      if (existingNames.has(cmdName)) {
        process.stderr.write(
          `Warning: Extra command '${cmdName}' collides with a built-in command and will be skipped.\n`,
        );
        continue;
      }
      program.addCommand(cmd);
      existingNames.add(cmdName);
    }
  }

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
 *
 * Includes all 11 FE-11 options: --dry-run, --trace, --stream, --strategy,
 * --approval-timeout, --approval-token, --fields, and enhanced --format choices.
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
  const formatOpt = new Option("--format <format>", "Output format: json, table, csv, yaml, jsonl.")
    .choices(["json", "table", "csv", "yaml", "jsonl"]);
  const fieldsOpt = new Option("--fields <fields>", "Comma-separated dot-paths to select from the result (e.g., 'status,data.count').");
  // --sandbox is always hidden (not yet implemented)
  const sandboxOpt = new Option("--sandbox", "Run module in an isolated subprocess with restricted filesystem and env access").default(false).hideHelp();
  // F1: --dry-run
  const dryRunOpt = new Option("--dry-run", "Run preflight checks without executing the module. Shows validation results.").default(false);
  // F4: --trace
  const traceOpt = new Option("--trace", "Show execution pipeline trace with per-step timing after the result.").default(false);
  // F6: --stream
  const streamOpt = new Option("--stream", "Stream module output as JSONL (one JSON object per line, flushed immediately).").default(false);
  // F8: --strategy
  const strategyOpt = new Option("--strategy <name>", "Execution pipeline strategy: standard (default), internal, testing, performance.")
    .choices(["standard", "internal", "testing", "performance", "minimal"]);
  // F5: --approval-timeout, --approval-token
  const approvalTimeoutOpt = new Option("--approval-timeout <seconds>", "Override approval prompt timeout in seconds (default: 60).").argParser(parseInt);
  const approvalTokenOpt = new Option("--approval-token <token>", "Resume a pending approval with the given token (for async approval flows).");

  if (!verbose) {
    inputOpt.hideHelp();
    yesOpt.hideHelp();
    largeInputOpt.hideHelp();
    formatOpt.hideHelp();
    fieldsOpt.hideHelp();
    dryRunOpt.hideHelp();
    traceOpt.hideHelp();
    streamOpt.hideHelp();
    strategyOpt.hideHelp();
    approvalTimeoutOpt.hideHelp();
    approvalTokenOpt.hideHelp();
  }

  cmd.addOption(inputOpt);
  cmd.addOption(yesOpt);
  cmd.addOption(largeInputOpt);
  cmd.addOption(formatOpt);
  cmd.addOption(fieldsOpt);
  cmd.addOption(sandboxOpt);
  cmd.addOption(dryRunOpt);
  cmd.addOption(traceOpt);
  cmd.addOption(streamOpt);
  cmd.addOption(strategyOpt);
  cmd.addOption(approvalTimeoutOpt);
  cmd.addOption(approvalTokenOpt);

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

  // Guard: schema property names must not collide with built-in option names.
  const reservedNames = new Set([
    "input", "yes", "largeInput", "format", "fields", "sandbox", "verbose",
    "dryRun", "trace", "stream", "strategy", "approvalTimeout", "approvalToken",
  ]);
  for (const opt of schemaOptions) {
    if (reservedNames.has(opt.name)) {
      process.stderr.write(
        `Error: Module '${moduleId}' schema property '${opt.name}' conflicts ` +
        `with a reserved CLI option name. Rename the property.\n`,
      );
      process.exit(EXIT_CODES.INVALID_CLI_INPUT);
    }
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
    const outputFields = options.fields as string | undefined;
    const sandboxEnabled = options.sandbox as boolean;
    const dryRun = options.dryRun as boolean;
    const traceFlag = options.trace as boolean;
    const streamFlag = options.stream as boolean;
    const strategyName = options.strategy as string | undefined;
    const approvalTimeout = (options.approvalTimeout as number | undefined) ?? 60;
    const approvalToken = options.approvalToken as string | undefined;

    // Remove built-in keys from options to get schema kwargs
    const schemaKwargs: Record<string, unknown> = {};
    const builtinKeys = new Set([
      "input", "yes", "largeInput", "format", "fields", "sandbox", "verbose",
      "dryRun", "trace", "stream", "strategy", "approvalTimeout", "approvalToken",
    ]);
    for (const [k, v] of Object.entries(options)) {
      if (!builtinKeys.has(k)) {
        schemaKwargs[k] = v;
      }
    }

    let merged: Record<string, unknown> = {};

    try {
      // 1. Collect and merge input
      merged = await collectInput(stdinFlag, schemaKwargs, largeInput);

      // 2. Reconvert enum values
      const reconverted = reconvertEnumValues(merged, schemaOptions);
      merged = reconverted;

      // -- Dry-run: preflight validation only, no execution (F1) --
      if (dryRun) {
        if (!executor.validate) {
          process.stderr.write("Error: Executor does not support validate.\n");
          process.exit(1);
        }
        const preflight = await executor.validate(moduleId, merged);
        formatPreflightResult(preflight, outputFormat);
        // --trace --dry-run: show pipeline preview
        if (traceFlag) {
          const pureSteps = new Set([
            "context_creation", "call_chain_guard", "module_lookup", "acl_check", "input_validation",
          ]);
          const allSteps = [
            "context_creation", "call_chain_guard", "module_lookup", "acl_check",
            "approval_gate", "middleware_before", "input_validation", "execute",
            "output_validation", "middleware_after", "return_result",
          ];
          process.stderr.write("\nPipeline preview (dry-run):\n");
          for (const s of allSteps) {
            if (pureSteps.has(s)) {
              process.stderr.write(`  \u2713 ${s.padEnd(24)} (pure \u2014 would execute)\n`);
            } else {
              process.stderr.write(`  \u25cb ${s.padEnd(24)} (impure \u2014 skipped in dry-run)\n`);
            }
          }
        }
        process.exit(preflight.valid ? 0 : firstFailedExitCode(preflight));
      }

      // -- Inject approval token if provided (F5) --
      if (approvalToken) {
        merged._approval_token = approvalToken;
      }

      // 3. Check approval
      await checkApproval(moduleDef, autoApprove, approvalTimeout);

      // 4. Execute with timing
      const startTime = performance.now();

      // -- Streaming execution (F6) --
      if (streamFlag) {
        // Streaming always outputs JSONL; --format table is ignored (spec §3.6.2)
        if (resolveFormat(outputFormat) === "table") {
          process.stderr.write("Warning: Streaming mode always outputs JSONL; --format table is ignored.\n");
        }
        const annotations = moduleDef.annotations as Record<string, unknown> | undefined;
        const isStreaming = annotations?.streaming === true;
        if (!isStreaming) {
          process.stderr.write(
            `Warning: Module '${moduleId}' does not declare streaming support. Falling back to standard execution.\n`,
          );
        }

        if (isStreaming && executor.stream) {
          let chunks = 0;
          for await (const chunk of executor.stream(moduleId, merged)) {
            chunks++;
            process.stdout.write(JSON.stringify(chunk) + "\n");
            if (process.stderr.isTTY) {
              process.stderr.write(`\rStreaming ${moduleId}... (${chunks} chunks)`);
            }
          }
          if (process.stderr.isTTY) {
            process.stderr.write("\n");
          }
          const durationMs = Math.round(performance.now() - startTime);

          // Audit log (success)
          const { getAuditLogger } = await import("./security/audit.js");
          const auditLogger = getAuditLogger();
          if (auditLogger) {
            auditLogger.logExecution(moduleId, merged, "success", 0, durationMs);
          }
          return;
        }
        // else: fall through to normal execution
      }

      // -- Traced execution (F4) --
      if (traceFlag && executor.callWithTrace) {
        const [result, trace] = await executor.callWithTrace(
          moduleId,
          merged,
          strategyName ? { strategy: strategyName } : undefined,
        );
        const durationMs = Math.round(performance.now() - startTime);

        // Audit log (success)
        const { getAuditLogger } = await import("./security/audit.js");
        const auditLogger = getAuditLogger();
        if (auditLogger) {
          auditLogger.logExecution(moduleId, merged, "success", 0, durationMs);
        }

        // Print result
        const resolved = resolveFormat(outputFormat);
        if (resolved === "json" || !process.stdout.isTTY) {
          // Merge _trace into JSON output
          const traceData = {
            strategy: trace.strategy_name,
            total_duration_ms: trace.total_duration_ms,
            success: trace.success,
            steps: trace.steps.map((s) => ({
              name: s.name,
              duration_ms: s.duration_ms,
              skipped: s.skipped,
              ...(s.skipped ? { skip_reason: s.skip_reason } : {}),
            })),
          };
          let output: Record<string, unknown>;
          if (typeof result === "object" && result !== null && !Array.isArray(result)) {
            output = { ...(result as Record<string, unknown>), _trace: traceData };
          } else {
            output = { result, _trace: traceData };
          }
          process.stdout.write(JSON.stringify(output, null, 2) + "\n");
        } else {
          formatExecResult(result, outputFormat, outputFields);
          // Print trace to stderr
          const stepCount = trace.steps.length;
          process.stderr.write(
            `\nPipeline Trace (strategy: ${trace.strategy_name}, ` +
            `${stepCount} steps, ${trace.total_duration_ms.toFixed(1)}ms)\n`,
          );
          for (const s of trace.steps) {
            if (s.skipped) {
              const reason = s.skip_reason ?? "n/a";
              process.stderr.write(`  \u25cb ${s.name.padEnd(24)} ${"\u2014".padStart(8)}  skipped (${reason})\n`);
            } else {
              process.stderr.write(`  \u2713 ${s.name.padEnd(24)} ${(s.duration_ms.toFixed(1) + "ms").padStart(8)}\n`);
            }
          }
        }
        return;
      }

      // -- Standard execution (with optional strategy F8) --
      let result: unknown;
      if (strategyName && executor.callWithTrace) {
        // Strategy requires callWithTrace to pass strategy param
        const [res] = await executor.callWithTrace(
          moduleId,
          merged,
          { strategy: strategyName },
        );
        result = res;
        if (strategyName !== "standard" && process.stderr.isTTY) {
          process.stderr.write(`Warning: Using '${strategyName}' strategy.\n`);
        }
      } else {
        const { Sandbox } = await import("./security/index.js");
        const sandbox = new Sandbox(sandboxEnabled);
        result = await sandbox.execute(moduleId, merged, executor);
      }
      const durationMs = Math.round(performance.now() - startTime);

      // 5. Audit log (success)
      const { getAuditLogger } = await import("./security/audit.js");
      const auditLogger = getAuditLogger();
      if (auditLogger) {
        auditLogger.logExecution(moduleId, merged, "success", 0, durationMs);
      }

      // 6. Format and print result
      formatExecResult(result, outputFormat, outputFields);
    } catch (err: unknown) {
      // Enhanced error output (F3)
      const errRecord = err as Record<string, unknown>;
      const errorCode = typeof errRecord?.code === "string" ? errRecord.code as string : undefined;
      const exitCode = errorCode && errorCode in ERROR_CODE_MAP
        ? ERROR_CODE_MAP[errorCode]
        : exitCodeForError(err);

      // Audit log (error)
      try {
        const { getAuditLogger } = await import("./security/audit.js");
        const auditLogger = getAuditLogger();
        if (auditLogger) {
          auditLogger.logExecution(moduleId, merged, "error", exitCode, 0);
        }
      } catch {
        // Ignore audit failures during error handling
      }

      if (outputFormat === "json" || !process.stderr.isTTY) {
        emitErrorJson(err, exitCode);
      } else {
        emitErrorTty(err, exitCode);
      }
      process.exit(exitCode);
    }
  });

  return cmd;
}

// ---------------------------------------------------------------------------
// validateModuleId
// ---------------------------------------------------------------------------

/**
 * Validate that a module ID conforms to the expected format.
 * Pattern: [a-z][a-z0-9_]*(.[a-z][a-z0-9_])* — max 192 chars.
 *
 * Length limit tracks PROTOCOL_SPEC §2.7 EBNF constraint #1 — bumped from
 * 128 to 192 in spec 1.6.0-draft to accommodate Java/.NET deep-namespace
 * FQN-derived IDs. Filesystem-safe (192 + ".binding.yaml".length = 205 < 255).
 */
export function validateModuleId(moduleId: string): void {
  if (moduleId.length > 192) {
    process.stderr.write(
      `Error: Invalid module ID format: '${moduleId}'. Maximum length is 192 characters.\n`,
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
