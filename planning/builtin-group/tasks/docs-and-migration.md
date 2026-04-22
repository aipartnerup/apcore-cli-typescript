# Task: CHANGELOG + README + CLAUDE.md updates, purge BUILTIN_COMMANDS

## Goal

Ship v0.7.0 documentation alongside the code change: CHANGELOG entry,
README restructure showing standalone vs embedded command surface,
CLAUDE.md Conventions section for v0.7.0, and a repo-wide purge of
residual `BUILTIN_COMMANDS` references (comments, docs, stale test
strings).

## Files Involved

- **MODIFY** `CHANGELOG.md`
- **MODIFY** `README.md`
- **MODIFY** `CLAUDE.md`
- **GREP + CLEAN** any remaining `BUILTIN_COMMANDS` mentions in `src/`,
  `tests/`, `docs/` (if any survived after the integration task).

## Dependencies

- depends on: `reserved-name-enforcement`, `deprecation-shims`,
  `cross-language-conformance`
- required by: (none — terminal task)

## Estimated Time

~1h

## Steps

1. **CHANGELOG.md** — add a v0.7.0 entry under `## [Unreleased]` →
   `## [0.7.0]`. Cover:
   - **Added**
     - `apcli` sub-group consolidating 13 built-in commands (list,
       describe, exec, validate, init, health, usage, enable, disable,
       reload, config, completion, describe-pipeline).
     - `ApcliGroup` class + `ApcliConfig` / `ApcliMode` types; exported
       from `src/index.ts`.
     - `RESERVED_GROUP_NAMES = {"apcli"}` as the enforced collision
       surface.
     - New env var `APCORE_CLI_APCLI` (values: show / hide / 1 / 0 /
       true / false, case-insensitive).
     - New config keys: `cli.apcli.mode`, `cli.apcli.include`,
       `cli.apcli.exclude`, `cli.apcli.disable_env` (snake_case DEFAULTS).
     - `ConfigResolver.resolveObject(key)` — non-leaf accessor for
       object-shaped config values.
     - `createCli({apcli})` option accepting `boolean | object |
       ApcliGroup`.
   - **Changed**
     - Built-in commands now live under `apcli` — invocation shifts from
       `<cli> list` to `<cli> apcli list`.
     - Discovery flags (`--extensions-dir`, `--commands-dir`, `--binding`)
       are now only present in standalone mode.
     - Shell completion generators enumerate registered subcommands
       dynamically; no more hardcoded lists.
   - **Deprecated**
     - Root-level v0.6 built-in commands still work via thin shims that
       print a `WARNING` and forward to `apcli <name>`. Will be removed
       in v0.8.
   - **Removed**
     - `BUILTIN_COMMANDS` constant and re-export. `RESERVED_GROUP_NAMES`
       replaces it as the collision surface.
   - **Breaking**
     - Reserved-name enforcement is a hard exit 2 on modules whose
       explicit group, auto-group prefix, or top-level name equals
       `apcli`. Previously warn-and-drop.

2. **README.md** — restructure:
   - Add / update §Usage showing both surfaces:
     - Standalone: `apcore-cli apcli list`, `apcore-cli apcli exec …`,
       with a note that `apcore-cli list` still works in v0.7 with a
       deprecation warning.
     - Embedded (host CLI injects a registry): same commands under
       `<host-cli> apcli …`.
   - Update the command reference to show commands as
     `apcli <subcommand>`.
   - Update `README.md:191` "canonical N built-in commands" reference
     — replace with apcli-group framing.
   - Add a migration callout at top of §Migration (or create §Migration)
     pointing to spec §11 of `docs/features/builtin-group.md`.

3. **CLAUDE.md** — add new section:
   ```markdown
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
   ```
   Remove the line referencing `BUILTIN_COMMANDS` at `CLAUDE.md:37` area.

4. **Purge sweep.** Run `grep -r BUILTIN_COMMANDS .` (excluding node_modules,
   dist, .git) and replace / delete every hit. Expected zero results after
   this task.

5. `pnpm test` → full suite still green (docs-only changes shouldn't
   affect tests, but the BUILTIN_COMMANDS grep might surface stale test
   strings).

6. `npx tsc --noEmit` → zero errors.

## Acceptance Criteria

- [ ] `CHANGELOG.md` has a v0.7.0 entry covering Added / Changed /
      Deprecated / Removed / Breaking as scoped above.
- [ ] `README.md` shows standalone and embedded surfaces, updated
      command reference, migration callout to spec §11.
- [ ] `CLAUDE.md` has a v0.7.0 Conventions section; BUILTIN_COMMANDS
      reference at line ~37 removed.
- [ ] Repo-wide grep for `BUILTIN_COMMANDS` returns zero hits.
- [ ] `pnpm test` fully green; `npx tsc --noEmit` clean.

## Notes

- Docs-only task — but the purge sweep may surface stale references left
  by earlier tasks. Fold those deletions in here rather than opening a
  follow-up.
- The migration callout should point to the exact §11 heading in
  `../apcore-cli/docs/features/builtin-group.md` so users landing here
  know where to read the full deprecation timeline.
- Do not create any new .md files beyond what's listed; update existing
  ones only.
