# Changelog

All notable changes to apcore-cli (TypeScript SDK) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [0.10.5] - 2026-08-17

Patch release. Bumps the required `apcore-js` floor to `0.27.0` to track the aligned apcore 0.27.0 release (2026-08-14). **No source changes** — the full test suite (653 tests across 30 files) plus `tsc --noEmit` and `build` pass unchanged against apcore-js 0.27.0.

The apcore-js 0.26.0 → 0.27.0 delta is BREAKING at the spec level, but touches no surface the CLI consumes — verified against the release notes and the actual call sites:

- **Middleware semantics** — `beforeStep` failure is now terminal/non-recoverable, `afterStep` fires after a recovered step body. The CLI never constructs or configures middleware or pipelines; it only consumes injected `registry` / `executor` objects and introspects `describePipeline` / `currentStrategy.steps` (read-only). No exposure.
- **ACL-failed `validate()` introspection** — a failed `acl` check now withholds `module_preflight` / `module_preview` checks and `predictedChanges`. The CLI's `--dry-run` / `apcli validate` consume `PreflightResult.valid` / `checks` / `requiresApproval` (never `predictedChanges`); `--dry-run --trace` prints a hardcoded preset step list, not SDK data. ACL-denied results still map to exit 77 via the hardcoded check-name map in `output.ts` (acl→77) or the `ACL_DENIED` error code. No code change needed.
- **`Registry.register` metadata `dependencies` persistence** — the CLI never calls `register`; registration runs via the SDK's `discover()` (sandbox runner) or host-injected registries. The `--deps` column reads top-level `dependencies` (already always-empty in 0.26.0); 0.27.0 persistence under metadata does not regress it. No exposure.
- **Schema conversion (A23)** — object detection, nullable `anyOf` wrapping, sorted `required` are SDK-conversion rules. The CLI runs its **own** schema→Commander converter (`schema-parser.ts` / `ref-resolver.ts`) on the descriptor's `inputSchema`; `required` is order-insensitive. Nullable `{anyOf:[orig,{type:null}]}` properties fall to the "no type → string + warning" path — a behavior nuance, not a break (matches v0.10.3's Python-side fix).
- **`pipeline.configure` 4-field set / `requires`/`provides` non-configurable** — the CLI never configures pipelines; a host config carrying other keys now fails at load (spec-mandated strictness, upstream concern). `Config.get(key)` used by `apcli config get` is unaffected — required-field validation applies to the load/validate path, which the CLI never invokes.
- **No type coercion at the module boundary** — the CLI already performs its own coercion (Commander `parseArg`, `reconvertEnumValues`) before `executor.execute`, so CLI-passed values are typed already.
- **Removed root exports** — `CTX_TRACING_SPAN_ID`, `OtelTracer`, `OtelSpan`, `TracingMiddlewareOptions` are no longer exported from `apcore-js` 0.27.0 — none imported by this CLI. (`ExecutionPolicy.fromObject` boolean strictness is host-side.)

## [0.10.4] - 2026-07-14

Patch release. Bumps the required `apcore-js` floor to `0.26.0` to align the ecosystem on the 0.26.0 governance layer (additive, no breaking changes). No code or API changes.

## [0.10.3] - 2026-07-07
update package dependency version for apcore-toolkit (0.10.0) and increment project patch version

## [0.10.2] - 2026-06-24

### Changed

- **Required runtime bumped to apcore-js 0.25.0 and apcore-toolkit 0.9.1.** Peer
  dependency floors in `package.json` raised from `apcore-js>=0.24.0` /
  `apcore-toolkit>=0.8.1` to `apcore-js>=0.25.0` / `apcore-toolkit>=0.9.1` (and the
  `apcore-toolkit` devDependency to `^0.9.1`), tracking the aligned apcore 0.25.0 and
  apcore-toolkit 0.9.1 releases. **No source changes** — the full test suite passes
  unchanged.

  Neither delta touches a surface the CLI consumes:
  - **apcore-js 0.24.0 → 0.25.0** adds config-driven ACL discovery (`acl.root`
    activation + `ACL.discover`), auto-wired only by the `APCore` bootstrap and
    skipped when the caller supplies its own `Executor`. The CLI never constructs
    `APCore`, so discovery does not engage; the change is backward-compatible
    regardless (a missing `acl.root` attaches no ACL, preserving the no-enforcement
    default).
  - **apcore-toolkit 0.8.1 → 0.9.1** is a bug-fix release; the TypeScript fixes
    (`RegistryVerifier` calling `get()` instead of the nonexistent `getModule()`,
    and `RegistryWriter.write` awaiting the async `register()`) correct internal
    behavior without changing call-site signatures. The toolkit surface the CLI
    uses (`BindingLoader`, `DisplayResolver`, `RegistryWriter`, `formatCsv`,
    `formatJsonl`) is unchanged.

## [0.10.1] - 2026-06-15

### Changed

