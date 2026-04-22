# Task: ConfigResolver.resolveObject + apcli.* DEFAULTS

## Goal

Teach `ConfigResolver` to return non-leaf (nested) config values without
flattening, so Tier 3 of the apcli visibility resolver can read a whole
`apcli: {mode, include, exclude, disable_env}` object from `apcore.yaml`.
Register the new `apcli.*` DEFAULTS keys (snake_case) and expose them via the
Config Bus.

## Files Involved

- **MODIFY** `src/config.ts`
- **MODIFY** `tests/config.test.ts`

## Dependencies

- depends on: none
- required by: `create-cli-integration`

## Estimated Time

~2h

## Steps

1. **RED — add failing tests** to `tests/config.test.ts`:

   - `resolveObject("apcli")` returns `null` when apcore.yaml has no `apcli`
     key (DEFAULTS `"apcli": null`).
   - Given yaml `apcli: true`, `resolveObject("apcli")` returns boolean `true`
     (raw, not flattened).
   - Given yaml `apcli: false`, returns boolean `false`.
   - Given yaml
     ```yaml
     apcli:
       mode: include
       include: [list, describe]
     ```
     `resolveObject("apcli")` returns `{mode: "include", include: ["list","describe"]}`.
   - Scalar lookups stay unchanged:
     `resolve("cli.apcli.mode")` still goes through the flattened path and
     returns `null` when unset, and the value (e.g. `"include"`) when set.
   - DEFAULTS snapshot contains `"apcli"`, `"apcli.mode"`, `"apcli.include"`,
     `"apcli.exclude"`, `"apcli.disable_env"`.
   - `registerConfigNamespace` publishes the new apcli keys onto the Config
     Bus (assert via whatever existing pattern the other namespace tests use,
     e.g. `getNamespace("cli")` returns a record containing `apcli.mode`).

   Run `pnpm test tests/config.test.ts` → confirm RED.

2. **GREEN — implement.**

   - In the ConfigResolver loader, keep a `private _rawConfig: Record<string,
     unknown> | null` populated with the parsed yaml **before** `flattenDict`
     runs. (`flattenDict` at `src/config.ts:195` eagerly flattens — do NOT
     reuse it for this path.) Walk the dot-path segments against `_rawConfig`.
   - Add:
     ```ts
     resolveObject(key: string): unknown {
       if (this._rawConfig == null) return null;
       const parts = key.split(".");
       let cur: unknown = this._rawConfig;
       for (const p of parts) {
         if (cur && typeof cur === "object" && !Array.isArray(cur) && p in (cur as Record<string, unknown>)) {
           cur = (cur as Record<string, unknown>)[p];
         } else {
           return null;
         }
       }
       return cur;
     }
     ```
   - Extend DEFAULTS (`src/config.ts:27`) with (snake_case per CLAUDE.md):
     ```ts
     "apcli": null,
     "apcli.mode": null,
     "apcli.include": [],
     "apcli.exclude": [],
     "apcli.disable_env": false,
     ```
   - Extend `registerConfigNamespace` (`src/config.ts:56`) to publish the
     new keys alongside existing cli.* keys — no new entry to
     `NAMESPACE_TO_LEGACY` (`src/config.ts:42`) needed.

   Run `pnpm test tests/config.test.ts` → confirm GREEN.

3. **Refactor.** If `_rawConfig` plumbing is ugly, consider exposing a
   small `_walkRaw(path: string[])` helper. Keep existing scalar `resolve()`
   semantics untouched.

4. `npx tsc --noEmit` → zero errors.

5. `pnpm test` → full suite green.

## Acceptance Criteria

- [ ] `ConfigResolver.resolveObject(key)` returns raw nested value (bool /
      Record / null) without invoking `flattenDict`.
- [ ] DEFAULTS includes the 5 new apcli keys in snake_case.
- [ ] `registerConfigNamespace` exposes apcli.* via Config Bus.
- [ ] Existing scalar `resolve()` callers are unaffected (regression tests
      remain green).
- [ ] New tests cover: unset → null, boolean shorthand, object form,
      scalar sub-key still works.

## Notes

- Spec §4.8 ("M1 note") requires a non-leaf accessor because apcli config
  is naturally an object.
- The `_rawConfig` field must be populated on every load path — yaml file,
  in-memory config, env overlays (if the env overlay injects object-shaped
  values; otherwise it remains scalar-only and resolveObject only sees yaml).
