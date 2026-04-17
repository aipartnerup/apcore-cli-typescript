/**
 * Smoke tests for src/logger.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setLogLevel, getLogLevel } from "../src/logger.js";

describe("logger (smoke)", () => {
  let originalLevel: string;

  beforeEach(() => {
    originalLevel = getLogLevel();
  });

  afterEach(() => {
    setLogLevel(originalLevel);
  });

  it("getLogLevel returns a valid level string", () => {
    const level = getLogLevel();
    expect(["DEBUG", "INFO", "WARNING", "ERROR"]).toContain(level);
  });

  it("setLogLevel persists across calls", () => {
    setLogLevel("DEBUG");
    expect(getLogLevel()).toBe("DEBUG");
    setLogLevel("ERROR");
    expect(getLogLevel()).toBe("ERROR");
  });
});
