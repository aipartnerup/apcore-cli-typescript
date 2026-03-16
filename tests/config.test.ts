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
import { ConfigResolver, DEFAULTS } from "../src/config.js";

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
      mockFileNotFound();
      const resolver = new ConfigResolver();
      expect(resolver.resolve("extensions.root")).toBe("./extensions");
      expect(resolver.resolve("logging.level")).toBe("INFO");
      expect(resolver.resolve("sandbox.enabled")).toBe(false);
      expect(resolver.resolve("cli.stdinBufferLimit")).toBe(10_485_760);
      expect(resolver.resolve("cli.autoApprove")).toBe(false);
    });

    it("returns undefined for unknown keys with no default", () => {
      mockFileNotFound();
      const resolver = new ConfigResolver();
      expect(resolver.resolve("nonexistent.key")).toBeUndefined();
    });

    it("DEFAULTS has expected keys", () => {
      expect(DEFAULTS).toHaveProperty("extensions.root");
      expect(DEFAULTS).toHaveProperty("logging.level");
      expect(DEFAULTS).toHaveProperty("sandbox.enabled");
      expect(DEFAULTS).toHaveProperty("cli.stdinBufferLimit");
      expect(DEFAULTS).toHaveProperty("cli.autoApprove");
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
          sandbox: { enabled: true },
        }),
      );
      const resolver = new ConfigResolver({}, "apcore.yaml");
      expect(resolver.resolve("logging.level")).toBe("DEBUG");
      expect(resolver.resolve("sandbox.enabled")).toBe(true);
    });

    it("returns null for missing config file (no error)", () => {
      mockFileNotFound();
      const resolver = new ConfigResolver({}, "nonexistent.yaml");
      expect(resolver.resolve("extensions.root")).toBe("./extensions");
    });

    it("returns null for malformed YAML (logs warning)", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockFileContent(": : : invalid yaml {{{}}}");
      const resolver = new ConfigResolver({}, "bad.yaml");
      expect(resolver.resolve("extensions.root")).toBe("./extensions");
      expect(warnSpy).toHaveBeenCalled();
    });

    it("returns null for non-dict YAML (logs warning)", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockFileContent("just a string");
      const resolver = new ConfigResolver({}, "string.yaml");
      expect(resolver.resolve("extensions.root")).toBe("./extensions");
      expect(warnSpy).toHaveBeenCalled();
    });

    it("returns null for array YAML (logs warning)", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockFileContent(yaml.dump([1, 2, 3]));
      const resolver = new ConfigResolver({}, "array.yaml");
      expect(resolver.resolve("extensions.root")).toBe("./extensions");
      expect(warnSpy).toHaveBeenCalled();
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
});
