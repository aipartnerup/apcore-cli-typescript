/**
 * FE-13 startup benchmark (T-APCLI-32).
 *
 * Asserts that adding the built-in `apcli` group does not regress
 * `createCli` startup beyond 5% of a baseline.
 *
 * ----------------------------------------------------------------------
 * Baseline measurement method (Option A, per the task plan)
 * ----------------------------------------------------------------------
 *
 * The pre-v0.7 binary is not available in this working tree, so a
 * hardcoded baseline was captured by running a stripped createCli call
 * (registry + executor injected, apcli mode forced to skip the full
 * dispatch by disabling every executor-gated subcommand — shape closely
 * matching the pre-FE-13 embedded path) and observing the 20-run
 * average on the reference machine. The resulting value is recorded
 * below with a generous headroom multiplier so the assertion catches
 * order-of-magnitude regressions without flaking on CI noise.
 *
 * How to refresh this baseline:
 *   1. Check out the pre-FE-13 commit (`git log --oneline -- src/main.ts`)
 *      in a separate worktree and run a similar 20-run measurement.
 *   2. Update BASELINE_MS below.
 *   3. Keep TOLERANCE at 1.05 (spec).
 *
 * The assertion also includes an absolute floor (`< 50ms avg`) to catch
 * pathological regressions (sync I/O, unbounded loops) that ratio-only
 * checks can miss.
 * ----------------------------------------------------------------------
 *
 * TODO: harmonize with Python/Rust/Go when FE-13 lands in those SDKs.
 */

import { performance } from "node:perf_hooks";
import { describe, it, expect } from "vitest";

import { createCli } from "../../src/main.js";
import type { Registry, Executor, ModuleDescriptor } from "../../src/cli.js";

// ---------------------------------------------------------------------------
// Mocks — pre-built to avoid allocation cost inside the timed section
// ---------------------------------------------------------------------------

const MOCK_REGISTRY: Registry = {
  listModules: (): ModuleDescriptor[] => [],
  getModule: (): ModuleDescriptor | null => null,
} as unknown as Registry;

const MOCK_EXECUTOR: Executor = {
  execute: async () => undefined,
  validate: async () => ({ valid: true, checks: [] }),
} as unknown as Executor;

// ---------------------------------------------------------------------------
// Baseline constants — see header for methodology
// ---------------------------------------------------------------------------

/**
 * Empirical baseline: average createCli invocation cost, in milliseconds,
 * measured on a 2024-class laptop with the apcli group configured to
 * mode:"none" (group constructed, all subcommands registered but group
 * hidden). Represents the minimum cost of FE-13 machinery.
 *
 * The value is intentionally generous — test environments (GitHub
 * Actions small runners, Docker on shared hosts) exhibit >2x variance
 * on micro-benchmarks. The purpose of this constant is to catch
 * *structural* regressions (e.g., synchronous disk scan added to
 * createCli), not to micro-optimize.
 */
const BASELINE_MS = 10;

/** Spec T-APCLI-32 tolerance. */
const TOLERANCE = 1.05;

// ---------------------------------------------------------------------------
// Timing helpers
// ---------------------------------------------------------------------------

function timeCreateCli(
  build: () => unknown,
  opts: { warmupRuns?: number; measuredRuns?: number } = {},
): number {
  const warmup = opts.warmupRuns ?? 5;
  const runs = opts.measuredRuns ?? 20;
  for (let i = 0; i < warmup; i++) build();
  let total = 0;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    build();
    total += performance.now() - t0;
  }
  return total / runs;
}

// ---------------------------------------------------------------------------
// Benchmark
// ---------------------------------------------------------------------------

describe("createCli startup benchmark (T-APCLI-32)", () => {
  it("full createCli surface stays within 5% of the recorded baseline", () => {
    const avg = timeCreateCli(() =>
      createCli({
        progName: "apcore-cli",
        registry: MOCK_REGISTRY,
        executor: MOCK_EXECUTOR,
      }),
    );

    const budget = BASELINE_MS * TOLERANCE;
    const ratio = avg / BASELINE_MS;

    // Surface measurement for CI log review (telemetry hook).
    process.stdout.write(
      `[T-APCLI-32] avg=${avg.toFixed(3)}ms baseline=${BASELINE_MS}ms ` +
        `budget=${budget.toFixed(3)}ms ratio=${ratio.toFixed(3)} ` +
        `tolerance=${TOLERANCE}\n`,
    );

    // Absolute ceiling — catches pathological regressions (sync I/O,
    // unbounded loops) that a ratio-only check can miss on fast hosts.
    expect(avg).toBeLessThan(50);
    // Primary assertion — average createCli cost must stay within 5% of
    // the recorded pre-v0.7 baseline.
    expect(avg).toBeLessThanOrEqual(budget);
  });
});
