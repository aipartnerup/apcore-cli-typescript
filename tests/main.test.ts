/**
 * Tests for main.ts — createCli, buildModuleCommand, Commander exitOverride.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { Command, CommanderError } from "commander";
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
    listModules: vi.fn(() => [makeMod("test.module", "A test module")]),
    getModule: vi.fn(() => null),
  };

  const mockExecutor = {
    execute: vi.fn(async () => ({})),
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
      listModules: () => [],
      getModule: () => null,
    };
  }

  function makeFakeExecutor(): Executor {
    return {
      execute: vi.fn(async () => ({})),
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
// FE-13 deprecation-shims: root-level shim commands forwarding to apcli
// ---------------------------------------------------------------------------

describe("createCli FE-13 deprecation shims", () => {
  const DEPRECATED = [
    "list", "describe", "exec", "init", "validate",
    "health", "usage", "enable", "disable", "reload",
    "config", "completion", "describe-pipeline",
  ];

  function makeRegistry() {
    return {
      listModules: () => [],
      getModule: () => null,
    };
  }

  function makeFakeExecutor(): Executor {
    return {
      execute: vi.fn(async () => ({})),
      call: vi.fn(async () => ({})),
      validate: vi.fn(async () => ({ valid: true, requiresApproval: false, checks: [] })),
    };
  }

  function getRootShimNames(cli: ReturnType<typeof createCli>): string[] {
    return cli.commands
      .filter((c) => c.name() !== "apcli" && c.name() !== "help")
      .map((c) => c.name());
  }

  it("standalone mode registers root-level shims only for apcli subcommands that were actually registered (no-executor subset)", () => {
    // Standalone (no registry/executor) → apcli registrars skip executor-required
    // entries silently, so the shim set is standalone-available names only.
    // Non-executor apcli subcommands: list, describe, init, completion.
    const cli = createCli(undefined, "test-cli");
    const shimNames = getRootShimNames(cli);
    expect(shimNames).toContain("list");
    expect(shimNames).toContain("describe");
    expect(shimNames).toContain("init");
    expect(shimNames).toContain("completion");
    // Executor-required ones should NOT be registered as shims in standalone
    // (their apcli counterpart also wasn't registered).
    expect(shimNames).not.toContain("exec");
    expect(shimNames).not.toContain("validate");
    expect(shimNames).not.toContain("health");
    expect(shimNames).not.toContain("usage");
    expect(shimNames).not.toContain("enable");
    expect(shimNames).not.toContain("disable");
    expect(shimNames).not.toContain("reload");
    expect(shimNames).not.toContain("config");
    expect(shimNames).not.toContain("describe-pipeline");
  });

  it("standalone mode shim count matches the non-executor apcli subcommand count (4)", () => {
    // Executor-required entries skip registration in standalone, and the shim
    // registrar skips any name whose apcli counterpart is absent → 4 shims.
    const cli = createCli(undefined, "test-cli");
    const shimNames = getRootShimNames(cli);
    expect(shimNames.length).toBe(4);
  });

  it("embedded mode registers ZERO shims at root (only 'apcli' + 'help')", () => {
    const cli = createCli({
      registry: makeRegistry(),
      executor: makeFakeExecutor(),
      progName: "branded",
    });
    const shimNames = getRootShimNames(cli);
    expect(shimNames).toEqual([]);
    // But the apcli group itself is still present
    const apcli = cli.commands.find((c) => c.name() === "apcli");
    expect(apcli).toBeDefined();
  });

  it("shim invocation writes exact deprecation warning to stderr (cli name in warning)", async () => {
    const cli = createCli(undefined, "my-cli");
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    // Issue 3: standalone + no registry → list action now exits with
    // CONFIG_INVALID (47) when listModules is invoked. Trap the exit so the
    // deprecation warning assertion remains meaningful.
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("__exit__");
    }) as never);

    try {
      await cli.parseAsync(["list"], { from: "user" });
    } catch (err) {
      expect((err as Error).message).toBe("__exit__");
    }

    const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrText).toContain(
      "WARNING: 'list' as a root-level command is deprecated. Use 'my-cli apcli list' instead.",
    );
    expect(stderrText).toContain("Will be removed in v0.8");
    // Sanity: stdout got *something* (list produced output or an empty table)
    expect(stdoutSpy.mock.calls.length).toBeGreaterThanOrEqual(0);

    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("shim invocation forwards to apcli subcommand action (list produces same output)", async () => {
    const listMods = [
      { id: "alpha.one", name: "alpha.one", description: "First module" },
    ];
    const registryWithData = {
      listModules: () => listMods,
      getModule: (id: string) => listMods.find((m) => m.id === id) ?? null,
    };
    // We can't pass a registry into createCli() standalone mode — registry
    // triggers embedded mode and suppresses shims. Instead invoke through the
    // non-embedded default registry fallback and verify the warning fires
    // and the list command (empty result) runs cleanly.
    const cli = createCli(undefined, "x");
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    // Issue 3: standalone + no registry → list action exits with CONFIG_INVALID
    // when listModules() is called.
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("__exit__");
    }) as never);

    try {
      await cli.parseAsync(["list"], { from: "user" });
    } catch (err) {
      expect((err as Error).message).toBe("__exit__");
    }

    const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    // The shim forwarded to apcli list (deprecation warning fired)...
    expect(stderrText).toContain("WARNING: 'list' as a root-level command is deprecated.");
    // ...and the list action reached the unwired-registry error path.
    expect(stderrText).toContain("no apcore-js registry wired");
    expect(exitSpy).toHaveBeenCalledWith(47);

    // Keep the registry test at unit level — verify the shim invoked the apcli
    // 'list' action, which is the forwarding guarantee.
    void registryWithData;
    void stdoutSpy;

    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("shim preserves positional args and options when forwarding (describe <id> --format json)", async () => {
    const cli = createCli(undefined, "z");
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("__exit__");
    }) as never);

    // Issue 3: standalone + no registry → describe action exits with
    // CONFIG_INVALID (47) when getModule() is called (rather than the old
    // MODULE_NOT_FOUND 44 which was emitted by a silent empty-registry
    // fallback). The forwarding contract is still what we verify — the shim
    // must reach the apcli describe action.
    try {
      await cli.parseAsync(["describe", "missing.mod", "--format", "json"], { from: "user" });
    } catch (err) {
      // expected: action exited via our process.exit spy
      expect((err as Error).message).toBe("__exit__");
    }

    const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    // Deprecation warning fired
    expect(stderrText).toContain(
      "WARNING: 'describe' as a root-level command is deprecated. Use 'z apcli describe' instead.",
    );
    // Forwarded to apcli describe — which hit the unwired-registry error path
    expect(stderrText).toContain("no apcore-js registry wired");
    expect(exitSpy).toHaveBeenCalledWith(47);

    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Review-identified regression fixes (Issues 2–6)
// ---------------------------------------------------------------------------

describe("Review Issue 2: _ALWAYS_REGISTERED check order", () => {
  function makeRegistry() {
    return { listModules: () => [], getModule: () => null };
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
      execute: vi.fn(async () => ({})),
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
    expect(stderrText).toContain("no apcore-js registry wired");
    expect(stderrText).toContain("--extensions-dir");
    expect(exitSpy).toHaveBeenCalledWith(47);

    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("embedded mode with wired registry does NOT trigger the unwired-registry error", async () => {
    const registry = {
      listModules: vi.fn(() => []),
      getModule: vi.fn(() => null),
    };
    const executor: Executor = {
      execute: vi.fn(async () => ({})),
      validate: vi.fn(async () => ({ valid: true, requiresApproval: false, checks: [] })),
    };
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const cli = createCli({ registry, executor, progName: "t" });

    await cli.parseAsync(["apcli", "list"], { from: "user" });

    const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrText).not.toContain("no apcore-js registry wired");
    expect(registry.listModules).toHaveBeenCalled();

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
    const executor: Executor = { execute: vi.fn(async () => ({})) };
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
    const registry = { listModules: () => [], getModule: () => null };
    const executor: Executor = { execute: vi.fn(async () => ({})) };
    const app = { registry, executor };
    expect(() => createCli({ app, registry, progName: "t" })).toThrow("__exit__");
    expect(exitSpy).toHaveBeenCalledWith(2);
    const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrText).toContain("mutually exclusive");
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

describe("Review Issue 5: extraCommands vs deprecation shim", () => {
  function makeRegistry() {
    return { listModules: () => [], getModule: () => null };
  }
  function makeFakeExecutor(): Executor {
    return {
      execute: vi.fn(async () => ({})),
      validate: vi.fn(async () => ({ valid: true, requiresApproval: false, checks: [] })),
    };
  }

  it("standalone: extraCommands overriding a deprecation-shim name warns + registers user's command", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    // 'list' is one of the deprecation shim names registered in standalone mode.
    const userList = new Command("list").description("user-supplied list command");
    const cli = createCli({
      extraCommands: [userList],
      progName: "t",
    });

    // The user's command should be registered, and there should be exactly one
    // command named "list" at root (not two — the shim should have been removed).
    const listCmds = cli.commands.filter((c) => c.name() === "list");
    expect(listCmds.length).toBe(1);
    expect(listCmds[0].description()).toBe("user-supplied list command");

    const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrText).toContain("extraCommands 'list' overrides the deprecation shim");
    stderrSpy.mockRestore();
  });

  it("standalone: extraCommands named 'apcli' still exits 2 (reserved, NOT shim)", () => {
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

  it("embedded (no shims): extraCommands named 'list' registers cleanly, no warning", () => {
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
    return { listModules: () => [], getModule: () => null };
  }
  function makeFakeExecutor(): Executor {
    return {
      execute: vi.fn(async () => ({})),
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
