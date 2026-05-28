/**
 * Integration tests for FE-13 built-in command group (apcli visibility,
 * subcommand filtering, exec guarantee, RESERVED_GROUP_NAMES).
 * Mirrors apcore-cli-python/tests/test_apcli_integration.py and
 * apcore-cli-rust/tests/apcli_integration.rs.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { Executor, ModuleDescriptor } from "../src/cli.js";
import { createCli } from "../src/main.js";
import { ApcliGroup, RESERVED_GROUP_NAMES, APCLI_SUBCOMMAND_NAMES } from "../src/builtin-group.js";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.APCORE_CLI_APCLI;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMod(id: string, tags: string[] = []): ModuleDescriptor {
  return { moduleId: id, name: id, description: "Test", tags, inputSchema: { type: "object", properties: {} } };
}

function makeRegistry(ids: string[] = []) {
  const mods = ids.map(makeMod);
  return {
    list: () => mods.map((m: ModuleDescriptor) => m.moduleId),
    getDefinition: (id: string) => mods.find((m) => m.moduleId === id) ?? null,
  };
}

function makeExecutor(): Executor {
  return { call: vi.fn().mockResolvedValue({ ok: true }) };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("RESERVED_GROUP_NAMES + APCLI_SUBCOMMAND_NAMES", () => {
  it("RESERVED_GROUP_NAMES contains 'apcli'", () => {
    expect(RESERVED_GROUP_NAMES.has("apcli")).toBe(true);
  });

  it("APCLI_SUBCOMMAND_NAMES contains the 13 canonical subcommands", () => {
    const expected = ["list", "describe", "exec", "validate", "init", "health",
      "usage", "enable", "disable", "reload", "config", "completion", "describe-pipeline"];
    for (const name of expected) {
      expect(APCLI_SUBCOMMAND_NAMES.has(name)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// ApcliGroup.tryFromYaml (A-001 parity with Rust)
// ---------------------------------------------------------------------------

describe("ApcliGroup.tryFromYaml", () => {
  it("returns [instance, null] for valid bool=true", () => {
    const [g, err] = ApcliGroup.tryFromYaml(true, { registryInjected: false });
    expect(g).not.toBeNull();
    expect(err).toBeNull();
    expect(g!.resolveVisibility()).toBe("all");
  });

  it("returns [instance, null] for valid bool=false", () => {
    const [g, err] = ApcliGroup.tryFromYaml(false, { registryInjected: false });
    expect(g).not.toBeNull();
    expect(err).toBeNull();
    expect(g!.resolveVisibility()).toBe("none");
  });

  it("returns [instance, null] for valid object config", () => {
    const [g, err] = ApcliGroup.tryFromYaml(
      { mode: "include", include: ["list", "exec"] },
      { registryInjected: true },
    );
    expect(g).not.toBeNull();
    expect(err).toBeNull();
    expect(g!.resolveVisibility()).toBe("include");
  });

  it("returns [null, error] for invalid mode string", () => {
    const [g, err] = ApcliGroup.tryFromYaml({ mode: "bogus" }, { registryInjected: false });
    expect(g).toBeNull();
    expect(err).toContain("bogus");
  });

  it("returns [null, error] for wrong type (number)", () => {
    const [g, err] = ApcliGroup.tryFromYaml(42, { registryInjected: false });
    expect(g).toBeNull();
    expect(err).not.toBeNull();
  });

  it("returns [null, error] for string value", () => {
    const [g, err] = ApcliGroup.tryFromYaml("invalid", { registryInjected: false });
    expect(g).toBeNull();
    expect(err).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FE-13 4-tier visibility resolution
// ---------------------------------------------------------------------------

describe("ApcliGroup visibility — 4-tier precedence", () => {
  describe("Tier 1 — CliConfig", () => {
    it("fromCliConfig(true) → all", () => {
      const g = ApcliGroup.fromCliConfig(true, { registryInjected: false });
      expect(g.resolveVisibility()).toBe("all");
    });

    it("fromCliConfig(false) → none", () => {
      const g = ApcliGroup.fromCliConfig(false, { registryInjected: false });
      expect(g.resolveVisibility()).toBe("none");
    });

    it("fromCliConfig({mode: 'include'}) → include", () => {
      const g = ApcliGroup.fromCliConfig(
        { mode: "include", include: ["list"] },
        { registryInjected: true },
      );
      expect(g.resolveVisibility()).toBe("include");
    });

    it("Tier 1 override beats env var", () => {
      process.env.APCORE_CLI_APCLI = "show";
      const g = ApcliGroup.fromCliConfig(false, { registryInjected: false });
      expect(g.resolveVisibility()).toBe("none"); // CLI wins
    });
  });

  describe("Tier 2 — env var APCORE_CLI_APCLI", () => {
    it("show → all", () => {
      process.env.APCORE_CLI_APCLI = "show";
      const g = ApcliGroup.fromYaml(null, { registryInjected: true });
      expect(g.resolveVisibility()).toBe("all");
    });

    it("1 → all", () => {
      process.env.APCORE_CLI_APCLI = "1";
      const g = ApcliGroup.fromYaml(null, { registryInjected: true });
      expect(g.resolveVisibility()).toBe("all");
    });

    it("hide → none", () => {
      process.env.APCORE_CLI_APCLI = "hide";
      const g = ApcliGroup.fromYaml(null, { registryInjected: false });
      expect(g.resolveVisibility()).toBe("none");
    });

    it("false → none", () => {
      process.env.APCORE_CLI_APCLI = "false";
      const g = ApcliGroup.fromYaml(null, { registryInjected: false });
      expect(g.resolveVisibility()).toBe("none");
    });

    it("env skipped when disableEnv=true", () => {
      process.env.APCORE_CLI_APCLI = "show";
      const g = ApcliGroup.fromCliConfig(
        { mode: "none", disableEnv: true },
        { registryInjected: false },
      );
      expect(g.resolveVisibility()).toBe("none"); // env disabled
    });
  });

  describe("Tier 4 — auto-detect", () => {
    it("registry injected → none", () => {
      const g = ApcliGroup.fromCliConfig(undefined, { registryInjected: true });
      expect(g.resolveVisibility()).toBe("none");
    });

    it("standalone (not injected) → all", () => {
      const g = ApcliGroup.fromCliConfig(undefined, { registryInjected: false });
      expect(g.resolveVisibility()).toBe("all");
    });
  });
});

// ---------------------------------------------------------------------------
// isSubcommandIncluded
// ---------------------------------------------------------------------------

describe("ApcliGroup.isSubcommandIncluded", () => {
  it("include mode: included subcommand returns true", () => {
    const g = ApcliGroup.fromCliConfig(
      { mode: "include", include: ["list", "exec"] },
      { registryInjected: true },
    );
    expect(g.isSubcommandIncluded("list")).toBe(true);
    expect(g.isSubcommandIncluded("exec")).toBe(true);
  });

  it("include mode: excluded subcommand returns false", () => {
    const g = ApcliGroup.fromCliConfig(
      { mode: "include", include: ["list"] },
      { registryInjected: true },
    );
    expect(g.isSubcommandIncluded("describe")).toBe(false);
  });

  it("exclude mode: excluded subcommand returns false", () => {
    const g = ApcliGroup.fromCliConfig(
      { mode: "exclude", exclude: ["health", "usage"] },
      { registryInjected: true },
    );
    expect(g.isSubcommandIncluded("health")).toBe(false);
    expect(g.isSubcommandIncluded("list")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createCli — command structure integration
// ---------------------------------------------------------------------------

describe("createCli — apcli group structure", () => {
  it("apcli group is registered as a subcommand", () => {
    const registry = makeRegistry(["math.add"]);
    const program = createCli({
      progName: "apcore-cli",
      registry,
      apcli: ApcliGroup.fromCliConfig(true, { registryInjected: true }),
    });
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("apcli");
  });

  it("exec is always present under apcli even with include:[]", () => {
    const registry = makeRegistry([]);
    const program = createCli({
      progName: "apcore-cli",
      registry,
      executor: makeExecutor(),
      apcli: ApcliGroup.fromCliConfig(
        { mode: "include", include: [] },
        { registryInjected: true },
      ),
    });
    const apcli = program.commands.find((c) => c.name() === "apcli");
    expect(apcli).toBeDefined();
    const subs = apcli!.commands.map((c) => c.name());
    expect(subs).toContain("exec"); // FE-12 guarantee
  });

  it("apcli has all 13 canonical subcommands under mode=all when system modules available", () => {
    // D10-004: the six system subcommands register only when the executor's
    // registry exposes `system.health.summary` (probe passes). Provide it here.
    const registry = makeRegistry(["system.health.summary"]);
    const program = createCli({
      progName: "apcore-cli",
      registry,
      executor: makeExecutor(),
      apcli: ApcliGroup.fromCliConfig(true, { registryInjected: true }),
    });
    const apcli = program.commands.find((c) => c.name() === "apcli");
    expect(apcli).toBeDefined();
    const subs = new Set(apcli!.commands.map((c) => c.name()));
    for (const name of APCLI_SUBCOMMAND_NAMES) {
      expect(subs.has(name)).toBe(true);
    }
  });

  it("system subcommands are hidden atomically when system modules unavailable (D10-004)", () => {
    // Spec (usability-enhancements.md §register_system_commands): either all six
    // system subcommands appear (system.health.summary probe passes) or none do.
    // A registry without system.health.summary must hide all six, leaving the
    // non-system subcommands intact. Parity with apcore-cli-python factory gating.
    const registry = makeRegistry([]); // no system.health.summary
    const program = createCli({
      progName: "apcore-cli",
      registry,
      executor: makeExecutor(),
      apcli: ApcliGroup.fromCliConfig(true, { registryInjected: true }),
    });
    const apcli = program.commands.find((c) => c.name() === "apcli");
    expect(apcli).toBeDefined();
    const subs = new Set(apcli!.commands.map((c) => c.name()));
    for (const sysCmd of ["health", "usage", "enable", "disable", "reload", "config"]) {
      expect(subs.has(sysCmd)).toBe(false);
    }
    // Non-system subcommands remain reachable.
    expect(subs.has("list")).toBe(true);
    expect(subs.has("exec")).toBe(true);
  });
});
