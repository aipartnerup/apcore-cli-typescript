/**
 * Tests for Sandbox.
 */

import { describe, it, expect, vi } from "vitest";
import { Sandbox } from "../../src/security/sandbox.js";
import { ModuleExecutionError } from "../../src/errors.js";
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

    it("throws clear error when enabled (subprocess isolation not yet implemented)", async () => {
      // Per audit D9-009: the broken stub-runner path was deleted in v0.6.x.
      // Sandbox now throws an informative error when enabled=true. Subprocess
      // isolation is tracked as future work — see tech-design §8.6.4.
      const sandbox = new Sandbox(true);
      await expect(
        sandbox.execute("test.mod", {}, mockExecutor),
      ).rejects.toBeInstanceOf(ModuleExecutionError);
      await expect(
        sandbox.execute("test.mod", {}, mockExecutor),
      ).rejects.toThrow(/not yet implemented/);
    });
  });
});
