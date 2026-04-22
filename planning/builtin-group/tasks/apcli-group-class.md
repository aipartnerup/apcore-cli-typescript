# Task: ApcliGroup class + RESERVED_GROUP_NAMES + APCORE_CLI_APCLI env parser

## Goal

Introduce the core visibility primitive for feature FE-13: the `ApcliGroup`
class plus supporting types/constants. Implements the 4-tier visibility
resolver (CliConfig > env > yaml > auto-detect), boolean shorthand
normalization, mode validation, `APCORE_CLI_APCLI` env parsing, and the
`RESERVED_GROUP_NAMES` set that later tasks will enforce.

MIRRORS the `ExposureFilter` shape (constructor + fromConfig + isX predicate)
from `src/exposure.ts`. Does **not** subclass — it is a parallel class.

## Files Involved

- **CREATE** `src/builtin-group.ts`
- **CREATE** `tests/builtin-group.test.ts`
- (Export from `src/index.ts` is folded into the `create-cli-integration`
  task, NOT here.)

## Dependencies

- depends on: none
- required by: `discovery-split`, `system-cmd-split`,
  `shell-split-and-completion`, `create-cli-integration`

## Estimated Time

~4h

## Steps

1. **RED — write failing test file first.** Create
   `tests/builtin-group.test.ts` mirroring `tests/exposure.test.ts`.
   Tests to scaffold (all should fail because the module does not yet exist):

   - Constructor defaults: `new ApcliGroup({mode: "auto"})` yields
     `mode=auto`, `include=[]`, `exclude=[]`, `disableEnv=false`.
   - Boolean shorthand normalization:
     - `ApcliGroup.fromCliConfig(true, {registryInjected: true})` → mode="all"
     - `ApcliGroup.fromCliConfig(false, {registryInjected: false})` → mode="none"
   - Mode-path coverage:
     `{mode:"all"}`, `{mode:"none"}`, `{mode:"include", include:["list"]}`,
     `{mode:"exclude", exclude:["health"]}`.
   - Tier precedence (§4.4):
     - Tier 1 wins: `_fromCliConfig=true` & mode!="auto" ignores env+yaml.
     - Tier 2: env `APCORE_CLI_APCLI=show` overrides yaml when not sealed.
     - Tier 3: yaml mode wins when no env.
     - Tier 4 auto-detect: `registryInjected=true` → "none";
       `registryInjected=false` → "all".
   - `disableEnv: true` seals Tier 2 — env is ignored even under mode:"auto".
   - `isSubcommandIncluded("list")` under mode="include"/include:["list"] →
     true; under exclude:["list"] → false.
   - Under mode="all" or "none", `isSubcommandIncluded` must throw
     (spec §4.6 — caller bug). Use `expect(() => ...).toThrow`.
   - `isGroupVisible()` returns false only under mode:"none".
   - Env parser: case-insensitive accepts `show,1,true` → "all";
     `hide,0,false` → "none"; other values → warn via `logger.warn` + ignored
     (spy on `logger.warn`).
   - Invalid mode in user config (e.g. `{mode:"bogus"}` via fromCliConfig) →
     `process.exit(EXIT_CODES.INVALID_CLI_INPUT)` with stderr message.
     Use the `vi.spyOn(process,"exit").mockImplementation(()=>{throw new
     Error("exit")})` idiom from `tests/cli.test.ts:61-106`.
   - `"auto"` rejected when supplied via user config (fromCliConfig /
     fromYaml) — spec §4.2: auto is internal-only → exit 2.
   - `RESERVED_GROUP_NAMES` exports a `ReadonlySet<string>` containing
     exactly `"apcli"`.

   Run `pnpm test tests/builtin-group.test.ts` → confirm RED.

