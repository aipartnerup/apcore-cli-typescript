/**
 * Tests for interactive approval prompts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkApproval, CliApprovalHandler } from "../src/approval.js";
import { ApprovalDeniedError, ApprovalTimeoutError } from "../src/errors.js";
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
    // stdin not TTY → will throw ApprovalDeniedError (caller handles exit)
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

    await expect(checkApproval(makeMod(true), false)).rejects.toBeInstanceOf(ApprovalDeniedError);
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

  it("throws ApprovalDeniedError when stdin is not a TTY (caller handles exit via exitCodeForError)", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    await expect(checkApproval(makeMod(true), false)).rejects.toBeInstanceOf(ApprovalDeniedError);
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  });

  it("ApprovalDeniedError for non-TTY carries a helpful message (--yes / APCORE_CLI_AUTO_APPROVE=1)", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    const err = await checkApproval(makeMod(true), false).catch((e) => e);
    expect(err).toBeInstanceOf(ApprovalDeniedError);
    expect(err.message).toContain("--yes");
    expect(err.message).toContain("APCORE_CLI_AUTO_APPROVE=1");
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  });

  // ---- Task 4: Error types ----

  it("ApprovalTimeoutError has correct name", () => {
    const err = new ApprovalTimeoutError();
    expect(err.name).toBe("ApprovalTimeoutError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("CliApprovalHandler — APCORE_CLI_APPROVAL_TIMEOUT env (C-1)", () => {
  const savedEnv = process.env.APCORE_CLI_APPROVAL_TIMEOUT;
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.APCORE_CLI_APPROVAL_TIMEOUT;
    else process.env.APCORE_CLI_APPROVAL_TIMEOUT = savedEnv;
  });

  it("uses explicit constructor timeout when provided", () => {
    process.env.APCORE_CLI_APPROVAL_TIMEOUT = "999";
    const handler = new CliApprovalHandler(false, 30);
    expect(handler.timeout).toBe(30);
  });

  it("falls back to APCORE_CLI_APPROVAL_TIMEOUT when constructor timeout undefined", () => {
    process.env.APCORE_CLI_APPROVAL_TIMEOUT = "120";
    const handler = new CliApprovalHandler(false);
    expect(handler.timeout).toBe(120);
  });

  it("defaults to 60 when neither set", () => {
    delete process.env.APCORE_CLI_APPROVAL_TIMEOUT;
    const handler = new CliApprovalHandler(false);
    expect(handler.timeout).toBe(60);
  });

  it("ignores invalid env values", () => {
    process.env.APCORE_CLI_APPROVAL_TIMEOUT = "abc";
    expect(new CliApprovalHandler(false).timeout).toBe(60);
    process.env.APCORE_CLI_APPROVAL_TIMEOUT = "0";
    expect(new CliApprovalHandler(false).timeout).toBe(60);
    process.env.APCORE_CLI_APPROVAL_TIMEOUT = "-5";
    expect(new CliApprovalHandler(false).timeout).toBe(60);
  });

  it("clamps to [1, 3600] range", () => {
    process.env.APCORE_CLI_APPROVAL_TIMEOUT = "99999";
    expect(new CliApprovalHandler(false).timeout).toBe(3600);
  });
});
