/**
 * Tests for src/system-cmd.ts (FE-11 system management commands).
 *
 * Covers the six per-subcommand registrars produced by the FE-13
 * system-cmd-split task, plus the backward-compat wrapper
 * `registerSystemCommands`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import type { Executor } from "../src/cli.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal executor mock whose .call() returns a deterministic result
 * keyed by module id. validate() resolves (probe passes) by default.
 */
interface MockExecutorState {
  calls: Array<{ moduleId: string; input: Record<string, unknown> }>;
  responses: Record<string, unknown>;
  validateFails?: boolean;
}

function makeExecutor(initial: Partial<MockExecutorState> = {}): { executor: Executor; state: MockExecutorState } {
  const state: MockExecutorState = {
    calls: [],
    responses: initial.responses ?? {},
    validateFails: initial.validateFails ?? false,
  };
  const executor: Executor = {
    async execute(moduleId, input) {
      state.calls.push({ moduleId, input });
      if (moduleId in state.responses) return state.responses[moduleId];
      return {};
    },
    async call(moduleId, input) {
      state.calls.push({ moduleId, input });
      if (moduleId in state.responses) return state.responses[moduleId];
      return {};
    },
    async validate(_moduleId, _input) {
      if (state.validateFails) throw new Error("no system modules");
      return { valid: true, requiresApproval: false, checks: [] };
    },
  };
  return { executor, state };
}

// Silence stdout writes produced by command actions so vitest output stays clean.
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;
const origIsTTY = process.stdout.isTTY;

