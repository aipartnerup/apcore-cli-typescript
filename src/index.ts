/**
 * apcore-cli — Public API exports.
 *
 * This module re-exports the user-facing public surface of the apcore CLI package.
 * Internal helpers are intentionally NOT re-exported here — import them directly
 * from their source modules (e.g. `import { mapType } from "apcore-cli/schema-parser"`).
 */

// Core CLI entry points
//
// D9-002 (audit, 2026-04-26): the raw mutable `verboseHelp` and `docsUrl`
// bindings were re-exported but had zero external readers across src/, tests/,
// and examples/ — only the setter pair `setVerboseHelp` / `setDocsUrl` is used.
// Raw `let` bindings are also unstable as a public surface (live binding
// behaviour depends on the importer's bundler). Dropped from the re-export
// list. Add `getVerboseHelp` / `getDocsUrl` getters in main.ts if read access
// is later needed.
export { createCli, main, buildModuleCommand, validateModuleId, collectInput, reconvertEnumValues, applyToolkitIntegration, setAllOptionsHelp, setVerboseHelp, setDocsUrl } from "./main.js";
export type { OptionConfig, CreateCliOptions, APCore, ApplyToolkitIntegrationOptions } from "./main.js";

// Command grouping (GroupedModuleGroup is the default click.Group; LazyModuleGroup
// is the base class, available for downstream consumers that need to subclass it).
export { LazyModuleGroup, GroupedModuleGroup, LazyGroup } from "./cli.js";
export type { Registry, Executor, ModuleDescriptor, PreflightResult, PreflightCheck, PipelineTrace, PipelineTraceStep, StrategyInfo, StrategyStep } from "./cli.js";

// Built-in apcli group (FE-13)
export {
  ApcliGroup,
  ApcliGroupError,
  RESERVED_GROUP_NAMES,
  APCLI_SUBCOMMAND_NAMES,
  DEFAULT_BUILTIN_GROUP_NAME,
} from "./builtin-group.js";
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

// Output formatting — D1-007 cross-SDK parity (Rust exports all four; TS now matches).
export { formatExecResult, formatModuleList, formatModuleDetail, resolveFormat } from "./output.js";

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
  MaxDepthExceededError,
  CircularRefError,
  UnresolvableRefError,
  EXIT_CODES,
  exitCodeForError,
} from "./errors.js";
export type { ExitCode } from "./errors.js";

// Logger — control functions only (per-level helpers are internal to logger module).
//
// D1-W4 (2026-05-12): setLogLevel / getLogLevel are intentionally TS-only. The
// other two SDKs delegate log-level control to the host language's idiomatic
// channel: Python uses `logging.getLogger("apcore_cli").setLevel(...)`; Rust
// uses the `tracing` crate's env-filter (`RUST_LOG=apcore_cli=debug`). There
// is no plan to add equivalent functions in those SDKs.
export { setLogLevel, getLogLevel } from "./logger.js";

// Security.
//
// D1 follow-up note (2026-05-13): `getAuditLogger` is currently TS-only —
// Python (apcore_cli/cli.py) and Rust (apcore-cli-rust/src/cli.rs) keep the
// active AuditLogger as a module-private static with only a setter exposed.
// TS exports the getter because internal modules (discovery, main) re-read it
// during async execution. Embedders writing cross-SDK glue should not rely on
// the getter — `setAuditLogger` is the canonical cross-SDK API.
export { AuditLogger, setAuditLogger, getAuditLogger, AuthProvider, ConfigEncryptor, Sandbox } from "./security/index.js";
