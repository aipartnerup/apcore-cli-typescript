/**
 * Tests for Sandbox.
 */

import { describe, it, expect, vi } from "vitest";
import { Sandbox } from "../../src/security/sandbox.js";
import type { Executor } from "../../src/cli.js";

describe("Sandbox", () => {
  const mockExecutor: Executor = {
    execute: vi.fn().mockResolvedValue({ result: "ok" }),
  };

  describe("execute()", () => {
    it("delegates to executor when disabled", async () => {
      const sandbox = new Sandbox(false);
      const result = await sandbox.execute("test.mod", { x: 1 }, mockExecutor);
      expect(result).toEqual({ result: "ok" });
      expect(mockExecutor.execute).toHaveBeenCalledWith("test.mod", { x: 1 });
    });

    it("runs in subprocess when enabled", async () => {
      const sandbox = new Sandbox(true);
      const result = await sandbox.execute("test.mod", {}, mockExecutor);
      expect(result).toBeDefined();
    });
  });
});
