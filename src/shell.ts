/**
 * Shell completion + man page generation.
 *
 * Protocol spec: Shell integration
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { Command } from "commander";
import { EXIT_CODES } from "./errors.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "../package.json"), "utf-8"));
const SHELL_VERSION: string = pkg.version;

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

function generateBashCompletion(progName: string): string {
  const fn = makeFunctionName(progName);
  const quoted = shellQuote(progName);
  const moduleListCmd =
    `${quoted} list --format json 2>/dev/null` +
    ` | node -e "process.stdin.on('data',d=>{JSON.parse(d).forEach(m=>console.log(m.id))})" 2>/dev/null`;
  const groupsAndTopCmd =
    `${quoted} list --format json 2>/dev/null | node -e "\n` +
    `const m=require('fs').readFileSync('/dev/stdin','utf8');\n` +
    `const ids=JSON.parse(m).map(x=>x.id);\n` +
    `const g=new Set(),t=[];\n` +
    `ids.forEach(i=>{if(i.includes('.'))g.add(i.split('.')[0]);else t.push(i)});\n` +
    `console.log([...g].sort().concat(t.sort()).join(' '))\n` +
    `" 2>/dev/null`;
  const groupCmdsCmd =
    `${quoted} list --format json 2>/dev/null | node -e "\n` +
    `const m=require('fs').readFileSync('/dev/stdin','utf8');\n` +
    `const g=process.env._APCORE_GRP;\n` +
    `JSON.parse(m).map(x=>x.id).filter(i=>i.includes('.')&&i.split('.')[0]===g).forEach(i=>console.log(i.split('.',2)[1]))\n` +
    `" 2>/dev/null`;

  return (
    `${fn}() {\n` +
    `    local cur prev opts\n` +
    `    COMPREPLY=()\n` +
    `    cur="\${COMP_WORDS[COMP_CWORD]}"\n` +
    `    prev="\${COMP_WORDS[COMP_CWORD-1]}"\n` +
    `\n` +
    `    if [[ \${COMP_CWORD} -eq 1 ]]; then\n` +
    `        opts="completion describe exec init list man"\n` +
    `        local groups_and_top=$(${groupsAndTopCmd})\n` +
    `        COMPREPLY=( $(compgen -W "\${opts} \${groups_and_top}" -- \${cur}) )\n` +
    `        return 0\n` +
    `    fi\n` +
    `\n` +
    `    if [[ \${COMP_CWORD} -eq 2 ]]; then\n` +
    `        if [[ "\${COMP_WORDS[1]}" == "exec" ]]; then\n` +
    `            local modules=$(${moduleListCmd})\n` +
    `            COMPREPLY=( $(compgen -W "\${modules}" -- \${cur}) )\n` +
    `            return 0\n` +
    `        fi\n` +
    `        export _APCORE_GRP="\${COMP_WORDS[1]}"\n` +
    `        local group_cmds=$(${groupCmdsCmd})\n` +
    `        COMPREPLY=( $(compgen -W "\${group_cmds}" -- \${cur}) )\n` +
    `        return 0\n` +
    `    fi\n` +
    `}\n` +
    `complete -F ${fn} ${quoted}\n`
  );
}

function generateZshCompletion(progName: string): string {
  const fn = makeFunctionName(progName);
  const quoted = shellQuote(progName);
  const moduleListCmd =
    `${quoted} list --format json 2>/dev/null` +
    ` | node -e "process.stdin.on('data',d=>{JSON.parse(d).forEach(m=>console.log(m.id))})" 2>/dev/null`;
  const groupsAndTopCmd =
    `${quoted} list --format json 2>/dev/null | node -e "\n` +
    `const m=require('fs').readFileSync('/dev/stdin','utf8');\n` +
    `const ids=JSON.parse(m).map(x=>x.id);\n` +
    `const g=new Set(),t=[];\n` +
    `ids.forEach(i=>{if(i.includes('.'))g.add(i.split('.')[0]);else t.push(i)});\n` +
    `console.log([...g].sort().concat(t.sort()).join(' '))\n` +
    `" 2>/dev/null`;
  const groupCmdsCmd =
    `${quoted} list --format json 2>/dev/null | node -e "\n` +
    `const m=require('fs').readFileSync('/dev/stdin','utf8');\n` +
    `const g=process.env._APCORE_GRP;\n` +
    `JSON.parse(m).map(x=>x.id).filter(i=>i.includes('.')&&i.split('.')[0]===g).forEach(i=>console.log(i.split('.',2)[1]))\n` +
    `" 2>/dev/null`;

  return (
    `#compdef ${progName}\n` +
    `\n` +
    `${fn}() {\n` +
    `    local -a commands\n` +
    `    commands=(\n` +
    `        'list:List available modules'\n` +
    `        'describe:Show module metadata and schema'\n` +
    `        'completion:Generate shell completion script'\n` +
    `        'init:Scaffolding commands'\n` +
    `        'man:Generate man page'\n` +
    `    )\n` +
    `\n` +
    `    _arguments -C \\\n` +
    `        '1:command:->command' \\\n` +
    `        '*::arg:->args'\n` +
    `\n` +
    `    case "$state" in\n` +
    `        command)\n` +
    `            _describe -t commands '${progName} commands' commands\n` +
    `            local -a groups_and_top\n` +
    `            groups_and_top=($(${groupsAndTopCmd}))\n` +
    `            compadd -a groups_and_top\n` +
    `            ;;\n` +
    `        args)\n` +
    `            case "\${words[1]}" in\n` +
    `                exec)\n` +
    `                    local modules\n` +
    `                    modules=($(${moduleListCmd}))\n` +
    `                    compadd -a modules\n` +
    `                    ;;\n` +
    `                *)\n` +
    `                    export _APCORE_GRP="\${words[1]}"\n` +
    `                    local -a group_cmds\n` +
    `                    group_cmds=($(${groupCmdsCmd}))\n` +
    `                    compadd -a group_cmds\n` +
    `                    ;;\n` +
    `            esac\n` +
    `            ;;\n` +
    `    esac\n` +
    `}\n` +
    `\n` +
    `compdef ${fn} ${quoted}\n`
  );
}

function generateFishCompletion(progName: string): string {
  const quoted = shellQuote(progName);
  const moduleListCmd =
    `${quoted} list --format json 2>/dev/null` +
    ` | node -e \\"process.stdin.on('data',d=>{JSON.parse(d).forEach(m=>console.log(m.id))})\\" 2>/dev/null`;
  const groupsAndTopCmd =
    `${quoted} list --format json 2>/dev/null | node -e \\"` +
    `const m=require('fs').readFileSync('/dev/stdin','utf8');` +
    `const ids=JSON.parse(m).map(x=>x.id);` +
    `const g=new Set(),t=[];` +
    `ids.forEach(i=>{if(i.includes('.'))g.add(i.split('.')[0]);else t.push(i)});` +
    `console.log([...g].sort().concat(t.sort()).join('\\\\n'))\\" 2>/dev/null`;

  return (
    `# Fish completions for ${progName}\n` +
    `complete -c ${quoted} -n "__fish_use_subcommand"` +
    ` -a list -d "List available modules"\n` +
    `complete -c ${quoted} -n "__fish_use_subcommand"` +
    ` -a describe -d "Show module metadata and schema"\n` +
    `complete -c ${quoted} -n "__fish_use_subcommand"` +
    ` -a completion -d "Generate shell completion script"\n` +
    `complete -c ${quoted} -n "__fish_use_subcommand"` +
    ` -a init -d "Scaffolding commands"\n` +
    `complete -c ${quoted} -n "__fish_use_subcommand"` +
    ` -a man -d "Generate man page"\n` +
    `complete -c ${quoted} -n "__fish_use_subcommand"` +
    ` -a "(${groupsAndTopCmd})" -d "Module group"\n` +
    `\n` +
    `complete -c ${quoted} -n "__fish_seen_subcommand_from exec"` +
    ` -a "(${moduleListCmd})"\n` +
    `\n` +
    `function __apcore_group_cmds\n` +
    `    set -l grp (commandline -opc)[2]\n` +
    `    set -x _APCORE_GRP $grp\n` +
    `    ${quoted} list --format json 2>/dev/null | node -e "\n` +
    `const m=require('fs').readFileSync('/dev/stdin','utf8');\n` +
    `const g=process.env._APCORE_GRP;\n` +
    `JSON.parse(m).map(x=>x.id).filter(i=>i.includes('.')&&i.split('.')[0]===g).forEach(i=>console.log(i.split('.',2)[1]))\n` +
    `" 2>/dev/null\n` +
    `end\n` +
    `\n` +
    `# Group subcommand completion — matches when position 1 is not a builtin\n` +
    `complete -c ${quoted} -n "not __fish_use_subcommand; and not __fish_seen_subcommand_from list describe completion init man exec"` +
    ` -a "(__apcore_group_cmds)"\n`
  );
}

// ---------------------------------------------------------------------------
// Man page generation
// ---------------------------------------------------------------------------

function buildSynopsis(
  command: Command | null,
  progName: string,
  commandName: string,
): string {
  if (!command) {
    return `\\fB${progName} ${commandName}\\fR [OPTIONS]`;
  }

  const parts = [`\\fB${progName} ${commandName}\\fR`];
  for (const opt of command.options) {
    const flag = opt.long ?? opt.short ?? "";
    if (opt.isBoolean?.()) {
      parts.push(`[${flag}]`);
    } else if (opt.required) {
      const typeName = (opt.argChoices ? "CHOICE" : "VALUE").toUpperCase();
      parts.push(`${flag} \\fI${typeName}\\fR`);
    } else {
      const typeName = (opt.argChoices ? "CHOICE" : "VALUE").toUpperCase();
      parts.push(`[${flag} \\fI${typeName}\\fR]`);
    }
  }

  for (const arg of command.registeredArguments ?? []) {
    const meta = arg.name().toUpperCase();
    if (arg.required) {
      parts.push(`\\fI${meta}\\fR`);
    } else {
      parts.push(`[\\fI${meta}\\fR]`);
    }
  }

  return parts.join(" ");
}

function generateManPage(
  commandName: string,
  command: Command | null,
  progName: string,
  version = SHELL_VERSION,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const title = `${progName}-${commandName}`.toUpperCase();
  const pkgLabel = `${progName} ${version}`;
  const manualLabel = `${progName} Manual`;

  const sections: string[] = [];
  sections.push(`.TH "${title}" "1" "${today}" "${pkgLabel}" "${manualLabel}"`);

  sections.push(".SH NAME");
  const desc = command?.description() ?? commandName;
  const nameDesc = desc.split("\n")[0].replace(/\.$/, "");
  sections.push(`${progName}-${commandName} \\- ${nameDesc}`);

  sections.push(".SH SYNOPSIS");
  sections.push(buildSynopsis(command, progName, commandName));

  if (command?.description()) {
    sections.push(".SH DESCRIPTION");
    sections.push(
      command.description().replace(/\\/g, "\\\\").replace(/-/g, "\\-"),
    );
  }

  if (command && command.options.length > 0) {
    sections.push(".SH OPTIONS");
    for (const opt of command.options) {
      const flag = [opt.short, opt.long].filter(Boolean).join(", ");
      sections.push(".TP");
      if (opt.isBoolean?.()) {
        sections.push(`\\fB${flag}\\fR`);
      } else {
        sections.push(`\\fB${flag}\\fR \\fIVALUE\\fR`);
      }
      if (opt.description) {
        sections.push(opt.description);
      }
      if (opt.defaultValue !== undefined && !opt.isBoolean?.()) {
        sections.push(`Default: ${opt.defaultValue}.`);
      }
    }
  }

  sections.push(".SH ENVIRONMENT");
  sections.push(".TP");
  sections.push("\\fBAPCORE_EXTENSIONS_ROOT\\fR");
  sections.push(
    "Path to the apcore extensions directory. Overrides the default \\fI./extensions\\fR.",
  );
  sections.push(".TP");
  sections.push("\\fBAPCORE_CLI_AUTO_APPROVE\\fR");
  sections.push(
    "Set to \\fB1\\fR to bypass approval prompts for modules that require human-in-the-loop confirmation.",
  );
  sections.push(".TP");
  sections.push("\\fBAPCORE_CLI_LOGGING_LEVEL\\fR");
  sections.push(
    "CLI-specific logging verbosity. One of: DEBUG, INFO, WARNING, ERROR. " +
      "Takes priority over \\fBAPCORE_LOGGING_LEVEL\\fR. Default: WARNING.",
  );
  sections.push(".TP");
  sections.push("\\fBAPCORE_LOGGING_LEVEL\\fR");
  sections.push(
    "Global apcore logging verbosity. One of: DEBUG, INFO, WARNING, ERROR. " +
      "Used as fallback when \\fBAPCORE_CLI_LOGGING_LEVEL\\fR is not set. Default: WARNING.",
  );
  sections.push(".TP");
  sections.push("\\fBAPCORE_AUTH_API_KEY\\fR");
  sections.push(
    "API key for authenticating with the apcore registry.",
  );

  sections.push(".SH EXIT CODES");
  const exitCodes: [string, string][] = [
    ["0", "Success."],
    ["1", "Module execution error."],
    ["2", "Invalid CLI input or missing argument."],
    ["44", "Module not found, disabled, or failed to load."],
    ["45", "Input failed JSON Schema validation."],
    [
      "46",
      "Approval denied, timed out, or no interactive terminal available.",
    ],
    [
      "47",
      "Configuration error (extensions directory not found or unreadable).",
    ],
    ["48", "Schema contains a circular \\fB$ref\\fR."],
    ["77", "ACL denied — insufficient permissions for this module."],
    ["130", "Execution cancelled by user (SIGINT / Ctrl\\-C)."],
  ];
  for (const [code, meaning] of exitCodes) {
    sections.push(`.TP\n\\fB${code}\\fR\n${meaning}`);
  }

  sections.push(".SH SEE ALSO");
  sections.push(
    [
      `\\fB${progName}\\fR(1)`,
      `\\fB${progName}\\-list\\fR(1)`,
      `\\fB${progName}\\-describe\\fR(1)`,
      `\\fB${progName}\\-completion\\fR(1)`,
    ].join(", "),
  );

  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// registerShellCommands
// ---------------------------------------------------------------------------

/**
 * Register completion and man commands.
 */
