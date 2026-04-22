/**
 * Canonical help formatter — clap/GNU-style output shared across the
 * apcore-cli SDK family (TS, Python, Rust).
 *
 * Conventions:
 *   - Description before Usage
 *   - `Usage: <prog> [OPTIONS] [COMMAND]` (uppercase)
 *   - `Commands:` section before `Options:`
 *   - `<UPPER>` placeholders
 *   - `[default: VALUE]` (brackets, no quotes)
 *   - `-h, --help` → "Print help", `-V, --version` → "Print version"
 *   - Long-only options indented 4 extra spaces so `--long` aligns with
 *     `-s, --long` rows
 */

import type { Command, Help, Option } from "commander";

type HelpTextSection =
  | string
  | ((ctx: { error: boolean; command: Command }) => string);

interface CommandHelpTextBag {
  beforeAll?: HelpTextSection;
  before?: HelpTextSection;
  after?: HelpTextSection;
  afterAll?: HelpTextSection;
}

function resolveHelpText(cmd: Command, section: keyof CommandHelpTextBag): string {
  const bag = (cmd as unknown as { _helpText?: CommandHelpTextBag })._helpText;
  const v = bag?.[section];
  if (typeof v === "function") return v({ error: false, command: cmd });
  return v ?? "";
}

function uppercasePlaceholders(flags: string): string {
  return flags
    .replace(/<([a-zA-Z0-9_-]+)>/g, (_, name) => `<${name.toUpperCase()}>`)
    .replace(/\[([a-zA-Z0-9_-]+)\]/g, (_, name) => `[${name.toUpperCase()}]`);
}

function optionTerm(opt: Option): string {
  const flags = uppercasePlaceholders(opt.flags);
  // Align long-only options with short+long rows: "  -s, --long" vs "      --long"
  if (!opt.short && flags.startsWith("--")) return "    " + flags;
  return flags;
}

function optionDescription(opt: Option): string {
  let desc = opt.description;
  const d = opt.defaultValue;
  if (d !== undefined && d !== false && d !== "" && d !== null) {
    desc = `${desc} [default: ${String(d)}]`;
  }
  return desc;
}

/**
 * Move `-h, --help` and `-V, --version` to the end of the options list so
 * they always render last (clap convention), regardless of registration
 * order inside `createCli`.
 */
function reorderHelpVersionLast(opts: readonly Option[]): Option[] {
  const helpOpts: Option[] = [];
  const versionOpts: Option[] = [];
  const rest: Option[] = [];
  for (const o of opts) {
    if (o.long === "--help") helpOpts.push(o);
    else if (o.long === "--version") versionOpts.push(o);
    else rest.push(o);
  }
  return [...rest, ...helpOpts, ...versionOpts];
}

export function canonicalFormatHelp(cmd: Command, helper: Help): string {
  const sections: string[] = [];

  const beforeAll = resolveHelpText(cmd, "beforeAll");
  if (beforeAll) sections.push(beforeAll);

  const desc = cmd.description();
  if (desc) sections.push(desc);

  const before = resolveHelpText(cmd, "before");
  if (before) sections.push(before);

  const visibleOpts = reorderHelpVersionLast(helper.visibleOptions(cmd));
  const visibleCmds = helper.visibleCommands(cmd);
  const args = (cmd as unknown as {
    registeredArguments?: Array<{ name: () => string; required: boolean }>;
  }).registeredArguments ?? [];

  let usage = `Usage: ${cmd.name()}`;
  if (visibleOpts.length > 0) usage += " [OPTIONS]";
  for (const a of args) {
    const n = a.name().toUpperCase();
    usage += a.required ? ` <${n}>` : ` [${n}]`;
  }
  if (visibleCmds.length > 0) usage += " [COMMAND]";
  sections.push(usage);

  if (visibleCmds.length > 0) {
    const terms = visibleCmds.map((c) => c.name());
    const w = Math.max(...terms.map((t) => t.length));
    const lines = ["Commands:"];
    visibleCmds.forEach((sub, i) => {
      lines.push(`  ${terms[i].padEnd(w)}  ${sub.description()}`);
    });
    sections.push(lines.join("\n"));
  }

  if (visibleOpts.length > 0) {
    const terms = visibleOpts.map(optionTerm);
    const w = Math.max(...terms.map((t) => t.length));
    const lines = ["Options:"];
    visibleOpts.forEach((opt, i) => {
      lines.push(`  ${terms[i].padEnd(w)}  ${optionDescription(opt)}`);
    });
    sections.push(lines.join("\n"));
  }

  const after = resolveHelpText(cmd, "after");
  if (after) sections.push(after);

  const afterAll = resolveHelpText(cmd, "afterAll");
  if (afterAll) sections.push(afterAll);

  return sections.join("\n\n") + "\n";
}
