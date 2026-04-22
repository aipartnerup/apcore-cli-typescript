# Task: Split registerCompletionCommand + rewrite bash/zsh/fish generators via Commander introspection

## Goal

(a) Split out `registerCompletionCommand(apcliGroup)` so completion lives
under the apcli group (the root keeps `configureManHelp` per spec §4.1).
(b) Rewrite `generateBashCompletion` / `generateZshCompletion` /
`generateFishCompletion` to enumerate the Commander `apcli` group's
actually-registered subcommands at generation time. Drop the hardcoded
`knownBuiltins` Set and every hardcoded `opts="..."` list.

## Files Involved

- **MODIFY** `src/shell.ts`
- **MODIFY** `tests/shell.test.ts`

## Dependencies

- depends on: `apcli-group-class`
- required by: `create-cli-integration`

## Estimated Time

~4h

## Steps

1. **RED — add failing tests** to `tests/shell.test.ts`:

   - T-APCLI-29 — root completion excludes `apcli` when the group is
     hidden (mode:"none"): build an `apcliGroup` with
     `isGroupVisible()===false`, run generator, assert the generated
     completion script does NOT list `apcli` as a root completion.
   - T-APCLI-30 — `apcli <TAB>` with `include:["list"]` yields the
     actually-registered set (`list` + `exec`, since `exec` is always
     registered). Assert generated script's apcli-level completion enumerates
     exactly those names.
   - **T-APCLI-40 regression guard** — `apcli <TAB>` with `mode:"none"`:
     when the group is present but hidden, the generator must enumerate ALL
     registered subcommands (not filter via `isSubcommandIncluded`). This
     catches the draft-v1 regression where completion wrongly invoked
     `isSubcommandIncluded`.
   - `registerCompletionCommand(apcliGroup)` attaches `completion` to
     `apcliGroup.commands`, not root.
   - `configureManHelp` still attaches `--man` at root level (spec §4.1).
   - No references to `knownBuiltins` or hardcoded `opts="completion
     describe exec init list man"` remain in `src/shell.ts` (grep assertion
     in the test, or a static check).

   Run `pnpm test tests/shell.test.ts` → confirm RED.

2. **GREEN — implement the rewrite.**

   - Extract `registerCompletionCommand(apcliGroup: Command)`; remove the
     old root-level registration path.
   - Rewrite each generator to accept `(program: Command, apcliGroup:
     Command | undefined)` (or infer apcliGroup by `program.commands.find(c
     => c.name() === "apcli")`). Enumerate:
     - Root completions = non-hidden `program.commands`. `apcli` is
       included only if the apcli Commander command exists and is not hidden.
     - apcli completions = `apcliGroup.commands.map(c => c.name())` —
       ALL registered ones, filtered only by Commander's own `hidden`
       flag. **Do not call `isSubcommandIncluded`.** Registration time is
       the gate; generation time just reflects reality.
   - Delete `knownBuiltins` Set at `src/shell.ts:600`.
   - Delete the hardcoded completion lists at `src/shell.ts:74`, `:124`,
     `:182`, `:205`.
   - Generated scripts emit the dynamic lists as string-interpolated arrays.

   Run `pnpm test tests/shell.test.ts` → confirm GREEN.

3. **Refactor.** Factor a small `enumerateApcliSubcommands(apcliGroup)`
   helper used by all three generators so their output stays consistent.

4. `npx tsc --noEmit` → zero errors.

5. `pnpm test` → full suite green.

## Acceptance Criteria

- [ ] `registerCompletionCommand(apcliGroup)` replaces the old root-level
      completion registration.
- [ ] All three generators enumerate registered subcommands — no hardcoded
      lists.
- [ ] `knownBuiltins` Set deleted.
- [ ] Root completion omits `apcli` when the group is hidden.
- [ ] apcli-level completion enumerates ALL registered subcommands — does
      NOT invoke `isSubcommandIncluded` (T-APCLI-40 regression guard).
- [ ] `configureManHelp` remains at root (spec §4.1).
- [ ] T-APCLI-29 / T-APCLI-30 / T-APCLI-40 tests pass.
- [ ] `pnpm test` fully green; `npx tsc --noEmit` clean.

## Notes

- Registration-time filtering (handled in `create-cli-integration`) means
  only visible subcommands live on `apcliGroup.commands`. Completion
  generation reads from that set, so it's automatically correct without
  re-consulting `ApcliGroup` logic.
- Spec §4.13 explicitly warns against the draft-v1 mistake of re-invoking
  `isSubcommandIncluded` during completion generation.
