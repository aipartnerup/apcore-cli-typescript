/**
 * Tests for interactive approval prompts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkApproval } from "../src/approval.js";
import { ApprovalTimeoutError } from "../src/errors.js";
import type { ModuleDescriptor } from "../src/cli.js";

describe("checkApproval", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.APCORE_CLI_AUTO_APPROVE;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  const makeMod = (
    requiresApproval: boolean,
    annotations?: Record<string, unknown>,
  ): ModuleDescriptor => ({
    id: "test.mod",
    name: "test.mod",
    description: "Test module",
    requiresApproval,
    annotations,
  });

  // ---- Task 1: Bypass logic ----

  it("returns immediately when module does not require approval", async () => {
    await expect(checkApproval(makeMod(false), false)).resolves.toBeUndefined();
  });

  it("returns immediately when autoApprove is true", async () => {
    await expect(checkApproval(makeMod(true), true)).resolves.toBeUndefined();
  });

  it("returns immediately when APCORE_CLI_AUTO_APPROVE=1", async () => {
    process.env.APCORE_CLI_AUTO_APPROVE = "1";
    await expect(checkApproval(makeMod(true), false)).resolves.toBeUndefined();
  });

  it("logs warning when APCORE_CLI_AUTO_APPROVE is invalid", async () => {
    process.env.APCORE_CLI_AUTO_APPROVE = "yes";
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    // stdin not TTY → will exit 46
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

    await expect(checkApproval(makeMod(true), false)).rejects.toThrow("exit");
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("APCORE_CLI_AUTO_APPROVE is set to 'yes'"),
    );
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  });

  it("handles missing annotations gracefully", async () => {
    const mod: ModuleDescriptor = {
      id: "test",
      name: "test",
      description: "Test",
    };
    await expect(checkApproval(mod, false)).resolves.toBeUndefined();
  });

  it("checks annotations.requires_approval when requiresApproval not set", async () => {
    const mod: ModuleDescriptor = {
      id: "test",
      name: "test",
      description: "Test",
      annotations: { requires_approval: true },
    };
    // autoApprove = true should bypass
    await expect(checkApproval(mod, true)).resolves.toBeUndefined();
  });

  // ---- Task 2: Non-TTY rejection ----

  it("exits 46 when stdin is not a TTY", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

    await expect(checkApproval(makeMod(true), false)).rejects.toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(46);

    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  });

  it("outputs helpful error message for non-TTY", async () => {
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

    await expect(checkApproval(makeMod(true), false)).rejects.toThrow("exit");
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("--yes"),
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("APCORE_CLI_AUTO_APPROVE=1"),
    );

    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  });

  // ---- Task 4: Error types ----

  it("ApprovalTimeoutError has correct name", () => {
    const err = new ApprovalTimeoutError();
    expect(err.name).toBe("ApprovalTimeoutError");
    expect(err).toBeInstanceOf(Error);
  });
});