beforeEach(() => {
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  // Force JSON path (non-TTY) for deterministic output capture.
  Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  Object.defineProperty(process.stdout, "isTTY", { value: origIsTTY, configurable: true });
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Smoke (import)
// ---------------------------------------------------------------------------

describe("system-cmd module (smoke)", () => {
  it("is importable", async () => {
    const sys = await import("../src/system-cmd.js");
    expect(sys).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Per-subcommand registrar attachment
// ---------------------------------------------------------------------------

describe("per-subcommand registrars attach to apcliGroup", () => {
  it("registerHealthCommand attaches 'health' subcommand", async () => {
    const { registerHealthCommand } = await import("../src/system-cmd.js");
    const { executor } = makeExecutor();
    const apcliGroup = new Command("apcli");
    registerHealthCommand(apcliGroup, executor);
    expect(apcliGroup.commands.map((c) => c.name())).toContain("health");
  });

  it("registerUsageCommand attaches 'usage' subcommand", async () => {
    const { registerUsageCommand } = await import("../src/system-cmd.js");
    const { executor } = makeExecutor();
    const apcliGroup = new Command("apcli");
    registerUsageCommand(apcliGroup, executor);
    expect(apcliGroup.commands.map((c) => c.name())).toContain("usage");
  });

  it("registerEnableCommand attaches 'enable' subcommand", async () => {
    const { registerEnableCommand } = await import("../src/system-cmd.js");
    const { executor } = makeExecutor();
    const apcliGroup = new Command("apcli");
    registerEnableCommand(apcliGroup, executor);
    expect(apcliGroup.commands.map((c) => c.name())).toContain("enable");
  });

  it("registerDisableCommand attaches 'disable' subcommand", async () => {
    const { registerDisableCommand } = await import("../src/system-cmd.js");
    const { executor } = makeExecutor();
    const apcliGroup = new Command("apcli");
    registerDisableCommand(apcliGroup, executor);
    expect(apcliGroup.commands.map((c) => c.name())).toContain("disable");
  });

  it("registerReloadCommand attaches 'reload' subcommand", async () => {
    const { registerReloadCommand } = await import("../src/system-cmd.js");
    const { executor } = makeExecutor();
    const apcliGroup = new Command("apcli");
    registerReloadCommand(apcliGroup, executor);
    expect(apcliGroup.commands.map((c) => c.name())).toContain("reload");
  });

  it("registerConfigCommand attaches 'config' subcommand (with get/set children)", async () => {
    const { registerConfigCommand } = await import("../src/system-cmd.js");
    const { executor } = makeExecutor();
    const apcliGroup = new Command("apcli");
    registerConfigCommand(apcliGroup, executor);
    expect(apcliGroup.commands.map((c) => c.name())).toContain("config");
    const configCmd = apcliGroup.commands.find((c) => c.name() === "config")!;
    const childNames = configCmd.commands.map((c) => c.name());
    expect(childNames).toContain("get");
    expect(childNames).toContain("set");
  });
});

// ---------------------------------------------------------------------------
// Behavioral parity: invoke action and verify downstream call.
// ---------------------------------------------------------------------------

describe("per-subcommand behavioral parity", () => {
  it("health (no module arg) calls system.health.summary with threshold + all", async () => {
    const { registerHealthCommand } = await import("../src/system-cmd.js");
    const { executor, state } = makeExecutor({
      responses: {
        "system.health.summary": { summary: { total_modules: 0 }, modules: [] },
      },
    });
    const apcliGroup = new Command("apcli").exitOverride();
    registerHealthCommand(apcliGroup, executor);
    await apcliGroup.parseAsync(["health", "--format", "json"], { from: "user" });
    const summaryCall = state.calls.find((c) => c.moduleId === "system.health.summary");
    expect(summaryCall).toBeDefined();
    expect(summaryCall!.input).toMatchObject({
      error_rate_threshold: 0.01,
      include_healthy: false,
    });
  });

  it("health <module-id> calls system.health.module", async () => {
    const { registerHealthCommand } = await import("../src/system-cmd.js");
    const { executor, state } = makeExecutor({
      responses: { "system.health.module": { module_id: "foo", status: "healthy" } },
    });
    const apcliGroup = new Command("apcli").exitOverride();
    registerHealthCommand(apcliGroup, executor);
    await apcliGroup.parseAsync(["health", "foo", "--format", "json"], { from: "user" });
    const moduleCall = state.calls.find((c) => c.moduleId === "system.health.module");
    expect(moduleCall).toBeDefined();
    expect(moduleCall!.input).toMatchObject({ module_id: "foo", error_limit: 10 });
  });

  it("usage (no module arg) calls system.usage.summary with period", async () => {
    const { registerUsageCommand } = await import("../src/system-cmd.js");
    const { executor, state } = makeExecutor({
      responses: { "system.usage.summary": { period: "24h", modules: [] } },
    });
    const apcliGroup = new Command("apcli").exitOverride();
    registerUsageCommand(apcliGroup, executor);
    await apcliGroup.parseAsync(["usage", "--format", "json"], { from: "user" });
    const call = state.calls.find((c) => c.moduleId === "system.usage.summary");
    expect(call).toBeDefined();
    expect(call!.input).toMatchObject({ period: "24h" });
  });

  it("enable calls system.control.toggle_feature with enabled:true", async () => {
    const { registerEnableCommand } = await import("../src/system-cmd.js");
    const { executor, state } = makeExecutor({
      responses: { "system.control.toggle_feature": { ok: true } },
    });
    const apcliGroup = new Command("apcli").exitOverride();
    registerEnableCommand(apcliGroup, executor);
    await apcliGroup.parseAsync(
      ["enable", "mymod", "--reason", "testing", "--yes", "--format", "json"],
      { from: "user" },
    );
    const call = state.calls.find((c) => c.moduleId === "system.control.toggle_feature");
    expect(call).toBeDefined();
    expect(call!.input).toMatchObject({
      module_id: "mymod",
      enabled: true,
      reason: "testing",
    });
  });

  it("disable calls system.control.toggle_feature with enabled:false", async () => {
    const { registerDisableCommand } = await import("../src/system-cmd.js");
    const { executor, state } = makeExecutor({
      responses: { "system.control.toggle_feature": { ok: true } },
    });
    const apcliGroup = new Command("apcli").exitOverride();
    registerDisableCommand(apcliGroup, executor);
    await apcliGroup.parseAsync(
      ["disable", "mymod", "--reason", "broken", "--yes", "--format", "json"],
      { from: "user" },
    );
    const call = state.calls.find((c) => c.moduleId === "system.control.toggle_feature");
    expect(call).toBeDefined();
    expect(call!.input).toMatchObject({
      module_id: "mymod",
      enabled: false,
      reason: "broken",
    });
  });

  it("reload calls system.control.reload_module", async () => {
    const { registerReloadCommand } = await import("../src/system-cmd.js");
    const { executor, state } = makeExecutor({
      responses: {
        "system.control.reload_module": {
          previous_version: "1.0.0",
          new_version: "1.0.1",
          reload_duration_ms: 42,
        },
      },
    });
    const apcliGroup = new Command("apcli").exitOverride();
    registerReloadCommand(apcliGroup, executor);
    await apcliGroup.parseAsync(
      ["reload", "mymod", "--reason", "bugfix", "--yes", "--format", "json"],
      { from: "user" },
    );
    const call = state.calls.find((c) => c.moduleId === "system.control.reload_module");
    expect(call).toBeDefined();
    expect(call!.input).toMatchObject({ module_id: "mymod", reason: "bugfix" });
  });

  it("config get calls system.config.get", async () => {
    const { registerConfigCommand } = await import("../src/system-cmd.js");
    const { executor, state } = makeExecutor({
      responses: { "system.config.get": { value: 42 } },
    });
    const apcliGroup = new Command("apcli").exitOverride();
    registerConfigCommand(apcliGroup, executor);
    await apcliGroup.parseAsync(["config", "get", "foo.bar", "--format", "json"], { from: "user" });
    const call = state.calls.find((c) => c.moduleId === "system.config.get");
    expect(call).toBeDefined();
    expect(call!.input).toMatchObject({ key: "foo.bar" });
  });

  it("config set calls system.control.update_config with parsed value", async () => {
    const { registerConfigCommand } = await import("../src/system-cmd.js");
    const { executor, state } = makeExecutor({
      responses: {
        "system.control.update_config": { old_value: 1, new_value: 99 },
      },
    });
    const apcliGroup = new Command("apcli").exitOverride();
    registerConfigCommand(apcliGroup, executor);
    await apcliGroup.parseAsync(
      ["config", "set", "foo.bar", "99", "--reason", "tuning", "--format", "json"],
      { from: "user" },
    );
    const call = state.calls.find((c) => c.moduleId === "system.control.update_config");
    expect(call).toBeDefined();
    expect(call!.input).toMatchObject({ key: "foo.bar", value: 99, reason: "tuning" });
  });
});

// ---------------------------------------------------------------------------
// Probe helper: called once per invocation (no duplicate probe work).
// ---------------------------------------------------------------------------

describe("loadProbe caching", () => {
  it("each registrar does NOT re-run the probe on every call", async () => {
    // The split is specified so that `registerXxxCommand` is a pure
    // attach-only operation (no probe). The probe gating happens only
    // inside the backward-compat `registerSystemCommands` wrapper.
    // Therefore: constructing six subcommands from six registrars
    // MUST NOT call executor.validate at all.
    const { registerHealthCommand, registerUsageCommand, registerEnableCommand,
            registerDisableCommand, registerReloadCommand, registerConfigCommand } =
      await import("../src/system-cmd.js");
    const { executor } = makeExecutor();
    const validateSpy = vi.spyOn(executor, "validate" as never);
    const apcliGroup = new Command("apcli");
    registerHealthCommand(apcliGroup, executor);
    registerUsageCommand(apcliGroup, executor);
    registerEnableCommand(apcliGroup, executor);
    registerDisableCommand(apcliGroup, executor);
    registerReloadCommand(apcliGroup, executor);
    registerConfigCommand(apcliGroup, executor);
    expect(validateSpy).not.toHaveBeenCalled();
  });
});

// Backward-compat wrapper registerSystemCommands removed in FE-13
// create-cli-integration. Individual registrar tests above cover attachment
// + behavior parity; the central dispatcher is exercised in tests/main.test.ts.

// ---------------------------------------------------------------------------
// Exit-code fidelity (review fix #3): emitErrorAndExit maps err.code via
// exitCodeForError so scripted callers can distinguish ACL_DENIED (77) from
// MODULE_NOT_FOUND (44) from generic MODULE_EXECUTE_ERROR (1).
// ---------------------------------------------------------------------------

describe("emitErrorAndExit: exit-code fidelity via exitCodeForError", () => {
  it("maps apcore err.code 'ACL_DENIED' to exit(77), not exit(1)", async () => {
    const { registerEnableCommand } = await import("../src/system-cmd.js");
    const aclError = Object.assign(new Error("access denied"), { code: "ACL_DENIED" });
    const executor: Executor = {
      async execute() { throw aclError; },
      async call() { throw aclError; },
    };
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((_code?: number) => {
      throw new Error("__EXIT__");
    }) as never);
    const apcliGroup = new Command("apcli").exitOverride();
    registerEnableCommand(apcliGroup, executor);
    await expect(
      apcliGroup.parseAsync(
        ["enable", "mymod", "--reason", "test", "--yes", "--format", "json"],
        { from: "user" },
      ),
    ).rejects.toThrow("__EXIT__");
    expect(exitSpy).toHaveBeenCalledWith(77);
    exitSpy.mockRestore();
  });

  it("maps apcore err.code 'MODULE_NOT_FOUND' to exit(44)", async () => {
    const { registerDisableCommand } = await import("../src/system-cmd.js");
    const nfError = Object.assign(new Error("not found"), { code: "MODULE_NOT_FOUND" });
    const executor: Executor = {
      async execute() { throw nfError; },
      async call() { throw nfError; },
    };
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((_code?: number) => {
      throw new Error("__EXIT__");
    }) as never);
    const apcliGroup = new Command("apcli").exitOverride();
    registerDisableCommand(apcliGroup, executor);
    await expect(
      apcliGroup.parseAsync(
        ["disable", "mymod", "--reason", "test", "--yes", "--format", "json"],
        { from: "user" },
      ),
    ).rejects.toThrow("__EXIT__");
    expect(exitSpy).toHaveBeenCalledWith(44);
    exitSpy.mockRestore();
  });

  it("falls back to exit(1) when error carries no recognized code", async () => {
    const { registerReloadCommand } = await import("../src/system-cmd.js");
    const executor: Executor = {
      async execute() { throw new Error("generic failure"); },
      async call() { throw new Error("generic failure"); },
    };
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((_code?: number) => {
      throw new Error("__EXIT__");
    }) as never);
    const apcliGroup = new Command("apcli").exitOverride();
    registerReloadCommand(apcliGroup, executor);
    await expect(
      apcliGroup.parseAsync(
        ["reload", "mymod", "--reason", "test", "--yes", "--format", "json"],
        { from: "user" },
      ),
    ).rejects.toThrow("__EXIT__");
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
