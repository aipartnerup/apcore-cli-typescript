/**
 * Tests for TTY-adaptive output formatting.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  formatExecResult,
  resolveFormat,
  truncate,
  formatModuleList,
  formatModuleDetail,
} from "../src/output.js";
import type { ModuleDescriptor } from "../src/cli.js";

describe("resolveFormat()", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns explicit format when provided", () => {
    expect(resolveFormat("json")).toBe("json");
    expect(resolveFormat("table")).toBe("table");
  });

  it("returns 'table' when stdout is TTY and no explicit format", () => {
    const original = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    expect(resolveFormat()).toBe("table");
    Object.defineProperty(process.stdout, "isTTY", { value: original, configurable: true });
  });

  it("returns 'json' when stdout is not TTY", () => {
    const original = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    expect(resolveFormat()).toBe("json");
    Object.defineProperty(process.stdout, "isTTY", { value: original, configurable: true });
  });
});

describe("truncate()", () => {
  it("returns text unchanged when under max length", () => {
    expect(truncate("hello", 80)).toBe("hello");
  });

  it("truncates and adds '...' when over max length", () => {
    const result = truncate("a".repeat(100), 80);
    expect(result.length).toBe(80);
    expect(result.endsWith("...")).toBe(true);
  });

  it("handles exact max length without truncation", () => {
    const text = "a".repeat(80);
    expect(truncate(text, 80)).toBe(text);
  });
});

describe("formatModuleList()", () => {
  let output: string;

  beforeEach(() => {
    output = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      output += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const makeMod = (id: string, desc: string, tags: string[] = []): ModuleDescriptor => ({
    id,
    name: id,
    description: desc,
    tags,
  });

  it("outputs JSON array for json format", () => {
    formatModuleList([makeMod("math.add", "Add numbers", ["math"])], "json");
    const parsed = JSON.parse(output);
    expect(parsed).toEqual([
      { id: "math.add", description: "Add numbers", tags: ["math"] },
    ]);
  });

  it("outputs plain-text table for table format", () => {
    formatModuleList([makeMod("math.add", "Add two numbers")], "table");
    expect(output).toContain("ID");
    expect(output).toContain("Description");
    expect(output).toContain("math.add");
    expect(output).toContain("Add two numbers");
  });

  it("shows 'No modules found.' for empty list", () => {
    formatModuleList([], "table");
    expect(output).toContain("No modules found.");
  });

  it("shows 'No modules found matching tags:' when filter active", () => {
    formatModuleList([], "table", ["math"]);
    expect(output).toContain("No modules found matching tags: math");
  });

  it("truncates description at 80 chars in table format", () => {
    const longDesc = "a".repeat(100);
    formatModuleList([makeMod("m", longDesc)], "table");
    expect(output).not.toContain(longDesc);
    expect(output).toContain("...");
  });

  it("outputs [] for empty list (json)", () => {
    formatModuleList([], "json");
    expect(JSON.parse(output)).toEqual([]);
  });
});

describe("formatModuleDetail()", () => {
  let output: string;

  beforeEach(() => {
    output = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      output += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const baseMod: ModuleDescriptor = {
    id: "test.mod",
    name: "test.mod",
    description: "A test module",
    tags: ["test"],
    inputSchema: { type: "object", properties: { x: { type: "string" } } },
    outputSchema: { type: "object", properties: { y: { type: "string" } } },
  };

  it("outputs full JSON object for json format", () => {
    formatModuleDetail(baseMod, "json");
    const parsed = JSON.parse(output);
    expect(parsed.id).toBe("test.mod");
    expect(parsed.description).toBe("A test module");
    expect(parsed.input_schema).toBeDefined();
    expect(parsed.tags).toEqual(["test"]);
  });

  it("outputs structured text for table format", () => {
    formatModuleDetail(baseMod, "table");
    expect(output).toContain("Module: test.mod");
    expect(output).toContain("A test module");
    expect(output).toContain("Input Schema:");
    expect(output).toContain("Output Schema:");
    expect(output).toContain("Tags: test");
  });

  it("includes annotations (non-default values only)", () => {
    const mod = {
      ...baseMod,
      annotations: { readonly: true, destructive: false, idempotent: true },
    } as ModuleDescriptor;
    formatModuleDetail(mod, "table");
    expect(output).toContain("Annotations:");
    expect(output).toContain("readonly: true");
    expect(output).toContain("idempotent: true");
    expect(output).not.toContain("destructive");
  });

  it("includes extension metadata (x- prefixed)", () => {
    const mod = {
      ...baseMod,
      metadata: { "x-owner": "team-a", "x-cost": 0.5, normal: "skip" },
    } as ModuleDescriptor;
    formatModuleDetail(mod, "json");
    const parsed = JSON.parse(output);
    expect(parsed["x-owner"]).toBe("team-a");
    expect(parsed["x-cost"]).toBe(0.5);
    expect(parsed.normal).toBeUndefined();
  });

  it("omits empty sections", () => {
    const mod: ModuleDescriptor = {
      id: "minimal",
      name: "minimal",
      description: "Minimal",
    };
    formatModuleDetail(mod, "table");
    expect(output).not.toContain("Input Schema:");
    expect(output).not.toContain("Annotations:");
    expect(output).not.toContain("Tags:");
  });
});

describe("formatExecResult()", () => {
  let output: string;

  beforeEach(() => {
    output = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      output += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("outputs nothing for null result", () => {
    formatExecResult(null, "json");
    expect(output).toBe("");
  });

  it("outputs nothing for undefined result", () => {
    formatExecResult(undefined, "json");
    expect(output).toBe("");
  });

  it("outputs JSON for dict result when format is json", () => {
    formatExecResult({ a: 1, b: 2 }, "json");
    const parsed = JSON.parse(output);
    expect(parsed).toEqual({ a: 1, b: 2 });
  });

  it("outputs key/value table for dict result when format is table", () => {
    formatExecResult({ name: "Alice", age: 30 }, "table");
    expect(output).toContain("Key");
    expect(output).toContain("Value");
    expect(output).toContain("name");
    expect(output).toContain("Alice");
  });

  it("outputs JSON for array result regardless of format", () => {
    formatExecResult([1, 2, 3], "table");
    const parsed = JSON.parse(output);
    expect(parsed).toEqual([1, 2, 3]);
  });

  it("outputs plain text for string result", () => {
    formatExecResult("hello world", "json");
    expect(output).toBe("hello world\n");
  });

  it("outputs string representation for number", () => {
    formatExecResult(42, "json");
    expect(output).toBe("42\n");
  });
});
