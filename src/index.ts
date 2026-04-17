/**
 * apcore-cli — Public API exports.
 *
 * This module re-exports the public surface of the apcore CLI package.
 */

// Core CLI
export { createCli, main, buildModuleCommand, validateModuleId, collectInput, reconvertEnumValues, applyToolkitIntegration, verboseHelp, setVerboseHelp, docsUrl, setDocsUrl, emitErrorJson, emitErrorTty } from "./main.js";
export type { OptionConfig, CreateCliOptions, APCore } from "./main.js";

// Lazy module loading
export { LazyModuleGroup, GroupedModuleGroup, LazyGroup, BUILTIN_COMMANDS } from "./cli.js";
export type { Registry, Executor, ModuleDescriptor, PreflightResult, PreflightCheck, PipelineTrace, PipelineTraceStep, StrategyInfo, StrategyStep } from "./cli.js";

// Approval
export { CliApprovalHandler } from "./approval.js";

// Display helpers
export { getDisplay, getCliDisplayFields } from "./display-helpers.js";

// Init command
export { registerInitCommand } from "./init-cmd.js";

// Configuration
export { ConfigResolver, DEFAULTS, registerConfigNamespace } from "./config.js";

// Discovery
export { registerDiscoveryCommands, registerValidateCommand } from "./discovery.js";

// Output formatting
export { formatExecResult, resolveFormat, truncate, formatModuleList, formatModuleDetail, formatPreflightResult, firstFailedExitCode } from "./output.js";

// Schema handling
export { resolveRefs } from "./ref-resolver.js";
export { schemaToCliOptions, mapType, extractHelp } from "./schema-parser.js";

// Approval
export { checkApproval } from "./approval.js";

// Shell integration
export { registerShellCommands, buildProgramManPage, configureManHelp } from "./shell.js";

// System commands (F2)
export { registerSystemCommands } from "./system-cmd.js";

// Strategy / pipeline commands (F8)
export { registerPipelineCommand } from "./strategy.js";

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

// Logger
export { setLogLevel, getLogLevel, debug, info, warn, error } from "./logger.js";

// Security
export { AuditLogger, setAuditLogger, getAuditLogger, AuthProvider, ConfigEncryptor, Sandbox } from "./security/index.js";
