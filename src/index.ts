/**
 * apcore-cli — Public API exports.
 *
 * This module re-exports the user-facing public surface of the apcore CLI package.
 * Internal helpers are intentionally NOT re-exported here — import them directly
 * from their source modules (e.g. `import { mapType } from "apcore-cli/schema-parser"`).
 */

// Core CLI entry points
export { createCli, main, buildModuleCommand, validateModuleId, collectInput, reconvertEnumValues, applyToolkitIntegration, verboseHelp, setVerboseHelp, docsUrl, setDocsUrl, emitErrorJson, emitErrorTty } from "./main.js";
export type { OptionConfig, CreateCliOptions, APCore } from "./main.js";

// Command grouping (GroupedModuleGroup is the default click.Group; LazyModuleGroup
// is the base class, available for downstream consumers that need to subclass it).
export { LazyModuleGroup, GroupedModuleGroup, LazyGroup } from "./cli.js";
export type { Registry, Executor, ModuleDescriptor, PreflightResult, PreflightCheck, PipelineTrace, PipelineTraceStep, StrategyInfo, StrategyStep } from "./cli.js";

// Built-in apcli group (FE-13)
export { ApcliGroup, RESERVED_GROUP_NAMES } from "./builtin-group.js";
export type { ApcliConfig, ApcliMode } from "./builtin-group.js";

// Approval handler (FE-11)
export { CliApprovalHandler, checkApproval } from "./approval.js";

// Configuration
export { ConfigResolver, DEFAULTS, registerConfigNamespace } from "./config.js";

// Exposure filtering (FE-12)
export { ExposureFilter } from "./exposure.js";

// Discovery (per-subcommand registrars — FE-13 split)
export {
  registerListCommand,
  registerDescribeCommand,
  registerExecCommand,
  registerValidateCommand,
} from "./discovery.js";

// Output formatting (top-level formatter only — per-type helpers are internal)
export { formatExecResult } from "./output.js";

// Schema handling
export { resolveRefs } from "./ref-resolver.js";
export { schemaToCliOptions } from "./schema-parser.js";

// Shell integration (FE-13 split)
export { registerCompletionCommand, configureManHelp } from "./shell.js";

// System commands (FE-11 F2, FE-13 split)
export {
  registerHealthCommand,
  registerUsageCommand,
  registerEnableCommand,
  registerDisableCommand,
  registerReloadCommand,
  registerConfigCommand,
} from "./system-cmd.js";

// Strategy / pipeline commands (FE-11 F8)
export { registerPipelineCommand } from "./strategy.js";

// Init command (FE-10)
export { registerInitCommand } from "./init-cmd.js";

// Errors
export {
  ApprovalTimeoutError,
  ApprovalDeniedError,
  AuthenticationError,
  ConfigDecryptionError,
  ModuleExecutionError,
  ModuleNotFoundError,
  SchemaValidationError,
  EXIT_CODES,
  exitCodeForError,
} from "./errors.js";
export type { ExitCode } from "./errors.js";

// Logger — control functions only (per-level helpers are internal to logger module)
export { setLogLevel, getLogLevel } from "./logger.js";

// Security
export { AuditLogger, setAuditLogger, getAuditLogger, AuthProvider, ConfigEncryptor, Sandbox } from "./security/index.js";
