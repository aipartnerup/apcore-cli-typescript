/**
 * Tests for init command (FE-10).
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Command } from "commander";
import { registerInitCommand } from "../src/init-cmd.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apcore-init-test-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  // Clean up tmp dir
  fs.rmSync(tmpDir, { recursive: true, force: true });
  // Clean up companion files created by binding style tests
  const companionDir = path.join(process.cwd(), "commands");
  if (fs.existsSync(companionDir)) {
    fs.rmSync(companionDir, { recursive: true, force: true });
  }
});

function makeCli(): Command {
  const root = new Command("test").exitOverride();
  registerInitCommand(root);
  return root;
}

function findFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, ext));
    } else if (entry.name.endsWith(ext)) {
      results.push(fullPath);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("init module command", () => {
  it("convention style creates file", () => {
    const cli = makeCli();
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    cli.parse(["node", "test", "init", "module", "ops.deploy", "--dir", tmpDir]);
    expect(stdoutSpy).toHaveBeenCalled();
    const calls = stdoutSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.includes("Created"))).toBe(true);
    const pyFiles = findFiles(tmpDir, ".py");
    expect(pyFiles.length).toBeGreaterThanOrEqual(1);
  });

  it("decorator style creates file with @module", () => {
    const cli = makeCli();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    cli.parse(["node", "test", "init", "module", "ops.deploy", "--style", "decorator", "--dir", tmpDir]);
    const pyFiles = findFiles(tmpDir, ".py");
    expect(pyFiles.length).toBe(1);
    const content = fs.readFileSync(pyFiles[0], "utf-8");
    expect(content).toContain("@module");
    expect(content).toContain('id="ops.deploy"');
  });

  it("binding style creates YAML", () => {
    const cli = makeCli();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    cli.parse(["node", "test", "init", "module", "ops.deploy", "--style", "binding", "--dir", tmpDir]);
    const yamlFiles = findFiles(tmpDir, ".yaml");
    expect(yamlFiles.length).toBe(1);
    const content = fs.readFileSync(yamlFiles[0], "utf-8");
    expect(content).toContain("ops.deploy");
  });

  it("convention has CLI_GROUP for dotted IDs", () => {
    const cli = makeCli();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    cli.parse(["node", "test", "init", "module", "ops.deploy", "--dir", tmpDir]);
    const pyFiles = findFiles(tmpDir, ".py");
    const content = fs.readFileSync(pyFiles[0], "utf-8");
    expect(content).toContain("CLI_GROUP");
  });

  it("description flag works", () => {
    const cli = makeCli();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    cli.parse([
      "node", "test", "init", "module", "ops.deploy",
      "--dir", tmpDir,
      "-d", "Deploy to production",
    ]);
    const pyFiles = findFiles(tmpDir, ".py");
    const content = fs.readFileSync(pyFiles[0], "utf-8");
    expect(content).toContain("Deploy to production");
  });

  it("help text mentions all styles", () => {
    const cli = makeCli();
    // Capture help output
    let helpText = "";
    try {
      cli.parse(["node", "test", "init", "module", "--help"]);
    } catch (e: unknown) {
      // Commander with exitOverride throws on --help
      if (e instanceof Error && "code" in e) {
        // Expected CommanderError
      } else {
        throw e;
      }
    }
    // Get help text by writing to string
    const initCmd = cli.commands.find((c) => c.name() === "init");
    expect(initCmd).toBeDefined();
    const moduleCmd = initCmd!.commands.find((c) => c.name() === "module");
    expect(moduleCmd).toBeDefined();
    helpText = moduleCmd!.helpInformation();
    expect(helpText).toContain("decorator");
    expect(helpText).toContain("convention");
    expect(helpText).toContain("binding");
  });

  it("non-dotted module id creates without CLI_GROUP", () => {
    const cli = makeCli();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    cli.parse(["node", "test", "init", "module", "health", "--dir", tmpDir]);
    const pyFiles = findFiles(tmpDir, ".py");
    expect(pyFiles.length).toBe(1);
    const content = fs.readFileSync(pyFiles[0], "utf-8");
    expect(content).not.toContain("CLI_GROUP");
  });
});