2. **GREEN — implement `src/builtin-group.ts`.**

   ```ts
   export type ApcliMode = "auto" | "all" | "none" | "include" | "exclude";

   export type ApcliConfig =
     | boolean
     | {
         mode: Exclude<ApcliMode, "auto">;
         include?: string[];
         exclude?: string[];
         disableEnv?: boolean;
       };

   export const RESERVED_GROUP_NAMES: ReadonlySet<string> = new Set(["apcli"]);

   export class ApcliGroup {
     private _mode: ApcliMode;
     private _include: string[];
     private _exclude: string[];
     private _disableEnv: boolean;
     private _registryInjected: boolean;
     private _fromCliConfig: boolean;

     private constructor(init: {...}) { ... }

     static fromCliConfig(
       config: ApcliConfig | undefined,
       opts: { registryInjected: boolean },
     ): ApcliGroup { /* sets _fromCliConfig=true */ }

     static fromYaml(
       config: unknown,
       opts: { registryInjected: boolean },
     ): ApcliGroup { /* sets _fromCliConfig=false */ }

     resolveVisibility(): "all" | "none" | "include" | "exclude" { ... }
     isSubcommandIncluded(name: string): boolean { ... }
     isGroupVisible(): boolean { ... }
   }
   ```

   Key implementation notes:

   - Normalize `true`/`false` inside both factories: bool → `{mode:"all"|"none"}`.
   - Validate mode: allowed user set = `{all, none, include, exclude}`.
     `"auto"` or unknown → stderr `Error: cli.apcli.mode '<x>' is invalid.
     Expected one of all|none|include|exclude.` then
     `process.exit(EXIT_CODES.INVALID_CLI_INPUT)`.
   - Warn (via `logger.warn` from `src/logger.ts:25-38`) on:
     non-boolean `disableEnv` (ignored), unknown entries in include/exclude
     (left as-is; matched later), unknown `APCORE_CLI_APCLI` values.
   - `resolveVisibility` 4-tier chain per spec §4.4, matching the Data Flow
     block in `plan.md:40-45`.
   - Env parsing is **co-located** inside `resolveVisibility` (Tier 2) —
     no centralized env module, mirrors the pattern in
     `src/approval.ts:123-137`. Case-insensitive:
     `show|1|true` → "all", `hide|0|false` → "none", else warn+ignore.
   - `isSubcommandIncluded(name)`:
     - If current resolved mode is "all" or "none" → throw
       `new Error("isSubcommandIncluded called under mode '<mode>'")`.
     - If "include" → `this._include.includes(name)`.
     - If "exclude" → `!this._exclude.includes(name)`.

   Run `pnpm test tests/builtin-group.test.ts` → confirm GREEN.

3. **Refactor.** Extract the env parser into a private method
   `ApcliGroup.prototype._parseEnv(raw: string | undefined)`. Re-run tests.

4. `npx tsc --noEmit` → zero errors.

5. `pnpm test` → full suite green.

## Acceptance Criteria

- [ ] `src/builtin-group.ts` exports `ApcliMode`, `ApcliConfig`,
      `RESERVED_GROUP_NAMES`, `ApcliGroup`.
- [ ] Constructor is private; only `fromCliConfig`/`fromYaml` instantiate.
- [ ] 4-tier precedence works (Tier 1 > Tier 2 > Tier 3 > Tier 4).
- [ ] Invalid mode / user-supplied "auto" exits 2 with `EXIT_CODES.INVALID_CLI_INPUT`.
- [ ] `disableEnv=true` seals Tier 2 even when mode=auto.
- [ ] `isSubcommandIncluded` throws under all/none (caller bug guard).
- [ ] `tests/builtin-group.test.ts` passes and covers T-APCLI-01..15, 22..26, 33..37.
- [ ] `pnpm test` fully green; `npx tsc --noEmit` clean.

## Notes

- `ExposureFilter` (`src/exposure.ts:57`) is the shape template. Do not
  subclass; copy the factory/predicate style.
- Mode validator style copies `ExposureFilter.fromConfig`
  (`src/exposure.ts:105-108`).
- Export from `src/index.ts` is deferred to `create-cli-integration` so the
  public surface bump lands atomically with wiring.
- Spec test IDs covered here: T-APCLI-01..15 (mode semantics + tier
  precedence), T-APCLI-22..26 (env parser & validation),
  T-APCLI-33..37 (boolean shorthand / normalization edge cases).
