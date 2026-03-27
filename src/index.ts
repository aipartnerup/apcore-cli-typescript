/**
 * apcore-cli — Public API exports.
 *
 * This module re-exports the public surface of the apcore CLI package.
 */

// Core CLI
export { createCli, main, buildModuleCommand, validateModuleId, collectInput, reconvertEnumValues, applyToolkitIntegration } from "./main.js";
export type { OptionConfig } from "./main.js";

// Lazy module loading
export { LazyModuleGroup, GroupedModuleGroup, LazyGroup, BUILTIN_COMMANDS } from "./cli.js";
export type { Registry, Executor, ModuleDescriptor } from "./cli.js";

// Display helpers
export { getDisplay, getCliDisplayFields } from "./display-helpers.js";

// Init command
export { registerInitCommand } from "./init-cmd.js";

// Configuration
export { ConfigResolver, DEFAULTS } from "./config.js";

// Discovery
export { registerDiscoveryCommands } from "./discovery.js";

// Output formatting
export { formatExecResult, resolveFormat, truncate, formatModuleList, formatModuleDetail } from "./output.js";

// Schema handling
export { resolveRefs } from "./ref-resolver.js";
export { schemaToCliOptions, mapType, extractHelp } from "./schema-parser.js";

// Approval
export { checkApproval } from "./approval.js";

// Shell integration
export { registerShellCommands } from "./shell.js";

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
