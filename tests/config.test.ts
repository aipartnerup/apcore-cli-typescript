/**
 * Tests for ConfigResolver — 4-tier config resolution.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import yaml from "js-yaml";

// Mock node:fs before importing ConfigResolver
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

import { readFileSync } from "node:fs";
import {
  ConfigResolver,
  DEFAULTS,
  NAMESPACE_DEFAULTS,
} from "../src/config.js";

const mockReadFileSync = vi.mocked(readFileSync);

describe("ConfigResolver", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    mockReadFileSync.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  function mockFileNotFound() {
    mockReadFileSync.mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
  }

  function mockFileContent(content: string) {
    mockReadFileSync.mockReturnValue(content);
  }

  // ---- Task 1: Defaults ----

  describe("defaults", () => {
    it("returns default value when no other source provides one", () => {
      // Audit D9 (v0.6.x): only keys actually consumed by resolve() at
      // runtime survive in DEFAULTS. The deleted keys are tested for
      // absence by `DEFAULTS does not contain dead keys` below.
      mockFileNotFound();
      const resolver = new ConfigResolver();
      expect(resolver.resolve("extensions.root")).toBe("./extensions");
      expect(resolver.resolve("logging.level")).toBe("WARNING");
      expect(resolver.resolve("cli.help_text_max_length")).toBe(1000);
      expect(resolver.resolve("cli.approval_timeout")).toBe(60);
      expect(resolver.resolve("cli.strategy")).toBe("standard");
      expect(resolver.resolve("cli.group_depth")).toBe(1);
    });

    it("returns undefined for unknown keys with no default", () => {
      mockFileNotFound();
      const resolver = new ConfigResolver();
      expect(resolver.resolve("nonexistent.key")).toBeUndefined();
    });

    it("DEFAULTS has expected keys", () => {
      expect(DEFAULTS).toHaveProperty("extensions.root");
      expect(DEFAULTS).toHaveProperty("logging.level");
      expect(DEFAULTS).toHaveProperty("cli.help_text_max_length");
      expect(DEFAULTS).toHaveProperty("cli.approval_timeout");
      expect(DEFAULTS).toHaveProperty("cli.strategy");
      expect(DEFAULTS).toHaveProperty("cli.group_depth");
    });

    it("DEFAULTS does not contain dead keys (audit D9 cleanup)", () => {
      // sandbox.enabled, cli.auto_approve, cli.stdin_buffer_limit, and the
      // apcore-cli.* aliases were never read by resolve() at runtime —
      // sandbox/auto-approve come from CLI flags, the stdin buffer is
      // hard-coded, and namespace aliases are registered separately by
      // registerConfigNamespace() at createCli startup.
      expect(DEFAULTS).not.toHaveProperty("sandbox.enabled");
      expect(DEFAULTS).not.toHaveProperty("cli.auto_approve");
      expect(DEFAULTS).not.toHaveProperty("cli.stdin_buffer_limit");
      expect(DEFAULTS).not.toHaveProperty("apcore-cli.stdin_buffer_limit");
      expect(DEFAULTS).not.toHaveProperty("apcore-cli.auto_approve");
      expect(DEFAULTS).not.toHaveProperty("apcore-cli.help_text_max_length");
      expect(DEFAULTS).not.toHaveProperty("apcore-cli.logging_level");
    });
  });

  // ---- Task 2: 4-tier precedence ----

  describe("resolve() precedence", () => {
    it("returns CLI flag value (tier 1) when present", () => {
      mockFileNotFound();
      const resolver = new ConfigResolver({ "extensions.root": "/custom" });
      expect(resolver.resolve("extensions.root")).toBe("/custom");
    });

    it("returns env var value (tier 2) when CLI flag absent", () => {
      mockFileNotFound();
      process.env.MY_EXT_ROOT = "/from-env";
      const resolver = new ConfigResolver();
      expect(
        resolver.resolve("extensions.root", undefined, "MY_EXT_ROOT"),
      ).toBe("/from-env");
    });

    it("CLI flag overrides env var", () => {
      mockFileNotFound();
      process.env.MY_EXT_ROOT = "/from-env";
      const resolver = new ConfigResolver({
        "extensions.root": "/from-cli",
      });
      expect(
        resolver.resolve("extensions.root", undefined, "MY_EXT_ROOT"),
      ).toBe("/from-cli");
    });

    it("env var overrides config file", () => {
      mockFileContent(yaml.dump({ extensions: { root: "/from-file" } }));
      process.env.MY_EXT_ROOT = "/from-env";
      const resolver = new ConfigResolver({}, "apcore.yaml");
      expect(
        resolver.resolve("extensions.root", undefined, "MY_EXT_ROOT"),
      ).toBe("/from-env");
    });

    it("config file overrides default", () => {
      mockFileContent(yaml.dump({ extensions: { root: "/from-file" } }));
      const resolver = new ConfigResolver({}, "apcore.yaml");
      expect(resolver.resolve("extensions.root")).toBe("/from-file");
    });

    it("ignores null CLI flag values", () => {
      mockFileNotFound();
      const resolver = new ConfigResolver({ "extensions.root": null });
      expect(resolver.resolve("extensions.root")).toBe("./extensions");
    });

    it("ignores undefined CLI flag values", () => {
      mockFileNotFound();
      const resolver = new ConfigResolver({ "extensions.root": undefined });
      expect(resolver.resolve("extensions.root")).toBe("./extensions");
    });

    it("ignores empty string env var values", () => {
      mockFileNotFound();
      process.env.MY_EXT_ROOT = "";
      const resolver = new ConfigResolver();
      expect(
        resolver.resolve("extensions.root", undefined, "MY_EXT_ROOT"),
      ).toBe("./extensions");
    });
  });

  // ---- Task 3: Config file loading and flattening ----

  describe("config file loading", () => {
    it("loads and flattens nested YAML config", () => {
      mockFileContent(
        yaml.dump({
          logging: { level: "DEBUG" },
          cli: { strategy: "performance" },
        }),
      );
      const resolver = new ConfigResolver({}, "apcore.yaml");
      expect(resolver.resolve("logging.level")).toBe("DEBUG");
      // cli.strategy is a real DEFAULTS key (FE-11) — file overrides default.
      expect(resolver.resolve("cli.strategy")).toBe("performance");
    });

    it("returns null for missing config file (no error)", () => {
      mockFileNotFound();
      const resolver = new ConfigResolver({}, "nonexistent.yaml");
      expect(resolver.resolve("extensions.root")).toBe("./extensions");
    });

    it("returns null for malformed YAML (logs warning)", () => {
      // Warnings now flow through ./logger.js (stderr) per review fix #4.
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      mockFileContent(": : : invalid yaml {{{}}}");
      const resolver = new ConfigResolver({}, "bad.yaml");
      expect(resolver.resolve("extensions.root")).toBe("./extensions");
      const out = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(out).toMatch(/WARNING:.*malformed/);
      stderrSpy.mockRestore();
    });

    it("returns null for non-dict YAML (logs warning)", () => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      mockFileContent("just a string");
      const resolver = new ConfigResolver({}, "string.yaml");
      expect(resolver.resolve("extensions.root")).toBe("./extensions");
      const out = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(out).toMatch(/WARNING:.*malformed/);
      stderrSpy.mockRestore();
    });

    it("returns null for array YAML (logs warning)", () => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      mockFileContent(yaml.dump([1, 2, 3]));
      const resolver = new ConfigResolver({}, "array.yaml");
      expect(resolver.resolve("extensions.root")).toBe("./extensions");
      const out = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(out).toMatch(/WARNING:.*malformed/);
      stderrSpy.mockRestore();
    });

    it("flattens deeply nested keys", () => {
      mockFileContent(
        yaml.dump({
          a: { b: { c: "deep" } },
        }),
      );
      const resolver = new ConfigResolver({}, "apcore.yaml");
      expect(resolver.resolve("a.b.c")).toBe("deep");
    });

    it("caches config file (only reads once)", () => {
      mockFileContent(yaml.dump({ logging: { level: "DEBUG" } }));
      const resolver = new ConfigResolver({}, "apcore.yaml");
      resolver.resolve("logging.level");
      resolver.resolve("logging.level");
      expect(mockReadFileSync).toHaveBeenCalledTimes(1);
    });
  });

  // ---- Task 4: Namespace-aware config resolution (apcore >= 0.15.0) ----

  describe("namespace-aware config resolution", () => {
    // Audit D9 (v0.6.x): the apcore-cli.* alias entries were removed from
    // DEFAULTS — but the cross-key file-lookup mechanism (NAMESPACE_TO_LEGACY
    // / LEGACY_TO_NAMESPACE) still works independently. The tests below
    // exercise that file-fallback path without depending on DEFAULTS.

    it("resolves namespace key from legacy config file", () => {
      mockFileContent(yaml.dump({ cli: { stdin_buffer_limit: 5242880 } }));
      const resolver = new ConfigResolver({}, "apcore.yaml");
      expect(resolver.resolve("apcore-cli.stdin_buffer_limit")).toBe(5242880);
    });

    it("resolves legacy key from namespace config file", () => {
      mockFileContent(
        yaml.dump({ "apcore-cli": { auto_approve: true } }),
      );
      const resolver = new ConfigResolver({}, "apcore.yaml");
      expect(resolver.resolve("cli.auto_approve")).toBe(true);
    });

    it("direct key takes precedence over alternate", () => {
      mockFileContent(
        yaml.dump({
          cli: { help_text_max_length: 500 },
          "apcore-cli": { help_text_max_length: 2000 },
        }),
      );
      const resolver = new ConfigResolver({}, "apcore.yaml");
      expect(resolver.resolve("cli.help_text_max_length")).toBe(500);
      expect(resolver.resolve("apcore-cli.help_text_max_length")).toBe(2000);
    });

    it("returns undefined for namespace keys when no file present (audit D9)", () => {
      // Post-cleanup: namespace alias keys are NOT in DEFAULTS, so a query
      // with no file falls through to undefined. The Config Bus registration
      // in registerConfigNamespace() handles namespace defaults at the
      // apcore-js layer instead of in this resolver.
      mockFileNotFound();
      const resolver = new ConfigResolver();
      expect(resolver.resolve("apcore-cli.stdin_buffer_limit")).toBeUndefined();
      expect(resolver.resolve("apcore-cli.auto_approve")).toBeUndefined();
      expect(resolver.resolve("apcore-cli.logging_level")).toBeUndefined();
    });
  });

  // ---- Task 5: apcli.* DEFAULTS + resolveObject (FE-13) ----

  describe("apcli DEFAULTS keys (FE-13)", () => {
    it("DEFAULTS contains the 5 new snake_case apcli keys", () => {
      expect(DEFAULTS).toHaveProperty("apcli");
      expect(DEFAULTS).toHaveProperty("apcli.mode");
      expect(DEFAULTS).toHaveProperty("apcli.include");
      expect(DEFAULTS).toHaveProperty("apcli.exclude");
      expect(DEFAULTS).toHaveProperty("apcli.disable_env");
    });

    it("DEFAULTS apcli root is null (object is absent by default)", () => {
      expect(DEFAULTS["apcli"]).toBeNull();
    });

    it("DEFAULTS apcli.mode is null by default", () => {
      expect(DEFAULTS["apcli.mode"]).toBeNull();
    });

    it("DEFAULTS apcli.include is empty array", () => {
      expect(DEFAULTS["apcli.include"]).toEqual([]);
    });

    it("DEFAULTS apcli.exclude is empty array", () => {
      expect(DEFAULTS["apcli.exclude"]).toEqual([]);
    });

    it("DEFAULTS apcli.disable_env is false", () => {
      expect(DEFAULTS["apcli.disable_env"]).toBe(false);
    });
  });

  describe("resolveObject() (FE-13)", () => {
    it("returns null when apcli is unset in yaml", () => {
      mockFileNotFound();
      const resolver = new ConfigResolver({}, "apcore.yaml");
      expect(resolver.resolveObject("apcli")).toBeNull();
    });

    it("returns raw boolean true for apcli: true shorthand", () => {
      mockFileContent(yaml.dump({ apcli: true }));
      const resolver = new ConfigResolver({}, "apcore.yaml");
      expect(resolver.resolveObject("apcli")).toBe(true);
    });

    it("returns raw boolean false for apcli: false shorthand", () => {
      mockFileContent(yaml.dump({ apcli: false }));
      const resolver = new ConfigResolver({}, "apcore.yaml");
      expect(resolver.resolveObject("apcli")).toBe(false);
    });

    it("returns raw nested object for expanded apcli form", () => {
      mockFileContent(
        yaml.dump({
          apcli: {
            mode: "include",
            include: ["list", "describe"],
          },
        }),
      );
      const resolver = new ConfigResolver({}, "apcore.yaml");
      const obj = resolver.resolveObject("apcli");
      expect(obj).toEqual({
        mode: "include",
        include: ["list", "describe"],
      });
    });

    it("returns array leaf values without descending into them", () => {
      mockFileContent(
        yaml.dump({
          apcli: {
            include: ["list", "describe"],
          },
        }),
      );
      const resolver = new ConfigResolver({}, "apcore.yaml");
      expect(resolver.resolveObject("apcli.include")).toEqual([
        "list",
        "describe",
      ]);
    });

    it("returns null for missing nested path", () => {
      mockFileContent(yaml.dump({ apcli: { mode: "include" } }));
      const resolver = new ConfigResolver({}, "apcore.yaml");
      expect(resolver.resolveObject("apcli.missing")).toBeNull();
    });

    it("returns null when raw config is null (no file)", () => {
      mockFileNotFound();
      const resolver = new ConfigResolver({}, "apcore.yaml");
      expect(resolver.resolveObject("anything")).toBeNull();
    });

    it("does NOT descend into arrays (path ending inside array returns null)", () => {
      mockFileContent(
        yaml.dump({
          apcli: { include: ["list", "describe"] },
        }),
      );
      const resolver = new ConfigResolver({}, "apcore.yaml");
      expect(resolver.resolveObject("apcli.include.0")).toBeNull();
    });
  });

  describe("scalar resolve() regression (FE-13)", () => {
    it("resolve('apcli.mode') returns null when unset (DEFAULTS null)", () => {
      mockFileNotFound();
      const resolver = new ConfigResolver();
      expect(resolver.resolve("apcli.mode")).toBeNull();
    });

    it("resolve('apcli.mode') returns value from file via flattened path", () => {
      mockFileContent(
        yaml.dump({ apcli: { mode: "include" } }),
      );
      const resolver = new ConfigResolver({}, "apcore.yaml");
      expect(resolver.resolve("apcli.mode")).toBe("include");
    });

    it("resolve('cli.apcli.mode') still goes through flattened path", () => {
      mockFileContent(
        yaml.dump({ cli: { apcli: { mode: "include" } } }),
      );
      const resolver = new ConfigResolver({}, "apcore.yaml");
      expect(resolver.resolve("cli.apcli.mode")).toBe("include");
    });

    it("resolve('apcli.include') returns file array", () => {
      mockFileContent(
        yaml.dump({ apcli: { include: ["list", "describe"] } }),
      );
      const resolver = new ConfigResolver({}, "apcore.yaml");
      expect(resolver.resolve("apcli.include")).toEqual(["list", "describe"]);
    });

    it("resolve('apcli.disable_env') returns false DEFAULT when unset", () => {
      mockFileNotFound();
      const resolver = new ConfigResolver();
      expect(resolver.resolve("apcli.disable_env")).toBe(false);
    });
  });

  describe("registerConfigNamespace publishes apcli keys (FE-13)", () => {
    it("NAMESPACE_DEFAULTS contains existing cli.* keys", () => {
      // Existing keys still present (regression guard).
      expect(NAMESPACE_DEFAULTS).toHaveProperty("stdin_buffer_limit");
      expect(NAMESPACE_DEFAULTS).toHaveProperty("auto_approve");
      expect(NAMESPACE_DEFAULTS).toHaveProperty("help_text_max_length");
      expect(NAMESPACE_DEFAULTS).toHaveProperty("logging_level");
      expect(NAMESPACE_DEFAULTS).toHaveProperty("approval_timeout");
      expect(NAMESPACE_DEFAULTS).toHaveProperty("strategy");
      expect(NAMESPACE_DEFAULTS).toHaveProperty("group_depth");
    });

    it("NAMESPACE_DEFAULTS publishes apcli as nested object default", () => {
      // apcli is published as a nested object default under the
      // apcore-cli namespace (mirrors the nested yaml shape).
      expect(NAMESPACE_DEFAULTS).toHaveProperty("apcli");
      const apcliDefaults = NAMESPACE_DEFAULTS.apcli as Record<string, unknown>;
      expect(apcliDefaults).toMatchObject({
        mode: null,
        include: [],
        exclude: [],
        disable_env: false,
      });
    });
  });
});
