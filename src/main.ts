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
import { EXIT_CODES, exitCodeForError, MaxDepthExceededError, CircularRefError, UnresolvableRefError } from "./errors.js";
import { resolveRefs } from "./ref-resolver.js";
import { schemaToCliOptions } from "./schema-parser.js";
import { checkApproval } from "./approval.js";
import { formatExecResult, formatPreflightResult, firstFailedExitCode, resolveFormat } from "./output.js";
import { setLogLevel, warn as logWarn } from "./logger.js";
import { registerInitCommand } from "./init-cmd.js";
import { getDisplay } from "./display-helpers.js";
import { ConfigResolver, registerConfigNamespace } from "./config.js";
import { CliApprovalHandler } from "./approval.js";
import { configureManHelp, registerCompletionCommand } from "./shell.js";
import {
  registerDescribeCommand,
  registerExecCommand,
  registerListCommand,
  registerValidateCommand,
} from "./discovery.js";
import {
  registerConfigCommand,
  registerDisableCommand,
  registerEnableCommand,
  registerHealthCommand,
  registerReloadCommand,
  registerUsageCommand,
} from "./system-cmd.js";
import { registerPipelineCommand } from "./strategy.js";
import { ApcliGroup, setReservedGroupNames } from "./builtin-group.js";
import type { ApcliConfig } from "./builtin-group.js";
import { ExposureFilter } from "./exposure.js";
import { AuditLogger, setAuditLogger } from "./security/audit.js";
import type { Executor, ModuleDescriptor, Registry } from "./cli.js";
import { canonicalFormatHelp } from "./canonical-help.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Whether --all-options was passed (controls help detail level).
 *
 * Module-private mutable flag. The setter `setVerboseHelp` is the sanctioned
 * public API; raw `let`-binding access from outside this module is an audit
 * violation (D9-W1) and unstable across bundlers.
 */
let verboseHelp = false;

/** Set the all-options help flag. When false, built-in options are hidden from help. */
export function setAllOptionsHelp(allOptions: boolean): void {
  verboseHelp = allOptions;
}

/** @deprecated Use {@link setAllOptionsHelp} instead. Kept for backward compatibility. */
export function setVerboseHelp(verbose: boolean): void {
  setAllOptionsHelp(verbose);
}

/**
 * Base URL for online documentation. Null means no docs link shown.
 *
 * Module-private. Use the setter `setDocsUrl` from outside this module.
 */
let docsUrl: string | null = null;

/**
 * Set the base URL for online documentation links shown in help and man pages.
 * Pass null to disable. Command-level help appends `/commands/{name}` automatically.
 *
 * @example setDocsUrl("https://docs.apcore.dev/cli");
 */
export function setDocsUrl(url: string | null): void {
  docsUrl = url;
}

/** Check if --all-options is present in process.argv (pre-parse, before Commander). */
function hasVerboseFlag(): boolean {
  return process.argv.includes("--all-options");
}

/**
 * Resolve a positive-integer option: CLI flag > env var > default.
 * Invalid env values (non-integer, zero, negative) are ignored with a warning
 * so users aren't silently downgraded to the default.
 */
