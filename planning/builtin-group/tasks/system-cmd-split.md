# Task: Split registerSystemCommands into 6 per-subcommand registrars

## Goal

Break `registerSystemCommands` (src/system-cmd.ts:118) into six individual
registrars — one per sub-command: `health`, `usage`, `enable`, `disable`,
`reload`, `config`. Each attaches to `apcliGroup`. Extract shared probe
logic into a cached private helper to preserve current behavior.

## Files Involved

- **MODIFY** `src/system-cmd.ts`
- **MODIFY** `tests/system-cmd.test.ts`

## Dependencies

- depends on: `apcli-group-class`
- required by: `create-cli-integration`

## Estimated Time

~3h

## Steps

1. **RED — add failing tests** to `tests/system-cmd.test.ts`:

   - For each of the six subcommand registrars, verify:
     ```ts
     const apcliGroup = new Command("apcli");
     registerHealthCommand(apcliGroup, executor);
     expect(apcliGroup.commands.map(c => c.name())).toContain("health");
     ```
     Repeat for usage / enable / disable / reload / config.
   - Behavioral parity: `apcli health` produces the same output structure
     as the pre-split `health` root command (reuse any existing system-cmd
     test fixtures; diff against a captured baseline).
   - Probe helper called once per invocation: spy on the extracted
     `loadProbe` helper, invoke `apcli health` and assert 1 call. This
     protects against regressions where the split duplicates probe work.

   Run `pnpm test tests/system-cmd.test.ts` → confirm RED.

2. **GREEN — implement the split.**

   - Extract internal probe logic into a private module-local helper:
     ```ts
     async function loadProbe(executor: Executor): Promise<Probe> { ... }
     ```
     Cache the result inside each action handler's scope (not a global —
     each command invocation gets a fresh probe).
   - Replace the monolithic `registerSystemCommands(program, executor)`
     with six exports. Signatures match the dispatcher table expected by
     `create-cli-integration` (registry-only for `config`, executor for the
     others; verify against current monolith for each):
     ```ts
     export function registerHealthCommand(apcliGroup: Command, executor: Executor): void
     export function registerUsageCommand(apcliGroup: Command, executor: Executor): void
     export function registerEnableCommand(apcliGroup: Command, executor: Executor): void
     export function registerDisableCommand(apcliGroup: Command, executor: Executor): void
     export function registerReloadCommand(apcliGroup: Command, executor: Executor): void
     export function registerConfigCommand(apcliGroup: Command, registry: Registry): void
     ```
   - Each function body mirrors the relevant `.command(...)` block from the
     old monolith, attaching to `apcliGroup` instead of `program`.
   - Remove the old `registerSystemCommands` export (wiring happens in
     `create-cli-integration`).

   Run `pnpm test tests/system-cmd.test.ts` → confirm GREEN.

3. **Refactor.** If each registrar duplicates option parsing, pull that
   into a tiny helper. Keep probe cache single-entry-per-invocation.

4. `npx tsc --noEmit` → zero errors.

5. `pnpm test` → full suite green.

## Acceptance Criteria

- [ ] Six per-subcommand registrars exported from `src/system-cmd.ts`.
- [ ] Each attaches to `apcliGroup`, never to root.
- [ ] Probe logic factored into `loadProbe` helper; not duplicated per
      registrar.
- [ ] Pre-split behavioral parity preserved.
- [ ] Old monolithic `registerSystemCommands` export removed.
- [ ] `pnpm test` fully green; `npx tsc --noEmit` clean.

## Notes

- Signatures must match exactly what the dispatcher table in
  `create-cli-integration` expects. If current monolith mixes registry and
  executor usage per command, preserve that per-command.
- The `config` subcommand reads the live registry — keeps `registry`-typed
  signature. The others dispatch via executor.