- **Required runtime bumped to apcore-js 0.24.0 and apcore-toolkit 0.8.1.** Peer
  dependency floors in `package.json` raised from `apcore-js>=0.22.0` /
  `apcore-toolkit>=0.8.0` to `apcore-js>=0.24.0` / `apcore-toolkit>=0.8.1` (and the
  `apcore-toolkit` devDependency to `^0.8.1`), tracking the aligned apcore 0.24.0 and
  apcore-toolkit 0.8.1 releases. **No source changes** — the full test suite passes
  unchanged.

  The apcore-js 0.22.0 → 0.24.0 delta does not touch any surface the CLI consumes:
  - **Error `details` key casing camelCase → snake_case (A-D-019)** scopes only the
    *inner* `details` keys of `CALL_DEPTH_EXCEEDED` / `CIRCULAR_CALL` /
    `CALL_FREQUENCY_EXCEEDED` (`maxDepth` → `max_depth`, etc.). The CLI's error
    serialization in `main.ts` reads top-level fields (`details`, `suggestion`,
    `ai_guidance`, `retryable`, `user_fixable`) and forwards `details` verbatim — it
    never references the inner keys, and the public TS getters (`maxDepth`, …) are
    unchanged. Transparent pass-through; no golden tests pin the shape.
  - **Per-instance `ToggleState` isolation (#71)** — the CLI never constructs
    `ToggleState`/`APCore` nor calls `isModuleDisabled()`.
  - The CLI's internal `Registry` / `Executor` / `ModuleDescriptor` mirror interfaces
    in `src/cli.ts` (`list(): string[]`, `getDefinition()`, `call()`,
    `moduleId`, `name: string | null`) still match apcore-js 0.24.0 exactly.
  - Out of scope and unused by the CLI: `Registry.unregister()` drain fix (A-D-001),
    array redaction (A-D-003), `Config` env coercion (A-D-008), middleware
    `on_error` (A-D-011), ACL `removeRule(null)` (A-D-016), `CircuitBreakerMiddleware`,
    `A2ASubscriber`, DLQ, `EventEmitter`.

## [0.10.0] - 2026-05-18

### Changed — BREAKING

- **Removed graceful dynamic-import fallback for `apcore-toolkit` in `applyToolkitIntegration` (resolves 6.2).** `package.json` already declares `apcore-toolkit>=0.7.0` as a required peer dependency, but `main.ts:792-801` used a `try { await import("apcore-toolkit") } catch { logWarn(...); return }` pattern — self-contradiction between manifest and runtime behaviour. The fallback is gone; `BindingLoader` and `DisplayResolver` are now statically imported at the top of `main.ts`. A missing toolkit installation now fails at module load time with `ERR_MODULE_NOT_FOUND`, matching the peer-dep contract. `loadBindingDisplayOverlay` no longer takes a `toolkit: Record<string, unknown>` parameter (signature simplified).
- **CLI-internal `Registry`, `Executor`, and `ModuleDescriptor` interfaces now match apcore-js >= 0.22.0 exactly (resolves "D9-W2 Known gap" in `src/cli.ts`).** Embedders may now pass an `apcore-js` `Registry` / `Executor` instance — and the `ModuleDescriptor` objects those instances return — directly to `createCli()` with no adapter or field remapping. Four surfaces aligned:
  - **`Executor.execute(moduleId, input)` → `Executor.call(moduleId, input)`**. `execute` is removed entirely; `call` is the single required invocation method.
  - **`Registry.listModules() → ModuleDescriptor[]` → `Registry.list() → string[]`**. `list()` returns module IDs only (matches apcore-js semantics). A new exported helper `listAllDefinitions(registry: Registry): ModuleDescriptor[]` performs the `list() + getDefinition()` iteration for call sites that need full descriptors.
  - **`Registry.getModule(moduleId)` → `Registry.getDefinition(moduleId)`** (rename only — semantics identical).
  - **`ModuleDescriptor.id: string` → `ModuleDescriptor.moduleId: string`**; **`ModuleDescriptor.name: string` → `ModuleDescriptor.name: string | null`** (matches apcore-js `name` nullability). All internal accesses (`approval`, `display-helpers`, `discovery`, `main`, `output`) updated. The generic `sortModulesByUsage<T>` helper in `system-usage.ts` accepts any of `{ moduleId, id, module_id }` for forward/backward compatibility with snake_case audit payloads.
- **CLI JSON output preserves the `id` field name** for backward compatibility with downstream scripts (jq pipelines, log parsers). The output boundary in `output.ts` maps `descriptor.moduleId` → JSON `id` explicitly; emitted JSON shape is unchanged from 0.9.x.
- **Migration for embedders** who provided custom Registry / Executor / ModuleDescriptor shims to `createCli()`:
  ```ts
  // Before (0.9.x):
  const registry = { listModules: () => mods, getModule: (id) => mods.find(m => m.id === id) ?? null };
  const executor = { execute: (id, input) => myInvoke(id, input) };
  const mod = { id: "math.add", name: "math.add", description: "Add" };
  // After (0.10.0):
  const registry = { list: () => mods.map(m => m.moduleId), getDefinition: (id) => mods.find(m => m.moduleId === id) ?? null };
  const executor = { call: (id, input) => myInvoke(id, input) };
  const mod = { moduleId: "math.add", name: "math.add", description: "Add" };
  ```
  Embedders using apcore-js's own `Registry` / `Executor` (the common case via `APCore` client) need no code change — those instances and their descriptors already satisfy the new shim shape verbatim.

## [0.9.1] - 2026-05-13

### Fixed

- **Pre-execute schema validation missing in `buildModuleCommand`** — before calling `executor.execute()`, the CLI now validates the merged input against the module's JSON Schema (required fields + scalar types). Previously, a missing required field (e.g. `--url` not supplied) propagated as `undefined` into the executor and produced an opaque `TypeError`. Now exits 45 with a human-readable message (`Validation failed: 'url' is required`) matching Python's `jsonschema.validate` and Rust's `validate_against_schema` pre-execute behaviour. Validation is skipped in `--dry-run` mode (executor preflight handles that path). `src/main.ts:177-208` (`validateInputSchema`), call site `src/main.ts:1127-1133`.
- **`SchemaValidationError` emitted `"code":"UNKNOWN"` in JSON error output** — `emitErrorJson` reads `err.code` to populate the `"code"` field; `SchemaValidationError` had no `.code` property, so exit-45 validation errors always emitted `"code":"UNKNOWN"`. Added `readonly code = "SCHEMA_VALIDATION_ERROR"` to the class. `src/errors.ts:52`.

### Changed

- **Step comment numbering in `buildModuleCommand` action handler corrected** — inserting the schema-validation step left two "3." labels in the try block. Renumbered: 3 = schema validation, 4 = check approval, 5 = execute, 6 = format, 7 = audit. `src/main.ts`.

### Tests

- Renamed test 4 in the pre-execute schema-validation suite from `"exits 45 with type error message when field has wrong type"` (which actually tested the required-field path) to `"exits 45 when required field is missing (integer schema)"`.
- Added test 5: `"exits 45 with type-mismatch message when integer field receives string via --input"` — supplies `{"count":"not-a-number"}` via `--input <file>` to exercise the scalar type-check branch (`validateInputSchema` lines 198-206) that had zero coverage.

---

## [0.9.0] - 2026-05-13

### Fixed (2026-05-13 — cross-SDK audit D10/D11/D1)

- **`ConfigEncryptor` LOGNAME key-derivation chain** (D10-001) — PBKDF2 username fallback was `USER → USERNAME → "unknown"` (3-tier); now `USER → LOGNAME → USERNAME → "unknown"` (4-tier) matching the spec and Rust. `src/security/config-encryptor.ts:183, 219`.
- **Sandbox stdin write lacks `'error'` listener** (D11-008) — `child.stdin.on('error', () => {})` added before `write()` so an EPIPE event from a child that exits early no longer surfaces as an uncaught exception. `src/security/sandbox.ts:153`.
- **`buildSandboxEnv` drops explicitly-empty env values** (D11-009) — `if (process.env[key])` changed to `if (process.env[key] !== undefined)` so `PATH=""` is forwarded uniformly with Python and Rust. `src/security/sandbox.ts:264`.
- **`exec --trace` flag ignored when used without `--strategy`** (D11-011) — condition `if (opts.strategy && executor.callWithTrace)` changed to `if ((opts.trace || opts.strategy) && executor.callWithTrace)`. `--trace` alone now routes through `callWithTrace` matching Python. `src/discovery.ts:345`.
- **CLI brand string in auth error messages** (D11-006) — remediation strings now say `apcli config set auth.api_key` (canonical FE-13 name). `src/security/auth.ts:46`.
- **`requestApproval` missing `requires_approval=false` short-circuit** (D11-014) — returns `approved/not_required` when the request explicitly carries `requires_approval: false`, matching Rust. `src/approval.ts:63`.
- **`AuthProvider` missing `config.encryptor` peer-attribute fallback** (D11-005) — `getEncryptor()` now walks explicit constructor arg → `config.encryptor` peer attribute → fresh instance, matching Python's three-tier chain. `src/security/auth.ts:22`.
- **`APCLI_SUBCOMMAND_NAMES` and `DEFAULT_BUILTIN_GROUP_NAME` not re-exported** (D1 re-audit) — both constants added to `src/index.ts:27` export block. Python and Rust already re-exported both.
- **Standalone bin entrypoint used deprecated `verbose:` field internally** (D9 re-audit) — `src/main.ts:848` `createCli` call now passes canonical `allOptions: verboseHelp`.
- **Stale `cli.ts` placeholder-type TODO** (D9-W2) — TODO comment updated to document the actual `apcore-js` Registry/ModuleDescriptor shape gap (method names diverge: `listModules`/`getModule` vs `list`/`getDefinition`/`moduleId`), replacing the generic "until available" wording.

### Added

- **`CreateCliOptions.allOptions` field** (D1-W5) — canonical successor to the deprecated `verbose` field. Embedders should migrate `createCli({ verbose: true })` → `createCli({ allOptions: true })`. `verbose` remains for backward compat through v0.9 and will be removed in v0.10. `src/main.ts:251`.
- **`setLogLevel` / `getLogLevel` documented as intentionally TS-only** (D1-W4) — `src/index.ts:96-102` now carries a cross-SDK parity note explaining that Python and Rust delegate to their native logging channels.
- **`getAuditLogger` documented as intentionally TS-only** (D1 re-audit) — `src/index.ts:106` now carries a note. Only the setter (`setAuditLogger`) is the canonical cross-SDK API.

### Fixed

- **CSV `--format csv` heterogeneous-keys data loss** — `formatExecResult` previously derived CSV headers from `Object.keys(rows[0])` only, silently dropping fields that first appeared in later rows. Surfaced via aisee-cli's `summarizeAction()` which emits optional `description` / `solution` fields. The header is now the **union of keys across all rows** in insertion-order. `src/output.ts:340-357`.
- **CSV line terminator** — now `\r\n` per RFC 4180 (was `\n`). Existing Excel + downstream-parser compatibility improves significantly.
- **CSV nested-value serialization** — now goes through the toolkit's canonical JSON encoder (compact, insertion-order, unicode-preserved). Behavior was already correct via `JSON.stringify`, but the contract is now enforced at the toolkit layer.

### Changed

- **User-visible help/man/completion/error text no longer leaks the `apcore` / `apcore-js` framework name** to end users of downstream CLIs built on apcore-cli. Affected strings: footer hint (`Use --verbose to show all options (including built-in apcore options)` → `… (including built-in options)`, `src/main.ts:947`), `init` group description (`Scaffold new apcore modules` → `Scaffold new modules`, `src/init-cmd.ts:82`), top-level CLI description (`… execute apcore modules from the command line` → `… execute modules from the command line`, `src/main.ts:835`), standalone unwired-registry error message (`Error: no apcore-js registry wired.` → `Error: no module registry wired.`, `src/main.ts:619`), and man-page `ENVIRONMENT` text (`Path to the apcore extensions directory.` → `Path to the extensions directory.`, `src/shell.ts:302`). README's `--verbose` row updated to match. Two `tests/main.test.ts` assertions (`:891`, `:916`) updated to the new error string. Logger names, source comments, type comments, and environment-variable identifiers (`APCORE_*`) are unchanged — only descriptive copy that appears in `--help`, shell completion, `man` output, or user-facing error messages. Cross-SDK parity with Python 0.8.1 and Rust 0.8.1.

### Changed (breaking CLI surface)

- **Global `--verbose` flag renamed to `--all-options`** — The help-display flag is now `--all-options`; use `apcore-cli module --help --all-options` to reveal hidden built-in options. `verbose` is removed from the reserved schema property names set — module schemas may now freely define `verbose: boolean` for runtime output control. Tracked in [apcore-cli#21](https://github.com/aiperceivable/apcore-cli/issues/21).

### Changed (breaking peer-dep semantics)

- **`apcore-toolkit` promoted from optional to REQUIRED peer dependency** (`>=0.7.0`). All `--format` operations now go through the toolkit's reference implementation for csv/jsonl/markdown/skill (was only markdown/skill). Consumers that did not install the optional peer must add it. `package.json` peer-dependency-meta `optional: true` removed.

### Removed

- `csvCellString` and `escapeCsvField` private helpers — replaced by `apcore_toolkit.formatCsv()` and the toolkit's RFC 4180 internals.

### Why

Per-SDK CSV reimplementations had accumulated divergence: Python emitted Python repr `{'k': 'v'}`, TS dropped heterogeneous keys, Rust used `\n` not CRLF. The spec MUST language couldn't enforce conformance on downstream consumers (e.g. aisee-cli) that reimplemented. See ADR-09 in `apcore-cli/docs/tech-design.md` for the byte-equivalent vs SDK-native tier split.

### Migration

Downstream consumers using only `json` / `table` formats are unaffected at runtime but need `apcore-toolkit@^0.7` installed alongside `apcore-cli@^0.9` (previously optional). aisee-cli and similar adapters get the CSV bug fix automatically on upgrade.


## [0.8.1] - 2026-05-09

### Fixed

- **Init-time deadlock under Bun (`src/security/sandbox.ts`).** The
  sandbox runner's 5 `await import('node:child_process|os|path|fs')`
  calls were hoisted to static `import` statements at the top of
  `sandbox.ts`. The dynamic-import pattern was a holdover from when
  apcore-cli targeted both Node and browser; the CLI is Node-only by
  nature (`#!/usr/bin/env node`, `process.argv[1]` re-exec, child-
  process spawning), so deferring the imports added no value and
  contributed to the Bun deadlock chain when the CLI was loaded via
  `bun run dist/bin/apcore-cli.js`. Verified end-to-end on Bun 1.3.13:
  `--version` returns in 108 ms (was: indefinite hang on Bun 1.2.x).
  No public API change.
- **C-SNAKE/1 — schema kwargs forwarded under commander's camelCase keys instead of the schema's snake_case property names** (`src/main.ts:985-998`). Commander stores parsed flag values under camelCased attribute names (`--has-solution` → `options.hasSolution`); the action handler previously passed `Object.entries(options)` straight into `schemaKwargs`, so modules reading `input["has_solution"]` always saw `undefined`. Single-word flags (`--module`, `--page`) coincidentally worked because their camelCase form matches the schema name. Multi-word fields (`has_solution`, `sort_by`, `sort_order`) were silently dropped. The fix iterates `schemaOptions` and writes each value back under its original `propName`, matching Python click's auto-derived parameter name and Rust clap's explicit `Arg::new(prop_name)` semantics. Cross-SDK parity restored.
- **C-SNAKE/2 — boolean `--flag/--no-flag` pair was registered as a single comma-combined commander option** (`src/main.ts:957-975`). The schema-parser produced `flags: "--<flag>, --no-<flag>"` and the registration loop forwarded that string to `cmd.option(...)`. Commander does not parse the comma form the way Python click's `--flag/--no-flag` does — it routes both forms to the negated attribute and stores `false` for both, so `--has-solution` did not flip the value to `true`. Boolean schema flags now register as two separate `Option`s (`--<flag>` carrying the schema default + help, plus a hidden `--no-<flag>` companion); commander's auto-negation routes both to the same camelCase attribute and applies the correct value.

### Added

- **`tests/conformance/snake-case-kwargs.test.ts`** — runs the cross-language Algorithm C-SNAKE fixture (`apcore-cli/conformance/fixtures/snake-case-kwargs/cases.json`) against `buildModuleCommand`. Five cases cover positive flag, negation, default fallback, snake_case string flags, and a multi-flag combination. The same fixture is consumed verbatim by the Python and Rust SDK runners.


## [0.8.0] - 2026-05-08

### Security

- **D11-008 — `AuditLogger.getUser` now includes `LOGNAME` in the env-var fallback chain** (`src/security/audit.ts:138`). The canonical user-resolution chain per spec `security.md` is `getlogin → pwd.getpwuid(getuid).pw_name → USER → LOGNAME → USERNAME → unknown`. The TS port collapsed the first two POSIX steps via `os.userInfo()` (correct) but then jumped from `USER` straight to `USERNAME`, dropping `LOGNAME`. On systems where only `LOGNAME` is set (some CI runners), audit entries fell through to `USERNAME` or `"unknown"` while Python/Rust/Go correctly resolved to `LOGNAME` — a cross-SDK divergence affecting the audit trail's user attribution. Fix inserts `process.env.LOGNAME` between `USER` and `USERNAME`.

### Removed (BREAKING)

- **D9-002 — root-level deprecation shims removed (FE-13 §11.3).** Pre-v0.8
  `createCli()` registered 13 hidden root-level commands (`list`, `describe`,
  `exec`, `init`, `validate`, `health`, `usage`, `enable`, `disable`,
  `reload`, `config`, `completion`, `describe-pipeline`) that printed a
  `WARNING: '<name>' as a root-level command is deprecated. ... Will be
  removed in v0.8` line on stderr and forwarded to `apcli <name>`. Per
  PROTOCOL_SPEC FE-13 §11.3 these shims are removed in v0.8 — the `apcli`
  sub-group (or the renamed `builtinGroupName`) is now the only path to
  built-in commands. Internal `_DEPRECATED_ROOT_COMMANDS`,
  `_registerDeprecationShims`, `_collectShimForwardArgs`, and the
  `__isDeprecationShim` collision-detection branch in `createCli`'s
  `extraCommands` handler are deleted.
- **D9-W1 — raw mutable bindings `verboseHelp` / `docsUrl` no longer exported** from `src/main.ts:50,58`. The setter pair `setVerboseHelp` / `setDocsUrl` is the sanctioned API and remains exported. Mutable `let` exports are brittle as a public surface (live-binding semantics depend on the importer's bundler) and no embedder imports the raw bindings; the public surface now only includes the setters.
- **D9-W2 — `emitErrorJson` / `emitErrorTty` no longer exported** from `src/main.ts:158,180` and dropped from the `src/index.ts` public re-export list. Both are only consumed inside `main.ts` (`buildModuleCommand` action handler). Now annotated `@internal`.

### Added

- **`builtinGroupName?: string` option on `createCli`** — downstream branded CLIs that embed apcore-cli can now expose the built-in commands under a custom namespace (e.g. `mycorp-cli admin health` instead of `mycorp-cli apcli health`). `ApcliGroup` gains a `name` getter and the constructor option is threaded through `fromCliConfig` / `fromYaml` / `tryFromYaml` / `_build`. Default `"apcli"` is unchanged. Validated against `/^[a-z][a-z0-9_-]*$/`; invalid values exit 2. Two new module-level accessors `getReservedGroupNames()` / `setReservedGroupNames()` expose the live reserved-set so `cli.ts`'s `assertNotReserved` and `listCommands` honour the renamed group. Env var `APCORE_CLI_APCLI` and config keys `apcli.*` deliberately do NOT rename — they are apcore-cli-internal toggles, not user-facing. Cross-SDK parity with Python `create_cli(builtin_group_name=...)`. New `DEFAULT_BUILTIN_GROUP_NAME` constant exported from `./builtin-group.js`.
- **Client-side approval gate for `apcli enable / disable / reload / config set`** — new `requireApprovalForSystemCommand(moduleId, autoApprove)` helper in `src/system-cmd.ts` synthesises a minimal `ModuleDescriptor` with `annotations.requires_approval = true` and invokes `checkApproval(...)` before dispatching the executor call. `ApprovalDeniedError` / `ApprovalTimeoutError` propagate to `emitErrorAndExit` which maps them to exit 46 via `exitCodeForError`. `apcli config set` gains a `-y, --yes` flag for parity with the other three. Mirrors Python `_check_system_approval` and Rust `require_approval_for_system_command`. Audit D11-B-001 (see Fixed).
- **14 new tests in `tests/builtin-group.test.ts`** — `ApcliGroup builtin-group rename` describe block covers default name, custom name via both factories, validation of 6 invalid + 5 valid name shapes.
- **5 new tests in `tests/system-cmd.test.ts`** — `client-side approval gate (D11-B-001)` describe block covers `enable / disable / reload / config set` deny path on non-TTY without `--yes` (exit 46 + executor never called) and the `--yes` bypass.
- **D1-info-1 — `ApcliGroupError` typed exception** (`src/builtin-group.ts:101`, re-exported from `src/index.ts`) for cross-SDK error-class parity with Rust (`apcore_cli::ApcliGroupError`, re-exported at `lib.rs:183`). The previous plain `Error` throw on invalid `builtinGroupName` gave consumers no programmatic way to discriminate apcli config errors from generic ones. Existing `catch (e) { if (e instanceof Error) ... }` blocks continue to work; new code can use `instanceof ApcliGroupError`. The neighbouring throw at `builtin-group.ts:464` (caller-bug guard for `isSubcommandIncluded` invoked under wrong mode) stays as plain `Error` — out of scope for apcli config validation.
- **D1-004 — `Sandbox` builder methods `withExtensionsRoot` and `withMaxOutputBytes`** (`src/security/sandbox.ts`). Cross-SDK parity with Python `with_extensions_root` / `with_max_output_bytes` and the new Rust builders. Both fields drive runtime behaviour: `extensions_root` takes precedence over inherited `APCORE_EXTENSIONS_ROOT`, `max_output_bytes` replaces the per-stream output cap. The "future builder (Python parity)" comment at `sandbox.ts:77` is removed.
- **D1-006 — `allowedPrefixes?: string[]` option on `CreateCliOptions`** plumbed through `createCli → applyToolkitIntegration → loadBindingDisplayOverlay` so non-allowlisted `target:` entries are dropped before they pollute the display map. Mirrors Python `factory.py:78 allowed_prefixes` safety knob. New `ApplyToolkitIntegrationOptions` type exported.
- **D1-007 — `formatModuleList`, `formatModuleDetail`, `resolveFormat` re-exported from `src/index.ts`** alongside `formatExecResult`. The output-formatter feature spec declares contracts for all four; embedders building custom output paths can now consume the canonical formatters from the package root.
- **D5-003 — dedicated `tests/system-usage.test.ts`** covering the new `src/system-usage.ts` aggregator (period filtering, per-module aggregates, missing-audit-log fallback) — previously coverage for the aggregator was only incidental via the discovery-layer integration tests.

### Fixed

- **D11-B-001 — `system-cmd.ts` skipped the client-side approval gate entirely**. Each of the four mutating subcommands (`enable`, `disable`, `reload`, `config set`) declared `--yes` but never read it; no `checkApproval(...)` call existed in the file. Operators on Python or Rust SDKs got an interactive 60s confirmation prompt; TS users got nothing — server-side enforcement was the only gate, and the `--yes` flag was completely dead. Fix wires `requireApprovalForSystemCommand(moduleId, opts.yes)` into all four action handlers (see Added). Description text updated from "Signal explicit intent (forwarded to server-side approval gate)" to "Skip approval prompt" — the original copy was misleading because nothing was actually forwarded.
- **D11-NEW-005 — TS RESERVED_NAMES exit code was 2, not 48**. `schema-parser.ts:101` previously called `process.exit(EXIT_CODES.INVALID_CLI_INPUT)` (=2) when a schema property collided with a reserved CLI option name. Spec mandates exit 48 (cross-SDK parity with Python `sys.exit(48)` and Rust `CliError::SchemaParserFailure → EXIT_SCHEMA_CIRCULAR_REF`). Fix changes to `EXIT_CODES.SCHEMA_CIRCULAR_REF`. The neighbour flag-collision branch already exited 48; both schema-author errors are now consistent. 6 existing tests updated from "exits 2" assertions to "exits 48".
- **D11-NEW-001 — `resolveRefs` dropped parent `required` when resolving `anyOf` / `oneOf` branches**. A schema like `{required: ["x"], anyOf: [{required: ["a"]}, {required: ["a"]}]}` resolved to `required: ["a"]` in TS — silently losing `"x"`. Per JSON Schema semantics, `parent.required` applies in addition to the branch intersection. Branch handling now preserves the parent node's `required` field (deduplicated, sibling-first ordering). Aligned with Python `ref_resolver.py:100-118`; Rust got the same fix in a sibling commit. 4 new ref-resolver regression tests.
- **D11-NEW-003 — `max_depth` over-counted plain nested-object recursion**. Previously a schema with >32 levels of nested object `properties` (no `$refs`) was rejected; the depth budget should only count `$ref` hops + composition-branch descents, not pure structural recursion. Aligned with Rust's interpretation of the spec ("Maximum $ref resolution recursion depth").
- **D11-NEW-004 — `schema_to_cli_options` flag-collision sites exited 2, not 48**. The two flag-collision sites in `src/schema-parser.ts` (regular flag collision, no-flag collision) previously exited 2 (`INVALID_CLI_INPUT`) instead of 48 (`SCHEMA_CIRCULAR_REF`) — observable: a CI / embedder checking `$? == 48` to detect schema-related failures missed the TS path. Fix matches Python `sys.exit(48)`. 2 updated schema-parser collision tests.
- **D11-W4 — `schema_to_cli_options` did not warn on `required` entries missing from `properties`** (`src/schema-parser.ts:81`). Python (`schema_parser.py:93-98`) and Rust (`schema_parser.rs:220-228`) iterate the schema `required` list and warn for entries not present in `properties`. The TS SDK skipped that loop, so schemas like `{required: ["foo"]}` with no matching property parsed silently — schema authors lost the cross-SDK guard rail. Now emits the same warning text as Python: `Required property '%s' not found in properties, skipping.` 3 new regression tests cover missing-only, all-present, and multiple-missing cases.
- **D10-info-1 — `APCORE_CLI_APCLI` env-var parser did not trim** (`src/builtin-group.ts:488`). Per spec invariant 2 in `features/builtin-group.md`, the parser is case-insensitive AND trim-on-read. The TS port lowercased but skipped the trim, so values like `"  show  "` or `"\thide\n"` silently fell through to the unknown-value warning branch — diverging from Python and Rust. Fix adds `.trim()` before `.toLowerCase()` and short-circuits to `null` when the trimmed value is empty (all-whitespace env is now treated as unset without emitting a warning, matching empty-string handling).

### Changed

- **`vitest.config.ts` `coverage.thresholds`** added — `lines / functions / statements: 85`, `branches: 75`. Cross-SDK CI parity with Python `pyproject.toml [tool.coverage.report] fail_under = 85` and Rust `make coverage --fail-under-lines 85`. Audit D5-004.

- **D8-W2 — `validateModuleId` extracted to dedicated `src/validate.ts`** for parallel-layout parity with Python (`apcore_cli/validate.py`) and Rust (`src/validate.rs`). Embedders reading multiple SDKs side-by-side previously had to grep for the helper inside `main.ts`. The existing import path is preserved via re-export from `main.ts`, so `discovery.ts` and tests need no changes. Adds an exported `MAX_MODULE_ID_LENGTH` constant for spec parity.

- **D1-W4 — `formatPreflightResult` / `firstFailedExitCode` annotated `@internal`** (`src/output.ts:406`). Both stay `export`ed because `main.ts` and `discovery.ts` import them across module boundaries, but they are not re-exported from `index.ts` and have no documented embedder use case. The `@internal` JSDoc tag now matches the import-graph reality so doc generators and human readers see they are not part of the package's stable API.

- **D6-TS-info — `@sinclair/typebox` ^0.32 → ^0.34** (`package.json:41`, resolves to 0.34.48). Cross-SDK dependency hygiene: Rust and Python pulled their matching schema-validation deps to current minors months ago; TS was the laggard. The only usage is the stable `Type.*` builder facade in `src/init-cmd.ts` (`Type.Object` / `Type.Array` / `Type.Optional` / `Type.String` / `Type.Number` / `Type.Boolean`), all of which are identical between 0.32 and 0.34 — no source changes required.

- **D6-001 — `apcore-toolkit` devDependency switched from local `link:` path to registry version `^0.6.0`**. The previous entry pointed at a developer's absolute local clone, which broke `pnpm install` for any other contributor. Clean clones now resolve `apcore-toolkit` identically to the peer-dependency declaration (`>=0.6.0`).

- **`apcli list` and `apcli describe` `--format` choices** are now validated
  via Commander's `Option.choices(...)` against the canonical set
  `[table, json, csv, yaml, jsonl, markdown, skill]`. Unknown values exit
  with code 2 instead of silently no-op'ing. Issue
  [aiperceivable/apcore-cli#20](https://github.com/aiperceivable/apcore-cli/issues/20).
- **Dependency bump**: peer-dep `apcore-js >= 0.21.0` (was `>= 0.19.0`) and the
  optional `apcore-toolkit >= 0.6.0` (was `>= 0.5.0`). Aligns with upstream
  `apcore 0.21.0` (Module.preview / PreflightResult.predicted_changes) and
  `apcore-toolkit 0.6.0` (surface-aware formatters).
- **Issue #19 — drop "apcore" branding from embedded-mode `--help`**: top-level
  CLI description now resolves from a new `description?: string` field on
  `CreateCliOptions` (defaults to `${progName} CLI`); the `apcli` subgroup
  description is now `Built-in commands` instead of `apcore-cli built-in
  commands`; `--verbose` option text and the help footer drop the trailing
  `apcore` from `(including built-in apcore options)`. Standalone bin entry
  (`bin/apcore-cli.ts → main()`) passes `description="<prog> — execute apcore
  modules from the command line"` explicitly so the standalone surface is
  unchanged.
- **Conformance fixtures (`aiperceivable/apcore-cli/conformance/fixtures/apcli-visibility/`)**
  refreshed to match the new debranded help output and to forward `version` /
  `description` from the fixture inputs through `captureHelp()`.

### Added

- **`--format markdown` and `--format skill`** for `apcli list` and `apcli describe`
  (issue [aiperceivable/apcore-cli#20](https://github.com/aiperceivable/apcore-cli/issues/20)).
  Both delegate to `apcore-toolkit` (`formatModule` / `formatModules`, peer dep
  ≥0.6) so the output is byte-identical to the same toolkit call in the Python
  and Rust SDKs. `--format skill` emits vendor-neutral SKILL.md content
  directly loadable by Claude Code (`.claude/skills/<id>/SKILL.md`) and
  Gemini CLI (`.gemini/skills/<id>/SKILL.md`):

  ```bash
  apcore-cli apcli describe users.create --format skill > .claude/skills/users.create/SKILL.md
  ```

  A new internal adapter `descriptorToScanned()` maps `ModuleDescriptor`
  to the toolkit's `ScannedModule`. The `formatModuleList` and
  `formatModuleDetail` functions are now `async` to support the dynamic
  toolkit import (the existing five-format paths remain effectively
  synchronous and complete before the returned promise resolves).
- **Issue #18 — host-app `--version` opt-in**: new `version?: string` field on
  `CreateCliOptions`. When supplied, registers `-V/--version` with the host's
  version string. **When omitted, the `--version` flag is no longer registered**
  — embedded CLIs that do not opt in stop leaking the SDK's own version. The
  standalone bin entry passes `version: VERSION` (the SDK package version)
  explicitly so the `apcore-cli` binary's behaviour is preserved. The
  `configureManHelp(...)` man-page generator falls back to the SDK version
  when the host does not supply one, so manpages always carry a version stamp.
- **Issue #19 — `description?: string`** on `CreateCliOptions`.
- **Issue #17 — `system.usage` aggregator + `list --sort calls|errors|latency`**:
  new module `src/system-usage.ts` reads `~/.apcore-cli/audit.jsonl`, filters
  by period (default 24h), and returns per-module aggregates (`calls`,
  `errors`, `avg latency_ms`). `list --sort {calls,errors,latency}` now
  consults the aggregator instead of falling back to id-sort with a buried
  `process.stderr.write("Warning: ...")`. When the audit log has no entries
  in the period window the discovery layer prints a user-visible note to
  stderr (`note: no usage data available for --sort <field>; sorted by id.
  ...`) and falls back to id-sort. Module-protocol registration of
  `system.usage.summary` / `system.usage.module` as registry-callable
  built-ins is tracked as a follow-up — today the readers are invoked
  directly by the discovery layer.
- New file: `src/system-usage.ts`.

---

## [0.7.0] - 2026-04-25

### Added

- **Canonical clap v4 / GNU-style help formatter** (`src/canonical-help.ts`) overriding Commander's default `formatHelp` so `--help` output is byte-stable across SDK implementations. Disables terminal-width wrapping, uppercases `<PLACEHOLDER>`s, enforces `Commands:` before `Options:`, and renders `-h, --help` / `-V, --version` last with `Print help` / `Print version` descriptions.
- **Cross-language conformance test harness** (`tests/conformance/apcli-visibility.test.ts`) now consumes the shared fixtures from the `aiperceivable/apcore-cli` spec repo (`conformance/fixtures/apcli-visibility/`). Dynamically discovers scenarios and byte-matches `--help` output against each `expected_help.txt`. Set `APCORE_CLI_SPEC_REPO` to point at a non-sibling checkout; defaults to `../apcore-cli/`.
- **CI — spec-repo checkout**: `.github/workflows/ci.yml` now checks out `aiperceivable/apcore-cli` into `.apcore-cli-spec/` and exposes it to `pnpm test` via `APCORE_CLI_SPEC_REPO`.
- **FE-13: Built-in command group (`apcli`)** — consolidates the 13 canonical built-in commands (`list`, `describe`, `exec`, `validate`, `init`, `health`, `usage`, `enable`, `disable`, `reload`, `config`, `completion`, `describe-pipeline`) under a single `apcli` sub-group. Invocation shifts from `<cli> list` to `<cli> apcli list`.
  - `ApcliGroup` class + `ApcliConfig` / `ApcliMode` types, exported from `src/index.ts`.
  - `RESERVED_GROUP_NAMES = new Set(["apcli"])` as the enforced collision surface (replaces the retired per-command `BUILTIN_COMMANDS` constant).
  - New env var `APCORE_CLI_APCLI` — accepts `show`, `hide`, `1`, `0`, `true`, `false` (case-insensitive).
  - New config keys (snake_case DEFAULTS): `apcli.mode`, `apcli.include`, `apcli.exclude`, `apcli.disable_env`.
  - `ConfigResolver.resolveObject(key)` — non-leaf accessor that returns object-shaped config values without flattening.
  - `createCli({ apcli })` option — accepts `boolean | object | ApcliGroup` to configure the built-in group surface.
  - See [migration guide](../apcore-cli/docs/features/builtin-group.md#11-migration) for the full v0.7 → v0.8 timeline.
- **New error-code → exit-code mappings** in `src/errors.ts` and `src/main.ts`: `DEPENDENCY_NOT_FOUND` and `DEPENDENCY_VERSION_MISMATCH` both map to exit code 44. Preserves the pre-0.19.0 exit code (`MODULE_LOAD_ERROR` = 44) for missing / version-mismatched module dependencies, now that apcore-js surfaces these through dedicated error types per PROTOCOL_SPEC §5.15.2.
- **Binding-overlay tests** in `tests/display-helpers.test.ts`: a tmp binding YAML is written, `applyToolkitIntegration` is called, and `getDisplay()` is verified to return the overlay for a descriptor that has no baked-in `metadata.display`.
- **`createCli({ app })` — `APCore` unified client**: `CreateCliOptions` now accepts an `app?: APCore` field. When provided, `app.registry` and `app.executor` are extracted and used in place of explicit `registry`/`executor` fields. Passing `app` together with `registry` or `executor` throws `"app is mutually exclusive with registry/executor"`.
- `APCore` interface exported from package index. `StrategyInfo` and `StrategyStep` interfaces exported from package index.
- `Executor` interface extended with optional `describePipeline(strategyName?: string): StrategyInfo` and `strategy?: { steps: StrategyStep[] }` fields.
- **FE-12: Module Exposure Filtering** — Declarative control over which discovered modules are exposed as CLI commands.
  - `ExposureFilter` class in `exposure.ts` with `isExposed(moduleId)` and `filterModules(ids)` methods.
  - Three modes: `all` (default), `include` (whitelist), `exclude` (blacklist) with glob-pattern matching.
  - `ExposureFilter.fromConfig(obj)` static method for loading from `apcore.yaml` `expose` section.
  - `CreateCliOptions.expose` field accepting object or `ExposureFilter` instance.
  - `list --exposure {exposed,hidden,all}` filter flag in discovery commands.
  - `GroupedModuleGroup` integration: applies exposure filter during command registration.
  - `ConfigResolver` gains `expose.*` config keys.
  - 4-tier config precedence: `CreateCliOptions.expose` > `--expose-mode` CLI flag > env var > `apcore.yaml`.
  - Hidden modules remain invocable via `exec <module_id>`.
- New file: `exposure.ts`.

### Changed

- Built-in commands now live under the `apcli` sub-group. Pre-v0.7 invocations (`<cli> list`, `<cli> describe`, etc.) still work in **standalone mode** via deprecation shims that print a `WARNING` to stderr and forward to `apcli <name>`. Shims are not installed in embedded mode.
- Discovery flags (`--extensions-dir`, `--commands-dir`, `--binding`) are now gated on standalone mode — they are only registered when no `registry` is injected.
- Shell-completion generators (bash/zsh/fish) enumerate registered Commander subcommands dynamically; hardcoded command lists are gone.
- **Dependency bump**: requires `apcore-js >= 0.19.0` (was `>= 0.18.0`) and `apcore-toolkit >= 0.5.0` (was `>= 0.4.0`). Aligns with upstream releases `apcore-js 0.19.0` (dependency graph errors, async `buildStrategyFromConfig`, auto-schema adapter chain, `BindingSchemaMissingError` rename) and `apcore-toolkit 0.5.0` (`BindingLoader`, `ScannedModule.display`, `apcore-toolkit/browser` subpath).
- **Placeholder types in `src/cli.ts` realigned with real apcore-js shapes.** `PipelineTrace` / `StepTrace` / `PreflightResult` / `StrategyStep` now use camelCase (`strategyName`, `totalDurationMs`, `durationMs`, `skipReason`, `requiresApproval`, `timeoutMs`) matching the apcore-js runtime object shape. `Executor.describePipeline` is typed as `(): StrategyInfo` (zero arguments — the previous `describePipeline?(strategyName?: string)` signature declared an argument that the real apcore-js method ignores). `Executor.strategy` renamed to `Executor.currentStrategy` to match the upstream getter.
- **`--trace` output now reads the correct runtime fields.** `main.ts` previously read `trace.strategy_name` / `trace.total_duration_ms` / `s.duration_ms` / `s.skip_reason` (snake_case) from the camelCase `PipelineTrace` returned by apcore-js, so those values surfaced as `undefined` at runtime. Now reads `strategyName` / `totalDurationMs` / `durationMs` / `skipReason` correctly. JSON output keys remain snake_case to preserve the cross-language CLI output contract.
- **`formatPreflightResult` now reads `result.requiresApproval`** (was `result.requires_approval`). The JSON output key remains `requires_approval`.
- **`MAX_MODULE_ID_LENGTH` 128 → 192**: `validateModuleId()` now enforces a 192-character limit for module IDs, up from 128, to accommodate Java/.NET deep-namespace FQN-derived IDs (PROTOCOL_SPEC §2.7 spec 1.6.0-draft).
- **`Executor.describePipeline()` returns `StrategyInfo`**: `describe-pipeline` command in `strategy.ts` now calls `executor.describePipeline(strategyName)` and consumes the returned `StrategyInfo` object (`name`, `stepCount`, `stepNames`, `description`). Pipeline header format updated to `Pipeline: ${info.name} (${info.stepCount} steps)`. Step metadata (Pure/Removable/Timeout columns) sourced from `executor.strategy.steps` (`pure: boolean`, `removable: boolean`, `timeoutMs: number`). Falls back to static preset table when `describePipeline` is not available.

### Deprecated

- Root-level v0.6 built-in commands continue to work in standalone mode but emit a `WARNING` and forward to `apcli <name>`. **Scheduled for removal in v0.8.**

### Removed

- The per-command `BUILTIN_COMMANDS` constant and its re-export from `src/index.ts`. Replaced by `RESERVED_GROUP_NAMES`.
- Monolithic registrars `registerDiscoveryCommands`, `registerSystemCommands`, `registerShellCommands` — replaced by per-subcommand exports invoked through `ApcliGroup`.

### Fixed

- **`describe-pipeline --strategy <name>` now works for non-current strategies.** Previously the command called `executor.describePipeline(strategyName)` — the real apcore-js signature takes no arguments and always returns info for the executor's *current* strategy, so all `--strategy` values produced identical output. `src/strategy.ts` now uses a two-step lookup: if the requested name matches the current strategy, use `describePipeline()`; otherwise fall back to the static `Executor.listStrategies()` (reached via `executor.constructor.listStrategies`) to introspect other registered strategies.
- **`--binding <path>` flag now actually applies display overlay.** `applyToolkitIntegration` previously instantiated a `DisplayResolver` and discarded it. The implementation now uses apcore-toolkit 0.5.0's `BindingLoader` + `DisplayResolver` pipeline to parse the binding YAML, resolve the sparse overlay, and populate a module-level binding display map. `display-helpers.ts#getDisplay` consults the map as a fallback when the descriptor itself has no `metadata.display`, so `cli.alias` / `cli.description` / tags from `.binding.yaml` are now honored by `list`, `describe`, and command help output. New exports: `lookupBindingDisplay(moduleId)` and `clearBindingDisplayMap()` from `src/main.ts`.

### Breaking

- Reserved-name enforcement is now a **hard exit 2** when a module's explicit group, auto-group prefix, or top-level name/alias equals `apcli`. Previously this was warn-and-drop.

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
