/**
 * Tests for ApcliGroup (FE-13 built-in command group).
 *
 * Covers spec test IDs T-APCLI-01..15, 22..26, 33..37 — mode semantics,
 * tier precedence, env parser validation, and boolean shorthand normalization.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ApcliGroup,
  APCLI_SUBCOMMAND_NAMES,
  RESERVED_GROUP_NAMES,
  type ApcliConfig,
} from "../src/builtin-group.js";

// ---------------------------------------------------------------------------
// Env var helpers — each test saves/restores APCORE_CLI_APCLI
// ---------------------------------------------------------------------------

const ENV_KEY = "APCORE_CLI_APCLI";

let savedEnv: string | undefined;

beforeEach(() => {
  savedEnv = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
});

afterEach(() => {
  if (savedEnv === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = savedEnv;
  }
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// RESERVED_GROUP_NAMES
// ---------------------------------------------------------------------------

describe("RESERVED_GROUP_NAMES", () => {
  it("contains exactly 'apcli'", () => {
    expect(RESERVED_GROUP_NAMES.has("apcli")).toBe(true);
    expect(RESERVED_GROUP_NAMES.size).toBe(1);
  });

  it("is a ReadonlySet", () => {
    // TS-only guarantee; runtime check that it's a Set instance
    expect(RESERVED_GROUP_NAMES instanceof Set).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ApcliGroup.fromCliConfig — boolean shorthand + mode coverage
// ---------------------------------------------------------------------------

describe("ApcliGroup.fromCliConfig — boolean shorthand", () => {
  it("true → mode 'all' regardless of registryInjected", () => {
    const g = ApcliGroup.fromCliConfig(true, { registryInjected: true });
    expect(g.resolveVisibility()).toBe("all");
    expect(g.isGroupVisible()).toBe(true);
  });

  it("false → mode 'none'", () => {
    const g = ApcliGroup.fromCliConfig(false, { registryInjected: false });
    expect(g.resolveVisibility()).toBe("none");
    expect(g.isGroupVisible()).toBe(false);
  });
});

describe("ApcliGroup.fromCliConfig — mode coverage", () => {
  it("mode: all", () => {
    const g = ApcliGroup.fromCliConfig(
      { mode: "all" },
      { registryInjected: false },
    );
    expect(g.resolveVisibility()).toBe("all");
  });

  it("mode: none", () => {
    const g = ApcliGroup.fromCliConfig(
      { mode: "none" },
      { registryInjected: false },
    );
    expect(g.resolveVisibility()).toBe("none");
    expect(g.isGroupVisible()).toBe(false);
  });

  it("mode: include", () => {
    const g = ApcliGroup.fromCliConfig(
      { mode: "include", include: ["list"] },
      { registryInjected: false },
    );
    expect(g.resolveVisibility()).toBe("include");
    expect(g.isSubcommandIncluded("list")).toBe(true);
    expect(g.isSubcommandIncluded("init")).toBe(false);
  });

  it("mode: exclude", () => {
    const g = ApcliGroup.fromCliConfig(
      { mode: "exclude", exclude: ["health"] },
      { registryInjected: false },
    );
    expect(g.resolveVisibility()).toBe("exclude");
    expect(g.isSubcommandIncluded("health")).toBe(false);
    expect(g.isSubcommandIncluded("list")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tier precedence (spec §4.4)
// ---------------------------------------------------------------------------

describe("ApcliGroup tier precedence", () => {
  it("Tier 1 wins: fromCliConfig non-auto ignores env var", () => {
    process.env[ENV_KEY] = "show";
    const g = ApcliGroup.fromCliConfig(false, { registryInjected: false });
    expect(g.resolveVisibility()).toBe("none");
  });

  it("Tier 1 wins over yaml (simulated: fromCliConfig takes precedence)", () => {
    // fromCliConfig with mode=none should win regardless of yaml — Tier 1 flag set
    const g = ApcliGroup.fromCliConfig(
      { mode: "none" },
      { registryInjected: false },
    );
    expect(g.resolveVisibility()).toBe("none");
  });

  it("Tier 2: env APCORE_CLI_APCLI=show overrides yaml when not sealed", () => {
    process.env[ENV_KEY] = "show";
    // yaml value of false → mode none, but env should override
    const g = ApcliGroup.fromYaml(false, { registryInjected: false });
    expect(g.resolveVisibility()).toBe("all");
  });

  it("Tier 2: env APCORE_CLI_APCLI=hide overrides yaml", () => {
    process.env[ENV_KEY] = "hide";
    const g = ApcliGroup.fromYaml(true, { registryInjected: false });
    expect(g.resolveVisibility()).toBe("none");
  });

  it("Tier 3: yaml mode wins when no env set", () => {
    const g = ApcliGroup.fromYaml(
      { mode: "none" },
      { registryInjected: false },
    );
    expect(g.resolveVisibility()).toBe("none");
  });

  it("Tier 4 auto-detect: registryInjected=true → 'none'", () => {
    const g = ApcliGroup.fromYaml(undefined, { registryInjected: true });
    expect(g.resolveVisibility()).toBe("none");
  });

  it("Tier 4 auto-detect: registryInjected=false → 'all'", () => {
    const g = ApcliGroup.fromYaml(undefined, { registryInjected: false });
    expect(g.resolveVisibility()).toBe("all");
  });

  it("fromCliConfig undefined falls through to Tier 4 auto-detect", () => {
    const g = ApcliGroup.fromCliConfig(undefined, { registryInjected: true });
    expect(g.resolveVisibility()).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// disableEnv sealing behavior
// ---------------------------------------------------------------------------

describe("ApcliGroup disableEnv sealing", () => {
  it("disableEnv: true seals Tier 2 — env ignored under yaml", () => {
    process.env[ENV_KEY] = "show";
    const g = ApcliGroup.fromYaml(
      { mode: "none", disableEnv: true },
      { registryInjected: false },
    );
    expect(g.resolveVisibility()).toBe("none");
  });

  it("disableEnv: true seals Tier 2 even under mode auto (via yaml)", () => {
    process.env[ENV_KEY] = "show";
    // yaml sets only disableEnv; mode stays auto. Env should be ignored;
    // auto-detect falls to 'none' (registryInjected=true).
    const g = ApcliGroup.fromYaml(
      { disableEnv: true } as unknown as ApcliConfig,
      { registryInjected: true },
    );
    expect(g.resolveVisibility()).toBe("none");
  });

  it("disableEnv: false (default) allows env override", () => {
    process.env[ENV_KEY] = "show";
    const g = ApcliGroup.fromYaml(
      { mode: "none", disableEnv: false },
      { registryInjected: false },
    );
    expect(g.resolveVisibility()).toBe("all");
  });
});

// ---------------------------------------------------------------------------
// isSubcommandIncluded — include / exclude / guard
// ---------------------------------------------------------------------------

describe("ApcliGroup.isSubcommandIncluded", () => {
  it("mode include: member returns true", () => {
    const g = ApcliGroup.fromCliConfig(
      { mode: "include", include: ["list"] },
      { registryInjected: false },
    );
    expect(g.isSubcommandIncluded("list")).toBe(true);
  });

  it("mode include: non-member returns false", () => {
    const g = ApcliGroup.fromCliConfig(
      { mode: "include", include: ["list"] },
      { registryInjected: false },
    );
    expect(g.isSubcommandIncluded("init")).toBe(false);
  });

  it("mode exclude: listed name returns false", () => {
    const g = ApcliGroup.fromCliConfig(
      { mode: "exclude", exclude: ["list"] },
      { registryInjected: false },
    );
    expect(g.isSubcommandIncluded("list")).toBe(false);
  });

  it("mode exclude: unlisted name returns true", () => {
    const g = ApcliGroup.fromCliConfig(
      { mode: "exclude", exclude: ["list"] },
      { registryInjected: false },
    );
    expect(g.isSubcommandIncluded("health")).toBe(true);
  });

  it("throws under mode 'all' (caller bug per spec §4.6)", () => {
    const g = ApcliGroup.fromCliConfig(true, { registryInjected: false });
    expect(() => g.isSubcommandIncluded("list")).toThrow();
  });

  it("throws under mode 'none'", () => {
    const g = ApcliGroup.fromCliConfig(false, { registryInjected: false });
    expect(() => g.isSubcommandIncluded("list")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// isGroupVisible
// ---------------------------------------------------------------------------

describe("ApcliGroup.isGroupVisible", () => {
  it("mode all → true", () => {
    const g = ApcliGroup.fromCliConfig(true, { registryInjected: false });
    expect(g.isGroupVisible()).toBe(true);
  });

  it("mode none → false", () => {
    const g = ApcliGroup.fromCliConfig(false, { registryInjected: false });
    expect(g.isGroupVisible()).toBe(false);
  });

  it("mode include → true (even with empty list)", () => {
    const g = ApcliGroup.fromCliConfig(
      { mode: "include", include: [] },
      { registryInjected: false },
    );
    expect(g.isGroupVisible()).toBe(true);
  });

  it("mode exclude → true", () => {
    const g = ApcliGroup.fromCliConfig(
      { mode: "exclude", exclude: ["init"] },
      { registryInjected: false },
    );
    expect(g.isGroupVisible()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Env parser — case-insensitive, aliases, warns on unknown
// ---------------------------------------------------------------------------

describe("APCORE_CLI_APCLI env parser", () => {
  it("accepts 'show' → all", () => {
    process.env[ENV_KEY] = "show";
    const g = ApcliGroup.fromYaml(undefined, { registryInjected: true });
    expect(g.resolveVisibility()).toBe("all");
  });

  it("accepts '1' → all", () => {
    process.env[ENV_KEY] = "1";
    const g = ApcliGroup.fromYaml(undefined, { registryInjected: true });
    expect(g.resolveVisibility()).toBe("all");
  });

  it("accepts 'true' → all", () => {
    process.env[ENV_KEY] = "true";
    const g = ApcliGroup.fromYaml(undefined, { registryInjected: true });
    expect(g.resolveVisibility()).toBe("all");
  });

  it("accepts 'hide' → none", () => {
    process.env[ENV_KEY] = "hide";
    const g = ApcliGroup.fromYaml(undefined, { registryInjected: false });
    expect(g.resolveVisibility()).toBe("none");
  });

  it("accepts '0' → none", () => {
    process.env[ENV_KEY] = "0";
    const g = ApcliGroup.fromYaml(undefined, { registryInjected: false });
    expect(g.resolveVisibility()).toBe("none");
  });

  it("accepts 'false' → none", () => {
    process.env[ENV_KEY] = "false";
    const g = ApcliGroup.fromYaml(undefined, { registryInjected: false });
    expect(g.resolveVisibility()).toBe("none");
  });

  it("is case-insensitive (SHOW, HIDE, True)", () => {
    process.env[ENV_KEY] = "SHOW";
    const g1 = ApcliGroup.fromYaml(undefined, { registryInjected: true });
    expect(g1.resolveVisibility()).toBe("all");

    process.env[ENV_KEY] = "HIDE";
    const g2 = ApcliGroup.fromYaml(undefined, { registryInjected: false });
    expect(g2.resolveVisibility()).toBe("none");

    process.env[ENV_KEY] = "True";
    const g3 = ApcliGroup.fromYaml(undefined, { registryInjected: true });
    expect(g3.resolveVisibility()).toBe("all");
  });

  it("warns on unknown value and falls through", () => {
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    process.env[ENV_KEY] = "bogus";
    const g = ApcliGroup.fromYaml(undefined, { registryInjected: true });
    // Unknown env → ignored; falls to Tier 3 (undefined means auto) → Tier 4.
    // registryInjected=true → 'none'.
    expect(g.resolveVisibility()).toBe("none");
    // Must have emitted a warning to stderr.
    const allWrites = warnSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(allWrites).toMatch(/APCORE_CLI_APCLI/);
    warnSpy.mockRestore();
  });

  it("empty string env treated as unset (no warning)", () => {
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    process.env[ENV_KEY] = "";
    const g = ApcliGroup.fromYaml(undefined, { registryInjected: true });
    expect(g.resolveVisibility()).toBe("none");
    const allWrites = warnSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(allWrites).not.toMatch(/APCORE_CLI_APCLI/);
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Invalid mode / user-supplied "auto" — exit 2
// ---------------------------------------------------------------------------

describe("ApcliGroup mode validation", () => {
  it("rejects invalid mode via fromCliConfig with exit 2", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(() =>
      ApcliGroup.fromCliConfig(
        { mode: "bogus" } as unknown as ApcliConfig,
        { registryInjected: false },
      ),
    ).toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("rejects 'auto' from user config via fromCliConfig (exit 2)", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(() =>
      ApcliGroup.fromCliConfig(
        { mode: "auto" } as unknown as ApcliConfig,
        { registryInjected: false },
      ),
    ).toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("rejects 'auto' from yaml (exit 2)", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(() =>
      ApcliGroup.fromYaml(
        { mode: "auto" } as unknown as ApcliConfig,
        { registryInjected: false },
      ),
    ).toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("rejects invalid mode from yaml (exit 2)", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(() =>
      ApcliGroup.fromYaml(
        { mode: "whitelist" } as unknown as ApcliConfig,
        { registryInjected: false },
      ),
    ).toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(2);
  });
});

// ---------------------------------------------------------------------------
// disableEnv warning on non-boolean
// ---------------------------------------------------------------------------

describe("ApcliGroup disableEnv validation", () => {
  it("warns on non-boolean disableEnv and treats as false", () => {
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    process.env[ENV_KEY] = "show";
    const g = ApcliGroup.fromYaml(
      { mode: "none", disableEnv: "yes" as unknown as boolean },
      { registryInjected: false },
    );
    // disableEnv treated as false → env 'show' allowed to override → 'all'.
    expect(g.resolveVisibility()).toBe("all");
    const allWrites = warnSpy.mock.calls.map((c) => String(c[0])).join("");
    // Generic wording uses the spec's snake_case key name, matches both
    // yaml (disable_env) and JS-API (disableEnv) callers.
    expect(allWrites).toMatch(/disable_env/i);
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Unknown include/exclude entries — silently accepted (forward-compat)
// ---------------------------------------------------------------------------

describe("ApcliGroup unknown subcommand entries", () => {
  it("silently retains unknown include entries (no throw)", () => {
    const g = ApcliGroup.fromCliConfig(
      { mode: "include", include: ["future-cmd", "list"] },
      { registryInjected: false },
    );
    expect(g.isSubcommandIncluded("list")).toBe(true);
    expect(g.isSubcommandIncluded("future-cmd")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Issue 1 — yaml snake_case disable_env honored (regression test)
// ---------------------------------------------------------------------------

describe("ApcliGroup.fromYaml snake_case disable_env (Issue 1)", () => {
  it("honors yaml disable_env: true — env is sealed even when registryInjected", () => {
    process.env[ENV_KEY] = "show";
    // Embedded mode (registryInjected=true) defaults to 'none' under Tier 4.
    // With yaml disable_env: true + mode auto, the env 'show' MUST be ignored
    // → fall through to Tier 4 auto-detect → 'none'.
    const g = ApcliGroup.fromYaml(
      { disable_env: true } as unknown as ApcliConfig,
      { registryInjected: true },
    );
    expect(g.resolveVisibility()).toBe("none");
  });

  it("parity: camelCase disableEnv produces identical result", () => {
    process.env[ENV_KEY] = "show";
    const g = ApcliGroup.fromYaml(
      { disableEnv: true },
      { registryInjected: true },
    );
    expect(g.resolveVisibility()).toBe("none");
  });

  it("non-boolean snake_case disable_env → warns, treated as false", () => {
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    process.env[ENV_KEY] = "show";
    const g = ApcliGroup.fromYaml(
      { mode: "none", disable_env: "yes" } as unknown as ApcliConfig,
      { registryInjected: false },
    );
    // Treated as false → env 'show' overrides yaml 'none' → 'all'.
    expect(g.resolveVisibility()).toBe("all");
    const allWrites = warnSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(allWrites).toMatch(/disable_env/i);
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Issue 7 — unknown include/exclude entries emit WARNING (regression test)
// ---------------------------------------------------------------------------

describe("ApcliGroup unknown subcommand warnings (Issue 7)", () => {
  it("warns on unknown entry in include list — exact spec wording", () => {
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    ApcliGroup.fromCliConfig(
      { mode: "include", include: ["list", "bogus"] },
      { registryInjected: false },
    );
    const allWrites = warnSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(allWrites).toContain(
      "Unknown apcli subcommand 'bogus' in include list — ignoring.",
    );
    warnSpy.mockRestore();
  });

  it("warns on unknown entry in exclude list", () => {
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    ApcliGroup.fromCliConfig(
      { mode: "exclude", exclude: ["bogus"] },
      { registryInjected: false },
    );
    const allWrites = warnSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(allWrites).toContain(
      "Unknown apcli subcommand 'bogus' in exclude list — ignoring.",
    );
    warnSpy.mockRestore();
  });

  it("no warning for known names in include/exclude", () => {
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    ApcliGroup.fromCliConfig(
      { mode: "include", include: ["list", "exec", "describe-pipeline"] },
      { registryInjected: false },
    );
    ApcliGroup.fromCliConfig(
      { mode: "exclude", exclude: ["health", "usage"] },
      { registryInjected: false },
    );
    const allWrites = warnSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(allWrites).not.toMatch(/Unknown apcli subcommand/);
    warnSpy.mockRestore();
  });

  it("unknown entries are still retained in the list (forward-compat)", () => {
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const g = ApcliGroup.fromCliConfig(
      { mode: "include", include: ["future-cmd", "list"] },
      { registryInjected: false },
    );
    // warning fired, but the entry stays in the list (matched at runtime).
    expect(g.isSubcommandIncluded("future-cmd")).toBe(true);
    expect(g.isSubcommandIncluded("list")).toBe(true);
    warnSpy.mockRestore();
  });

  it("APCLI_SUBCOMMAND_NAMES exports all 13 canonical names", () => {
    expect(APCLI_SUBCOMMAND_NAMES.size).toBe(13);
    for (const name of [
      "list",
      "describe",
      "exec",
      "validate",
      "init",
      "health",
      "usage",
      "enable",
      "disable",
      "reload",
      "config",
      "completion",
      "describe-pipeline",
    ]) {
      expect(APCLI_SUBCOMMAND_NAMES.has(name)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Issue 8 — error msg should say apcli.mode, not cli.apcli.mode
// ---------------------------------------------------------------------------

describe("ApcliGroup mode error messages (Issue 8)", () => {
  it("invalid string mode: message uses 'apcli.mode', not 'cli.apcli.mode'", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    expect(() =>
      ApcliGroup.fromCliConfig(
        { mode: "bogus" } as unknown as ApcliConfig,
        { registryInjected: false },
      ),
    ).toThrow("exit");
    const allWrites = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(allWrites).toContain("apcli.mode");
    expect(allWrites).not.toContain("cli.apcli.mode");
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("non-string mode: message uses 'apcli.mode', not 'cli.apcli.mode'", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    expect(() =>
      ApcliGroup.fromCliConfig(
        { mode: 123 } as unknown as ApcliConfig,
        { registryInjected: false },
      ),
    ).toThrow("exit");
    const allWrites = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(allWrites).toContain("apcli.mode");
    expect(allWrites).not.toContain("cli.apcli.mode");
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});
