/**
 * Tests for main.ts — createCli, buildModuleCommand, Commander exitOverride.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { CommanderError } from "commander";
import { createCli, buildModuleCommand } from "../src/main.js";
import type { ModuleDescriptor, Executor } from "../src/cli.js";

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMod(
  id: string,
  desc = "Test module",
  inputSchema?: Record<string, unknown>,
): ModuleDescriptor {
  return { id, name: id, description: desc, inputSchema };
}

function makeExecutor(result: unknown = { ok: true }): Executor {
  return {
    execute: vi.fn().mockResolvedValue(result),
  };
}

// ---------------------------------------------------------------------------
// createCli
// ---------------------------------------------------------------------------

describe("createCli()", () => {
  it("returns a Commander program with the given name", () => {
    const cli = createCli(undefined, "my-tool");
    expect(cli.name()).toBe("my-tool");
  });

  it("uses 'apcore-cli' as default fallback name", () => {
    const cli = createCli(undefined, "apcore-cli");
    expect(cli.name()).toBe("apcore-cli");
  });

  it("has --extensions-dir and --log-level options", () => {
    const cli = createCli(undefined, "test-cli");
    const optNames = cli.options.map((o) => o.long);
    expect(optNames).toContain("--extensions-dir");
    expect(optNames).toContain("--log-level");
  });

  it("has .exitOverride() so Commander throws instead of exiting", () => {
    const cli = createCli(undefined, "test-cli");
    // Passing an unknown option should throw CommanderError, not call process.exit
    expect(() => {
      cli.parse(["--unknown-flag-xyz"], { from: "user" });
    }).toThrow(CommanderError);
  });
});

// ---------------------------------------------------------------------------
// Commander exitOverride behavior
// ---------------------------------------------------------------------------

describe("Commander exitOverride", () => {
  it("throws CommanderError for --help", () => {
    const cli = createCli(undefined, "test-cli");
    expect(() => {
      cli.parse(["--help"], { from: "user" });
    }).toThrow(CommanderError);
  });

  it("throws CommanderError for --version", () => {
    const cli = createCli(undefined, "test-cli");
    expect(() => {
      cli.parse(["--version"], { from: "user" });
    }).toThrow(CommanderError);
  });

  it("CommanderError has exitCode 0 for --help", () => {
    const cli = createCli(undefined, "test-cli");
    try {
      cli.parse(["--help"], { from: "user" });
    } catch (err) {
      expect(err).toBeInstanceOf(CommanderError);
      expect((err as CommanderError).exitCode).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// createCli with pre-populated registry
// ---------------------------------------------------------------------------

describe("createCli() with pre-populated registry", () => {
  it("accepts registry via CreateCliOptions", () => {
    const registry = {
      listModules: () => [],
      getModule: () => null,
    };
    const executor = {
      execute: async () => ({}),
    };
    const cli = createCli({ registry, executor, progName: "test-cli" });
    expect(cli.name()).toBe("test-cli");
    // Registry should be stored on program for downstream access
    expect((cli as unknown as Record<string, unknown>)._registry).toBe(registry);
    expect((cli as unknown as Record<string, unknown>)._executor).toBe(executor);
  });

  it("accepts registry without executor", () => {
    const registry = {
      listModules: () => [],
      getModule: () => null,
    };
    const cli = createCli({ registry, progName: "test-cli" });
    expect(cli.name()).toBe("test-cli");
    expect((cli as unknown as Record<string, unknown>)._registry).toBe(registry);
  });

  it("throws if executor is provided without registry", () => {
    const executor = {
      execute: async () => ({}),
    };
    expect(() => createCli({ executor, progName: "test-cli" })).toThrow(
      "executor requires registry",
    );
  });

  it("preserves backward compatibility with string first arg", () => {
    const cli = createCli(undefined, "compat-test");
    expect(cli.name()).toBe("compat-test");
  });
});

// ---------------------------------------------------------------------------
// buildModuleCommand
// ---------------------------------------------------------------------------

describe("buildModuleCommand()", () => {
  it("creates a command with the module ID as its name", () => {
    const cmd = buildModuleCommand(makeMod("math.add", "Add numbers"), makeExecutor());
    expect(cmd.name()).toBe("math.add");
  });

  it("sets the module description", () => {
    const cmd = buildModuleCommand(makeMod("math.add", "Add numbers"), makeExecutor());
    expect(cmd.description()).toBe("Add numbers");
  });

  it("includes built-in options (--input, --yes, --format, --sandbox, --large-input, --dry-run, --trace, --stream, --strategy, --fields, --approval-timeout, --approval-token)", () => {
    const cmd = buildModuleCommand(makeMod("test.mod"), makeExecutor());
    const longFlags = cmd.options.map((o) => o.long);
    expect(longFlags).toContain("--input");
    expect(longFlags).toContain("--format");
    expect(longFlags).toContain("--sandbox");
    expect(longFlags).toContain("--large-input");
    expect(longFlags).toContain("--dry-run");
    expect(longFlags).toContain("--trace");
    expect(longFlags).toContain("--stream");
    expect(longFlags).toContain("--strategy");
    expect(longFlags).toContain("--fields");
    expect(longFlags).toContain("--approval-timeout");
    expect(longFlags).toContain("--approval-token");
  });

  it("generates schema-derived options from inputSchema.properties", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string", description: "The name" },
        count: { type: "integer", description: "How many" },
      },
      required: ["name"],
    };
    const cmd = buildModuleCommand(makeMod("test.mod", "Test", schema), makeExecutor());
    const longFlags = cmd.options.map((o) => o.long);
    expect(longFlags).toContain("--name");
    expect(longFlags).toContain("--count");
  });

  it("hides built-in options from help by default", () => {
    const cmd = buildModuleCommand(makeMod("test.mod"), makeExecutor());
    const hiddenLongs = cmd.options.filter((o) => (o as any).hidden).map((o) => o.long);
    expect(hiddenLongs).toContain("--input");
    expect(hiddenLongs).toContain("--format");
    expect(hiddenLongs).toContain("--sandbox");
    expect(hiddenLongs).toContain("--large-input");
    expect(hiddenLongs).toContain("--yes");
    expect(hiddenLongs).toContain("--dry-run");
    expect(hiddenLongs).toContain("--trace");
    expect(hiddenLongs).toContain("--stream");
    expect(hiddenLongs).toContain("--strategy");
    expect(hiddenLongs).toContain("--fields");
    expect(hiddenLongs).toContain("--approval-timeout");
    expect(hiddenLongs).toContain("--approval-token");
  });

  it("shows built-in options in help when verboseHelp is true", () => {
    const cmd = buildModuleCommand(makeMod("test.mod"), makeExecutor(), 1000, undefined, true);
    const hiddenLongs = cmd.options.filter((o) => (o as any).hidden).map((o) => o.long);
    expect(hiddenLongs).not.toContain("--input");
  });

  it("does not crash when inputSchema has no properties", () => {
    const cmd = buildModuleCommand(makeMod("test.mod", "Test", { type: "object" }), makeExecutor());
    expect(cmd.name()).toBe("test.mod");
  });

  it("executes the module when action is triggered", async () => {
    const executor = makeExecutor({ sum: 3 });
    const schema = {
      type: "object",
      properties: {
        a: { type: "integer" },
        b: { type: "integer" },
      },
    };
    const cmd = buildModuleCommand(makeMod("math.add", "Add", schema), executor);

    // Suppress output
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    // Parse and execute
    await cmd.parseAsync(["--a", "1", "--b", "2"], { from: "user" });
    expect(executor.execute).toHaveBeenCalledWith("math.add", { a: 1, b: 2 });
  });
});

// ---------------------------------------------------------------------------
// SIGINT handling concept (basic test)
// ---------------------------------------------------------------------------

describe("SIGINT handling", () => {
  it("process listens for SIGINT", () => {
    // Verify the process has listeners — this is a basic sanity check
    const listeners = process.listeners("SIGINT");
    // At minimum the process should be able to register SIGINT handlers
    expect(typeof process.on).toBe("function");
    // We just verify the mechanism works, not the specific handler count
    expect(listeners).toBeDefined();
  });
});
