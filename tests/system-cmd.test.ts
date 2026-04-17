/**
 * Smoke tests for src/system-cmd.ts (FE-11 system management commands).
 *
 * TODO (T-001): expand with full health/usage/enable/disable/reload/config
 * coverage. Real verification requires a live apcore-js Executor with
 * system modules registered.
 */

import { describe, it, expect } from "vitest";

describe("system-cmd module (smoke)", () => {
  it("is importable", async () => {
    const sys = await import("../src/system-cmd.js");
    expect(sys).toBeDefined();
  });

  it("exports registerSystemCommands", async () => {
    const { registerSystemCommands } = await import("../src/system-cmd.js");
    expect(typeof registerSystemCommands).toBe("function");
  });
});
