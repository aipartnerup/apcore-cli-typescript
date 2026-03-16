/**
 * Tests for shell completion + man page generation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { registerShellCommands } from "../src/shell.js";

describe("registerShellCommands()", () => {
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

  it("adds 'completion' and 'man' subcommands", () => {
    const cli = new Command("test-cli");
    registerShellCommands(cli, "test-cli");
    const names = cli.commands.map((c) => c.name());
    expect(names).toContain("completion");
    expect(names).toContain("man");
  });

  describe("completion command", () => {
    it("generates bash completion script", () => {
      const cli = new Command("test-cli");
      registerShellCommands(cli, "test-cli");
      cli.parse(["completion", "bash"], { from: "user" });
      expect(output).toContain("compgen");
      expect(output).toContain("complete -F");
    });

    it("generates zsh completion script", () => {
      const cli = new Command("test-cli");
      registerShellCommands(cli, "test-cli");
      cli.parse(["completion", "zsh"], { from: "user" });
      expect(output).toContain("#compdef");
      expect(output).toContain("compdef");
    });

    it("generates fish completion script", () => {
      const cli = new Command("test-cli");
      registerShellCommands(cli, "test-cli");
      cli.parse(["completion", "fish"], { from: "user" });
      expect(output).toContain("complete -c");
      expect(output).toContain("__fish_use_subcommand");
    });

    it("exits 2 for unknown shell", () => {
      const cli = new Command("test-cli");
      registerShellCommands(cli, "test-cli");
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("exit");
      });
      expect(() =>
        cli.parse(["completion", "powershell"], { from: "user" }),
      ).toThrow("exit");
      expect(exitSpy).toHaveBeenCalledWith(2);
    });
  });

  describe("man command", () => {
    it("generates roff-formatted man page", () => {
      const cli = new Command("test-cli");
      registerShellCommands(cli, "test-cli");
      cli.parse(["man", "completion"], { from: "user" });
      expect(output).toContain(".TH");
      expect(output).toContain(".SH NAME");
      expect(output).toContain(".SH SYNOPSIS");
      expect(output).toContain(".SH ENVIRONMENT");
      expect(output).toContain(".SH EXIT CODES");
    });

    it("includes all exit codes", () => {
      const cli = new Command("test-cli");
      registerShellCommands(cli, "test-cli");
      cli.parse(["man", "completion"], { from: "user" });
      for (const code of ["0", "1", "2", "44", "45", "46", "47", "48", "77", "130"]) {
        expect(output).toContain(`\\fB${code}\\fR`);
      }
    });

    it("exits 2 for unknown command", () => {
      const cli = new Command("test-cli");
      registerShellCommands(cli, "test-cli");
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("exit");
      });
      expect(() =>
        cli.parse(["man", "nonexistent"], { from: "user" }),
      ).toThrow("exit");
      expect(exitSpy).toHaveBeenCalledWith(2);
    });
  });
});
