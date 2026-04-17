/**
 * Smoke tests for src/display-helpers.ts (FE-09 display overlay).
 *
 * TODO (T-001): expand with binding metadata edge cases.
 */

import { describe, it, expect } from "vitest";

describe("display-helpers (smoke)", () => {
  it("is importable", async () => {
    const helpers = await import("../src/display-helpers.js");
    expect(helpers).toBeDefined();
  });

  it("getDisplay returns object for empty descriptor", async () => {
    const { getDisplay } = await import("../src/display-helpers.js");
    const result = getDisplay({ id: "test.empty", name: "test", description: "" });
    expect(typeof result).toBe("object");
  });
});
