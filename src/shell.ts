/**
 * Shell completion + man page generation.
 *
 * Protocol spec: Shell integration
 */

import { spawnSync } from "node:child_process";
import { Command, Help, Option } from "commander";
import { EXIT_CODES } from "./errors.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a prog_name like 'my-tool' to a valid shell identifier '_my_tool'.
 */
function makeFunctionName(progName: string): string {
  return "_" + progName.replace(/[^a-zA-Z0-9]/g, "_");
}

/**
 * Shell-safe quoting.
 */
function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// ---------------------------------------------------------------------------
// Completion generators
// ---------------------------------------------------------------------------

/**
 * Enumerate non-hidden registered subcommands on the apcli Commander group.
 *
 * Per spec §4.13 (T-APCLI-40 regression guard): completion generation reads
 * Commander's registered set verbatim and MUST NOT re-invoke
 * `ApcliGroup.isSubcommandIncluded`. Registration time is the gate.
 */
function enumerateApcliSubcommands(apcliGroup: Command | undefined): string[] {
  if (!apcliGroup) return [];
  return apcliGroup.commands
    .filter((c) => !isCmdHidden(c))
    .map((c) => c.name());
}

/** Enumerate non-hidden root-level subcommands on the program. */
function enumerateRootCommands(program: Command): string[] {
  return program.commands
    .filter((c) => !isCmdHidden(c))
    .map((c) => c.name());
}

/** Locate the apcli Commander subcommand if present. */
function findApcliGroup(program: Command): Command | undefined {
  return program.commands.find((c) => c.name() === "apcli");
}

/** Detect Commander command hidden flag across versions. */
function isCmdHidden(cmd: Command): boolean {
  const withHiddenFn = cmd as unknown as { hidden?: () => boolean };
  const withHiddenField = cmd as unknown as { _hidden?: boolean };
  if (typeof withHiddenFn.hidden === "function") return !!withHiddenFn.hidden();
  return !!withHiddenField._hidden;
}

export function generateBashCompletion(
  progName: string,
  program?: Command,
): string {
  const fn = makeFunctionName(progName);
  const quoted = shellQuote(progName);

  const apcliGroup = program ? findApcliGroup(program) : undefined;
  const apcliVisible = apcliGroup !== undefined && !isCmdHidden(apcliGroup);
  const rootCmds = program
    ? enumerateRootCommands(program).filter(
        (n) => n !== "apcli" || apcliVisible,
      )
    : [];
  const apcliCmds = apcliVisible ? enumerateApcliSubcommands(apcliGroup) : [];

  const rootOpts = rootCmds.join(" ");
  const apcliOpts = apcliCmds.join(" ");

  let body =
    `${fn}() {\n` +
    `    local cur prev opts\n` +
    `    COMPREPLY=()\n` +
    `    cur="\${COMP_WORDS[COMP_CWORD]}"\n` +
    `    prev="\${COMP_WORDS[COMP_CWORD-1]}"\n` +
    `\n` +
    `    if [[ \${COMP_CWORD} -eq 1 ]]; then\n` +
    `        opts="${rootOpts}"\n` +
    `        COMPREPLY=( $(compgen -W "\${opts}" -- \${cur}) )\n` +
    `        return 0\n` +
    `    fi\n`;
  if (apcliVisible) {
    body +=
      `\n` +
      `    if [[ \${COMP_CWORD} -eq 2 ]]; then\n` +
      `        if [[ "\${COMP_WORDS[1]}" == "apcli" ]]; then\n` +
      `            local apcli_cmds="${apcliOpts}"\n` +
      `            COMPREPLY=( $(compgen -W "\${apcli_cmds}" -- \${cur}) )\n` +
      `            return 0\n` +
      `        fi\n` +
      `    fi\n`;
  }
  body += `}\n` + `complete -F ${fn} ${quoted}\n`;
  return body;
}

