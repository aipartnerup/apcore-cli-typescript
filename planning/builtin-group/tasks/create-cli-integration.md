# Task: Wire ApcliGroup into createCli + drop BUILTIN_COMMANDS

## Goal

Integrate everything produced by the split tasks into `createCli`:

- Accept a new `apcli` option on `CreateCliOptions`.
- Build an `ApcliGroup` via the 3-source dispatch (CliConfig > direct
  instance > yaml).
- Add the Commander `apcli` sub-group with hidden flag driven by
  `isGroupVisible()`.
- Implement the central `_registerApcliSubcommands` registrar table (13
  entries) honoring `mode` and `_ALWAYS_REGISTERED = {"exec"}`.
- Gate discovery flags (`--extensions-dir`, `--commands-dir`, `--binding`)
  on `!registryInjected`.
- Retire `BUILTIN_COMMANDS` end-to-end (constant, filter, re-export, test
  block).
- Export the new apcli symbols from `src/index.ts`.

## Files Involved

- **MODIFY** `src/main.ts`
- **MODIFY** `src/cli.ts`
- **MODIFY** `src/index.ts`
- **MODIFY** `tests/main.test.ts`
- **MODIFY** `tests/cli.test.ts`
- **MODIFY** `tests/grouped-commands.test.ts`

## Dependencies

- depends on: `apcli-group-class`, `config-resolve-object`,
  `discovery-split`, `system-cmd-split`, `shell-split-and-completion`
- required by: `reserved-name-enforcement`, `deprecation-shims`,
  `cross-language-conformance`, `docs-and-migration`

## Estimated Time

~5h

## Steps

1. **RED — write integration tests first.**

   In `tests/main.test.ts` (using the createCli fixture variants at
   `tests/main.test.ts:36` standalone and `:97` embedded):

   - T-APCLI-01..09 (mode semantics): createCli called with
     `{apcli: {mode:"all"}}`, `{mode:"none"}`,
     `{mode:"include", include:["list"]}`,
     `{mode:"exclude", exclude:["health"]}` — assert
     `program.commands.find(c=>c.name()==="apcli").commands.map(c=>c.name())`
     matches expected set. Under mode:"none" the group still exists but is
     hidden AND ALL 13 subcommands are still registered (mode:all/none →
     register all).
   - T-APCLI-18/19 — surface & behavioral parity: the flat set of
     reachable commands under standalone mode (with mode:"all") matches
     v0.6 BUILTIN_COMMANDS, just under the `apcli` prefix.
   - T-APCLI-20/21 — edge lists: empty include:[] under mode:"include" →
     only `exec` registered (via `_ALWAYS_REGISTERED`). Empty exclude:[]
     under mode:"exclude" → all 13 registered.
   - T-APCLI-24 — `exec` always registers regardless of include/exclude.
   - T-APCLI-27/28 — discovery flag gating:
     - standalone createCli (no registry): `program.options` contains
       `--extensions-dir`, `--commands-dir`, `--binding`.
     - embedded createCli (registry supplied): those options are absent.
   - T-APCLI-33 — passing a pre-built `ApcliGroup` instance as `apcli`
     is accepted and used as-is.
   - T-APCLI-36 — form equivalence: `{apcli: true}` and
     `{apcli: {mode:"all"}}` produce identical command surfaces.
   - T-APCLI-38 — Tier 1 (CliConfig) beats Tier 3 (yaml): given yaml
     `apcli: {mode:"none"}` and createCli `{apcli: {mode:"all"}}`, group
     is visible.
   - T-APCLI-39 — Tier 1 beats Tier 2 (env): env `APCORE_CLI_APCLI=hide`
     but createCli `{apcli: {mode:"all"}}` → group visible.

   In `tests/cli.test.ts` and `tests/grouped-commands.test.ts`:

   - Delete/update the BUILTIN_COMMANDS assertion blocks at
     `tests/grouped-commands.test.ts:10` (import) and `:366-376` (test
     block) — replace with the new apcli-group parity assertions.

   Run `pnpm test` → confirm RED.

