/**
 * Tests for shell completion + man page generation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import {
  buildProgramManPage,
  configureManHelp,
  registerCompletionCommand,
  generateBashCompletion,
  generateZshCompletion,
  generateFishCompletion,
} from "../src/shell.js";

describe("registerCompletionCommand() attachment", () => {
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

  it("adds 'completion' subcommand to the passed host", () => {
    const cli = new Command("test-cli");
    registerCompletionCommand(cli);
    const names = cli.commands.map((c) => c.name());
    expect(names).toContain("completion");
  });

  describe("completion command", () => {
    it("generates bash completion script", () => {
      const cli = new Command("test-cli");
      registerCompletionCommand(cli);
      cli.parse(["completion", "bash"], { from: "user" });
      expect(output).toContain("compgen");
      expect(output).toContain("complete -F");
    });

    it("generates zsh completion script", () => {
      const cli = new Command("test-cli");
      registerCompletionCommand(cli);
      cli.parse(["completion", "zsh"], { from: "user" });
      expect(output).toContain("#compdef");
      expect(output).toContain("compdef");
    });

    it("generates fish completion script", () => {
      const cli = new Command("test-cli");
      registerCompletionCommand(cli);
      cli.parse(["completion", "fish"], { from: "user" });
      expect(output).toContain("complete -c");
      expect(output).toContain("__fish_use_subcommand");
    });

    it("exits 2 for unknown shell", () => {
      const cli = new Command("test-cli");
      registerCompletionCommand(cli);
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("exit");
      });
      expect(() =>
        cli.parse(["completion", "powershell"], { from: "user" }),
      ).toThrow("exit");
      expect(exitSpy).toHaveBeenCalledWith(2);
    });
  });

  describe("configureManHelp() attaches --man at root", () => {
    it("adds hidden --man option", () => {
      const cli = new Command("test-cli").exitOverride();
      configureManHelp(cli, "test-cli", "1.0.0");
      const manOpt = cli.options.find((o) => o.long === "--man");
      expect(manOpt).toBeDefined();
    });
  });
});

describe("buildProgramManPage()", () => {
  it("generates valid roff with TH header", () => {
    const program = new Command("test-cli").description("Test CLI");
    program.command("hello").description("Say hello").option("--name <n>", "Your name");
    const roff = buildProgramManPage(program, "test-cli", "1.0.0");
    expect(roff).toContain('.TH "TEST-CLI"');
    expect(roff).toContain(".SH COMMANDS");
    expect(roff).toContain("hello");
    expect(roff).toContain("\\-\\-name");
  });

  it("includes nested subcommands", () => {
    const program = new Command("mycli");
    const group = program.command("group").description("A group");
    group.command("sub").description("A sub").option("--flag", "A flag");
    const roff = buildProgramManPage(program, "mycli", "1.0.0");
    expect(roff).toContain("mycli group sub");
    expect(roff).toContain("\\-\\-flag");
  });

  it("excludes help and version options", () => {
    const program = new Command("mycli").version("1.0.0");
    program.command("cmd").description("A command");
    const roff = buildProgramManPage(program, "mycli", "1.0.0");
    expect(roff).not.toContain("display help for command");
    expect(roff).not.toContain("output the version number");
  });
});

describe("configureManHelp()", () => {
  it("adds --man as a hidden option", () => {
    const program = new Command("test-cli").exitOverride();
    configureManHelp(program, "test-cli", "1.0.0");
    const manOpt = program.options.find((o) => o.long === "--man");
    expect(manOpt).toBeDefined();
    expect((manOpt as any).hidden).toBe(true);
  });

  it("attaches --man at root level (spec §4.1), not under apcli group", () => {
    const program = new Command("test-cli");
    const apcliGroup = program.command("apcli").description("Builtin group");
    configureManHelp(program, "test-cli", "1.0.0");
    // --man lives on root program, not on apcli
    expect(program.options.find((o) => o.long === "--man")).toBeDefined();
    expect(apcliGroup.options.find((o) => o.long === "--man")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// FE-13 task 2: registerCompletionCommand + dynamic completion generators
// ---------------------------------------------------------------------------

describe("registerCompletionCommand(apcliGroup)", () => {
  it("attaches 'completion' to the apcli group's subcommands (not root)", () => {
    const program = new Command("test-cli");
    const apcliGroup = program.command("apcli").description("Builtin group");
    registerCompletionCommand(apcliGroup);
    const apcliNames = apcliGroup.commands.map((c) => c.name());
    expect(apcliNames).toContain("completion");
    // Not on root
    const rootNames = program.commands.map((c) => c.name()).filter((n) => n !== "apcli");
    expect(rootNames).not.toContain("completion");
  });
});

describe("dynamic completion generators", () => {
  describe("T-APCLI-29: root completion excludes 'apcli' when group is hidden", () => {
    function build(hidden: boolean): Command {
      const program = new Command("test-cli");
      const apcliGroup = program.command("apcli").description("Builtin group");
      apcliGroup.command("list").description("List");
      apcliGroup.command("exec").description("Exec");
      if (hidden) {
        // Hide the apcli group (mode:"none" equivalent)
        (apcliGroup as any)._hidden = true;
      }
      return program;
    }

    it("bash: omits 'apcli' when apcli group is hidden", () => {
      const script = generateBashCompletion("test-cli", build(true));
      // Should not list apcli as a top-level completion token
      expect(script).not.toMatch(/\bapcli\b/);
    });

    it("bash: includes 'apcli' when apcli group is visible", () => {
      const script = generateBashCompletion("test-cli", build(false));
      expect(script).toMatch(/\bapcli\b/);
    });

    it("zsh: omits 'apcli' when apcli group is hidden", () => {
      const script = generateZshCompletion("test-cli", build(true));
      expect(script).not.toMatch(/'apcli'/);
      expect(script).not.toMatch(/\bapcli:/);
    });

    it("fish: omits 'apcli' when apcli group is hidden", () => {
      const script = generateFishCompletion("test-cli", build(true));
      expect(script).not.toMatch(/-a\s+["']?apcli\b/);
    });
  });

  describe("T-APCLI-30: apcli-level completions enumerate registered subcommands", () => {
    function buildTwo(): Command {
      const program = new Command("test-cli");
      const apcliGroup = program.command("apcli").description("Builtin group");
      apcliGroup.command("list").description("List");
      apcliGroup.command("exec").description("Exec");
      return program;
    }

    it("bash: apcli-level contains exactly 'list' and 'exec'", () => {
      const script = generateBashCompletion("test-cli", buildTwo());
      // script must mention list and exec as apcli subcommands
      expect(script).toContain("list");
      expect(script).toContain("exec");
      // Should NOT contain other builtins that aren't registered
      expect(script).not.toMatch(/\bdescribe\b/);
      expect(script).not.toMatch(/\binit\b/);
    });

    it("zsh: apcli-level contains 'list' and 'exec'", () => {
      const script = generateZshCompletion("test-cli", buildTwo());
      expect(script).toContain("list");
      expect(script).toContain("exec");
      expect(script).not.toMatch(/\bdescribe\b/);
    });

    it("fish: apcli-level contains 'list' and 'exec'", () => {
      const script = generateFishCompletion("test-cli", buildTwo());
      expect(script).toContain("list");
      expect(script).toContain("exec");
      expect(script).not.toMatch(/\bdescribe\b/);
    });
  });

  describe("T-APCLI-40 regression guard: enumerate ALL registered subcommands", () => {
    // When the apcli group is visible AND all subcommands are registered
    // (mode:"none" registers all — well, mode "all" does; mode "none" hides the
    // group). The regression guard: completion must NOT filter via
    // isSubcommandIncluded — it reads Commander's registered set verbatim.
    function buildAll(): Command {
      const program = new Command("test-cli");
      const apcliGroup = program.command("apcli").description("Builtin group");
      // Register the full builtin set
      for (const name of ["completion", "describe", "exec", "init", "list", "man"]) {
        apcliGroup.command(name).description(name);
      }
      return program;
    }

    it("bash: enumerates all registered subcommands", () => {
      const script = generateBashCompletion("test-cli", buildAll());
      for (const n of ["completion", "describe", "exec", "init", "list", "man"]) {
        expect(script).toContain(n);
      }
    });

    it("fish: enumerates all registered subcommands", () => {
      const script = generateFishCompletion("test-cli", buildAll());
      for (const n of ["completion", "describe", "exec", "init", "list", "man"]) {
        expect(script).toContain(n);
      }
    });
  });

  describe("source-level regression guards", () => {
    const shellSource = readFileSync(
      path.resolve(__dirname, "../src/shell.ts"),
      "utf8",
    );

    it("does NOT contain the hardcoded opts list 'completion describe exec init list man'", () => {
      expect(shellSource).not.toContain(
        "completion describe exec init list man",
      );
    });

    it("does NOT contain the 'knownBuiltins' identifier", () => {
      expect(shellSource).not.toMatch(/\bknownBuiltins\b/);
    });
  });
});
