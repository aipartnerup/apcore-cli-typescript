/**
 * Tests for GroupedModuleGroup, LazyGroup, and display helpers (FE-09).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  GroupedModuleGroup,
  LazyGroup,
  LazyModuleGroup,
  BUILTIN_COMMANDS,
} from "../src/cli.js";
import { getDisplay, getCliDisplayFields } from "../src/display-helpers.js";
import type { ModuleDescriptor, Registry, Executor } from "../src/cli.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMod(
  id: string,
  description = "desc",
  display?: Record<string, unknown>,
  metadata?: Record<string, unknown>,
): ModuleDescriptor {
  const m: ModuleDescriptor = {
    id,
    name: id,
    description,
    tags: [],
    metadata: metadata ?? {},
  };
  if (display) {
    (m.metadata as Record<string, unknown>).display = display;
  }
  return m;
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

function makeGroupedGroup(
  moduleDefs: Array<[string, ModuleDescriptor]>,
): GroupedModuleGroup {
  const modules = moduleDefs.map(([, desc]) => desc);
  const registry = makeRegistry(modules);
  return new GroupedModuleGroup(registry, mockExecutor);
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

describe("getDisplay()", () => {
  it("returns display from metadata", () => {
    const desc = makeMod("x", "desc", { alias: "y" });
    const d = getDisplay(desc);
    expect(d.alias).toBe("y");
  });

  it("returns empty object when no metadata", () => {
    const desc = makeMod("x");
    desc.metadata = undefined;
    expect(getDisplay(desc)).toEqual({});
  });

  it("returns empty object when metadata has no display", () => {
    const desc = makeMod("x");
    expect(getDisplay(desc)).toEqual({});
  });
});

describe("getCliDisplayFields()", () => {
  it("returns cli alias if present", () => {
    const desc = makeMod("x.y", "original", { cli: { alias: "short" } });
    const [name, , ] = getCliDisplayFields(desc);
    expect(name).toBe("short");
  });

  it("falls back to display alias", () => {
    const desc = makeMod("x.y", "original", { alias: "mid" });
    const [name, , ] = getCliDisplayFields(desc);
    expect(name).toBe("mid");
  });

  it("falls back to module id", () => {
    const desc = makeMod("x.y", "original");
    const [name, , ] = getCliDisplayFields(desc);
    expect(name).toBe("x.y");
  });

  it("uses cli description if present", () => {
    const desc = makeMod("x.y", "original", { cli: { description: "CLI desc" } });
    const [, description] = getCliDisplayFields(desc);
    expect(description).toBe("CLI desc");
  });

  it("returns tags from display", () => {
    const desc = makeMod("x.y", "original", { tags: ["a", "b"] });
    const [, , tags] = getCliDisplayFields(desc);
    expect(tags).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// LazyModuleGroup alias map
// ---------------------------------------------------------------------------

describe("LazyModuleGroup alias map", () => {
  it("builds alias map from display overlay", () => {
    const mod = makeMod("payment.status", "Check", { cli: { alias: "pay-status" } });
    const group = new LazyModuleGroup(makeRegistry([mod]), mockExecutor);
    group.buildAliasMap();
    expect(group.getCommand("pay-status")).not.toBeNull();
  });

  it("listCommands uses aliases", () => {
    const mod = makeMod("payment.status", "Check", { cli: { alias: "pay-status" } });
    const group = new LazyModuleGroup(makeRegistry([mod]), mockExecutor);
    const cmds = group.listCommands();
    expect(cmds).toContain("pay-status");
    expect(cmds).not.toContain("payment.status");
  });

  it("alias map build is idempotent", () => {
    const mod = makeMod("x", "desc");
    const group = new LazyModuleGroup(makeRegistry([mod]), mockExecutor);
    group.buildAliasMap();
    group.buildAliasMap(); // should not error
  });
});

// ---------------------------------------------------------------------------
// TestResolveGroup
// ---------------------------------------------------------------------------

describe("GroupedModuleGroup.resolveGroup", () => {
  it("explicit group with alias", () => {
    const desc = makeMod("x.y", "desc", { cli: { group: "mygrp", alias: "cmd1" } });
    expect(GroupedModuleGroup.resolveGroup("x.y", desc)).toEqual(["mygrp", "cmd1"]);
  });

  it("explicit group without alias falls back to module_id", () => {
    const desc = makeMod("x.y", "desc", { cli: { group: "mygrp" } });
    expect(GroupedModuleGroup.resolveGroup("x.y", desc)).toEqual(["mygrp", "x.y"]);
  });

  it("opt-out with empty string group", () => {
    const desc = makeMod("math.add", "desc", { cli: { group: "", alias: "add" } });
    expect(GroupedModuleGroup.resolveGroup("math.add", desc)).toEqual([null, "add"]);
  });

  it("auto-extraction from alias with dot", () => {
    const desc = makeMod("payment.status", "desc", { cli: { alias: "pay.status" } });
    expect(GroupedModuleGroup.resolveGroup("payment.status", desc)).toEqual(["pay", "status"]);
  });

  it("auto-extraction from module_id with dot", () => {
    const desc = makeMod("math.add", "desc");
    expect(GroupedModuleGroup.resolveGroup("math.add", desc)).toEqual(["math", "add"]);
  });

  it("no dot means top-level", () => {
    const desc = makeMod("status", "desc");
    expect(GroupedModuleGroup.resolveGroup("status", desc)).toEqual([null, "status"]);
  });

  it("multi-dot splits on first dot only", () => {
    const desc = makeMod("a.b.c", "desc");
    expect(GroupedModuleGroup.resolveGroup("a.b.c", desc)).toEqual(["a", "b.c"]);
  });

  it("empty module_id warns", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const desc = makeMod("", "desc");
    const result = GroupedModuleGroup.resolveGroup("", desc);
    expect(result).toEqual([null, ""]);
    const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.includes("Empty module_id"))).toBe(true);
    stderrSpy.mockRestore();
  });

  it("handles descriptor with no metadata", () => {
    const desc = makeMod("user.create", "desc");
    desc.metadata = undefined;
    const [group, cmd] = GroupedModuleGroup.resolveGroup("user.create", desc);
    expect(group).toBe("user");
    expect(cmd).toBe("create");
  });
});

// ---------------------------------------------------------------------------
// TestBuildGroupMap
// ---------------------------------------------------------------------------

describe("GroupedModuleGroup.buildGroupMap", () => {
  it("builds three groups", () => {
    const defs: Array<[string, ModuleDescriptor]> = [
      ["math.add", makeMod("math.add")],
      ["math.sub", makeMod("math.sub")],
      ["text.upper", makeMod("text.upper")],
      ["io.read", makeMod("io.read")],
    ];
    const group = makeGroupedGroup(defs);
    group.buildGroupMap();
    const gm = group.getGroupMap();
    expect(gm.has("math")).toBe(true);
    expect(gm.has("text")).toBe(true);
    expect(gm.has("io")).toBe(true);
    expect(gm.get("math")!.size).toBe(2);
  });

  it("is idempotent", () => {
    const defs: Array<[string, ModuleDescriptor]> = [
      ["math.add", makeMod("math.add")],
    ];
    const group = makeGroupedGroup(defs);
    group.buildGroupMap();
    const firstSize = group.getGroupMap().size;
    group.buildGroupMap(); // second call — should be no-op
    expect(group.getGroupMap().size).toBe(firstSize);
  });

  it("warns on builtin collision", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const desc = makeMod("list.items", "desc", { cli: { group: "list", alias: "items" } });
    const defs: Array<[string, ModuleDescriptor]> = [["list.items", desc]];
    const group = makeGroupedGroup(defs);
    group.buildGroupMap();
    expect(stderrSpy).toHaveBeenCalled();
    const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.includes("collides"))).toBe(true);
    stderrSpy.mockRestore();
  });

  it("invalid group name falls back to top-level", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const desc = makeMod("my.mod", "desc", { cli: { group: "INVALID!", alias: "cmd" } });
    const defs: Array<[string, ModuleDescriptor]> = [["my.mod", desc]];
    const group = makeGroupedGroup(defs);
    group.buildGroupMap();
    expect(group.getGroupMap().has("INVALID!")).toBe(false);
    expect(group.getTopLevelModules().has("cmd")).toBe(true);
    const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.includes("not shell-safe"))).toBe(true);
    stderrSpy.mockRestore();
  });

  it("display overlay group overrides auto-extraction", () => {
    const desc = makeMod("payment.check_status", "desc", {
      cli: { group: "billing", alias: "status" },
    });
    const defs: Array<[string, ModuleDescriptor]> = [["payment.check_status", desc]];
    const group = makeGroupedGroup(defs);
    group.buildGroupMap();
    expect(group.getGroupMap().has("billing")).toBe(true);
    expect(group.getGroupMap().get("billing")!.has("status")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TestGroupedModuleGroupRouting
// ---------------------------------------------------------------------------

describe("GroupedModuleGroup routing", () => {
  it("listCommands shows groups and top-level", () => {
    const defs: Array<[string, ModuleDescriptor]> = [
      ["math.add", makeMod("math.add")],
      ["status", makeMod("status")],
    ];
    const group = makeGroupedGroup(defs);
    const commands = group.listCommands();
    expect(commands).toContain("math"); // group
    expect(commands).toContain("status"); // top-level
    expect(commands).toContain("exec"); // builtin
  });

  it("getCommand returns a Command for group", () => {
    const defs: Array<[string, ModuleDescriptor]> = [
      ["math.add", makeMod("math.add")],
    ];
    const group = makeGroupedGroup(defs);
    const result = group.getCommand("math");
    expect(result).not.toBeNull();
    expect(result!.name()).toBe("math");
  });

  it("getCommand returns a Command for top-level module", () => {
    const defs: Array<[string, ModuleDescriptor]> = [
      ["status", makeMod("status")],
    ];
    const group = makeGroupedGroup(defs);
    const result = group.getCommand("status");
    expect(result).not.toBeNull();
    expect(result!.name()).toBe("status");
  });

  it("getCommand returns null for unknown", () => {
    const group = makeGroupedGroup([]);
    const result = group.getCommand("nonexistent");
    expect(result).toBeNull();
  });

  it("getCommand caches lazy group", () => {
    const defs: Array<[string, ModuleDescriptor]> = [
      ["math.add", makeMod("math.add")],
    ];
    const group = makeGroupedGroup(defs);
    const first = group.getCommand("math");
    const second = group.getCommand("math");
    expect(first).toBe(second);
  });
});

// ---------------------------------------------------------------------------
// TestLazyGroupInner
// ---------------------------------------------------------------------------

describe("LazyGroup", () => {
  function makeLazyGroup(): LazyGroup {
    const d1 = makeMod("math.add");
    const d2 = makeMod("math.sub");
    const members = new Map<string, [string, ModuleDescriptor]>();
    members.set("add", ["math.add", d1]);
    members.set("sub", ["math.sub", d2]);
    return new LazyGroup(members, mockExecutor, "math");
  }

  it("listCommands returns sorted member names", () => {
    const grp = makeLazyGroup();
    expect(grp.listCommands()).toEqual(["add", "sub"]);
  });

  it("getCommand returns a Command", () => {
    const grp = makeLazyGroup();
    const cmd = grp.getCommand("add");
    expect(cmd).not.toBeNull();
    expect(cmd!.name()).toBe("add");
  });

  it("getCommand returns null for unknown", () => {
    const grp = makeLazyGroup();
    expect(grp.getCommand("nonexistent")).toBeNull();
  });

  it("caches commands", () => {
    const grp = makeLazyGroup();
    const first = grp.getCommand("add");
    const second = grp.getCommand("add");
    expect(first).toBe(second);
  });
});

// ---------------------------------------------------------------------------
// BUILTIN_COMMANDS constant
// ---------------------------------------------------------------------------

describe("BUILTIN_COMMANDS", () => {
  it("contains expected entries", () => {
    expect(BUILTIN_COMMANDS).toContain("exec");
    expect(BUILTIN_COMMANDS).toContain("list");
    expect(BUILTIN_COMMANDS).toContain("describe");
    expect(BUILTIN_COMMANDS).toContain("completion");
    expect(BUILTIN_COMMANDS).toContain("man");
  });
});
