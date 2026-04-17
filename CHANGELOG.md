# Changelog

All notable changes to apcore-cli (TypeScript SDK) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] - 2026-04-15

### Changed

- **Dependency bump**: requires `apcore-js >= 0.18.0` (was `>= 0.17.1`). Aligns with upstream breaking changes in `apcore-js 0.18.0` and `apcore-toolkit 0.4.2`.
- **`MAX_MODULE_ID_LENGTH` 128 → 192**: `validateModuleId()` now enforces a 192-character limit for module IDs, up from 128, to accommodate Java/.NET deep-namespace FQN-derived IDs (PROTOCOL_SPEC §2.7 spec 1.6.0-draft).
- **`Executor.describePipeline()` returns `StrategyInfo`**: `describe-pipeline` command in `strategy.ts` now calls `executor.describePipeline(strategyName)` and consumes the returned `StrategyInfo` object (`name`, `stepCount`, `stepNames`, `description`). Pipeline header format updated to `Pipeline: ${info.name} (${info.stepCount} steps)`. Step metadata (Pure/Removable/Timeout columns) sourced from `executor.strategy.steps` (`pure: boolean`, `removable: boolean`, `timeoutMs: number`). Falls back to static preset table when `describePipeline` is not available.

### Added

- **`createCli({ app })` — `APCore` unified client**: `CreateCliOptions` now accepts an `app?: APCore` field. When provided, `app.registry` and `app.executor` are extracted and used in place of explicit `registry`/`executor` fields. Passing `app` together with `registry` or `executor` throws `"app is mutually exclusive with registry/executor"`.
- `APCore` interface exported from package index. `StrategyInfo` and `StrategyStep` interfaces exported from package index.
- `Executor` interface extended with optional `describePipeline(strategyName?: string): StrategyInfo` and `strategy?: { steps: StrategyStep[] }` fields.

---

## [0.6.0] - 2026-04-06

### Changed

- **Dependency bump**: requires `apcore-js >= 0.17.1` (was `>= 0.15.1`). Adds Execution Pipeline Strategy, Config Bus enhancements, Pipeline v2 declarative step metadata, `minimal` strategy preset.
- **Schema parser**: Required schema properties now correctly enforced at Commander option level (was silently optional).
- `checkApproval()` now accepts `timeout` parameter instead of hardcoded 60s.

### Added

- **FE-11: Usability Enhancements** — 11 new capabilities:
  - `--dry-run` preflight mode. Standalone `validate` command via `registerValidateCommand()`.
  - System management commands: `health`, `usage`, `enable`, `disable`, `reload`, `config get`/`config set` in `system-cmd.ts`. Graceful no-op when system modules unavailable.
  - Enhanced error output: `emitErrorJson()` / `emitErrorTty()` with structured guidance fields.
  - `--trace` pipeline visualization.
  - `CliApprovalHandler` class implementing apcore `ApprovalHandler` protocol. `--approval-timeout`, `--approval-token` flags.
  - `--stream` JSONL output.
  - Enhanced `list` command: `--search`, `--status`, `--annotation`, `--sort`, `--reverse`, `--deprecated`, `--deps`, `--flat`.
  - `--strategy` selection: `standard`, `internal`, `testing`, `performance`, `minimal`. `describe-pipeline` command in `strategy.ts`.
  - Output format extensions: `--format csv|yaml|jsonl`, `--fields` dot-path field selection.
  - Multi-level grouping: `groupDepth` parameter in `resolveGroup()`.
  - Custom command extension: `CreateCliOptions.extraCommands` with collision detection.
- `Executor` interface extended with optional `validate()`, `callWithTrace()`, `stream()`, `call()` methods.
- `PreflightResult`, `PreflightCheck`, `PipelineTrace`, `PipelineTraceStep` types exported.
- New error code: `CONFIG_ENV_MAP_CONFLICT` in `EXIT_CODES`.
- Config defaults: `cli.approval_timeout` (60), `cli.strategy` ("standard"), `cli.group_depth` (1).
- New files: `system-cmd.ts`, `strategy.ts`.

---

## [0.5.1] - 2026-04-03

### Added
- **Pre-populated registry support** — `createCli()` accepts a `CreateCliOptions` object with optional `registry` and `executor` fields. When a pre-populated `Registry` is provided, filesystem discovery is skipped entirely. This enables frameworks that register modules at runtime to generate CLI commands from their existing registry without requiring an extensions directory.
- `CreateCliOptions` interface exported from package index.
- Passing `executor` without `registry` throws an error.

---

## [0.4.0] - 2026-03-29

