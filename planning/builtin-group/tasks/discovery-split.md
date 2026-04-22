# Task: Split registerDiscoveryCommands into per-subcommand registrars

## Goal

Break the monolithic `registerDiscoveryCommands` into individual
`registerListCommand`, `registerDescribeCommand`, and NEW `registerExecCommand`
registrars that attach to the `apcli` Commander sub-group. Keep
`registerValidateCommand` but have its caller attach to `apcliGroup` instead
of root. Preserves behavior; changes attachment point and granularity.

## Files Involved

- **MODIFY** `src/discovery.ts`
- **MODIFY** `tests/discovery.test.ts`

## Dependencies

- depends on: `apcli-group-class`
- required by: `create-cli-integration`

## Estimated Time

~3h

## Steps

1. **RED — add failing tests** to `tests/discovery.test.ts`:

   - Given a fresh Commander `apcliGroup` and a mock registry/executor, call
     `registerListCommand(apcliGroup, registry)` and assert
     `apcliGroup.commands.map(c => c.name())` includes `"list"` and the
     root program does NOT.
   - Same for `registerDescribeCommand` → `"describe"`.
   - New: `registerExecCommand(apcliGroup, registry, executor)` adds an
     `exec` subcommand with signature `apcli exec <module-id> [options...]`.
     Invoke it (using `program.parseAsync(["node","cli","apcli","exec","my.mod"])`
     fixture style) and assert the executor was called with moduleId
     `"my.mod"` and that output flows through `output.ts` resolveFormat /
     formatExecResult.
   - Behavioral parity for list/describe (T-APCLI-19): with same registry
     fixture, the stdout of `apcli list` matches what the old
     `registerDiscoveryCommands` + root `list` produced. Use the stdout
     capture pattern from `tests/discovery.test.ts:25` and the command
     enumeration pattern at `:43`.
   - `registerValidateCommand` now attaches to `apcliGroup`, not root.

   Run `pnpm test tests/discovery.test.ts` → confirm RED for the new
   assertions.

2. **GREEN — implement the split.**

   - Rename the existing `registerDiscoveryCommands(program, registry)`
     internals into three exported functions:
     ```ts
     export function registerListCommand(apcliGroup: Command, registry: Registry): void
     export function registerDescribeCommand(apcliGroup: Command, registry: Registry): void
     export function registerExecCommand(
       apcliGroup: Command, registry: Registry, executor: Executor,
     ): void
     ```
   - Add `registerExecCommand` as a NEW entry point. Current codebase
     executes modules via per-module Commands attached at `program`; the
     apcli-flavored `exec` is a single generic dispatch:
     `apcli exec <module-id> [--json] [--yaml] [options...]`. Reuse
     `output.ts` `resolveFormat` / `formatExecResult` verbatim.
   - Keep `registerValidateCommand` (src/discovery.ts:222) as-is internally;
     callers pass `apcliGroup` rather than root.
   - If any shared helpers exist inside discovery.ts, leave them internal.
   - Remove the old `registerDiscoveryCommands` export (create-cli-integration
     task will wire the new ones).

   Run `pnpm test tests/discovery.test.ts` → confirm GREEN.

3. **Refactor.** Consolidate shared argument parsing (format flag wiring)
   into a private helper if duplication crept in. Keep public surface the
   four `registerXCommand` functions.

4. `npx tsc --noEmit` → zero errors.

5. `pnpm test` → full suite green.

## Acceptance Criteria

- [ ] `registerListCommand`, `registerDescribeCommand`, `registerExecCommand`,
      `registerValidateCommand` all exported from `src/discovery.ts`.
- [ ] Each attaches to the passed-in `apcliGroup`, never to root.
- [ ] `apcli exec <module-id>` runs executor and returns formatted output
      via `output.ts` helpers.
- [ ] Behavioral parity maintained for list/describe (T-APCLI-19).
- [ ] Old `registerDiscoveryCommands` export removed.
- [ ] `pnpm test` fully green; `npx tsc --noEmit` clean.

## Notes

- Per CLAUDE.md "Known gap" — the Registry placeholder in `src/cli.ts` uses
  `listModules`/`getModule` and descriptor field `id`. Keep using these local
  shape names; do not try to align with upstream apcore-js here.
- `registerExecCommand` is the generic apcli dispatch; per-module executable
  Commands registered elsewhere remain unaffected.
