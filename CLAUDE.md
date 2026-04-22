# CLAUDE.md — apcore-cli-typescript

## Build & Test

- `pnpm test` (or `npx vitest run`) — run all tests. **Must pass before considering any task complete.**
- `pnpm build` — compile TypeScript to `dist/`.
- `npx tsc --noEmit` — type check without emitting.

## Code Style

- TypeScript strict mode with full type coverage.
- All code must pass `tsc --noEmit` with zero errors.
- Use `process.stderr.write()` for error output, `process.stdout.write()` or `console.log()` for normal output.
- Prefer `process.exit(code)` with `EXIT_CODES` constants over throwing for CLI errors.
- camelCase for functions/methods/variables, PascalCase for classes/interfaces/types.

## Project Conventions

- Spec repo (single source of truth): `../apcore-cli/docs/`
- Python reference implementation: `../apcore-cli-python/`
- ESM module (`"type": "module"` in package.json).
- Public API exported from `src/index.ts`.
- CLI framework: Commander.js (not Click or clap).
- DEFAULTS keys use snake_case dot-notation to match spec (e.g., `cli.help_text_max_length`, not `cli.helpTextMaxLength`).
- Security modules live in `src/security/` sub-directory.
- Tests: vitest, files in `tests/*.test.ts`.

## Environment

- Node.js >= 18
- Package manager: pnpm
- Key dependencies: commander, js-yaml, @sinclair/typebox

## v0.6.0 Conventions

- Public surface (src/index.ts): user-facing symbols only. Internals (globMatch,
  formatModuleList, mapType, extractHelp, truncate, LazyModuleGroup,
  applyToolkitIntegration, emitErrorJson/Tty, verboseHelp/docsUrl raw exports, per-level
  logger helpers) are no longer re-exported — import directly from their source modules.
- ExposureFilter + `expose` option on CreateCliOptions (FE-12).
- `extraCommands` field on CreateCliOptions as the FE-11 extension point.
- `commandsDir` / `bindingPath` options for programmatic apcore-toolkit integration
  (mirrors Python create_cli).
- system-cmd module registers runtime system commands (health/usage/enable/disable/
  reload/config) — FE-11.
- strategy module registers describe-pipeline + wires --strategy flag — FE-11.
- validate module registers validate command + --dry-run flag — FE-11.
- Config Bus namespace registration in registerConfigNamespace() at createCli start.
- AuditLogger is wired in createCli via setAuditLogger() at startup (parity with Python).
- Known gap: Registry / ModuleDescriptor types in src/cli.ts are still local
  placeholder interfaces. Their method names (`listModules` / `getModule`) and
  descriptor field name (`id`) do NOT match upstream apcore-js (`list` /
  `getDefinition` / `moduleId`). Users must adapt their real apcore-js registry
  instances to this local shape (or pass wrappers). The Executor placeholder
  and the PipelineTrace / PreflightResult / StrategyStep runtime-read shapes
  were aligned with upstream camelCase in the 0.19.0 upgrade — only the
  Registry / ModuleDescriptor side remains divergent.
- Known gap: Sandbox.execute() throws an informative error when enabled=true —
  subprocess isolation is not yet implemented. Disabled path is a passthrough to
  executor.execute(). See tech-design §8.6.4.
- New env vars (v0.6.0): APCORE_CLI_APPROVAL_TIMEOUT, APCORE_CLI_STRATEGY,
  APCORE_CLI_GROUP_DEPTH.
- New config keys (v0.6.0): cli.approval_timeout, cli.strategy, cli.group_depth.

## v0.7.0 Conventions

- Built-in commands live under the `apcli` sub-group. `RESERVED_GROUP_NAMES
  = {"apcli"}` replaces the retired `BUILTIN_COMMANDS` collision surface
  (src/builtin-group.ts).
- `ApcliGroup` resolves visibility via a 4-tier chain:
  CliConfig > APCORE_CLI_APCLI env > apcore.yaml > auto-detect
  (registryInjected → "none", else "all").
- Discovery flags (`--extensions-dir`, `--commands-dir`, `--binding`) are
  gated on `!registryInjected`.
- v0.7.x ships root-level deprecation shims that warn and forward to
  `apcli <name>` in standalone mode only. Removed in v0.8.
- New env var: `APCORE_CLI_APCLI` (show/hide/1/0/true/false).
- New config keys: `cli.apcli.mode`, `cli.apcli.include`,
  `cli.apcli.exclude`, `cli.apcli.disable_env`.
- `ConfigResolver.resolveObject(key)` reads nested (non-flattened)
  config values.