### Added
- **Verbose help mode** — Built-in apcore options (`--input`, `--yes`, `--large-input`, `--format`, `--sandbox`) are now hidden from `--help` output by default. Pass `--help --verbose` to display the full option list including built-in options.
- **Universal man page generation** — `buildProgramManPage()` generates a complete roff man page covering all registered commands. `configureManHelp()` adds `--help --man` support to any Commander program, enabling downstream projects to get man pages for free.
- **Documentation URL support** — `setDocsUrl()` sets a base URL for online docs. Per-command help shows `Docs: {url}/commands/{name}`, man page SEE ALSO includes `Full documentation at {url}`. No default — disabled when not set.

### Changed
- `buildModuleCommand()` accepts optional `verboseHelp` parameter to control built-in option visibility in help.
- `--sandbox` is now always hidden from help (not yet implemented). Only four built-in options (`--input`, `--yes`, `--large-input`, `--format`) toggle with `--verbose`.
- Improved built-in option descriptions for clarity (e.g., `--input` now reads "Read JSON input from a file path, or use '-' to read from stdin pipe").

## [0.3.2] - 2026-03-28

### Fixed
- Handle missing `package.json` for version retrieval in bundled environments (e.g., Bun compile).

## [0.3.1] - 2026-03-28

### Changed
- Update `tsup.config.ts` entry configuration to use named entries (`{ index: "src/index.ts", "bin/apcore-cli": "bin/apcore-cli.ts" }`) instead of an array.

## [0.3.0] - 2026-03-27

### Added
- **Grouped CLI commands (FE-09)** — `GroupedModuleGroup` organizes modules into nested subcommand groups by namespace prefix, enabling `apcore-cli <group> <command>` invocation.
- **Display overlay helpers** — `getDisplay()` and `getCliDisplayFields()` resolve alias, description, and tags from `metadata["display"]`.
- **Init command (FE-10)** — `apcore-cli init module <id>` scaffolds new modules with `--style` (decorator/convention/binding), `--dir`, and `--description` options.
- **Grouped shell completions** — Bash, Zsh, and Fish completions now support two-level group/command completion via `_APCORE_GRP`.
- **Optional apcore-toolkit integration** — `DisplayResolver` and `RegistryWriter` via optional `apcore-toolkit` peer dependency with graceful fallback.
- **Path traversal validation** — `--dir` rejects paths containing `..` components.

### Changed
- `BUILTIN_COMMANDS` updated to include `init` (6 items, sorted).
- `buildModuleCommand` accepts optional `cmdName` parameter for display alias override.
- `APCORE_EXTENSIONS_ROOT` environment variable now used as fallback in `createCli()`.
- `APCORE_AUTH_API_KEY` added to man page ENVIRONMENT section.
- Dependency bump: `apcore-js >= 0.14.0`.

## [0.2.2] - 2026-03-22

### Changed
- Rebrand: aipartnerup → aiperceivable

## [0.2.1] - 2026-03-19

### Changed
- Help text truncation limit increased from 200 to 1000 characters (configurable via `cli.help_text_max_length` config key)
- `extractHelp`: added `maxLength` parameter (default 1000) (`schema-parser.ts`)
- `schemaToCliOptions`: added `maxHelpLength` parameter (default 1000) (`schema-parser.ts`)
- `buildModuleCommand`: added `helpTextMaxLength` parameter (default 1000), threaded through to schema parser (`main.ts`)
- `LazyModuleGroup`: constructor accepts `helpTextMaxLength` (default 1000), passes to `buildModuleCommand` (`cli.ts`)

### Added
- `cli.help_text_max_length` config key (default: 1000) in `DEFAULTS` (`config.ts`)
- `APCORE_CLI_HELP_TEXT_MAX_LENGTH` environment variable support
- Test: "truncates help text at 1000 chars (default)"
- Test: "does not truncate text within default limit"
- Test: "truncates at custom maxLength"
- 183 tests (up from 181)

## [0.2.0] - 2026-03-18

### Added
- Core dispatch pipeline: `buildModuleCommand` now fully wires schema resolution, built-in options (`--input`, `--yes`, `--large-input`, `--format`, `--sandbox`), input collection, approval gate, sandbox execution, audit logging, and output formatting
- `LazyModuleGroup.getCommand` now calls `buildModuleCommand` instead of creating bare Commander commands
- `createCli` wired with program name resolution from `argv`, `--extensions-dir` and `--log-level` global options, and log level resolution from `APCORE_CLI_LOGGING_LEVEL` / `APCORE_LOGGING_LEVEL` env vars
- Commander `.exitOverride()` — custom exit code mapping via `exitCodeForError` is now active (previously dead code because Commander calls `process.exit()` internally)
- `src/logger.ts` — structured logger utility with `setLogLevel`, `getLogLevel`, `debug`, `info`, `warn`, `error` functions respecting `logging.level` config
- `setAuditLogger` / `getAuditLogger` — module-level audit logger getter/setter (ported from Python SDK)
- `tests/main.test.ts` — 14 new tests covering `createCli`, Commander exitOverride, `buildModuleCommand` action execution, and SIGINT handling
- `APCORE_CLI_LOGGING_LEVEL` env var support — CLI-specific log level that takes priority over `APCORE_LOGGING_LEVEL`; 3-tier precedence: `--log-level` flag > `APCORE_CLI_LOGGING_LEVEL` > `APCORE_LOGGING_LEVEL` > `WARNING`
- 181 tests total (up from 167)

