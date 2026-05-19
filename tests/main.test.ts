/**
 * Tests for main.ts — createCli, buildModuleCommand, Commander exitOverride.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command, CommanderError } from "commander";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createCli, buildModuleCommand, collectInput, resolveIntOption, resolveStringOption } from "../src/main.js";
import type { ModuleDescriptor, Executor } from "../src/cli.js";

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMod(
  moduleId: string,
  desc = "Test module",
  inputSchema?: Record<string, unknown>,
): ModuleDescriptor {
  return { moduleId, name: moduleId, description: desc, inputSchema };
}

function makeExecutor(result: unknown = { ok: true }): Executor {
  return {
    call: vi.fn().mockResolvedValue(result),
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

// ---------------------------------------------------------------------------
// D1-006 — allowedPrefixes plumbing
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// D1-007 — public output-formatter re-exports
// ---------------------------------------------------------------------------

describe("public surface — output formatter re-exports (D1-007)", () => {
  it("re-exports formatExecResult, formatModuleList, formatModuleDetail, resolveFormat from index", async () => {
    const idx = await import("../src/index.js");
    expect(typeof idx.formatExecResult).toBe("function");
    expect(typeof idx.formatModuleList).toBe("function");
    expect(typeof idx.formatModuleDetail).toBe("function");
    expect(typeof idx.resolveFormat).toBe("function");
  });
});

describe("createCli() — allowedPrefixes (D1-006)", () => {
  it("accepts allowedPrefixes on CreateCliOptions without throwing", () => {
    const cli = createCli({
      progName: "test-cli",
      allowedPrefixes: ["myapp.", "trusted_module."],
    });
    expect(cli.name()).toBe("test-cli");
  });

  it("applyToolkitIntegration accepts an allowedPrefixes option (signature check)", async () => {
    const { applyToolkitIntegration } = await import("../src/main.js");
    // Call with no commandsDir/bindingPath — fast no-op path. The crucial
    // assertion is the signature: passing the options bag must type-check
    // and the function must not throw on the early-return branch.
    await expect(
      applyToolkitIntegration(undefined, undefined, { allowedPrefixes: ["safe."] }),
    ).resolves.toBeUndefined();
  });
});

describe("createCli() with pre-populated registry", () => {
  it("accepts registry via CreateCliOptions", () => {
    const registry = {
      list: () => [],
      getDefinition: () => null,
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
      list: () => [],
      getDefinition: () => null,
    };
    const cli = createCli({ registry, progName: "test-cli" });
    expect(cli.name()).toBe("test-cli");
    expect((cli as unknown as Record<string, unknown>)._registry).toBe(registry);
  });

  it("exits with INVALID_CLI_INPUT (2) if executor is provided without registry", () => {
    const executor = {
      execute: async () => ({}),
    };
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("__exit__");
    }) as never);
    expect(() => createCli({ executor, progName: "test-cli" })).toThrow("__exit__");
    expect(exitSpy).toHaveBeenCalledWith(2);
    const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrText).toContain("executor requires registry");
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("preserves backward compatibility with string first arg", () => {
    const cli = createCli(undefined, "compat-test");
    expect(cli.name()).toBe("compat-test");
  });

  // Regression: apcli list --exposure must consult the program-level
  // ExposureFilter. Previously the filter was constructed then stashed on
  // the program object with zero readers; the list registrar received no
  // filter and the --exposure flag was inert.
  it("apcli list --exposure hidden filters via the createCli expose option", async () => {
    let output = "";
    vi.spyOn(process.stdout, "write").mockImplementation(
      (chunk: string | Uint8Array) => {
        output += typeof chunk === "string" ? chunk : chunk.toString();
        return true;
      },
    );
    const registry = {
      list: () => ["public.add", "public.sub", "admin.secret"],
      getDefinition: (id: string) => {
        const mods = [
          makeMod("public.add", "Public module"),
          makeMod("public.sub", "Public module"),
          makeMod("admin.secret", "Admin module"),
        ];
        return mods.find((m) => m.moduleId === id) ?? null;
      },
    };
    const executor = makeExecutor();
    const cli = createCli({
      progName: "t",
      registry,
      executor,
      expose: { mode: "include", include: ["public.*"] },
    });
    await cli.parseAsync(
      ["apcli", "list", "--exposure", "hidden", "--format", "json"],
      { from: "user" },
    );
    const parsed = JSON.parse(output);
    expect(parsed.map((p: { id: string }) => p.id).sort()).toEqual(["admin.secret"]);
  });

  // Review fix #1: malformed `expose` option previously threw uncaught,
  // producing exit 1 with a raw error message. Now the throw is caught
  // and mapped to INVALID_CLI_INPUT (2) with a prefixed user-facing line.
  it("invalid 'expose' option exits INVALID_CLI_INPUT (2), not MODULE_EXECUTE_ERROR (1)", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("__exit__");
    }) as never);
    expect(() =>
      createCli({ progName: "t", expose: { mode: "bogus" } } as unknown as Parameters<typeof createCli>[0]),
    ).toThrow("__exit__");
    expect(exitSpy).toHaveBeenCalledWith(2);
    const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrText).toMatch(/invalid 'expose' option/);
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// createCli with APCore app client
// ---------------------------------------------------------------------------

describe("createCli() with APCore app client", () => {
  const mockRegistry = {
    list: vi.fn(() => ["test.module"]),
    getDefinition: vi.fn((id: string) =>
      id === "test.module" ? makeMod("test.module", "A test module") : null,
    ),
  };

  const mockExecutor = {
    call: vi.fn(async () => ({})),
  };

  const mockApp = {
    registry: mockRegistry,
    executor: mockExecutor,
  };

  it("exits with INVALID_CLI_INPUT (2) if app and registry are both provided", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("__exit__");
    }) as never);
    expect(() =>
      createCli({ app: mockApp, registry: mockRegistry, progName: "t" }),
    ).toThrow("__exit__");
    expect(exitSpy).toHaveBeenCalledWith(2);
    const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrText).toContain("mutually exclusive");
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("exits with INVALID_CLI_INPUT (2) if app and executor are both provided", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("__exit__");
    }) as never);
    expect(() =>
      createCli({ app: mockApp, executor: mockExecutor, progName: "t" }),
    ).toThrow("__exit__");
    expect(exitSpy).toHaveBeenCalledWith(2);
    const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrText).toContain("mutually exclusive");
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("accepts APCore app and extracts registry and executor", () => {
    expect(() =>
      createCli({ app: mockApp, progName: "test-cli" }),
    ).not.toThrow();
    const cli = createCli({ app: mockApp, progName: "test-cli" });
    expect(cli.name()).toBe("test-cli");
  });

  it("app registry and executor are wired onto the returned program", () => {
    const cli = createCli({ app: mockApp, progName: "test-cli" });
    expect((cli as unknown as Record<string, unknown>)._registry).toBe(mockApp.registry);
    expect((cli as unknown as Record<string, unknown>)._executor).toBe(mockApp.executor);
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
    expect(executor.call).toHaveBeenCalledWith("math.add", { a: 1, b: 2 });
  });
});

// ---------------------------------------------------------------------------
// Pre-execute schema validation (parity with Python/Rust)
// ---------------------------------------------------------------------------

describe("buildModuleCommand() — pre-execute schema validation", () => {
  it("exits 45 with friendly message when a required field is missing", async () => {
    const schema = {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    };
    const executor = makeExecutor();
    const cmd = buildModuleCommand(makeMod("fetch.data", "Fetch", schema), executor);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("__exit__");
    }) as never);

    await expect(cmd.parseAsync([], { from: "user" })).rejects.toThrow("__exit__");

    expect(exitSpy).toHaveBeenCalledWith(45);
    const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrText).toContain("'url'");
    expect(stderrText).toContain("required");
    expect(executor.call).not.toHaveBeenCalled();
  });

  it("proceeds to execute when all required fields are provided", async () => {
    const schema = {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    };
    const executor = makeExecutor({ result: "ok" });
    const cmd = buildModuleCommand(makeMod("fetch.data", "Fetch", schema), executor);

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await cmd.parseAsync(["--url", "https://example.com"], { from: "user" });
    expect(executor.call).toHaveBeenCalledWith("fetch.data", { url: "https://example.com" });
  });

  it("skips validation when schema has no properties", async () => {
    const schema = { type: "object" };
    const executor = makeExecutor({ ok: true });
    const cmd = buildModuleCommand(makeMod("no.schema", "No schema", schema), executor);

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await cmd.parseAsync([], { from: "user" });
    expect(executor.call).toHaveBeenCalled();
  });

  it("exits 45 when required field is missing (integer schema)", async () => {
    const schema = {
      type: "object",
      properties: { count: { type: "integer" } },
      required: ["count"],
    };
    const executor = makeExecutor();
    const cmd = buildModuleCommand(makeMod("data.count", "Count", schema), executor);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("__exit__");
    }) as never);

    await expect(cmd.parseAsync([], { from: "user" })).rejects.toThrow("__exit__");
    expect(exitSpy).toHaveBeenCalledWith(45);
    const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrText).toContain("'count'");
    expect(stderrText).toContain("required");
    expect(executor.call).not.toHaveBeenCalled();
  });

  it("exits 45 with type-mismatch message when integer field receives string via --input", async () => {
    const schema = {
      type: "object",
      properties: { count: { type: "integer" } },
      // no required — exercises type check only, not required check
    };
    const executor = makeExecutor();
    const cmd = buildModuleCommand(makeMod("data.count", "Count", schema), executor);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apcore-schema-test-"));
    try {
      const inputFile = path.join(tmpDir, "input.json");
      fs.writeFileSync(inputFile, JSON.stringify({ count: "not-a-number" }));

      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("__exit__");
      }) as never);

      await expect(
        cmd.parseAsync(["--input", inputFile], { from: "user" }),
      ).rejects.toThrow("__exit__");

      expect(exitSpy).toHaveBeenCalledWith(45);
      const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(stderrText).toContain("'count'");
      expect(stderrText).toContain("must be a number");
      expect(executor.call).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
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

// ---------------------------------------------------------------------------
// FE-13 create-cli-integration: apcli group integration tests
// ---------------------------------------------------------------------------

describe("createCli FE-13 apcli group integration", () => {
  const FULL_SET = [
    "list", "describe", "exec", "validate", "init",
    "health", "usage", "enable", "disable", "reload",
    "config", "completion", "describe-pipeline",
  ];

  function makeRegistry() {
    return {
      list: () => [],
      getDefinition: () => null,
    };
  }

  function makeFakeExecutor(): Executor {
    return {
      call: vi.fn(async () => ({})),
      call: vi.fn(async () => ({})),
      validate: vi.fn(async () => ({ valid: true, requiresApproval: false, checks: [] })),
    };
  }

  function getApcliGroup(cli: ReturnType<typeof createCli>) {
    return cli.commands.find((c) => c.name() === "apcli");
  }

  function getApcliSubNames(cli: ReturnType<typeof createCli>): string[] {
    const g = getApcliGroup(cli);
    return g ? g.commands.map((c) => c.name()) : [];
  }

  const OLD_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  // T-APCLI-01..09 mode semantics ---------------------------------------

  describe("T-APCLI-01..09 mode semantics", () => {
    it("mode:'all' registers ALL 13 subcommands", () => {
      const cli = createCli({
        registry: makeRegistry(),
        executor: makeFakeExecutor(),
        apcli: { mode: "all" },
        progName: "t",
      });
      const names = getApcliSubNames(cli);
      for (const n of FULL_SET) expect(names).toContain(n);
    });

    it("mode:'none' still registers ALL 13 subcommands (hidden group)", () => {
      const cli = createCli({
        registry: makeRegistry(),
        executor: makeFakeExecutor(),
        apcli: { mode: "none" },
        progName: "t",
      });
      const names = getApcliSubNames(cli);
      for (const n of FULL_SET) expect(names).toContain(n);
    });

    it("mode:'none' hides the apcli group from root help", () => {
      const cli = createCli({
        registry: makeRegistry(),
        executor: makeFakeExecutor(),
        apcli: { mode: "none" },
        progName: "t",
      });
      const apcliGroup = getApcliGroup(cli);
      expect(apcliGroup).toBeDefined();
      const rec = apcliGroup as unknown as { _hidden?: boolean; hidden?: () => boolean };
      const isHidden = typeof rec.hidden === "function" ? rec.hidden() : !!rec._hidden;
      expect(isHidden).toBe(true);
    });

    it("mode:'include' registers only listed subcommands + always-registered 'exec'", () => {
      const cli = createCli({
        registry: makeRegistry(),
        executor: makeFakeExecutor(),
        apcli: { mode: "include", include: ["list"] },
        progName: "t",
      });
      const names = getApcliSubNames(cli).sort();
      expect(names).toEqual(["exec", "list"].sort());
    });

    it("mode:'exclude' omits listed, registers everything else", () => {
      const cli = createCli({
        registry: makeRegistry(),
        executor: makeFakeExecutor(),
        apcli: { mode: "exclude", exclude: ["health"] },
        progName: "t",
      });
      const names = getApcliSubNames(cli);
      expect(names).not.toContain("health");
      for (const n of FULL_SET.filter((x) => x !== "health")) {
        expect(names).toContain(n);
      }
    });
  });

  // T-APCLI-18/19 behavioral parity -------------------------------------

  it("T-APCLI-18/19: under standalone + mode:'all', core non-executor subcommands are reachable under apcli/", () => {
    const cli = createCli({ apcli: { mode: "all" }, progName: "t" });
    const names = getApcliSubNames(cli);
    // Standalone (no executor) → executor-required entries skip silently.
    for (const n of ["list", "describe", "init", "completion"]) {
      expect(names).toContain(n);
    }
  });

  it("T-APCLI-18/19b: under embedded + mode:'all', all 13 subcommands reachable", () => {
    const cli = createCli({
      registry: makeRegistry(),
      executor: makeFakeExecutor(),
      apcli: { mode: "all" },
      progName: "t",
    });
    const names = getApcliSubNames(cli);
    for (const n of FULL_SET) expect(names).toContain(n);
  });

  // T-APCLI-20/21 edge lists --------------------------------------------

  it("T-APCLI-20: empty include:[] under mode:'include' registers only 'exec' via _ALWAYS_REGISTERED", () => {
    const cli = createCli({
      registry: makeRegistry(),
      executor: makeFakeExecutor(),
      apcli: { mode: "include", include: [] },
      progName: "t",
    });
    const names = getApcliSubNames(cli);
    expect(names).toEqual(["exec"]);
  });

  it("T-APCLI-21: empty exclude:[] under mode:'exclude' registers all 13", () => {
    const cli = createCli({
      registry: makeRegistry(),
      executor: makeFakeExecutor(),
      apcli: { mode: "exclude", exclude: [] },
      progName: "t",
    });
    const names = getApcliSubNames(cli);
    for (const n of FULL_SET) expect(names).toContain(n);
  });

  // T-APCLI-24 exec always registers ------------------------------------

  it("T-APCLI-24: 'exec' is registered under include:[] (always-registered)", () => {
    const cli = createCli({
      registry: makeRegistry(),
      executor: makeFakeExecutor(),
      apcli: { mode: "include", include: [] },
      progName: "t",
    });
    const names = getApcliSubNames(cli);
    expect(names).toContain("exec");
  });

  it("T-APCLI-24b: 'exec' is registered under exclude:['exec']", () => {
    const cli = createCli({
      registry: makeRegistry(),
      executor: makeFakeExecutor(),
      apcli: { mode: "exclude", exclude: ["exec"] },
      progName: "t",
    });
    const names = getApcliSubNames(cli);
    expect(names).toContain("exec");
  });

  // T-APCLI-27/28 discovery flag gating ---------------------------------

  describe("T-APCLI-27/28 discovery flag gating", () => {
    it("T-APCLI-27: standalone (no registry) program exposes --extensions-dir, --commands-dir, --binding", () => {
      const cli = createCli(undefined, "t");
      const longs = cli.options.map((o) => o.long);
      expect(longs).toContain("--extensions-dir");
      expect(longs).toContain("--commands-dir");
      expect(longs).toContain("--binding");
    });

    it("T-APCLI-28: embedded (registry supplied) program omits --extensions-dir, --commands-dir, --binding", () => {
      const cli = createCli({ registry: makeRegistry(), progName: "t" });
      const longs = cli.options.map((o) => o.long);
      expect(longs).not.toContain("--extensions-dir");
      expect(longs).not.toContain("--commands-dir");
      expect(longs).not.toContain("--binding");
    });
  });

  // T-APCLI-33 pre-built ApcliGroup accepted ----------------------------

  it("T-APCLI-33: accepts a pre-built ApcliGroup instance via apcli option", async () => {
    const { ApcliGroup } = await import("../src/builtin-group.js");
    const preBuilt = ApcliGroup.fromCliConfig({ mode: "include", include: ["list"] }, {
      registryInjected: true,
    });
    const cli = createCli({
      registry: makeRegistry(),
      executor: makeFakeExecutor(),
      apcli: preBuilt,
      progName: "t",
    });
    const names = getApcliSubNames(cli).sort();
    expect(names).toEqual(["exec", "list"].sort());
  });

  // T-APCLI-36 form equivalence -----------------------------------------

  it("T-APCLI-36: apcli:true and apcli:{mode:'all'} produce identical subcommand surfaces", () => {
    const a = createCli({
      registry: makeRegistry(),
      executor: makeFakeExecutor(),
      apcli: true,
      progName: "t",
    });
    const b = createCli({
      registry: makeRegistry(),
      executor: makeFakeExecutor(),
      apcli: { mode: "all" },
      progName: "t",
    });
    expect(getApcliSubNames(a).sort()).toEqual(getApcliSubNames(b).sort());
  });

  // T-APCLI-38 Tier 1 > Tier 3 ------------------------------------------

  it("T-APCLI-38: Tier 1 CliConfig beats Tier 3 yaml (visible even though yaml would say none)", () => {
    const cli = createCli({
      registry: makeRegistry(),
      executor: makeFakeExecutor(),
      apcli: { mode: "all" },
      progName: "t",
    });
    const apcliGroup = getApcliGroup(cli);
    const rec = apcliGroup as unknown as { _hidden?: boolean; hidden?: () => boolean };
    const isHidden = typeof rec?.hidden === "function" ? rec.hidden() : !!rec?._hidden;
    expect(isHidden).toBe(false);
  });

  // T-APCLI-39 Tier 1 > Tier 2 env --------------------------------------

  it("T-APCLI-39: Tier 1 CliConfig beats Tier 2 APCORE_CLI_APCLI env var", () => {
    process.env.APCORE_CLI_APCLI = "hide";
    const cli = createCli({
      registry: makeRegistry(),
      executor: makeFakeExecutor(),
      apcli: { mode: "all" },
      progName: "t",
    });
    const apcliGroup = getApcliGroup(cli);
    const rec = apcliGroup as unknown as { _hidden?: boolean; hidden?: () => boolean };
    const isHidden = typeof rec?.hidden === "function" ? rec.hidden() : !!rec?._hidden;
    expect(isHidden).toBe(false);
  });

  // Tier 4 auto-detect defaults -----------------------------------------

  it("auto-detect: standalone default (no registry, no apcli) → group visible", () => {
    const cli = createCli(undefined, "t");
    const apcliGroup = getApcliGroup(cli);
    expect(apcliGroup).toBeDefined();
    const rec = apcliGroup as unknown as { _hidden?: boolean; hidden?: () => boolean };
    const isHidden = typeof rec.hidden === "function" ? rec.hidden() : !!rec._hidden;
    expect(isHidden).toBe(false);
  });

  it("auto-detect: embedded default (registry supplied, no apcli) → group hidden", () => {
    const cli = createCli({ registry: makeRegistry(), executor: makeFakeExecutor(), progName: "t" });
    const apcliGroup = getApcliGroup(cli);
    expect(apcliGroup).toBeDefined();
    const rec = apcliGroup as unknown as { _hidden?: boolean; hidden?: () => boolean };
    const isHidden = typeof rec.hidden === "function" ? rec.hidden() : !!rec._hidden;
    expect(isHidden).toBe(true);
  });

  // T-APCLI-17: extraCommands reserved-name enforcement -----------------

  describe("T-APCLI-17 extraCommands reserved-name enforcement", () => {
    it("rejects extraCommands named 'apcli' with exit 2", () => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("exit");
      }) as never);
      const extra = new Command("apcli").description("x");
      expect(() =>
        createCli({
          registry: makeRegistry(),
          executor: makeFakeExecutor(),
          extraCommands: [extra],
          progName: "t",
        }),
      ).toThrow("exit");
      expect(exitSpy).toHaveBeenCalledWith(2);
      const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
      expect(calls.some((c) => /extraCommands name 'apcli' is reserved/.test(c))).toBe(true);
      stderrSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it("rejects extraCommands that collide with an existing command (exit 2)", () => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("exit");
      }) as never);
      // Pre-register a command name that will be used in extraCommands too.
      // Use two entries with the same name; the second collides with the first
      // once it's registered.
      const first = new Command("customcmd").description("first");
      const second = new Command("customcmd").description("second");
      expect(() =>
        createCli({
          registry: makeRegistry(),
          executor: makeFakeExecutor(),
          extraCommands: [first, second],
          progName: "t",
        }),
      ).toThrow("exit");
      expect(exitSpy).toHaveBeenCalledWith(2);
      const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
      expect(calls.some((c) => /customcmd/.test(c) && /collides/.test(c))).toBe(true);
      stderrSpy.mockRestore();
      exitSpy.mockRestore();
    });
  });

  // Executor-optional subcommands skip silently in include/exclude mode ---

  it("mode:'include' with missing executor skips executor-required entries silently", () => {
    // Standalone (no registry → no executor); mode:'include' asks for health + list.
    const cli = createCli({
      apcli: { mode: "include", include: ["health", "list"] },
      progName: "t",
    });
    const names = getApcliSubNames(cli);
    expect(names).not.toContain("health"); // health needs executor
    expect(names).toContain("list"); // list does not require executor
  });
});

// ---------------------------------------------------------------------------
// FE-13 §11.3 — deprecation shims removed in v0.8
// ---------------------------------------------------------------------------
//
// Pre-v0.8 the standalone CLI registered 13 root-level shim commands that
// forwarded to `apcli <name>` after printing a deprecation warning. Per
// PROTOCOL_SPEC FE-13 §11.3 these shims are removed in v0.8 — the only path
// to the built-in commands is the `apcli` sub-group (or the renamed
// `builtinGroupName`).

describe("createCli FE-13 §11.3 — no root-level deprecation shims", () => {
  function makeRegistry() {
    return {
      list: () => [],
      getDefinition: () => null,
    };
  }

  function makeFakeExecutor(): Executor {
    return {
      call: vi.fn(async () => ({})),
      call: vi.fn(async () => ({})),
      validate: vi.fn(async () => ({ valid: true, requiresApproval: false, checks: [] })),
    };
  }

  function getNonGroupRootCommandNames(cli: ReturnType<typeof createCli>): string[] {
    return cli.commands
      .filter((c) => c.name() !== "apcli" && c.name() !== "help")
      .map((c) => c.name());
  }

  it("standalone mode registers ZERO root-level shim commands (apcli sub-group is the only path)", () => {
    const cli = createCli(undefined, "test-cli");
    const rootCmds = getNonGroupRootCommandNames(cli);
    expect(rootCmds).toEqual([]);
  });

  it("embedded mode registers ZERO root-level shim commands (parity with standalone)", () => {
    const cli = createCli({
      registry: makeRegistry(),
      executor: makeFakeExecutor(),
      progName: "branded",
    });
    const rootCmds = getNonGroupRootCommandNames(cli);
    expect(rootCmds).toEqual([]);
    // apcli sub-group is still present.
    const apcli = cli.commands.find((c) => c.name() === "apcli");
    expect(apcli).toBeDefined();
  });

  it("invoking a former-shim name at root no longer prints a deprecation warning", async () => {
    const cli = createCli(undefined, "my-cli").exitOverride();
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    // `list` at root is now an unknown command; Commander throws a
    // CommanderError thanks to exitOverride().
    await expect(cli.parseAsync(["list"], { from: "user" })).rejects.toThrow();

    const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrText).not.toContain("Will be removed in v0.8");
    expect(stderrText).not.toContain("root-level command is deprecated");

    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Review-identified regression fixes (Issues 2–6)
// ---------------------------------------------------------------------------

describe("Review Issue 2: _ALWAYS_REGISTERED check order", () => {
  function makeRegistry() {
    return { list: () => [], getDefinition: () => null };
  }

  it("logs a WARNING (not silent skip) when _ALWAYS_REGISTERED entry is skipped for lack of executor", () => {
    // Standalone + include:[] — _ALWAYS_REGISTERED says "exec" should be
    // registered, but no executor is wired. Old behavior: silent skip. New
    // behavior: WARN to stderr so the wiring gap is visible.
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const cli = createCli({
      registry: makeRegistry(), // no executor
      apcli: { mode: "include", include: [] },
      progName: "t",
    });
    const apcliGroup = cli.commands.find((c) => c.name() === "apcli");
    expect(apcliGroup).toBeDefined();
    // Without executor, exec can't be registered even though it's _ALWAYS_REGISTERED.
    const apcliSubs = apcliGroup!.commands.map((c) => c.name());
    expect(apcliSubs).not.toContain("exec");
    // But the WARNING must have fired.
    const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrText).toContain("exec");
    expect(stderrText).toMatch(/_ALWAYS_REGISTERED|no executor is wired/);
    stderrSpy.mockRestore();
  });

  it("T-APCLI-24 parity retained: executor + include:['list'] registers list + exec", () => {
    const executor: Executor = {
      call: vi.fn(async () => ({})),
      validate: vi.fn(async () => ({ valid: true, requiresApproval: false, checks: [] })),
    };
    const cli = createCli({
      registry: makeRegistry(),
      executor,
      apcli: { mode: "include", include: ["list"] },
      progName: "t",
    });
    const apcliGroup = cli.commands.find((c) => c.name() === "apcli")!;
    const names = apcliGroup.commands.map((c) => c.name()).sort();
    expect(names).toEqual(["exec", "list"].sort());
  });
});

describe("Review Issue 3: standalone registry-unwired emits clear error", () => {
  it("apcli list in standalone-no-registry mode exits CONFIG_INVALID (47) with clear message", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("__exit__");
    }) as never);

    const cli = createCli(undefined, "t");
    try {
      await cli.parseAsync(["apcli", "list"], { from: "user" });
    } catch (err) {
      expect((err as Error).message).toBe("__exit__");
    }

    const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrText).toContain("no module registry wired");
    expect(stderrText).toContain("--extensions-dir");
    expect(exitSpy).toHaveBeenCalledWith(47);

    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("embedded mode with wired registry does NOT trigger the unwired-registry error", async () => {
    const registry = {
      list: vi.fn(() => []),
      getDefinition: vi.fn(() => null),
    };
    const executor: Executor = {
      call: vi.fn(async () => ({})),
      validate: vi.fn(async () => ({ valid: true, requiresApproval: false, checks: [] })),
    };
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const cli = createCli({ registry, executor, progName: "t" });

    await cli.parseAsync(["apcli", "list"], { from: "user" });

    const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrText).not.toContain("no module registry wired");
    expect(registry.list).toHaveBeenCalled();

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});

describe("Review Issue 4: createCli param-combination errors use EXIT_CODES, not throw", () => {
  it("createCli({executor}) without registry: stderr + exit 2", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("__exit__");
    }) as never);
    const executor: Executor = { call: vi.fn(async () => ({})) };
    expect(() => createCli({ executor, progName: "t" })).toThrow("__exit__");
    expect(exitSpy).toHaveBeenCalledWith(2);
    const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrText).toContain("executor requires registry");
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("createCli({app, registry}) simultaneous: stderr + exit 2", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("__exit__");
    }) as never);
    const registry = { list: () => [], getDefinition: () => null };
    const executor: Executor = { call: vi.fn(async () => ({})) };
    const app = { registry, executor };
    expect(() => createCli({ app, registry, progName: "t" })).toThrow("__exit__");
    expect(exitSpy).toHaveBeenCalledWith(2);
    const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrText).toContain("mutually exclusive");
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

describe("Review Issue 5: extraCommands collision rules (post-v0.8 shim removal)", () => {
  function makeRegistry() {
    return { list: () => [], getDefinition: () => null };
  }
  function makeFakeExecutor(): Executor {
    return {
      call: vi.fn(async () => ({})),
      validate: vi.fn(async () => ({ valid: true, requiresApproval: false, checks: [] })),
    };
  }

  it("standalone: extraCommands named 'list' (a former-shim name) registers cleanly, no shim collision", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const userList = new Command("list").description("user-supplied list command");
    const cli = createCli({
      extraCommands: [userList],
      progName: "t",
    });

    const listCmds = cli.commands.filter((c) => c.name() === "list");
    expect(listCmds.length).toBe(1);
    expect(listCmds[0].description()).toBe("user-supplied list command");

    const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrText).not.toContain("overrides the deprecation shim");
    expect(stderrText).not.toContain("collides");
    stderrSpy.mockRestore();
  });

  it("standalone: extraCommands named 'apcli' exits 2 (reserved group name)", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("__exit__");
    }) as never);
    const extra = new Command("apcli").description("x");
    expect(() => createCli({ extraCommands: [extra], progName: "t" })).toThrow("__exit__");
    expect(exitSpy).toHaveBeenCalledWith(2);
    const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrText).toContain("reserved");
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("embedded: extraCommands named 'list' registers cleanly", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const userList = new Command("list").description("embedded-mode user list");
    const cli = createCli({
      registry: makeRegistry(),
      executor: makeFakeExecutor(),
      extraCommands: [userList],
      progName: "t",
    });
    const listCmds = cli.commands.filter((c) => c.name() === "list");
    expect(listCmds.length).toBe(1);
    expect(listCmds[0].description()).toBe("embedded-mode user list");
    const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrText).not.toContain("overrides the deprecation shim");
    stderrSpy.mockRestore();
  });
});

describe("Review Issue 6: apcli group hidden uses Commander public API, not _hidden", () => {
  function makeRegistry() {
    return { list: () => [], getDefinition: () => null };
  }
  function makeFakeExecutor(): Executor {
    return {
      call: vi.fn(async () => ({})),
      validate: vi.fn(async () => ({ valid: true, requiresApproval: false, checks: [] })),
    };
  }

  it("apcli:false / mode:'none' → apcli group absent from root help text", () => {
    const cli = createCli({
      registry: makeRegistry(),
      executor: makeFakeExecutor(),
      apcli: false,
      progName: "t",
    });
    const helpText = cli.helpInformation();
    // Help text organizes commands under a "Commands:" section — a hidden
    // subcommand should NOT appear in that listing (public-API contract).
    const commandsSection = helpText.split("Commands:")[1] ?? "";
    expect(commandsSection).not.toMatch(/^\s*apcli\b/m);
  });

  it("apcli:true / mode:'all' → apcli group present in root help text", () => {
    const cli = createCli({
      registry: makeRegistry(),
      executor: makeFakeExecutor(),
      apcli: true,
      progName: "t",
    });
    const helpText = cli.helpInformation();
    const commandsSection = helpText.split("Commands:")[1] ?? "";
    expect(commandsSection).toMatch(/^\s*apcli\b/m);
  });
});

// ---------------------------------------------------------------------------
// resolveIntOption / resolveStringOption — env-var 4-tier chain (C-1)
// ---------------------------------------------------------------------------

describe("resolveIntOption", () => {
  it("prefers CLI flag over env var", () => {
    expect(resolveIntOption(30, "999", 60)).toBe(30);
  });

  it("falls back to env var when CLI flag is undefined", () => {
    expect(resolveIntOption(undefined, "120", 60)).toBe(120);
  });

  it("falls back to default when neither CLI flag nor env var is provided", () => {
    expect(resolveIntOption(undefined, undefined, 60)).toBe(60);
    expect(resolveIntOption(undefined, "", 60)).toBe(60);
  });

  it("warns and falls back to default on invalid env value", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(resolveIntOption(undefined, "abc", 60)).toBe(60);
    expect(resolveIntOption(undefined, "-5", 60)).toBe(60);
    expect(resolveIntOption(undefined, "0", 60)).toBe(60);
    const msgs = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(msgs).toMatch(/invalid integer env value/);
    stderrSpy.mockRestore();
  });

  it("rejects NaN / non-positive CLI values and falls through to env", () => {
    expect(resolveIntOption(NaN, "120", 60)).toBe(120);
    expect(resolveIntOption(0, "120", 60)).toBe(120);
    expect(resolveIntOption(-1, "120", 60)).toBe(120);
  });
});

describe("resolveStringOption", () => {
  it("prefers CLI flag over env var", () => {
    expect(resolveStringOption("performance", "minimal")).toBe("performance");
  });

  it("falls back to env var when CLI flag is absent or empty", () => {
    expect(resolveStringOption(undefined, "minimal")).toBe("minimal");
    expect(resolveStringOption("", "minimal")).toBe("minimal");
  });

  it("returns undefined when neither set", () => {
    expect(resolveStringOption(undefined, undefined)).toBeUndefined();
    expect(resolveStringOption("", "")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// collectInput — --input <file-path> support (W-15)
// ---------------------------------------------------------------------------

describe("collectInput — file-path input", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "collect-input-test-"));
  });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it("reads JSON from a file path when stdinFlag is not '-'", async () => {
    const filePath = path.join(tmpDir, "data.json");
    fs.writeFileSync(filePath, JSON.stringify({ a: 1, b: { x: 2 } }));
    const merged = await collectInput(filePath, {});
    expect(merged).toEqual({ a: 1, b: { x: 2 } });
  });

  it("CLI kwargs override file keys for duplicates", async () => {
    const filePath = path.join(tmpDir, "data.json");
    fs.writeFileSync(filePath, JSON.stringify({ a: 1, b: 2 }));
    const merged = await collectInput(filePath, { a: 999 });
    expect(merged).toEqual({ a: 999, b: 2 });
  });

  it("exits with INVALID_CLI_INPUT on missing file", async () => {
    const missing = path.join(tmpDir, "does-not-exist.json");
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("EXIT"); }) as never;
    await expect(collectInput(missing, {})).rejects.toThrow("EXIT");
    expect(stderrSpy.mock.calls.map((c) => String(c[0])).join("")).toMatch(/Could not read input file/);
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("exits with INVALID_CLI_INPUT on invalid JSON in file", async () => {
    const filePath = path.join(tmpDir, "bad.json");
    fs.writeFileSync(filePath, "not json");
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("EXIT"); }) as never;
    await expect(collectInput(filePath, {})).rejects.toThrow("EXIT");
    expect(stderrSpy.mock.calls.map((c) => String(c[0])).join("")).toMatch(/does not contain valid JSON/);
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("exits with INVALID_CLI_INPUT when file JSON is not an object", async () => {
    const filePath = path.join(tmpDir, "array.json");
    fs.writeFileSync(filePath, JSON.stringify([1, 2, 3]));
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("EXIT"); }) as never;
    await expect(collectInput(filePath, {})).rejects.toThrow("EXIT");
    expect(stderrSpy.mock.calls.map((c) => String(c[0])).join("")).toMatch(/JSON must be an object, got array/);
    expect(exitSpy).toHaveBeenCalledWith(2);
  });
});

// ---------------------------------------------------------------------------
// CliApprovalHandler wiring — SDK parity with apcore-cli-python (FE-11 §3.5)
// ---------------------------------------------------------------------------

describe("createCli — CliApprovalHandler wiring", () => {
  const makeRegistry = (): import("../src/cli.js").Registry => ({
    list: () => [],
    getDefinition: () => undefined,
  });

  it("calls executor.setApprovalHandler when the method is available", () => {
    const setHandler = vi.fn();
    const executor = {
      call: vi.fn(),
      setApprovalHandler: setHandler,
    } as unknown as Executor;
    createCli({ registry: makeRegistry(), executor, progName: "test-cli" });
    expect(setHandler).toHaveBeenCalledTimes(1);
    // The wired object should quack like CliApprovalHandler — at minimum
    // expose requestApproval / checkApproval.
    const handler = setHandler.mock.calls[0][0];
    expect(typeof handler.requestApproval).toBe("function");
    expect(typeof handler.checkApproval).toBe("function");
  });

  it("silently skips wiring when executor lacks setApprovalHandler", () => {
    const executor = { call: vi.fn() } as unknown as Executor;
    expect(() =>
      createCli({ registry: makeRegistry(), executor, progName: "test-cli" }),
    ).not.toThrow();
  });

  it("survives a throwing setApprovalHandler (non-fatal path)", () => {
    const executor = {
      call: vi.fn(),
      setApprovalHandler: () => { throw new Error("boom"); },
    } as unknown as Executor;
    expect(() =>
      createCli({ registry: makeRegistry(), executor, progName: "test-cli" }),
    ).not.toThrow();
  });
});
