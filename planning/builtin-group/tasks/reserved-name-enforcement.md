# Task: Hard-fail exit 2 on reserved `apcli` name

## Goal

Replace the current warn-and-drop behavior in `GroupedModuleGroup` with a
hard exit (code 2, `EXIT_CODES.INVALID_CLI_INPUT`) when any module resolves
to a group / auto-group / top-level alias of `apcli`. Also update the
extraCommands collision check in `createCli` to use `RESERVED_GROUP_NAMES` +
live `program.commands` inspection instead of the retired `BUILTIN_COMMANDS`.

## Files Involved

- **MODIFY** `src/cli.ts`
- **MODIFY** `src/main.ts`
- **MODIFY** `tests/cli.test.ts`
- **MODIFY** `tests/grouped-commands.test.ts`

## Dependencies

- depends on: `create-cli-integration`
- required by: `docs-and-migration`

## Estimated Time

~2h

## Steps

1. **RED — write failing tests** covering T-APCLI-16 / T-APCLI-17:

   In `tests/grouped-commands.test.ts` (use the `makeMod` / `makeRegistry`
   helpers at `:19` / `:38` and the `vi.spyOn(process,"exit")` pattern
   from `tests/cli.test.ts:61-106`):

   - **Case 1 — explicit `display.cli.group: apcli`**:
     ```ts
     const mod = makeMod("my.mod", { display: { cli: { group: "apcli" } } });
     const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
       throw new Error("exit");
     }) as never);
     expect(() => resolveGroupMap(makeRegistry([mod]))).toThrow("exit");
     expect(exitSpy).toHaveBeenCalledWith(2);
     expect(stderr).toMatch(/Module 'my\.mod'.+'apcli'.+reserved/);
     ```
   - **Case 2 — auto-grouped prefix** (module id `apcli.foo`): same
     assertions.
   - **Case 3 — top-level name `apcli`** (module with alias/name resolving
     to `apcli` and no group): same assertions.
   - **extraCommands collision** (in `tests/main.test.ts`): createCli
     called with `extraCommands: [{ name: "apcli", ... }]` → exit 2 with
     stderr `Error: extraCommands name 'apcli' is reserved`.
   - **Still fails on live collision**: if some other layer already
     attached an `apcli` command and extraCommands tries to add another
     `apcli`, also exit 2.

   Run `pnpm test` → confirm RED.

2. **GREEN — implement.**

   - In `GroupedModuleGroup._buildGroupMap()` (currently warn-and-drop at
     `src/cli.ts:385-392`): replace the loop body. Pseudocode:
     ```ts
     for (const mod of modules) {
       const display = getDisplay(mod); // from src/display-helpers.ts
       const explicitGroup = display?.cli?.group;
       const autoGroup = mod.id.includes(".") ? mod.id.split(".")[0] : undefined;
       const topLevel = !explicitGroup && !autoGroup ? (display?.cli?.name ?? mod.id) : undefined;

       if (explicitGroup && RESERVED_GROUP_NAMES.has(explicitGroup)) {
         process.stderr.write(
           `Error: Module '${mod.id}': display.cli.group '${explicitGroup}' is reserved\n`,
         );
         process.exit(EXIT_CODES.INVALID_CLI_INPUT);
       }
       if (autoGroup && RESERVED_GROUP_NAMES.has(autoGroup)) {
         process.stderr.write(
           `Error: Module '${mod.id}': auto-group '${autoGroup}' is reserved\n`,
         );
         process.exit(EXIT_CODES.INVALID_CLI_INPUT);
       }
       if (topLevel && RESERVED_GROUP_NAMES.has(topLevel)) {
         process.stderr.write(
           `Error: Module '${mod.id}': top-level name '${topLevel}' is reserved\n`,
         );
         process.exit(EXIT_CODES.INVALID_CLI_INPUT);
       }
       // existing accept path ...
     }
     ```
     Import `RESERVED_GROUP_NAMES` from `./builtin-group.js` and
     `EXIT_CODES` from `./errors.js`. Use `getDisplay` from
     `./display-helpers.js` for consistency with existing alias detection.

   - In `src/main.ts:347-348` replace the BUILTIN_COMMANDS check with:
     ```ts
     for (const extra of extraCommands ?? []) {
       if (RESERVED_GROUP_NAMES.has(extra.name)) {
         process.stderr.write(
           `Error: extraCommands name '${extra.name}' is reserved\n`,
         );
         process.exit(EXIT_CODES.INVALID_CLI_INPUT);
       }
       if (program.commands.some(c => c.name() === extra.name)) {
         process.stderr.write(
           `Error: extraCommands name '${extra.name}' collides with an existing command\n`,
         );
         process.exit(EXIT_CODES.INVALID_CLI_INPUT);
       }
     }
     ```

   Run `pnpm test` → confirm GREEN.

3. **Refactor.** Extract a small `assertNotReserved(kind, name, modId)`
   helper to DRY the three GroupedModuleGroup checks.

4. `npx tsc --noEmit` → zero errors.

5. `pnpm test` → full suite green.

## Acceptance Criteria

- [ ] `GroupedModuleGroup._buildGroupMap()` exits 2 on any of the three
      reserved-name cases (explicit group, auto-group prefix, top-level
      name).
- [ ] stderr message identifies the module id and the offending name.
- [ ] extraCommands collision check uses `RESERVED_GROUP_NAMES` +
      live `program.commands` — old BUILTIN_COMMANDS path removed.
- [ ] T-APCLI-16 / T-APCLI-17 tests pass (3 module-side cases + extraCommands
      case).
- [ ] No residual `BUILTIN_COMMANDS` references after this task.
- [ ] `pnpm test` fully green; `npx tsc --noEmit` clean.

## Notes

- Use `getDisplay` from `src/display-helpers.ts` for alias detection —
  stays consistent with existing code paths.
- Exit-2 idiom uses `process.exit(EXIT_CODES.INVALID_CLI_INPUT)`
  (`src/errors.ts:71`). Tests mock via
  `vi.spyOn(process,"exit").mockImplementation(()=>{throw new Error("exit")})`.
