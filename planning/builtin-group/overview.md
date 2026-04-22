# Feature Overview: Built-in Command Group (`apcli`) — FE-13

## Overview

Restructure the apcore-cli TypeScript command surface by moving all apcore-cli-provided
commands (`list`, `describe`, `exec`, `init`, `validate`, `health`, `usage`, `enable`,
`disable`, `reload`, `config`, `completion`, `describe-pipeline`) under a single reserved
group named **`apcli`**. The root level retains only meta-flags (`--help`, `--version`,
`--verbose`, `--man`, `--log-level`), the `help` command, and user business modules.

Visibility of the `apcli` group is governed by a 4-tier precedence chain:
`CliConfig.apcli` → `APCORE_CLI_APCLI` env var → `apcore.yaml` → auto-detect by registry
injection. Five modes are supported (`all`, `none`, `include`, `exclude`, plus the internal
`auto` sentinel), with boolean shorthand (`true`/`false`) and a `disableEnv` flag that
severs the env-var override channel for branded-CLI lockdown.

## Scope

### Included

- New `src/builtin-group.ts` with `ApcliGroup` class, `ApcliMode` / `ApcliConfig` types,
  and `RESERVED_GROUP_NAMES` set.
- `ConfigResolver.resolveObject()` — new non-leaf, non-flattened lookup API.
- Per-subcommand registrar split across `discovery.ts`, `system-cmd.ts`, `shell.ts`;
  caller-side reattach for `strategy.ts` and `init-cmd.ts`.
- `createCli()` refactor: build `ApcliGroup`, create hidden-toggleable `apcli` Commander
  sub-group, central `_registerApcliSubcommands` dispatcher with
  `_ALWAYS_REGISTERED = new Set(["exec"])`.
- Discovery flags (`--extensions-dir`, `--commands-dir`, `--binding`) registered only in
  standalone mode.
- Reserved-name enforcement in `GroupedModuleGroup._buildGroupMap` — hard exit 2 on
  reserved `apcli` (group, auto-group, or top-level name).
- Retire `BUILTIN_COMMANDS` constant and its callers; export `ApcliGroup`,
  `RESERVED_GROUP_NAMES`, etc. from `src/index.ts`.
- Standalone-only deprecation shims for v0.6 root-level built-ins (v0.7.x migration).
- Shell completion rewrites: enumerate registered Commander subcommands (fixes draft-v1
  regression where `mode: none` hid reachable commands).
- Cross-language conformance fixtures at `conformance/fixtures/apcli-visibility/` and
  startup-time benchmark (≤5% regression).
- CHANGELOG v0.7.0 entry, README migration callout, CLAUDE.md v0.7.0 Conventions section.

### Excluded

- Retirement of the per-command `builtins: {...}` override surface is implicit (superseded
  by the new namespace) but not tracked as a separate task.
- Go / Rust implementations of FE-13 (cross-language normative references in spec §4.14)
  are out of scope for this TypeScript-only plan.
- Client-side cache invalidation for `completion` regeneration (users re-run
  `<cli> apcli completion <shell>` manually).

## Technology Stack

- **Language / runtime:** TypeScript (strict mode, ESM), Node >= 18.
- **CLI framework:** Commander.js (not Click).
- **Config schema:** `@sinclair/typebox`.
- **YAML parser:** `js-yaml`.
- **Test framework:** vitest (`pnpm test`, `npx vitest run`).
- **Type check:** `npx tsc --noEmit` (zero errors).
- **Package manager:** pnpm.

## Task Execution Order

| # | Task File | Description | Status |
|---|-----------|-------------|--------|
| 1 | [apcli-group-class](./tasks/apcli-group-class.md) | `ApcliGroup` class + types + `RESERVED_GROUP_NAMES` + `APCORE_CLI_APCLI` parser + unit tests | completed |
| 2 | [config-resolve-object](./tasks/config-resolve-object.md) | `ConfigResolver.resolveObject` + `apcli.*` DEFAULTS + namespace registration | completed |
| 3 | [discovery-split](./tasks/discovery-split.md) | Split `registerDiscoveryCommands` into per-subcommand registrars; add `registerExecCommand` | completed |
| 4 | [system-cmd-split](./tasks/system-cmd-split.md) | Split `registerSystemCommands` into 6 registrars sharing a probe helper | completed |
| 5 | [shell-split-and-completion](./tasks/shell-split-and-completion.md) | Split `registerCompletionCommand`; rewrite bash/zsh/fish generators via Commander introspection | completed |
| 6 | [create-cli-integration](./tasks/create-cli-integration.md) | Wire `ApcliGroup` + `_registerApcliSubcommands` table into `createCli`; gate discovery flags; drop `BUILTIN_COMMANDS` | completed |
| 7 | [reserved-name-enforcement](./tasks/reserved-name-enforcement.md) | Hard exit 2 on reserved `apcli` name (group / auto-group / top-level) | completed |
| 8 | [deprecation-shims](./tasks/deprecation-shims.md) | Standalone-mode root-level shims warning + forwarding to `apcli <sub>` | completed |
| 9 | [cross-language-conformance](./tasks/cross-language-conformance.md) | Conformance fixtures (T-APCLI-31) + startup benchmark (T-APCLI-32) | completed |
| 10 | [docs-and-migration](./tasks/docs-and-migration.md) | CHANGELOG + README + CLAUDE.md + purge `BUILTIN_COMMANDS` residue | completed |

## Progress

- Total: **10**
- Completed: **10**
- In progress: **0**
- Pending: **0**

**Final test suite:** 420 passed, 2 pre-existing display-helpers failures (unrelated, present on clean HEAD). `tsc --noEmit` clean. `BUILTIN_COMMANDS` references in `src/`+`tests/` = 0.

**Known partial:** `cross-language-conformance` golden files are TS-self-consistent rather than byte-parity with Python — the Python reference has not yet ported FE-13. Harmonize when upstream ships.

## Reference Documents

- **Primary spec:** [`../apcore-cli/docs/features/builtin-group.md`](../../../apcore-cli/docs/features/builtin-group.md) (FE-13, P0, Breaking Change)
- **Tech design:** §8.2 of `../apcore-cli/docs/tech-design.md`
- **SRS requirements:** FR-DISP-001, FR-DISP-002, FR-DISP-009, FR-DISC-001, NFR-USB-001
- **Related features:** FE-01 Core Dispatcher, FE-04 Discovery, FE-07 Config Resolver, FE-09 Grouped Commands, FE-11 Usability Enhancements, FE-12 Exposure Filtering
- **Project conventions:** `CLAUDE.md` (v0.6.0 Conventions section)
- **Python reference (port source):** `../apcore-cli-python/` — note: FE-13 may not yet be ported upstream; cross-language conformance is partial until it ships
