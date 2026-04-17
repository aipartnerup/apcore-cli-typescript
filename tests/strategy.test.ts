/**
 * Smoke tests for src/strategy.ts (FE-11 strategy + describe-pipeline).
 *
 * TODO (T-001): expand with full FE-11 strategy / describe-pipeline / --strategy
 * flag coverage. Real behavior verification requires a live apcore-js Executor
 * with strategy support — see code-forge:build for the dedicated test pass.
 */

import { describe, it, expect } from "vitest";

describe("strategy module (smoke)", () => {
  it("is importable", async () => {
    const strategy = await import("../src/strategy.js");
    expect(strategy).toBeDefined();
  });

  it("exports registerPipelineCommand", async () => {
    const { registerPipelineCommand } = await import("../src/strategy.js");
    expect(typeof registerPipelineCommand).toBe("function");
  });
});
