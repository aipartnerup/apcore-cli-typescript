/**
 * Tests for `markdown` and `skill` output formats (FE-08, issue #20).
 *
 * Both formats delegate to apcore-toolkit's `formatModule(s)` — these tests
 * assert the CLI wrapper produces output byte-identical to the toolkit
 * primitive when fed an adapted ScannedModule.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { formatModule, formatModules, type ScannedModule } from "apcore-toolkit";
import { formatModuleList, formatModuleDetail } from "../src/output.js";
import type { ModuleDescriptor } from "../src/cli.js";

const makeDescriptor = (overrides: Partial<ModuleDescriptor> = {}): ModuleDescriptor => ({
  id: "math.add",
  name: "math.add",
  description: "Add two numbers.",
  tags: [],
  inputSchema: {
    type: "object",
    properties: {
      a: { type: "integer" },
      b: { type: "integer" },
    },
    required: ["a", "b"],
  },
  outputSchema: {
    type: "object",
    properties: { sum: { type: "integer" } },
    required: ["sum"],
  },
  ...overrides,
});

const makeScanned = (d: ModuleDescriptor): ScannedModule => ({
  moduleId: d.id,
  description: d.description ?? "",
  inputSchema: (d.inputSchema ?? {}) as Record<string, unknown>,
  outputSchema: (d.outputSchema ?? {}) as Record<string, unknown>,
  tags: d.tags ?? [],
  target: "",
  version: "1.0.0",
  annotations: null,
  documentation: null,
  suggestedAlias: null,
  examples: [],
  metadata: (d.metadata ?? {}) as Record<string, unknown>,
  display:
    ((d.metadata ?? {}) as Record<string, unknown>)["display"] as
      | Record<string, unknown>
      | null ?? null,
  warnings: [],
});

describe("markdown / skill output formats", () => {
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

  it("formatModuleList markdown matches toolkit formatModules", async () => {
    const d = makeDescriptor();
    await formatModuleList([d], "markdown");
    const expected =
      (formatModules([makeScanned(d)], { style: "markdown", display: true }) as string) +
      "\n";
    expect(output).toBe(expected);
  });

  it("formatModuleList skill matches toolkit formatModules", async () => {
    const d = makeDescriptor();
    await formatModuleList([d], "skill");
    const expected =
      (formatModules([makeScanned(d)], { style: "skill", display: true }) as string) +
      "\n";
    expect(output).toBe(expected);
  });

  it("formatModuleDetail markdown matches toolkit formatModule", async () => {
    const d = makeDescriptor({ description: "Add two integers." });
    await formatModuleDetail(d, "markdown");
    const expected =
      (formatModule(makeScanned(d), { style: "markdown", display: true }) as string) +
      "\n";
    expect(output).toBe(expected);
  });

  it("formatModuleDetail skill emits YAML frontmatter", async () => {
    const d = makeDescriptor();
    await formatModuleDetail(d, "skill");
    expect(output.startsWith("---\n")).toBe(true);
    const lines = output.split("\n");
    expect(lines[1]).toMatch(/^name: math\.add/);
    expect(lines[2]).toMatch(/^description:/);
    expect(lines[3]).toBe("---");
  });

  it("formatModuleDetail skill matches toolkit formatModule", async () => {
    const d = makeDescriptor({ tags: ["math"] });
    await formatModuleDetail(d, "skill");
    const expected =
      (formatModule(makeScanned(d), { style: "skill", display: true }) as string) +
      "\n";
    expect(output).toBe(expected);
  });
});
