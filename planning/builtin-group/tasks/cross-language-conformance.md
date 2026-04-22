# Task: Cross-language conformance fixtures + startup benchmark

## Goal

Satisfy T-APCLI-31 (cross-language --help byte-parity with the Python
reference) and T-APCLI-32 (startup time within 5% of v0.6 baseline).
Create conformance fixtures under `conformance/fixtures/apcli-visibility/`
and an integration test harness that runs the CLI with identical inputs
and asserts parity.

## Files Involved

- **CREATE** `conformance/fixtures/apcli-visibility/` — fixture directory
  (inputs: `apcore.yaml`, env vars, createCli options; expected outputs:
  golden `--help` dumps).
- **CREATE** `tests/conformance/apcli-visibility.test.ts`
- **CREATE** `tests/conformance/startup-benchmark.test.ts` (or inline into
  the visibility test if appropriate)

## Dependencies

- depends on: `create-cli-integration`
- required by: `docs-and-migration`

## Estimated Time

~3h

## Steps

1. **Fixture scaffold.** Under
   `conformance/fixtures/apcli-visibility/` create scenario directories:
   - `standalone-default/` — no yaml, no env, no createCli option. Expect
     mode:"all" via Tier 4 auto-detect.
   - `embedded-default/` — registry injected, no other config. Expect
     mode:"none" via Tier 4.
   - `yaml-include/` — `apcore.yaml` with `apcli: {mode: include,
     include: [list, describe]}`. Expect `apcli list`, `apcli describe`,
     `apcli exec` reachable.
   - `env-override/` — yaml mode:"none", env `APCORE_CLI_APCLI=show`.
     Expect group visible.
   - `cli-override/` — createCli `{apcli: {mode:"all"}}` with yaml
     mode:"none". Expect group visible.

   Each scenario folder contains `input.yaml` (or absent), `env.json`
   (env var map), `createCli.json` (options as JSON, or empty),
   `expected-help.txt` (golden `--help` output).

   If Python reference fixtures already exist in `../apcore-cli-python/`
   or `../apcore-cli/`, copy them verbatim and strip any Python-only
   wrapper. Otherwise, generate expected-help.txt from the current TS
   implementation and mark the task partial (see Notes).

2. **RED — write conformance test** `tests/conformance/apcli-visibility.test.ts`:

   ```ts
   import { describe, it, expect } from "vitest";
   import fs from "node:fs";
   import path from "node:path";
   import { createCli } from "../../src/main.js";

   const FIXTURE_ROOT = path.resolve(
     __dirname, "../../conformance/fixtures/apcli-visibility",
   );

   for (const scenario of fs.readdirSync(FIXTURE_ROOT)) {
     describe(`apcli visibility — ${scenario}`, () => {
       it("matches golden --help", async () => {
         const dir = path.join(FIXTURE_ROOT, scenario);
         const env = JSON.parse(fs.readFileSync(path.join(dir, "env.json"), "utf8"));
         const opts = JSON.parse(fs.readFileSync(path.join(dir, "createCli.json"), "utf8"));
         const expected = fs.readFileSync(path.join(dir, "expected-help.txt"), "utf8");
         // set env, load yaml if present, build createCli, capture --help stdout
         const actual = await captureHelp(opts, env, dir);
         expect(actual).toBe(expected);
       });
     });
   }
   ```
   Confirm RED (fixtures / helper not yet wired).

3. **Benchmark test** `tests/conformance/startup-benchmark.test.ts`:

   ```ts
   import { performance } from "node:perf_hooks";
   const BASELINE_NS = /* recorded from v0.6 commit — see Notes */;
   const TOLERANCE = 1.05;

   it("createCli startup within 5% of baseline", async () => {
     const runs = 20;
     let total = 0;
     for (let i = 0; i < runs; i++) {
       const t0 = performance.now();
       createCli({ /* standard standalone opts */ });
       total += performance.now() - t0;
     }
     const avg = total / runs;
     expect(avg).toBeLessThanOrEqual(BASELINE_NS * TOLERANCE);
   });
   ```
   Run once to record current (post-FE-13) time; commit the ratio
   assertion against the recorded baseline.

4. **GREEN — wire helper + fixtures.** Implement `captureHelp(opts, env,
   fixtureDir)` — sets `process.env` overlay, reads `input.yaml` into a
   temp dir, builds `createCli`, captures `--help` via
   `program.helpInformation()`. Run scenarios, tune fixture text until
   green.

5. `npx tsc --noEmit` → zero errors.

6. `pnpm test` → full suite green.

## Acceptance Criteria

- [ ] `conformance/fixtures/apcli-visibility/` contains at least 5
      scenario directories covering Tier 1–4 paths.
- [ ] Each scenario has `input.yaml` (or absent), `env.json`,
      `createCli.json`, `expected-help.txt`.
- [ ] `tests/conformance/apcli-visibility.test.ts` runs each scenario and
      asserts `--help` byte-parity with the golden file (T-APCLI-31).
- [ ] Startup benchmark asserts `avg / baseline ≤ 1.05` (T-APCLI-32).
- [ ] If Python reference fixtures are not yet available, test files
      contain a clear `// TODO: harmonize with Python when FE-13 lands
      there` marker pointing to the open question.
- [ ] `pnpm test` fully green; `npx tsc --noEmit` clean.

## Notes

- **Baseline for T-APCLI-32**: since pre-v0.7 binary is gone, measure
  either (a) the v0.6 commit via `git worktree add` + `pnpm build`, or
  (b) a stripped `createCli` call that omits the apcli group registration
  as a reference. Record `BASELINE_NS` as a literal constant in the test
  with a comment pointing to the measurement method.
- **Open question**: Python conformance may lag. This task is partial if
  Python has not shipped FE-13. Mark such scenarios with vitest
  `it.skip` + TODO and track in the project board.
- Use `process.env` snapshot/restore patterns to avoid leaking env state
  between scenarios.