export function generateZshCompletion(
  progName: string,
  program?: Command,
): string {
  const fn = makeFunctionName(progName);
  const quoted = shellQuote(progName);

  const apcliGroup = program ? findApcliGroup(program) : undefined;
  const apcliVisible = apcliGroup !== undefined && !isCmdHidden(apcliGroup);
  const rootCmds = program
    ? enumerateRootCommands(program).filter(
        (n) => n !== "apcli" || apcliVisible,
      )
    : [];
  const apcliCmds = apcliVisible ? enumerateApcliSubcommands(apcliGroup) : [];

  const rootEntries = rootCmds.map((n) => `        '${n}:${n}'`).join("\n");
  const apcliEntries = apcliCmds.map((n) => `        '${n}:${n}'`).join("\n");

  return (
    `#compdef ${progName}\n` +
    `\n` +
    `${fn}() {\n` +
    `    local -a commands\n` +
    `    commands=(\n` +
    (rootEntries ? rootEntries + "\n" : "") +
    `    )\n` +
    `    local -a apcli_cmds\n` +
    `    apcli_cmds=(\n` +
    (apcliEntries ? apcliEntries + "\n" : "") +
    `    )\n` +
    `\n` +
    `    _arguments -C \\\n` +
    `        '1:command:->command' \\\n` +
    `        '*::arg:->args'\n` +
    `\n` +
    `    case "$state" in\n` +
    `        command)\n` +
    `            _describe -t commands '${progName} commands' commands\n` +
    `            ;;\n` +
    `        args)\n` +
    `            case "\${words[1]}" in\n` +
    `                apcli)\n` +
    `                    _describe -t apcli_cmds '${progName} apcli commands' apcli_cmds\n` +
    `                    ;;\n` +
    `            esac\n` +
    `            ;;\n` +
    `    esac\n` +
    `}\n` +
    `\n` +
    `compdef ${fn} ${quoted}\n`
  );
}

