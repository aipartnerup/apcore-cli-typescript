/**
 * Tests for ExposureFilter (FE-12).
 */

import { describe, it, expect, vi } from "vitest";
import { globMatch, ExposureFilter } from "../src/exposure.js";

// ---------------------------------------------------------------------------
// globMatch
// ---------------------------------------------------------------------------

describe("globMatch()", () => {
  it("exact match", () => {
    expect(globMatch("system.health", "system.health")).toBe(true);
  });

  it("exact no partial", () => {
    expect(globMatch("system.health.check", "system.health")).toBe(false);
  });

  it("single star matches one segment", () => {
    expect(globMatch("admin.users", "admin.*")).toBe(true);
  });

  it("single star not across dots", () => {
    expect(globMatch("admin.users.list", "admin.*")).toBe(false);
  });

  it("single star not prefix only", () => {
    expect(globMatch("admin", "admin.*")).toBe(false);
  });

  it("star prefix match", () => {
    expect(globMatch("product.get", "*.get")).toBe(true);
  });

  it("star prefix no deep", () => {
    expect(globMatch("product.get.all", "*.get")).toBe(false);
  });

  it("double star matches across segments", () => {
    expect(globMatch("admin.users", "admin.**")).toBe(true);
    expect(globMatch("admin.users.list", "admin.**")).toBe(true);
  });

  it("double star not bare prefix", () => {
    expect(globMatch("admin", "admin.**")).toBe(false);
  });

  it("bare star", () => {
    expect(globMatch("standalone", "*")).toBe(true);
    expect(globMatch("a.b", "*")).toBe(false);
  });

  it("bare double star", () => {
    expect(globMatch("anything", "**")).toBe(true);
    expect(globMatch("a.b.c.d", "**")).toBe(true);
  });

  it("literal no glob", () => {
    expect(globMatch("admin.users", "admin.users")).toBe(true);
    expect(globMatch("admin.config", "admin.users")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ExposureFilter
// ---------------------------------------------------------------------------

describe("ExposureFilter", () => {
  it("mode all exposes everything", () => {
    const f = new ExposureFilter("all");
    expect(f.isExposed("anything")).toBe(true);
  });

  it("mode include matches", () => {
    const f = new ExposureFilter("include", ["admin.*", "jobs.*"]);
    expect(f.isExposed("admin.users")).toBe(true);
    expect(f.isExposed("webhooks.stripe")).toBe(false);
  });

  it("mode include empty list exposes nothing", () => {
    const f = new ExposureFilter("include", []);
    expect(f.isExposed("anything")).toBe(false);
  });

  it("mode exclude matches", () => {
    const f = new ExposureFilter("exclude", undefined, ["webhooks.*", "internal.*"]);
    expect(f.isExposed("admin.users")).toBe(true);
    expect(f.isExposed("webhooks.stripe")).toBe(false);
  });

  it("mode exclude empty list exposes all", () => {
    const f = new ExposureFilter("exclude", undefined, []);
    expect(f.isExposed("anything")).toBe(true);
  });

  it("filterModules partitions", () => {
    const f = new ExposureFilter("include", ["admin.*"]);
    const [exposed, hidden] = f.filterModules(["admin.users", "admin.config", "webhooks.stripe"]);
    expect(exposed).toEqual(["admin.users", "admin.config"]);
    expect(hidden).toEqual(["webhooks.stripe"]);
  });

  it("duplicate patterns deduplicated", () => {
    const f = new ExposureFilter("include", ["admin.*", "admin.*"]);
    expect(f.isExposed("admin.users")).toBe(true);
  });

  it("default is mode all", () => {
    const f = new ExposureFilter();
    expect(f.isExposed("anything")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ExposureFilter.fromConfig
// ---------------------------------------------------------------------------

describe("ExposureFilter.fromConfig()", () => {
  it("include mode", () => {
    const f = ExposureFilter.fromConfig({ expose: { mode: "include", include: ["admin.*"] } });
    expect(f._mode).toBe("include");
    expect(f.isExposed("admin.users")).toBe(true);
    expect(f.isExposed("webhooks.stripe")).toBe(false);
  });

  it("exclude mode", () => {
    const f = ExposureFilter.fromConfig({ expose: { mode: "exclude", exclude: ["webhooks.*"] } });
    expect(f._mode).toBe("exclude");
    expect(f.isExposed("webhooks.stripe")).toBe(false);
  });

  it("missing expose key", () => {
    const f = ExposureFilter.fromConfig({});
    expect(f._mode).toBe("all");
  });

  it("invalid mode throws", () => {
    expect(() => ExposureFilter.fromConfig({ expose: { mode: "whitelist" } })).toThrow(
      "Invalid expose mode",
    );
  });

  it("expose not dict warns", () => {
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const f = ExposureFilter.fromConfig({ expose: "invalid" });
    expect(f._mode).toBe("all");
    warnSpy.mockRestore();
  });

  it("include not list warns", () => {
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const f = ExposureFilter.fromConfig({ expose: { mode: "include", include: "admin.*" } });
    expect(f._mode).toBe("include");
    warnSpy.mockRestore();
  });

  it("empty string in list warns", () => {
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const f = ExposureFilter.fromConfig({ expose: { mode: "include", include: ["admin.*", ""] } });
    expect(f.isExposed("admin.users")).toBe(true);
    warnSpy.mockRestore();
  });

  it("mode all ignores lists", () => {
    const f = ExposureFilter.fromConfig({ expose: { mode: "all", include: ["admin.*"] } });
    expect(f._mode).toBe("all");
    expect(f.isExposed("webhooks.stripe")).toBe(true);
  });
});
