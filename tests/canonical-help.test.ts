/**
 * Tests for canonical-help.ts — clap/GNU-style help formatter.
 *
 * The formatter is a spec-conformance artifact shared across the TS,
 * Python, and Rust SDK implementations. These tests lock in the key
 * byte-level conventions (section ordering, --help/--version last,
 * UPPER placeholders, default-value filter, long-only alignment).
 */

import { describe, it, expect } from "vitest";
import { Command, Help, Option } from "commander";
import { canonicalFormatHelp } from "../src/canonical-help.js";

function render(cmd: Command): string {
  return canonicalFormatHelp(cmd, new Help());
}

describe("canonicalFormatHelp — section ordering", () => {
  it("emits Description before Usage", () => {
    const cmd = new Command("tool").description("A demo tool");
    const out = render(cmd);
    const descIdx = out.indexOf("A demo tool");
    const usageIdx = out.indexOf("Usage:");
    expect(descIdx).toBeGreaterThan(-1);
    expect(usageIdx).toBeGreaterThan(-1);
    expect(descIdx).toBeLessThan(usageIdx);
  });

  it("emits Commands section before Options", () => {
    const cmd = new Command("tool").description("A demo tool");
    cmd.command("sub").description("A subcommand");
    cmd.option("-v, --verbose", "Verbose output");
    const out = render(cmd);
    const cmdsIdx = out.indexOf("Commands:");
    const optsIdx = out.indexOf("Options:");
    expect(cmdsIdx).toBeGreaterThan(-1);
    expect(optsIdx).toBeGreaterThan(-1);
    expect(cmdsIdx).toBeLessThan(optsIdx);
  });

  it("separates sections with a blank line (joins with '\\n\\n')", () => {
    const cmd = new Command("tool").description("A demo tool");
    cmd.option("-v, --verbose", "Verbose output");
    const out = render(cmd);
    expect(out).toMatch(/A demo tool\n\nUsage:/);
  });

  it("terminates with a single trailing newline", () => {
    const cmd = new Command("tool").description("x");
    const out = render(cmd);
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("canonicalFormatHelp — Usage line", () => {
  it("builds `Usage: <prog>` (uppercase 'Usage:')", () => {
    const cmd = new Command("mytool");
    const out = render(cmd);
    expect(out).toContain("Usage: mytool");
  });

  it("appends [OPTIONS] when any visible option is declared", () => {
    const cmd = new Command("mytool").option("-v, --verbose", "Verbose");
    const out = render(cmd);
    expect(out).toMatch(/Usage: mytool \[OPTIONS\]/);
  });

  it("appends [COMMAND] when any visible subcommand is registered", () => {
    const cmd = new Command("mytool");
    cmd.command("sub").description("A subcommand");
    const out = render(cmd);
    // Commander auto-adds a --help option when subcommands exist, so
    // [OPTIONS] is also present; assert only the [COMMAND] suffix.
    expect(out).toMatch(/Usage: mytool.*\[COMMAND\]/);
  });

  it("uses <UPPER> for required arguments and [UPPER] for optional", () => {
    const cmd = new Command("mytool");
    cmd.argument("<source>", "Required arg");
    cmd.argument("[target]", "Optional arg");
    const out = render(cmd);
    // Commander auto-adds a --help option (so [OPTIONS] appears); the
    // argument ordering and case transformation are what this test locks.
    expect(out).toMatch(/Usage: mytool.*<SOURCE> \[TARGET\]/);
  });
});

describe("canonicalFormatHelp — Options section", () => {
  it("moves -h, --help to the end (clap convention)", () => {
    const cmd = new Command("tool")
      .helpOption("-h, --help", "Print help")
      .option("-v, --verbose", "Verbose output")
      .option("--config <path>", "Config path");
    const out = render(cmd);
    const helpIdx = out.indexOf("--help");
    const verboseIdx = out.indexOf("--verbose");
    const configIdx = out.indexOf("--config");
    expect(verboseIdx).toBeLessThan(helpIdx);
    expect(configIdx).toBeLessThan(helpIdx);
  });

  it("moves -V, --version to the very end (after --help)", () => {
    const cmd = new Command("tool")
      .version("1.0.0", "-V, --version", "Print version")
      .helpOption("-h, --help", "Print help")
      .option("-v, --verbose", "Verbose output");
    const out = render(cmd);
    const helpIdx = out.indexOf("--help");
    const versionIdx = out.indexOf("--version");
    expect(helpIdx).toBeLessThan(versionIdx);
  });

  it("uppercases placeholder tokens in flag strings", () => {
    const cmd = new Command("tool").option("-c, --config <path>", "Config");
    const out = render(cmd);
    expect(out).toContain("--config <PATH>");
    expect(out).not.toContain("--config <path>");
  });

  it("indents long-only options with 4 extra spaces to align with '-s, --long' rows", () => {
    const cmd = new Command("tool")
      .option("-v, --verbose", "Verbose")
      .option("--long-only", "Long only");
    const out = render(cmd);
    // Capture the Options block
    const opts = out.split("Options:")[1] ?? "";
    expect(opts).toMatch(/ {2}-v, --verbose/);
    // Long-only row: leading "  " (term indent) + "    " (alignment) + "--long-only"
    expect(opts).toMatch(/ {6}--long-only/);
  });
});

describe("canonicalFormatHelp — default-value filter", () => {
  it("appends [default: VALUE] for a truthy string default", () => {
    const cmd = new Command("tool").option("--lang <l>", "Language", "en");
    const out = render(cmd);
    expect(out).toContain("[default: en]");
  });

  it("appends [default: N] for a truthy numeric default", () => {
    const cmd = new Command("tool").option(
      "--retries <n>",
      "Retry count",
      (v) => parseInt(v, 10),
      3,
    );
    const out = render(cmd);
    expect(out).toContain("[default: 3]");
  });

  it("omits [default] when default value is undefined", () => {
    const cmd = new Command("tool").option("--name <n>", "Name");
    const out = render(cmd);
    expect(out).not.toContain("[default:");
  });

  it("omits [default] when default value is false (clap convention)", () => {
    const cmd = new Command("tool").option("-v, --verbose", "Verbose", false);
    const out = render(cmd);
    expect(out).not.toContain("[default: false]");
  });

  it("omits [default] when default value is the empty string", () => {
    const cmd = new Command("tool").option("--sep <s>", "Separator", "");
    const out = render(cmd);
    expect(out).not.toContain("[default: ]");
  });

  it("omits [default] when default value is null", () => {
    const cmd = new Command("tool").addOption(
      new Option("--ref <r>", "Reference").default(null),
    );
    const out = render(cmd);
    expect(out).not.toContain("[default: null]");
  });
});

describe("canonicalFormatHelp — help-text blocks", () => {
  // canonical-help reads before/after blocks from a private `_helpText`
  // bag on the Command. Commander's `addHelpText` API does NOT populate
  // that field (it attaches event listeners instead) — so the public
  // Commander API alone cannot feed these sections. These tests document
  // the current contract: the bag must be set directly on the command.
  function setHelpBag(cmd: Command, bag: Record<string, unknown>): void {
    (cmd as unknown as { _helpText: Record<string, unknown> })._helpText = bag;
  }

  it("emits beforeAll block first (above Description)", () => {
    const cmd = new Command("tool").description("Desc");
    setHelpBag(cmd, { beforeAll: "BANNER-TEXT" });
    const out = render(cmd);
    const bannerIdx = out.indexOf("BANNER-TEXT");
    const descIdx = out.indexOf("Desc");
    expect(bannerIdx).toBeGreaterThan(-1);
    expect(bannerIdx).toBeLessThan(descIdx);
  });

  it("emits afterAll block last (below Options)", () => {
    const cmd = new Command("tool").option("-v, --verbose", "Verbose");
    setHelpBag(cmd, { afterAll: "FOOTER-TEXT" });
    const out = render(cmd);
    const footerIdx = out.indexOf("FOOTER-TEXT");
    const optsIdx = out.indexOf("Options:");
    expect(footerIdx).toBeGreaterThan(-1);
    expect(footerIdx).toBeGreaterThan(optsIdx);
  });

  it("resolves function-valued help text by invoking it", () => {
    const cmd = new Command("tool").description("Desc");
    setHelpBag(cmd, { after: () => "DYNAMIC-NOTE" });
    const out = render(cmd);
    expect(out).toContain("DYNAMIC-NOTE");
  });
});

describe("canonicalFormatHelp — Commands section", () => {
  it("aligns subcommand terms with the longest name", () => {
    const cmd = new Command("tool");
    cmd.command("a").description("Short");
    cmd.command("longcommand").description("Long");
    const out = render(cmd);
    const cmdsBlock = out.split("Commands:")[1]?.split("\n\n")[0] ?? "";
    // "longcommand" is 11 chars → "a" is padded with 10 trailing spaces
    // (total width 11). Row format: "  <term-padded>  <description>".
    expect(cmdsBlock).toMatch(/ {2}a {10} {2}Short/);
    expect(cmdsBlock).toMatch(/ {2}longcommand {2}Long/);
  });
});