### Changed
- `schemaToCommanderOptions` renamed to `schemaToCliOptions` — framework-agnostic name matching spec canonical form
- `AuditLogger` constructor parameter renamed from `logPath` to `path` — matches spec and Python SDK
- `ConfigResolver.DEFAULTS` keys normalized to snake_case: `cli.stdinBufferLimit` → `cli.stdin_buffer_limit`, `cli.autoApprove` → `cli.auto_approve` — matches spec and Python SDK
- `ConfigResolver.DEFAULTS` `logging.level` default changed from `"INFO"` to `"WARNING"` — matches updated spec
- `ConfigEncryptor.store` / `ConfigEncryptor.retrieve` now async — required by keytar dynamic import change
- `AuthProvider.getApiKey` / `AuthProvider.authenticateRequest` now async — propagated from ConfigEncryptor async change
- Version string read from `package.json` at runtime instead of hardcoded in 3 places
- `readStdin()` properly removes event listeners on completion/error — prevents listener accumulation
- Removed duplicate `resolveFormat` re-export from `main.ts` (index.ts already exports from output.ts)

### Fixed
- **Commander exit code mapping was dead code**: `program.parse()` calls `process.exit()` internally; added `.exitOverride()` so errors throw `CommanderError` and the catch block in `main()` can apply `exitCodeForError` mapping
- **`LazyModuleGroup.getCommand` bypassed `buildModuleCommand`**: was creating bare `new Command(cmdName)` instead of building a fully wired command with schema options and execution callback
- **`require('keytar')` in ESM module**: replaced with dynamic `await import('keytar')` via cached helper; keytar is an optional peer dependency (archived/deprecated)
- **README `--stdin json` flag**: corrected to `--input -`
- **README missing Features and API Overview sections**: added comprehensive sections

### Security
- `AuditLogger._hashInput`: uses `crypto.randomBytes(16)` per-invocation salt before SHA-256 hashing, preventing cross-invocation input correlation
- Added security comment on AES key derivation fallback (best-effort when OS keyring unavailable — key derived from hostname + username)

## [0.1.0] - 2026-03-17

### Added
- Core Dispatcher (FE-01): `LazyModuleGroup`, `buildModuleCommand`, `collectInput`, `validateModuleId`, `createCli`, `main`
- Schema Parser (FE-02): `schemaToCliOptions`, `mapType`, `extractHelp`, `reconvertEnumValues`
- Ref Resolver (FE-02): `resolveRefs` with `$ref`, `allOf`, `anyOf`, `oneOf` support, max depth 32
- Config Resolver (FE-07): `ConfigResolver` with 4-tier precedence (CLI > Env > File > Default), YAML config loading
- Approval Gate (FE-03): `checkApproval` with TTY detection, `--yes` bypass, `APCORE_CLI_AUTO_APPROVE` env var, 60s timeout
- Discovery (FE-04): `list` and `describe` commands with `--tag` AND-filtering and `--format json|table`
- Output Formatter (FE-08): `formatModuleList`, `formatModuleDetail`, `formatExecResult` with TTY-adaptive JSON/table rendering
- Security Manager (FE-05): `AuthProvider` (API key auth with keyring/AES), `ConfigEncryptor` (keyring + AES-256-GCM fallback), `AuditLogger` (JSON Lines with salted SHA-256), `Sandbox` (subprocess isolation)
- Shell Integration (FE-06): bash/zsh/fish completion generators, roff man page generator
- Error classes: `ApprovalTimeoutError`, `ApprovalDeniedError`, `AuthenticationError`, `ConfigDecryptionError`, `ModuleExecutionError`, `ModuleNotFoundError`, `SchemaValidationError`
- Exit code mapping: `EXIT_CODES` constant and `exitCodeForError` helper (0, 1, 2, 44, 45, 46, 47, 48, 77, 130)
- 167 tests (unit and integration)
- TypeScript strict mode with full type coverage
- Pre-commit hooks: `apdev-js check-chars`, `apdev-js check-imports`, `tsc --noEmit`
