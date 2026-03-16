/**
 * Tests for discovery commands (list, describe).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { registerDiscoveryCommands } from "../src/discovery.js";
import type { ModuleDescriptor, Registry } from "../src/cli.js";

function makeRegistry(modules: ModuleDescriptor[]): Registry {
  return {
    listModules: () => modules,
    getModule: (id: string) => modules.find((m) => m.id === id) ?? null,
  };
}

function makeMod(
  id: string,
  desc: string,
  tags: string[] = [],
): ModuleDescriptor {
  return { id, name: id, description: desc, tags };
}

describe("registerDiscoveryCommands()", () => {
  let output: string;

  beforeEach(() => {
    output = "";
    vi.spyOn(process.stdout, "write").mockImplementation(
      (chunk: string | Uint8Array) => {
        output += typeof chunk === "string" ? chunk : chunk.toString();
        return true;
      },
    );
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds 'list' and 'describe' as subcommands", () => {
    const cli = new Command("test");
    registerDiscoveryCommands(cli, makeRegistry([]));
    const names = cli.commands.map((c) => c.name());
    expect(names).toContain("list");
    expect(names).toContain("describe");
  });

  describe("list command", () => {
    it("lists all modules from registry", () => {
      const cli = new Command("test");
      const mods = [makeMod("math.add", "Add"), makeMod("text.upper", "Upper")];
      registerDiscoveryCommands(cli, makeRegistry(mods));
      cli.parse(["list", "--format", "json"], { from: "user" });
      const parsed = JSON.parse(output);
      expect(parsed).toHaveLength(2);
    });

    it("filters modules by tag", () => {
      const cli = new Command("test");
      const mods = [
        makeMod("math.add", "Add", ["math"]),
        makeMod("text.upper", "Upper", ["text"]),
      ];
      registerDiscoveryCommands(cli, makeRegistry(mods));
      cli.parse(["list", "--tag", "math", "--format", "json"], { from: "user" });
      const parsed = JSON.parse(output);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe("math.add");
    });

    it("filters by multiple tags (AND logic)", () => {
      const cli = new Command("test");
      const mods = [
        makeMod("a", "A", ["math", "util"]),
        makeMod("b", "B", ["math"]),
      ];
      registerDiscoveryCommands(cli, makeRegistry(mods));
      cli.parse(["list", "--tag", "math", "--tag", "util", "--format", "json"], { from: "user" });
      const parsed = JSON.parse(output);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe("a");
    });

    it("validates tag format", () => {
      const cli = new Command("test");
      registerDiscoveryCommands(cli, makeRegistry([]));
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("exit");
      });
      expect(() =>
        cli.parse(["list", "--tag", "INVALID"], { from: "user" }),
      ).toThrow("exit");
      expect(exitSpy).toHaveBeenCalledWith(2);
    });
  });

  describe("describe command", () => {
    it("shows module metadata for valid ID", () => {
      const cli = new Command("test");
      const mods = [makeMod("math.add", "Add two numbers", ["math"])];
      registerDiscoveryCommands(cli, makeRegistry(mods));
      cli.parse(["describe", "math.add", "--format", "json"], { from: "user" });
      const parsed = JSON.parse(output);
      expect(parsed.id).toBe("math.add");
    });

    it("exits 44 when module not found", () => {
      const cli = new Command("test");
      registerDiscoveryCommands(cli, makeRegistry([]));
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("exit");
      });
      expect(() =>
        cli.parse(["describe", "nonexistent"], { from: "user" }),
      ).toThrow("exit");
      expect(exitSpy).toHaveBeenCalledWith(44);
    });

    it("validates module ID format", () => {
      const cli = new Command("test");
      registerDiscoveryCommands(cli, makeRegistry([]));
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("exit");
      });
      expect(() =>
        cli.parse(["describe", "INVALID-ID"], { from: "user" }),
      ).toThrow("exit");
      expect(exitSpy).toHaveBeenCalledWith(2);
    });
  });
});