export function generateFishCompletion(
  progName: string,
  program?: Command,
): string {
  const quoted = shellQuote(progName);

  const apcliGroup = program ? findApcliGroup(program) : undefined;
  const apcliVisible = apcliGroup !== undefined && !isCmdHidden(apcliGroup);
  const rootCmds = program
    ? enumerateRootCommands(program).filter(
        (n) => n !== "apcli" || apcliVisible,
      )
    : [];
  const apcliCmds = apcliVisible ? enumerateApcliSubcommands(apcliGroup) : [];

  const lines: string[] = [];
  lines.push(`# Fish completions for ${progName}`);
  for (const name of rootCmds) {
    lines.push(
      `complete -c ${quoted} -n "__fish_use_subcommand" -a ${name} -d "${name}"`,
    );
  }
  if (apcliVisible && apcliCmds.length > 0) {
    lines.push("");
    for (const name of apcliCmds) {
      lines.push(
        `complete -c ${quoted} -n "__fish_seen_subcommand_from apcli" -a ${name} -d "${name}"`,
      );
    }
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Program-wide man page generation
// ---------------------------------------------------------------------------

/** Escape a string for roff output. */
function roffEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/-/g, "\\-").replace(/'/g, "\\(aq");
}

/**
 * Build a complete roff man page for the entire program.
 * Covers all registered commands including downstream business commands.
 */
export function buildProgramManPage(
  program: Command,
  progName: string,
  version: string,
  description?: string,
  docsUrl?: string,
): string {
  const help = new Help();
  const today = new Date().toISOString().slice(0, 10);
  const s: string[] = [];

  const resolvedDesc = description ?? program.description() ?? `${progName} CLI`;

  s.push(`.TH "${progName.toUpperCase()}" "1" "${today}" "${progName} ${version}" "${progName} Manual"`);

  s.push(".SH NAME");
  s.push(`${progName} \\- ${roffEscape(resolvedDesc)}`);

  s.push(".SH SYNOPSIS");
  s.push(`\\fB${progName}\\fR [\\fIglobal\\-options\\fR] \\fIcommand\\fR [\\fIcommand\\-options\\fR]`);

  if (resolvedDesc) {
    s.push(".SH DESCRIPTION");
    s.push(roffEscape(resolvedDesc));
  }

  // Global options
  const globalOpts = help.visibleOptions(program)
    .filter((o) => !["help", "version", "all", "man"].includes(o.long?.replace("--", "") ?? ""));
  if (globalOpts.length > 0) {
    s.push(".SH GLOBAL OPTIONS");
    for (const opt of globalOpts) {
      const flag = [opt.short, opt.long].filter(Boolean).join(", ");
      s.push(".TP");
      s.push(`\\fB${roffEscape(flag)}\\fR`);
      if (opt.description) s.push(roffEscape(opt.description));
    }
  }

  // Commands
  const allCommands = help.visibleCommands(program);
  if (allCommands.length > 0) {
    s.push(".SH COMMANDS");
    for (const cmd of allCommands) {
      if (cmd.name() === "help") continue;

      const desc = help.subcommandDescription(cmd);
      s.push(".TP");
      s.push(`\\fB${progName} ${roffEscape(cmd.name())}\\fR`);
      if (desc) s.push(roffEscape(desc));

      // Command options
      const cmdHelp = new Help();
      const opts = cmdHelp.visibleOptions(cmd)
        .filter((o) => !["help", "version"].includes(o.long?.replace("--", "") ?? ""));
      for (const opt of opts) {
        const flag = [opt.short, opt.long].filter(Boolean).join(", ");
        s.push(".RS");
        s.push(".TP");
        s.push(`\\fB${roffEscape(flag)}\\fR`);
        if (opt.description) s.push(roffEscape(opt.description));
        s.push(".RE");
      }

      // Nested subcommands (e.g., series init, asset add)
      const subCmds = cmdHelp.visibleCommands(cmd).filter((c) => c.name() !== "help");
      for (const sub of subCmds) {
        const subDesc = help.subcommandDescription(sub);
        s.push(".TP");
        s.push(`\\fB${progName} ${roffEscape(cmd.name())} ${roffEscape(sub.name())}\\fR`);
        if (subDesc) s.push(roffEscape(subDesc));
        const subOpts = cmdHelp.visibleOptions(sub)
          .filter((o) => !["help", "version"].includes(o.long?.replace("--", "") ?? ""));
        for (const opt of subOpts) {
          const flag = [opt.short, opt.long].filter(Boolean).join(", ");
          s.push(".RS");
          s.push(".TP");
          s.push(`\\fB${roffEscape(flag)}\\fR`);
          if (opt.description) s.push(roffEscape(opt.description));
          s.push(".RE");
        }
      }
    }
  }

  // Environment
  s.push(".SH ENVIRONMENT");
  s.push(".TP");
  s.push("\\fBAPCORE_EXTENSIONS_ROOT\\fR");
  s.push("Path to the apcore extensions directory.");
  s.push(".TP");
  s.push("\\fBAPCORE_CLI_AUTO_APPROVE\\fR");
  s.push("Set to \\fB1\\fR to bypass approval prompts.");
  s.push(".TP");
  s.push("\\fBAPCORE_CLI_LOGGING_LEVEL\\fR");
  s.push("CLI\\-specific logging verbosity (DEBUG|INFO|WARNING|ERROR).");

  // Exit codes
  s.push(".SH EXIT CODES");
  const exitCodes: [string, string][] = [
    ["0", "Success."],
    ["1", "Module execution error."],
    ["2", "Invalid CLI input or missing argument."],
    ["44", "Module not found, disabled, or failed to load."],
    ["45", "Input failed JSON Schema validation."],
    ["46", "Approval denied or timed out."],
    ["47", "Configuration error."],
    ["77", "ACL denied."],
    ["130", "Cancelled by user (SIGINT)."],
  ];
  for (const [code, meaning] of exitCodes) {
    s.push(`.TP\n\\fB${code}\\fR\n${meaning}`);
  }

  s.push(".SH SEE ALSO");
  s.push(`\\fB${progName} \\-\\-help \\-\\-verbose\\fR for full option list.`);
  if (docsUrl) {
    s.push(`.PP\nFull documentation at \\fI${roffEscape(docsUrl)}\\fR`);
  }

  return s.join("\n");
}

/**
 * Configure --help --man support on a Commander program.
 * When --man is passed with --help, outputs a complete roff man page
 * covering all registered commands (including downstream business commands).
 *
 * Usage in downstream projects:
 *   configureManHelp(program, 'reach', '0.2.0', 'ReachForge: The Social Influence Engine', 'https://reachforge.dev/docs');
 */
export function configureManHelp(
  program: Command,
  progName: string,
  version: string,
  description?: string,
  docsUrl?: string,
): void {
  // Add --man as a hidden option
  const manOpt = new Option("--man", "Output man page in roff format (use with --help)").hideHelp();
  program.addOption(manOpt);

  // Intercept help to output roff when --man is set
  program.addHelpText("beforeAll", () => {
    if (program.opts().man) {
      const roff = buildProgramManPage(program, progName, version, description, docsUrl) + "\n";

      // If stdout is a TTY, render through a pager; otherwise output raw roff
      // (allows piping/redirection like `reach --help --man > reach.1`)
      if (process.stdout.isTTY) {
        // Try mandoc first (available on macOS/BSD), then groff, then fall back to raw output
        const pagers: Array<{ cmd: string; args: string[] }> = [
          { cmd: "mandoc", args: ["-a"] },
          { cmd: "groff",  args: ["-man", "-Tutf8"] },
        ];
        let rendered = false;
        for (const { cmd, args } of pagers) {
          const result = spawnSync(cmd, args, {
            input: roff,
            stdio: ["pipe", "pipe", "pipe"],
            encoding: "utf-8",
          });
          if (result.status === 0 && result.stdout) {
            const pager = process.env.PAGER || "less";
            const pagerResult = spawnSync(pager, ["-R"], {
              input: result.stdout,
              stdio: ["pipe", "inherit", "inherit"],
            });
            if (pagerResult.status !== null) {
              rendered = true;
              break;
            }
          }
        }
        if (!rendered) {
          process.stdout.write(roff);
        }
      } else {
        process.stdout.write(roff);
      }
      process.exit(0);
    }
    return "";
  });
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

/**
 * Locate the root Commander program by walking the parent chain from `host`.
 * When `host` is the root itself, returns `host`.
 */
function findRootProgram(host: Command): Command {
  let cur: Command = host;
  while (cur.parent) cur = cur.parent;
  return cur;
}

/**
 * Register the `completion` subcommand on `host` (typically the apcli group
 * per spec §4.1, or the root program during the transition period).
 *
 * The completion-script generator enumerates the actually-registered set of
 * subcommands from the root program's Commander tree at generation time
 * (spec §4.13).
 */
export function registerCompletionCommand(host: Command): void {
  const completionCmd = new Command("completion")
    .description("Generate a shell completion script and print it to stdout.")
    .argument("<shell>", "Shell type: bash, zsh, or fish")
    .action((shell: string) => {
      const validShells = ["bash", "zsh", "fish"];
      if (!validShells.includes(shell)) {
        process.stderr.write(
          `Error: Unknown shell '${shell}'. Expected: bash, zsh, or fish.\n`,
        );
        process.exit(EXIT_CODES.INVALID_CLI_INPUT);
      }

      const root = findRootProgram(host);
      const resolved = root.name() || "apcore-cli";
      const generators: Record<string, () => string> = {
        bash: () => generateBashCompletion(resolved, root),
        zsh: () => generateZshCompletion(resolved, root),
        fish: () => generateFishCompletion(resolved, root),
      };
      process.stdout.write(generators[shell]());
    });
  host.addCommand(completionCmd);
}

// registerShellCommands was removed in FE-13 create-cli-integration.
// Call registerCompletionCommand directly (typically from the apcli group
// dispatcher) and configureManHelp at the root program to get --help --man.
