/**
 * Tests for LazyModuleGroup and core CLI functions.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { LazyModuleGroup } from "../src/cli.js";
import { validateModuleId, reconvertEnumValues, resolveFormat, collectInput } from "../src/main.js";
import type { ModuleDescriptor, Registry, Executor } from "../src/cli.js";

function makeMod(id: string, desc = "Test module"): ModuleDescriptor {
  return { id, name: id, description: desc };
}

function makeRegistry(modules: ModuleDescriptor[]): Registry {
  return {
    listModules: () => modules,
    getModule: (id: string) => modules.find((m) => m.id === id) ?? null,
  };
}

const mockExecutor: Executor = {
  execute: vi.fn().mockResolvedValue({ result: "ok" }),
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LazyModuleGroup", () => {
  it("lists all commands from the registry", () => {
    const mods = [makeMod("math.add"), makeMod("text.upper")];
    const group = new LazyModuleGroup(makeRegistry(mods), mockExecutor);
    expect(group.listCommands()).toEqual(["math.add", "text.upper"]);
  });

  it("returns a Command for a valid module ID", () => {
    const group = new LazyModuleGroup(
      makeRegistry([makeMod("math.add", "Add numbers")]),
      mockExecutor,
    );
    const cmd = group.getCommand("math.add");
    expect(cmd).not.toBeNull();
    expect(cmd!.name()).toBe("math.add");
  });

  it("returns null for an unknown module ID", () => {
    const group = new LazyModuleGroup(makeRegistry([]), mockExecutor);
    expect(group.getCommand("nonexistent")).toBeNull();
  });

  it("caches commands after first access", () => {
    const registry = makeRegistry([makeMod("math.add")]);
    const group = new LazyModuleGroup(registry, mockExecutor);
    const cmd1 = group.getCommand("math.add");
    const cmd2 = group.getCommand("math.add");
    expect(cmd1).toBe(cmd2);
  });
});

describe("validateModuleId()", () => {
  it("accepts valid module IDs", () => {
    expect(() => validateModuleId("math.add")).not.toThrow();
    expect(() => validateModuleId("text.word_count")).not.toThrow();
    expect(() => validateModuleId("health")).not.toThrow();
  });

  it("exits 2 for IDs exceeding 128 characters", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(() => validateModuleId("a".repeat(129))).toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("exits 2 for IDs with invalid characters", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(() => validateModuleId("INVALID")).toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("exits 2 for IDs starting with a digit", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(() => validateModuleId("1abc")).toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("exits 2 for empty string", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(() => validateModuleId("")).toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(2);
  });
});

describe("resolveFormat()", () => {
  it("returns explicit format when provided", () => {
    expect(resolveFormat("json")).toBe("json");
    expect(resolveFormat("table")).toBe("table");
  });
});

describe("collectInput()", () => {
  it("returns CLI kwargs when no stdin flag", async () => {
    const result = await collectInput(undefined, { a: 1, b: "hello" });
    expect(result).toEqual({ a: 1, b: "hello" });
  });

  it("strips null/undefined CLI kwargs", async () => {
    const result = await collectInput(undefined, { a: 1, b: null, c: undefined });
    expect(result).toEqual({ a: 1 });
  });
});