2. **GREEN — implementation.**

   a. **CreateCliOptions** (`src/main.ts:195`): add
      ```ts
      apcli?: ApcliConfig | ApcliGroup;
      ```
      Import `ApcliGroup`, `ApcliConfig` from `./builtin-group.js`.

   b. **createCli dispatch** (`src/main.ts:226`):
      ```ts
      const registryInjected = registry !== undefined;
      let apcliCfg: ApcliGroup;
      if (opts.apcli instanceof ApcliGroup) {
        apcliCfg = opts.apcli;
      } else if (opts.apcli !== undefined) {
        apcliCfg = ApcliGroup.fromCliConfig(opts.apcli, { registryInjected });
      } else {
        const yamlVal = configResolver.resolveObject("apcli");
        apcliCfg = ApcliGroup.fromYaml(yamlVal, { registryInjected });
      }
      ```

   c. **Create apcli sub-group**:
      ```ts
      const apcliGroup = program.command("apcli").description("apcore-cli built-in commands");
      if (!apcliCfg.isGroupVisible()) apcliGroup.hideHelp(true);
      ```

   d. **`_ALWAYS_REGISTERED` + `_registerApcliSubcommands`** per spec §4.9:
      ```ts
      const _ALWAYS_REGISTERED = new Set(["exec"]);

      type RegistrarEntry =
        | { name: string; registrar: (g: Command, ex: Executor) => void; requiresExecutor: true }
        | { name: string; registrar: (g: Command, r: Registry) => void; requiresExecutor: false };

      function _registerApcliSubcommands(
        apcliGroup: Command,
        apcliCfg: ApcliGroup,
        registry: Registry,
        executor: Executor | undefined,
      ): void {
        const TABLE: RegistrarEntry[] = [
          { name: "list",              registrar: (g, r) => registerListCommand(g, r),     requiresExecutor: false },
          { name: "describe",          registrar: (g, r) => registerDescribeCommand(g, r), requiresExecutor: false },
          { name: "exec",              registrar: (g, ex) => registerExecCommand(g, registry, ex), requiresExecutor: true },
          { name: "validate",          registrar: (g, r) => registerValidateCommand(g, r), requiresExecutor: false },
          { name: "init",              registrar: (g, _) => registerInitCommand(g),        requiresExecutor: false },
          { name: "health",            registrar: (g, ex) => registerHealthCommand(g, ex), requiresExecutor: true },
          { name: "usage",             registrar: (g, ex) => registerUsageCommand(g, ex),  requiresExecutor: true },
          { name: "enable",            registrar: (g, ex) => registerEnableCommand(g, ex), requiresExecutor: true },
          { name: "disable",           registrar: (g, ex) => registerDisableCommand(g, ex),requiresExecutor: true },
          { name: "reload",            registrar: (g, ex) => registerReloadCommand(g, ex), requiresExecutor: true },
          { name: "config",            registrar: (g, r) => registerConfigCommand(g, r),   requiresExecutor: false },
          { name: "completion",        registrar: (g, _) => registerCompletionCommand(g),  requiresExecutor: false },
          { name: "describe-pipeline", registrar: (g, r) => registerDescribePipelineCommand(g, r), requiresExecutor: false },
        ];

        const mode = apcliCfg.resolveVisibility();
        for (const entry of TABLE) {
          if (entry.requiresExecutor && !executor) continue;
          const shouldRegister =
            mode === "all" || mode === "none"
              ? true
              : _ALWAYS_REGISTERED.has(entry.name) || apcliCfg.isSubcommandIncluded(entry.name);
          if (!shouldRegister) continue;
          if (entry.requiresExecutor) entry.registrar(apcliGroup, executor!);
          else entry.registrar(apcliGroup, registry);
        }
      }
      ```
      (Strategy + init-cmd reattach: strategy command and init command
      move under `apcliGroup` here. `registerInitCommand` called from the
      `init` row; strategy handled inside describe-pipeline or its own
      row — follow whatever the existing `registerStrategyCommand` API
      needs.)

   e. **Discovery flag gating** (`src/main.ts:275-277`):
      ```ts
      if (!registryInjected) {
        program.option("--extensions-dir <dir>", "...");
        program.option("--commands-dir <dir>", "...");
        program.option("--binding <path>", "...");
      }
      ```

   f. **Retire BUILTIN_COMMANDS (deletions):**
      - Drop import in `src/main.ts:27`.
      - Drop constant `src/cli.ts:113-128`.
      - Drop listCommands filter/spread at `src/cli.ts:405-408`.
      - Drop re-export at `src/index.ts:15`.
      - Drop test block at `tests/grouped-commands.test.ts:10, 366-376`.

   g. **Export from `src/index.ts`**:
      ```ts
      export { ApcliGroup, RESERVED_GROUP_NAMES } from "./builtin-group.js";
      export type { ApcliConfig, ApcliMode } from "./builtin-group.js";
      ```

   Run `pnpm test` → confirm GREEN.

3. **Refactor.** If `_registerApcliSubcommands` is too long, extract the
   TABLE constant to module scope. Keep `_ALWAYS_REGISTERED` adjacent.

4. `npx tsc --noEmit` → zero errors.

5. `pnpm test` → full suite green.

## Acceptance Criteria

- [ ] `createCli({apcli})` accepts `boolean | object | ApcliGroup`.
- [ ] `apcli` Commander sub-group created and hidden flag honors
      `isGroupVisible()`.
- [ ] `_registerApcliSubcommands` dispatches 13 entries correctly.
- [ ] `exec` always registers (honors `_ALWAYS_REGISTERED`).
- [ ] Discovery flags only present in standalone mode.
- [ ] BUILTIN_COMMANDS fully retired: no references in `src/`, no import
      in `src/main.ts`, no re-export in `src/index.ts`, no test block
      in `tests/grouped-commands.test.ts`.
- [ ] `ApcliGroup`, `RESERVED_GROUP_NAMES`, `ApcliConfig`, `ApcliMode`
      exported from `src/index.ts`.
- [ ] T-APCLI-01..09, 18..21, 24, 27..28, 33, 36, 38, 39 tests pass.
- [ ] `pnpm test` fully green; `npx tsc --noEmit` clean.

## Notes

- Strategy + init-cmd registrars: no internal change needed per plan
  (`src/strategy.ts`, `src/init-cmd.ts` EXTEND — caller only). Pass
  `apcliGroup` instead of `program`.
- Registry placeholder divergence per CLAUDE.md remains; keep using local
  `listModules`/`getModule`/`id` shape.
- Sandbox gap unchanged — still throws when enabled=true.
