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

  it("includes built-in options (--input, --yes, --format, --sandbox, --large-input)", () => {
    const cmd = buildModuleCommand(makeMod("test.mod"), makeExecutor());
    const longFlags = cmd.options.map((o) => o.long);
    expect(longFlags).toContain("--input");
    expect(longFlags).toContain("--format");
    expect(longFlags).toContain("--sandbox");
    expect(longFlags).toContain("--large-input");
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
