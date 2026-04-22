/**
 * Tests for discovery commands (list, describe, exec, validate).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import {
  registerListCommand,
  registerDescribeCommand,
  registerExecCommand,
  registerValidateCommand,
} from "../src/discovery.js";
import type { Executor, ModuleDescriptor, Registry } from "../src/cli.js";

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

function makeExecutor(overrides: Partial<Executor> = {}): Executor {
  return {
    execute: vi.fn(async () => ({ ok: true })),
    ...overrides,
  } as Executor;
}

// Legacy registerDiscoveryCommands tests removed in FE-13 create-cli-integration.
// The per-subcommand registrar tests below provide full behavioral coverage.

// ---------------------------------------------------------------------------
// Per-subcommand registrars (FE-13 discovery-split)
// ---------------------------------------------------------------------------

describe("registerListCommand()", () => {
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

  it("attaches 'list' to the passed-in group, not root", () => {
    const root = new Command("root");
    const apcliGroup = new Command("apcli");
    root.addCommand(apcliGroup);
    registerListCommand(apcliGroup, makeRegistry([]));

    const groupNames = apcliGroup.commands.map((c) => c.name());
    expect(groupNames).toContain("list");

    const rootNames = root.commands.filter((c) => c.name() !== "apcli").map((c) => c.name());
    expect(rootNames).not.toContain("list");
  });

  it("lists modules from the registry", () => {
    const apcliGroup = new Command("apcli");
    const mods = [makeMod("math.add", "Add", ["math"]), makeMod("text.upper", "Upper", ["text"])];
    registerListCommand(apcliGroup, makeRegistry(mods));
    apcliGroup.parse(["list", "--format", "json"], { from: "user" });
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(2);
    expect(parsed.map((p: { id: string }) => p.id).sort()).toEqual(["math.add", "text.upper"]);
  });

  it("filters by tag (parity)", () => {
    const apcliGroup = new Command("apcli");
    const mods = [
      makeMod("math.add", "Add", ["math"]),
      makeMod("text.upper", "Upper", ["text"]),
    ];
    registerListCommand(apcliGroup, makeRegistry(mods));
    apcliGroup.parse(["list", "--tag", "math", "--format", "json"], { from: "user" });
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("math.add");
  });
});

describe("registerDescribeCommand()", () => {
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

  it("attaches 'describe' to the passed-in group, not root", () => {
    const root = new Command("root");
    const apcliGroup = new Command("apcli");
    root.addCommand(apcliGroup);
    registerDescribeCommand(apcliGroup, makeRegistry([]));

    const groupNames = apcliGroup.commands.map((c) => c.name());
    expect(groupNames).toContain("describe");

    const rootNames = root.commands.filter((c) => c.name() !== "apcli").map((c) => c.name());
    expect(rootNames).not.toContain("describe");
  });

  it("describes a module (parity)", () => {
    const apcliGroup = new Command("apcli");
    const mods = [makeMod("math.add", "Add two numbers", ["math"])];
    registerDescribeCommand(apcliGroup, makeRegistry(mods));
    apcliGroup.parse(["describe", "math.add", "--format", "json"], { from: "user" });
    const parsed = JSON.parse(output);
    expect(parsed.id).toBe("math.add");
  });

  it("exits 44 when module not found", () => {
    const apcliGroup = new Command("apcli");
    registerDescribeCommand(apcliGroup, makeRegistry([]));
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    expect(() =>
      apcliGroup.parse(["describe", "nonexistent"], { from: "user" }),
    ).toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(44);
  });
});

describe("registerExecCommand()", () => {
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

  it("attaches 'exec' to the passed-in group, not root", () => {
    const root = new Command("root");
    const apcliGroup = new Command("apcli");
    root.addCommand(apcliGroup);
    const executor = makeExecutor();
    registerExecCommand(apcliGroup, makeRegistry([]), executor);

    const groupNames = apcliGroup.commands.map((c) => c.name());
    expect(groupNames).toContain("exec");

    const rootNames = root.commands.filter((c) => c.name() !== "apcli").map((c) => c.name());
    expect(rootNames).not.toContain("exec");
  });

  it("calls executor.execute with the passed module id", async () => {
    const apcliGroup = new Command("apcli");
    const mods = [makeMod("my.mod", "My module")];
    const execFn = vi.fn(async () => ({ result: 42 }));
    const executor = makeExecutor({ execute: execFn });
    registerExecCommand(apcliGroup, makeRegistry(mods), executor);

    await apcliGroup.parseAsync(["exec", "my.mod", "--format", "json"], { from: "user" });

    expect(execFn).toHaveBeenCalledTimes(1);
    expect(execFn.mock.calls[0][0]).toBe("my.mod");
  });

  it("formats the executor result through output.ts (json)", async () => {
    const apcliGroup = new Command("apcli");
    const mods = [makeMod("my.mod", "My module")];
    const execFn = vi.fn(async () => ({ result: 42 }));
    const executor = makeExecutor({ execute: execFn });
    registerExecCommand(apcliGroup, makeRegistry(mods), executor);

    await apcliGroup.parseAsync(["exec", "my.mod", "--format", "json"], { from: "user" });

    const parsed = JSON.parse(output);
    expect(parsed).toEqual({ result: 42 });
  });

  it("passes parsed --input JSON to executor", async () => {
    const apcliGroup = new Command("apcli");
    const mods = [makeMod("my.mod", "My module")];
    const execFn = vi.fn(async () => ({ ok: true }));
    const executor = makeExecutor({ execute: execFn });
    registerExecCommand(apcliGroup, makeRegistry(mods), executor);

    await apcliGroup.parseAsync(
      ["exec", "my.mod", "--input", '{"foo":"bar"}', "--format", "json"],
      { from: "user" },
    );

    expect(execFn.mock.calls[0][1]).toEqual({ foo: "bar" });
  });

  it("exits 44 when module not found", async () => {
    const apcliGroup = new Command("apcli");
    const executor = makeExecutor();
    registerExecCommand(apcliGroup, makeRegistry([]), executor);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    await expect(
      apcliGroup.parseAsync(["exec", "nonexistent"], { from: "user" }),
    ).rejects.toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(44);
  });
});

describe("registerValidateCommand() attachment", () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("attaches 'validate' to the passed-in group, not root", () => {
    const root = new Command("root");
    const apcliGroup = new Command("apcli");
    root.addCommand(apcliGroup);
    const executor = makeExecutor();
    registerValidateCommand(apcliGroup, makeRegistry([]), executor);

    const groupNames = apcliGroup.commands.map((c) => c.name());
    expect(groupNames).toContain("validate");

    const rootNames = root.commands.filter((c) => c.name() !== "apcli").map((c) => c.name());
    expect(rootNames).not.toContain("validate");
  });
});
