/**
 * Smoke tests for src/display-helpers.ts (FE-09 display overlay).
 *
 * TODO (T-001): expand with binding metadata edge cases.
 */

import { describe, it, expect, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

describe("display-helpers (smoke)", () => {
  it("is importable", async () => {
    const helpers = await import("../src/display-helpers.js");
    expect(helpers).toBeDefined();
  });

  it("getDisplay returns object for empty descriptor", async () => {
    const { getDisplay } = await import("../src/display-helpers.js");
    const result = getDisplay({ id: "test.empty", name: "test", description: "" });
    expect(typeof result).toBe("object");
  });
});

describe("display-helpers binding overlay fallback (FE-11)", () => {
  let tmpDir: string;

  afterEach(async () => {
    const { clearBindingDisplayMap } = await import("../src/main.js");
    clearBindingDisplayMap();
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("applyToolkitIntegration populates overlay map from binding.yaml", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apcore-cli-binding-"));
    const bindingFile = path.join(tmpDir, "demo.binding.yaml");
    fs.writeFileSync(
      bindingFile,
      [
        'spec_version: "1.0"',
        "bindings:",
        '  - module_id: "demo.hello"',
        '    target: "demo.handlers:hello"',
        '    description: "Say hello"',
        "    display:",
        '      alias: "hi"',
        "      cli:",
        '        alias: "hi"',
        '        description: "Greet the world"',
        "",
      ].join("\n"),
    );

    const { applyToolkitIntegration, lookupBindingDisplay } = await import("../src/main.js");
    await applyToolkitIntegration(undefined, bindingFile);

    const overlay = lookupBindingDisplay("demo.hello");
    expect(overlay).toBeDefined();
    expect(overlay).toMatchObject({ alias: "hi" });
  });

  it("getDisplay consults overlay when descriptor has no metadata.display", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apcore-cli-binding-"));
    const bindingFile = path.join(tmpDir, "demo.binding.yaml");
    fs.writeFileSync(
      bindingFile,
      [
        'spec_version: "1.0"',
        "bindings:",
        '  - module_id: "demo.goodbye"',
        '    target: "demo.handlers:goodbye"',
        '    description: "Say goodbye"',
        "    display:",
        "      cli:",
        '        alias: "bye"',
        "",
      ].join("\n"),
    );

    const { applyToolkitIntegration } = await import("../src/main.js");
    await applyToolkitIntegration(undefined, bindingFile);

    const { getDisplay } = await import("../src/display-helpers.js");
    const display = getDisplay({
      id: "demo.goodbye",
      name: "goodbye",
      description: "Say goodbye",
    });
    const cli = (display.cli ?? {}) as Record<string, unknown>;
    expect(cli.alias).toBe("bye");
  });

  it("getDisplay prefers descriptor.metadata.display over binding overlay", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apcore-cli-binding-"));
    const bindingFile = path.join(tmpDir, "demo.binding.yaml");
    fs.writeFileSync(
      bindingFile,
      [
        'spec_version: "1.0"',
        "bindings:",
        '  - module_id: "demo.hello"',
        '    target: "demo.handlers:hello"',
        '    description: "Say hello"',
        "    display:",
        "      cli:",
        '        alias: "overlay-alias"',
        "",
      ].join("\n"),
    );

    const { applyToolkitIntegration } = await import("../src/main.js");
    await applyToolkitIntegration(undefined, bindingFile);

    // Descriptor already carries a baked-in display overlay (e.g. resolved
    // by apcore-toolkit's RegistryWriter at discovery time). The binding
    // overlay map MUST NOT shadow it — the descriptor wins.
    const { getDisplay } = await import("../src/display-helpers.js");
    const display = getDisplay({
      id: "demo.hello",
      name: "hello",
      description: "Say hello",
      metadata: {
        display: { cli: { alias: "descriptor-alias" } },
      },
    });
    const cli = (display.cli ?? {}) as Record<string, unknown>;
    expect(cli.alias).toBe("descriptor-alias");
  });
});