export function resolveIntOption(
  cliValue: number | undefined,
  envValue: string | undefined,
  defaultValue: number,
): number {
  if (cliValue !== undefined && Number.isFinite(cliValue) && cliValue > 0) {
    return cliValue;
  }
  if (envValue !== undefined && envValue !== "") {
    const parsed = parseInt(envValue, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
    process.stderr.write(
      `Warning: invalid integer env value '${envValue}'; using default ${defaultValue}.\n`,
    );
  }
  return defaultValue;
}

/**
 * Resolve a string option: CLI flag > env var > undefined.
 * Empty strings are treated as absent.
 */
export function resolveStringOption(
  cliValue: unknown,
  envValue: string | undefined,
): string | undefined {
  if (typeof cliValue === "string" && cliValue !== "") {
    return cliValue;
  }
  if (envValue !== undefined && envValue !== "") {
    return envValue;
  }
  return undefined;
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
// Enhanced error output (F3)
// ---------------------------------------------------------------------------

/**
 * Emit structured JSON error to stderr for AI agents.
 *
 * Module-private. The only consumer is buildModuleCommand's action handler
 * within this same file (audit D9-W2).
 */
function emitErrorJson(e: unknown, exitCode: number): void {
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
 *
 * Module-private. The only consumer is buildModuleCommand's action handler
 * within this same file (audit D9-W2).
 */
function emitErrorTty(e: unknown, exitCode: number): void {
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
  /**
   * Optional allowlist of module-path prefixes forwarded to
   * apcore-toolkit's `RegistryWriter.write` when registering convention-scanned
   * or binding-loaded modules. When set, the writer rejects any `target:`
   * path outside the listed prefixes — mitigates arbitrary-code-execution via
   * forged binding YAML (e.g. `target: "os:system"`).
   *
   * Mirrors the Python SDK's `allowed_prefixes` kwarg
   * (apcore-cli-python/src/apcore_cli/factory.py).
   */
  allowedPrefixes?: string[];
  /**
   * Built-in apcli group configuration (FE-13).
   *
   * Accepts:
   *  - `true` / `false` (shorthand for `{mode: "all"}` / `{mode: "none"}`)
   *  - A config object (see {@link ApcliConfig})
   *  - A pre-built {@link ApcliGroup} instance (Tier 1 override)
   *
   * When absent, Tier 3 (apcore.yaml `apcli:` block) is consulted, falling
   * back to auto-detect: standalone → visible, embedded → hidden.
   */
  apcli?: ApcliConfig | ApcliGroup;
  /**
   * Override the name of the built-in command group (default `"apcli"`).
   * Downstream branded CLIs that want their built-ins under a custom
   * namespace (e.g. `mycorp-cli admin health`) pass a different value
   * here. Must match `/^[a-z][a-z0-9_-]*$/` — non-empty, lowercase,
   * alphanumeric + `_` / `-`. Invalid values cause exit code 2.
   *
   * Note: env var `APCORE_CLI_APCLI` and config keys `apcli.*` remain
   * stable regardless of this rename — they are apcore-cli-internal
   * toggles, not user-facing. Mirrors Python
   * `create_cli(builtin_group_name=)`. Cross-SDK parity: 2026-05-08.
   */
  builtinGroupName?: string;
  /**
   * Host application version printed by `-V, --version`.
   *
   * When omitted, the `--version` flag is NOT registered — embedded CLIs
   * that do not opt in will not surface the SDK's own version. The
   * standalone `apcore-cli` binary entry point passes its package version
   * explicitly (see `main()`).
   */
  version?: string;
  /**
   * Top-level CLI description shown at the head of `--help`. Defaults to
   * `${progName} CLI` when omitted, so embedded CLIs do not leak the
   * "apcore" framework name into their own help output.
   */
  description?: string;
}

/**
 * Build and return the top-level Commander program.
 *
 * @param extensionsDirOrOpts  Path to extensions directory, or a CreateCliOptions object.
 * @param progName       Program name shown in help (default: apcore-cli)
 * @param allOptions     Show all options in help output (controls `--all-options` behaviour;
 *                       parameter was named `verbose` prior to v0.9.0)
 */
export function createCli(
  extensionsDirOrOpts?: string | CreateCliOptions,
  progName?: string,
  allOptions = false,
): Command {
  // Normalise overloaded first argument.
  let extensionsDir: string | undefined;
  let registry: Registry | undefined;
  let executor: Executor | undefined;
  let extraCommands: Command[] | undefined;
  let app: APCore | undefined;
  let expose: Record<string, unknown> | import("./exposure.js").ExposureFilter | undefined;
  let apcliOption: ApcliConfig | ApcliGroup | undefined;
  let appVersion: string | undefined;
  let appDescription: string | undefined;
  let allowedPrefixes: string[] | undefined;
  let builtinGroupName: string | undefined;
  if (typeof extensionsDirOrOpts === "object" && extensionsDirOrOpts !== null) {
    extensionsDir = extensionsDirOrOpts.extensionsDir;
    progName = extensionsDirOrOpts.progName ?? progName;
    allOptions = extensionsDirOrOpts.verbose ?? allOptions;
    app = extensionsDirOrOpts.app;
    registry = extensionsDirOrOpts.registry;
    executor = extensionsDirOrOpts.executor;
    extraCommands = extensionsDirOrOpts.extraCommands;
    expose = extensionsDirOrOpts.expose;
    apcliOption = extensionsDirOrOpts.apcli;
    appVersion = extensionsDirOrOpts.version;
    appDescription = extensionsDirOrOpts.description;
    builtinGroupName = extensionsDirOrOpts.builtinGroupName;
    allowedPrefixes = extensionsDirOrOpts.allowedPrefixes;
  } else {
    extensionsDir = extensionsDirOrOpts;
  }

  verboseHelp = allOptions;
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

  // Validate parameter combination: app is mutually exclusive with registry/executor.
  if (app && (registry || executor)) {
    process.stderr.write("Error: app is mutually exclusive with registry/executor\n");
    process.exit(EXIT_CODES.INVALID_CLI_INPUT);
  }

  // Extract registry/executor from APCore unified client when provided.
  if (app) {
    registry = app.registry;
    executor = app.executor;
  }

  // Validate parameter combination: executor without registry is invalid.
  if (executor && !registry) {
    process.stderr.write("Error: executor requires registry — pass both or neither\n");
    process.exit(EXIT_CODES.INVALID_CLI_INPUT);
  }

  // Wire CliApprovalHandler to the executor (FE-11 §3.5) so module calls that
  // set `requires_approval: true` route through the interactive CLI prompt
  // (or auto-approve when APCORE_CLI_AUTO_APPROVE=1). Parity with
  // ../apcore-cli-python/src/apcore_cli/factory.py:315-327 — previously the
  // TypeScript CliApprovalHandler class was exported but never plugged in,
  // so requires_approval modules were rejected by the built-in gate even
  // though the CLI had its own interactive handler ready to use.
  if (executor && typeof (executor as unknown as Record<string, unknown>).setApprovalHandler === "function") {
    try {
      const handler = new CliApprovalHandler(/*autoApprove*/ false);
      (executor as unknown as { setApprovalHandler: (h: unknown) => void }).setApprovalHandler(handler);
    } catch {
      // Non-fatal: handler wiring failed; built-in gate still applies.
    }
  }

  const registryInjected = registry !== undefined;

  const program = new Command(resolvedProgName)
    .exitOverride()
    .helpOption("-h, --help", "Print help")
    .addHelpCommand("help [command]", "Print this message or the help of the given subcommand(s)")
    .description(appDescription ?? `${resolvedProgName} CLI`)
    .option("--log-level <level>", "Logging level (DEBUG|INFO|WARNING|ERROR)", "WARNING")
    .option("--all-options", "Show all options in help output (including built-in options)");
  if (appVersion) {
    program.version(appVersion, "-V, --version", "Print version");
  }
  program.configureHelp({ formatHelp: canonicalFormatHelp });

  // Discovery flags are standalone-only (FE-13 T-APCLI-27/28).
  if (!registryInjected) {
    program.option("--extensions-dir <path>", "Path to extensions directory");
    program.option("--commands-dir <path>", "Path to convention-based commands directory");
    program.option("--binding <path>", "Path to binding.yaml for display overlay");
  }

  // Build ApcliGroup via 3-source dispatch (FE-13 §4.8):
  //   1) Pre-built ApcliGroup instance (pass-through)
  //   2) CliConfig boolean/object (Tier 1, fromCliConfig)
  //   3) Tier 3 yaml via ConfigResolver.resolveObject (fromYaml)
  let apcliCfg: ApcliGroup;
  try {
    if (apcliOption instanceof ApcliGroup) {
      // Pre-built ApcliGroup wins; surface a conflict if the caller also
      // passed builtinGroupName with a different value.
      if (
        builtinGroupName !== undefined
        && builtinGroupName !== "apcli"
        && apcliOption.name !== builtinGroupName
      ) {
        throw new Error(
          `builtinGroupName=${JSON.stringify(builtinGroupName)} conflicts with `
            + `the name on the supplied ApcliGroup (${JSON.stringify(apcliOption.name)}). Pass only one.`,
        );
      }
      apcliCfg = apcliOption;
    } else if (apcliOption !== undefined) {
      apcliCfg = ApcliGroup.fromCliConfig(apcliOption, {
        registryInjected,
        name: builtinGroupName,
      });
    } else {
      let yamlVal: unknown = null;
      try {
        const resolver = new ConfigResolver();
        yamlVal = resolver.resolveObject("apcli");
      } catch {
        yamlVal = null;
      }
      apcliCfg = ApcliGroup.fromYaml(yamlVal, {
        registryInjected,
        name: builtinGroupName,
      });
    }
  } catch (e) {
    // ApcliGroup name validation failure or conflict — exit 2.
    process.stderr.write(`Error: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(EXIT_CODES.INVALID_CLI_INPUT);
  }

  // Sync the module-level reserved-group cache so cli.ts's `assertNotReserved`
  // and `listCommands` filter against the live (possibly renamed) name. Reset
  // to the default afterwards is the createCli caller's responsibility — in
  // practice processes invoke createCli once at startup, so this is fine.
  setReservedGroupNames(new Set([apcliCfg.name]));

  // Construct the apcli sub-group. Hidden when visibility resolves to "none".
  // Group name resolves from `apcliCfg.name` so downstream branded CLIs
  // that overrode `builtinGroupName` see their custom namespace.
  const apcliGroup = program
    .command(apcliCfg.name, { hidden: !apcliCfg.isGroupVisible() })
    .description("Built-in commands");

  // Dispatch the 13-entry subcommand registrar table (FE-13 §4.9).
  if (registry) {
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

  // Build exposure filter (FE-12) BEFORE the apcli dispatcher table so
  // registerListCommand can consult the filter for --exposure. fromConfig
  // throws on malformed shape (e.g. { mode: "bogus" }) — catch and exit with
  // INVALID_CLI_INPUT so the caller sees a friendly message and the documented
  // exit code, matching ApcliGroup._build's contract (review fix #1).
  let exposureFilter: ExposureFilter;
  try {
    if (expose instanceof ExposureFilter) {
      exposureFilter = expose;
    } else if (typeof expose === "object" && expose !== null) {
      exposureFilter = ExposureFilter.fromConfig({ expose });
    } else {
      exposureFilter = new ExposureFilter();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: invalid 'expose' option — ${msg}\n`);
    process.exit(EXIT_CODES.INVALID_CLI_INPUT);
  }

  _registerApcliSubcommands(apcliGroup, apcliCfg, registry, executor, exposureFilter);

  // Footer hints for discoverability
  program.addHelpText("after", [
    "",
    "Use --help --all-options to show all options (including built-in options).",
    "Use --help --man to display a formatted man page.",
  ].join("\n"));

  // Register --help --man support (stays at root — spec §4.1).
  // The man page reflects the host app's version when supplied; otherwise
  // falls back to the SDK version so the manpage still has a stamp.
  configureManHelp(program, resolvedProgName, appVersion ?? VERSION);

  // Register extra commands (F11) — validate no name collisions with live
  // Commander tree (root + apcli group subcommands). FE-13 moved the old
  // per-command constant into a live-tree walk; collision detection now
  // reads the actual program shape. Reserved-name (`apcli`) and
  // live-collision cases are hard exit 2 (FE-13 §4.10 / §7 FR-13-09).
  if (extraCommands && extraCommands.length > 0) {
    // Reserved-name set follows the resolved built-in-group name, not the
    // static default. When a downstream branded CLI renames the group via
    // `builtinGroupName`, an extraCommands entry that shadows the renamed
    // group is the same kind of collision and is rejected here.
    const _reservedForExtra: ReadonlySet<string> = new Set([apcliCfg.name]);
    for (const cmd of extraCommands) {
      const cmdName = cmd.name();
      if (_reservedForExtra.has(cmdName)) {
        process.stderr.write(
          `Error: extraCommands name '${cmdName}' is reserved\n`,
        );
        process.exit(EXIT_CODES.INVALID_CLI_INPUT);
      }
      const existing = program.commands.find((c) => c.name() === cmdName);
      if (existing) {
        process.stderr.write(
          `Error: extraCommands name '${cmdName}' collides with an existing command\n`,
        );
        process.exit(EXIT_CODES.INVALID_CLI_INPUT);
      }
      program.addCommand(cmd);
    }
  }

  // Hook to apply optional toolkit integration before command execution.
  // Commander actions are async, so we can set up toolkit state lazily.
  program.hook("preAction", async (thisCommand) => {
    const opts = thisCommand.opts();
    const commandsDir = opts.commandsDir as string | undefined;
    const bindingPath = opts.binding as string | undefined;
    await applyToolkitIntegration(commandsDir, bindingPath, { allowedPrefixes });
  });

  return program;
}

// ---------------------------------------------------------------------------
// FE-13 apcli subcommand dispatcher (§4.9)
// ---------------------------------------------------------------------------

/**
 * Subcommand names that are registered regardless of the resolved visibility
 * mode's include/exclude filter. `exec` is the documented always-registered
 * escape hatch (spec §4.9) so that downstream callers can always invoke modules
 * by ID even when the apcli group is configured with a minimal surface.
 */
const _ALWAYS_REGISTERED: ReadonlySet<string> = new Set<string>(["exec"]);

interface _RegistrarEntry {
  name: string;
  requiresExecutor: boolean;
  register: (
    apcliGroup: Command,
    registry: Registry | undefined,
    executor: Executor | undefined,
  ) => void;
}

/**
 * Central dispatcher for the 13 canonical apcli subcommands. Called once per
 * createCli invocation after the apcli Commander group is built. Honors
 * {@link ApcliGroup.resolveVisibility} for include/exclude modes, and skips
 * entries whose `requiresExecutor: true` flag is not satisfied.
 */
function _registerApcliSubcommands(
  apcliGroup: Command,
  apcliCfg: ApcliGroup,
  registry: Registry | undefined,
  executor: Executor | undefined,
  exposureFilter: ExposureFilter,
): void {
  // Standalone-mode fallback registry. Previously returned an empty list +
  // null; that silently masked the "no registry wired" contract gap — users
  // saw empty `apcli list` output with no clue the CLI was unwired. The
  // erroring fallback below surfaces the gap with a clear message + exit code
  // whenever list/describe actions actually reach into registry methods.
  const emitUnwiredError = (): never => {
    process.stderr.write(
      "Error: no module registry wired. In standalone mode, pass " +
        "--extensions-dir <path> to enable module discovery.\n",
    );
    process.exit(EXIT_CODES.CONFIG_INVALID);
  };
  const effectiveRegistry: Registry = registry ?? {
    listModules: () => emitUnwiredError(),
    getModule: () => emitUnwiredError(),
  };

  const TABLE: _RegistrarEntry[] = [
    { name: "list",              requiresExecutor: false, register: (g) => registerListCommand(g, effectiveRegistry, exposureFilter) },
    { name: "describe",          requiresExecutor: false, register: (g) => registerDescribeCommand(g, effectiveRegistry) },
    { name: "exec",              requiresExecutor: true,  register: (g, _r, ex) => registerExecCommand(g, effectiveRegistry, ex!) },
    { name: "validate",          requiresExecutor: true,  register: (g, _r, ex) => registerValidateCommand(g, effectiveRegistry, ex!) },
    { name: "init",              requiresExecutor: false, register: (g) => registerInitCommand(g) },
    { name: "health",            requiresExecutor: true,  register: (g, _r, ex) => registerHealthCommand(g, ex!) },
    { name: "usage",             requiresExecutor: true,  register: (g, _r, ex) => registerUsageCommand(g, ex!) },
    { name: "enable",            requiresExecutor: true,  register: (g, _r, ex) => registerEnableCommand(g, ex!) },
    { name: "disable",           requiresExecutor: true,  register: (g, _r, ex) => registerDisableCommand(g, ex!) },
    { name: "reload",            requiresExecutor: true,  register: (g, _r, ex) => registerReloadCommand(g, ex!) },
    { name: "config",            requiresExecutor: true,  register: (g, _r, ex) => registerConfigCommand(g, ex!) },
    { name: "completion",        requiresExecutor: false, register: (g) => registerCompletionCommand(g) },
    { name: "describe-pipeline", requiresExecutor: true,  register: (g, _r, ex) => registerPipelineCommand(g, ex!) },
  ];

  const mode = apcliCfg.resolveVisibility();
  for (const entry of TABLE) {
    // Determine whether this entry would be registered BEFORE short-circuiting
    // on missing executor — otherwise _ALWAYS_REGISTERED never gets consulted
    // for executor-required entries (e.g. "exec"), which violates spec §4.9.
    let shouldRegister: boolean;
    if (mode === "all" || mode === "none") {
      // mode:"none" still registers all subcommands — the group itself is
      // hidden, but subcommands remain individually reachable (spec §4.6).
      shouldRegister = true;
    } else {
      shouldRegister =
        _ALWAYS_REGISTERED.has(entry.name) || apcliCfg.isSubcommandIncluded(entry.name);
    }
    if (!shouldRegister) continue;

    // Executor-required entry but no executor wired. Silent skip for ordinary
    // entries — loud WARN for _ALWAYS_REGISTERED entries since the spec §4.9
    // contract says they are always registered, and silently dropping them
    // would mask a legitimate wiring gap for the caller.
    if (entry.requiresExecutor && !executor) {
      if (_ALWAYS_REGISTERED.has(entry.name)) {
        logWarn(
          `apcli.${entry.name} is in _ALWAYS_REGISTERED but no executor is wired — ` +
            `subcommand unavailable. Pass executor to createCli() or avoid ${entry.name} invocations.`,
        );
      }
      continue;
    }

    entry.register(apcliGroup, registry, executor);
  }
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
/**
 * Module-level binding display overlay map: moduleId → resolved `display`
 * metadata (as produced by `DisplayResolver.resolve()`). Consulted by
 * `getDisplay()` when a `ModuleDescriptor`'s own `metadata.display` is absent.
 */
const bindingDisplayMap = new Map<string, Record<string, unknown>>();

/**
 * Internal accessor for the binding display overlay map — used by
 * `display-helpers.ts#getDisplay` as a fallback when the descriptor itself
 * carries no resolved display metadata.
 */
export function lookupBindingDisplay(moduleId: string): Record<string, unknown> | undefined {
  return bindingDisplayMap.get(moduleId);
}

/**
 * Clear the binding display overlay map. Primarily for tests.
 */
export function clearBindingDisplayMap(): void {
  bindingDisplayMap.clear();
}

/** Options bag for {@link applyToolkitIntegration}. */
export interface ApplyToolkitIntegrationOptions {
  /**
   * Allowlist of module-path prefixes forwarded to apcore-toolkit's
   * `RegistryWriter.write` when registering scanned/loaded modules. Mirrors
   * the Python factory's `allowed_prefixes` kwarg.
   */
  allowedPrefixes?: string[];
}

export async function applyToolkitIntegration(
  commandsDir?: string,
  bindingPath?: string,
  options: ApplyToolkitIntegrationOptions = {},
): Promise<void> {
  if (!commandsDir && !bindingPath) {
    return;
  }

  let toolkit: Record<string, unknown>;
  try {
    // String indirection prevents bundlers from statically resolving the
    // optional peer dependency at build time.
    const toolkitModule = "apcore-toolkit";
    toolkit = await import(/* @vite-ignore */ toolkitModule) as Record<string, unknown>;
  } catch {
    logWarn("apcore-toolkit not installed — toolkit features unavailable");
    return;
  }

  // ConventionScanner has no TypeScript equivalent (the Python adapter is
  // pydantic-specific and does not port cleanly). See the upstream
  // apcore-toolkit README for the tri-language parity note.
  if (commandsDir) {
    logWarn("Convention scanning not available in the TypeScript toolkit");
  }

  if (bindingPath) {
    try {
      await loadBindingDisplayOverlay(toolkit, bindingPath, options.allowedPrefixes);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logWarn(`apcore-toolkit: failed to load binding '${bindingPath}': ${msg}`);
    }
  }
}

/**
 * Parse a `.binding.yaml` (or directory thereof) and populate the module-level
 * `bindingDisplayMap` with resolved display overlay entries. Uses the
 * apcore-toolkit `BindingLoader` + `DisplayResolver` pipeline so the overlay
 * produced here is identical to what apcore-toolkit's registry-writer would
 * emit at scan time.
 */
async function loadBindingDisplayOverlay(
  toolkit: Record<string, unknown>,
  bindingPath: string,
  allowedPrefixes?: string[],
): Promise<void> {
  const BindingLoaderCtor = toolkit.BindingLoader as
    | (new () => { load(path: string): unknown[] })
    | undefined;
  const DisplayResolverCtor = toolkit.DisplayResolver as
    | (new () => { resolve(mods: unknown[], opts?: { bindingPath?: string }): unknown[] })
    | undefined;

  if (!BindingLoaderCtor || !DisplayResolverCtor) {
    // apcore-toolkit < 0.5.0 (no BindingLoader) — silently skip the overlay.
    return;
  }

  const loader = new BindingLoaderCtor();
  const scanned = loader.load(bindingPath);
  const resolver = new DisplayResolverCtor();
  const resolved = resolver.resolve(scanned, { bindingPath });

  // Mirrors Python's RegistryWriter `allowed_prefixes` gate: any entry whose
  // `target:` path is outside the allowlist is dropped before its display
  // overlay reaches the runtime — the TS overlay path doesn't go through
  // RegistryWriter, so we apply the same check inline.
  const prefixes = allowedPrefixes && allowedPrefixes.length > 0 ? allowedPrefixes : null;
  const isTargetAllowed = (target: unknown): boolean => {
    if (!prefixes) return true;
    if (typeof target !== "string" || target.length === 0) return true;
    return prefixes.some((p) => target.startsWith(p));
  };

  for (const mod of resolved) {
    if (!mod || typeof mod !== "object") continue;
    const entry = mod as { moduleId?: unknown; metadata?: unknown; target?: unknown };
    const id = typeof entry.moduleId === "string" ? entry.moduleId : null;
    if (!id) continue;
    if (!isTargetAllowed(entry.target)) {
      logWarn(
        `apcore-toolkit: dropped binding entry '${id}' — target '${String(entry.target)}' ` +
          `is outside allowedPrefixes`,
      );
      continue;
    }
    const meta = (entry.metadata as Record<string, unknown> | undefined) ?? {};
    const display = meta.display;
    if (display && typeof display === "object" && !Array.isArray(display)) {
      bindingDisplayMap.set(id, display as Record<string, unknown>);
    }
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
  // Standalone bin entry: SDK version IS the app version. Pass it through
  // explicitly so createCli registers --version (which is intentionally
  // gated on opts.version for embedded callers — see issue #18).
  const program = createCli({
    progName,
    verbose: verboseHelp,
    version: VERSION,
    description: `${progName ?? "apcore-cli"} — execute modules from the command line`,
  });

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
    } catch (err) {
      if (err instanceof MaxDepthExceededError || err instanceof CircularRefError) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exit(EXIT_CODES.SCHEMA_CIRCULAR_REF);
      }
      if (err instanceof UnresolvableRefError) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exit(EXIT_CODES.SCHEMA_VALIDATION_ERROR);
      }
      resolvedSchema = inputSchema; // unexpected error: fall through to raw schema
    }
    schemaOptions = schemaToCliOptions(resolvedSchema, helpTextMaxLength);
  }

  const cmd = new Command(effectiveCmdName).description(cmdHelp);

  // Built-in options (hidden unless --all-options)
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

  // Help footer: --all-options hint + optional docs link
  const footerParts: string[] = [];
  if (!verbose) {
    footerParts.push("Use --all-options to show all options (including built-in options).");
  }
  if (docsUrl) {
    footerParts.push(`Docs: ${docsUrl}/commands/${effectiveCmdName}`);
  }
  if (footerParts.length > 0) {
    cmd.addHelpText("after", "\n" + footerParts.join("\n") + "\n");
  }

  // Schema-generated options
  for (const opt of schemaOptions) {
    if (opt.isBooleanFlag) {
      // Commander does not parse the combined "--flag, --no-flag" spec the
      // way Python click does — it ends up storing `false` for both forms.
      // Register the affirmative form (carrying the schema default and help
      // text) and a hidden `--no-<flag>` companion; commander auto-routes
      // both to the same camelCase attribute and applies negation correctly.
      const flagBase = opt.name.replace(/_/g, "-");
      cmd.addOption(
        new Option(`--${flagBase}`, opt.description).default(
          opt.defaultValue as boolean,
        ),
      );
      cmd.addOption(new Option(`--no-${flagBase}`).hideHelp());
    } else if (opt.parseArg) {
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
    const strategyName = resolveStringOption(options.strategy, process.env.APCORE_CLI_STRATEGY);
    const approvalTimeout = resolveIntOption(
      options.approvalTimeout as number | undefined,
      process.env.APCORE_CLI_APPROVAL_TIMEOUT,
      60,
    );
    const approvalToken = options.approvalToken as string | undefined;

    // Build schema kwargs from parsed options. Commander stores parsed flag
    // values under camelCase keys (e.g. `--has-solution` -> `hasSolution`),
    // but downstream module code keys off the original schema property names
    // (snake_case) to match Python click and Rust clap behavior. Drive the
    // mapping from schemaOptions so each value is written back under its
    // original propName.
    const schemaKwargs: Record<string, unknown> = {};
    for (const opt of schemaOptions) {
      const commanderKey = opt.name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
      if (commanderKey in options) {
        schemaKwargs[opt.name] = options[commanderKey];
      } else if (opt.name in options) {
        schemaKwargs[opt.name] = options[opt.name];
      }
    }

    let merged: Record<string, unknown> = {};
    const startTime = performance.now();

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
          process.exit(EXIT_CODES.MODULE_EXECUTE_ERROR);
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

        // Print result
        const resolved = resolveFormat(outputFormat);
        if (resolved === "json" || !process.stdout.isTTY) {
          // Merge _trace into JSON output. JSON keys remain snake_case to
          // match the cross-language CLI output contract; runtime reads use
          // the camelCase shape returned by apcore-js PipelineTrace.
          const traceData = {
            strategy: trace.strategyName,
            total_duration_ms: trace.totalDurationMs,
            success: trace.success,
            steps: trace.steps.map((s) => ({
              name: s.name,
              duration_ms: s.durationMs,
              skipped: s.skipped,
              ...(s.skipped ? { skip_reason: s.skipReason ?? null } : {}),
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
            `\nPipeline Trace (strategy: ${trace.strategyName}, ` +
            `${stepCount} steps, ${trace.totalDurationMs.toFixed(1)}ms)\n`,
          );
          for (const s of trace.steps) {
            if (s.skipped) {
              const reason = s.skipReason ?? "n/a";
              process.stderr.write(`  \u25cb ${s.name.padEnd(24)} ${"\u2014".padStart(8)}  skipped (${reason})\n`);
            } else {
              process.stderr.write(`  \u2713 ${s.name.padEnd(24)} ${(s.durationMs.toFixed(1) + "ms").padStart(8)}\n`);
            }
          }
        }
        // Audit log AFTER format (canonical ordering: format \u2192 audit on success)
        const { getAuditLogger: getAL2 } = await import("./security/audit.js");
        const al2 = getAL2();
        if (al2) {
          al2.logExecution(moduleId, merged, "success", 0, durationMs);
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

      // 5. Format and print result first (canonical order: format → audit)
      formatExecResult(result, outputFormat, outputFields);

      // 6. Audit log (success) — called AFTER format so formatter exceptions
      //    suppress the success entry (matches Python canonical ordering).
      const { getAuditLogger } = await import("./security/audit.js");
      const auditLogger = getAuditLogger();
      if (auditLogger) {
        auditLogger.logExecution(moduleId, merged, "success", 0, durationMs);
      }
    } catch (err: unknown) {
      // Enhanced error output (F3)
      const exitCode = exitCodeForError(err);
      const durationMs = Math.round(performance.now() - startTime);

      // Audit log (error) with real elapsed duration_ms
      try {
        const { getAuditLogger } = await import("./security/audit.js");
        const auditLogger = getAuditLogger();
        if (auditLogger) {
          auditLogger.logExecution(moduleId, merged, "error", exitCode, durationMs);
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
// validateModuleId — see src/validate.ts (extracted to mirror Python/Rust layout, audit D8-W2)
// ---------------------------------------------------------------------------

export { validateModuleId } from "./validate.js";

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

  let raw: string;
  let source: string;
  if (stdinFlag === "-") {
    raw = await readStdin();
    source = "STDIN";
  } else {
    // File-path source (help text: "JSON input file or '-' for stdin")
    source = `file '${stdinFlag}'`;
    try {
      raw = readFileSync(stdinFlag, "utf-8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: Could not read input ${source}: ${msg}\n`);
      process.exit(EXIT_CODES.INVALID_CLI_INPUT);
    }
  }

  const rawSize = Buffer.byteLength(raw, "utf-8");
  if (rawSize > 10_485_760 && !largeInput) {
    process.stderr.write(
      `Error: ${source} input exceeds 10MB limit. Use --large-input to override.\n`,
    );
    process.exit(EXIT_CODES.INVALID_CLI_INPUT);
  }

  if (!raw) {
    return cliKwargsNonNull;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    process.stderr.write(`Error: ${source} does not contain valid JSON.\n`);
    process.exit(EXIT_CODES.INVALID_CLI_INPUT);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    process.stderr.write(
      `Error: ${source} JSON must be an object, got ${Array.isArray(parsed) ? "array" : typeof parsed}.\n`,
    );
    process.exit(EXIT_CODES.INVALID_CLI_INPUT);
  }

  // CLI flags override stdin/file for duplicate keys
  return { ...(parsed as Record<string, unknown>), ...cliKwargsNonNull };
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