export function registerShellCommands(
  cli: Command,
  progName = "apcore-cli",
): void {
  const completionCmd = new Command("completion")
    .description(
      "Generate a shell completion script and print it to stdout.",
    )
    .argument("<shell>", "Shell type: bash, zsh, or fish")
    .action((shell: string) => {
      const validShells = ["bash", "zsh", "fish"];
      if (!validShells.includes(shell)) {
        process.stderr.write(
          `Error: Unknown shell '${shell}'. Expected: bash, zsh, or fish.\n`,
        );
        process.exit(EXIT_CODES.INVALID_CLI_INPUT);
      }

      const resolved = cli.name() || progName;
      const generators: Record<string, () => string> = {
        bash: () => generateBashCompletion(resolved),
        zsh: () => generateZshCompletion(resolved),
        fish: () => generateFishCompletion(resolved),
      };
      process.stdout.write(generators[shell]());
    });
  cli.addCommand(completionCmd);

  const manCmd = new Command("man")
    .description("Generate a roff man page for COMMAND and print it to stdout.")
    .argument("<command>", "Command to generate man page for")
    .action((commandName: string) => {
      const knownBuiltins = new Set(["completion", "describe", "exec", "init", "list", "man"]);
      const cmd = cli.commands.find((c) => c.name() === commandName) ?? null;

      if (!cmd && !knownBuiltins.has(commandName)) {
        process.stderr.write(
          `Error: Unknown command '${commandName}'.\n`,
        );
        process.exit(EXIT_CODES.INVALID_CLI_INPUT);
      }

      const resolved = cli.name() || progName;
      const roff = generateManPage(commandName, cmd, resolved);
      process.stdout.write(roff);
    });
  cli.addCommand(manCmd);
}
