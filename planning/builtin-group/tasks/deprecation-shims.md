# Task: Standalone-mode deprecation shims

## Goal

Implement `_registerDeprecationShims(root, apcliGroup, registryInjected)` in
`src/main.ts`. When the CLI runs standalone (`!registryInjected`), register
thin root-level Command shims for the 13 v0.6 built-in commands; each shim
logs a WARNING to stderr then forwards to the corresponding apcli
subcommand. Skip entirely in embedded mode. This is the v0.7.x deprecation
window; shims get removed in v0.8.

## Files Involved

- **MODIFY** `src/main.ts`
- **MODIFY** `tests/main.test.ts`

## Dependencies

- depends on: `create-cli-integration`
- required by: `docs-and-migration`

## Estimated Time

~2h

## Steps

1. **RED — write failing tests** in `tests/main.test.ts`:

   - **Standalone mode (no registry injected)**: after `createCli(...)`,
     assert `program.commands.filter(c => c.name() !== "apcli").map(c => c.name())`
     contains 13 shim names:
     `["list","describe","exec","init","validate","health","usage","enable",
     "disable","reload","config","completion","describe-pipeline"]`.
   - **Embedded mode (registry supplied)**: assert zero root-level shims
     are registered (only `apcli` + user-supplied commands exist at root).
   - **Invoking shim emits warning + forwards**:
     - Capture stderr. Call `program.parseAsync(["node","cli","list"])`.
     - Assert stderr matches:
       `"WARNING: 'list' as a root-level command is deprecated. Use '<cli> apcli list' instead. Will be removed in v0.8."`
       (verify exact wording against spec §11.2 once the spec file is
       opened).
     - Assert the forwarded `apcli list` action executed successfully
       (stdout contains module list output).
   - **Forward preserves args/options**: `program.parseAsync(["node","cli",
     "describe","my.mod","--json"])` → stderr shows deprecation warning,
     stdout matches `apcli describe my.mod --json` output.

   Run `pnpm test tests/main.test.ts` → confirm RED.

2. **GREEN — implement.**

   - Add private helper in `src/main.ts`:
     ```ts
     const DEPRECATED_ROOT_COMMANDS = [
       "list", "describe", "exec", "init", "validate",
       "health", "usage", "enable", "disable", "reload",
       "config", "completion", "describe-pipeline",
     ] as const;

     function _registerDeprecationShims(
       root: Command,
       apcliGroup: Command,
       registryInjected: boolean,
       cliName: string,
     ): void {
       if (registryInjected) return;
       for (const name of DEPRECATED_ROOT_COMMANDS) {
         const apcliSub = apcliGroup.commands.find(c => c.name() === name);
         if (!apcliSub) continue; // subcommand not registered (e.g. no executor)
         const shim = root
           .command(name)
           .description(`[DEPRECATED] Use '${cliName} apcli ${name}' instead`)
           .allowUnknownOption(true)
           .action(async (...args) => {
             process.stderr.write(
               `WARNING: '${name}' as a root-level command is deprecated. Use '${cliName} apcli ${name}' instead. Will be removed in v0.8.\n`,
             );
             // Forward: use Commander's parseAsync on apcliGroup with the
             // sliced original argv so args + options are preserved.
             const originalArgv = process.argv;
             const idx = originalArgv.indexOf(name);
             const forwarded = ["node", cliName, "apcli", ...originalArgv.slice(idx)];
             await root.parseAsync(forwarded);
           });
       }
     }
     ```
     (Verify the argv forwarding shape against how Commander dispatches —
     alternative: invoke `apcliSub.parseAsync([ ...shimArgs ])` directly
     with the arguments captured from the action handler's positional +
     `this.opts()`.)
   - Call from `createCli` AFTER `_registerApcliSubcommands` completes:
     ```ts
     _registerDeprecationShims(program, apcliGroup, registryInjected, program.name());
     ```
   - Warning text must exactly match spec §11.2 — before final commit,
     **open `../apcore-cli/docs/features/builtin-group.md` §11.2** and
     copy the exact phrasing.

   Run `pnpm test tests/main.test.ts` → confirm GREEN.

3. **Refactor.** If argv rewriting is clumsy, consider dispatching directly
   via `apcliSub.parseAsync(args)` inside the action using the Commander
   context. Keep the warning as a one-liner.

4. `npx tsc --noEmit` → zero errors.

5. `pnpm test` → full suite green.

## Acceptance Criteria

- [ ] `_registerDeprecationShims` is a no-op when `registryInjected=true`.
- [ ] In standalone mode, 13 root-level shim commands are registered
      (minus any whose apcli counterpart was skipped due to missing
      executor).
- [ ] Invoking a shim writes the exact spec §11.2 warning to stderr.
- [ ] Invoking a shim successfully dispatches to the corresponding
      `apcli <name>` subcommand, preserving args and options.
- [ ] No deprecation shims registered in embedded mode.
- [ ] `pnpm test` fully green; `npx tsc --noEmit` clean.

## Notes

- Shims are a v0.7.x-only deprecation window; spec §11 governs removal in
  v0.8.
- The forward must be transparent to exit codes — the wrapped
  `apcli <name>` exit code should propagate. Since `parseAsync` is async
  and errors bubble via Commander, standard behavior should suffice; add
  an integration assertion if unsure.
- Avoid collision with existing root commands: if a user-supplied
  `extraCommand` already uses one of the shim names, the earlier
  `reserved-name-enforcement` check handles refusal.
