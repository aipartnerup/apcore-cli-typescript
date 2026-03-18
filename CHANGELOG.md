# Changelog

All notable changes to apcore-cli (TypeScript SDK) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
