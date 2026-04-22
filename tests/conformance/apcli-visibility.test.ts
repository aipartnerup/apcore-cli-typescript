/**
 * FE-13 cross-language conformance fixture tests (T-APCLI-31).
 *
 * TODO: harmonize with Python when FE-13 lands upstream.
 *
 * Each scenario directory under conformance/fixtures/apcli-visibility/
 * declares:
 *   - input.yaml      (optional) — apcore.yaml content to materialize
 *   - env.json                    — env-var overlay (restored after run)
 *   - createCli.json              — createCli opts (serializable subset)
 *   - expected-help.txt           — golden program.helpInformation() output
 *
 * Because the Python reference has not yet shipped FE-13 (no
 * apcore_cli/builtin_group.py present), the golden files are generated
 * from the current TypeScript implementation and are self-consistent; a
 * follow-up task will replace them with Python-sourced fixtures when the
 * upstream port lands.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll } from "vitest";

import { createCli } from "../../src/main.js";
import type { Registry, Executor, ModuleDescriptor } from "../../src/cli.js";

// ---------------------------------------------------------------------------
// Paths — resolve relative to this source file (ESM-safe __dirname)
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_ROOT = path.resolve(
  __dirname,
  "../../conformance/fixtures/apcli-visibility",
);

// ---------------------------------------------------------------------------
// Minimal Registry / Executor stubs for embedded scenarios
// ---------------------------------------------------------------------------

function makeMockRegistry(): Registry {
  return {
    listModules: (): ModuleDescriptor[] => [],
    getModule: (): ModuleDescriptor | null => null,
  } as unknown as Registry;
}

function makeMockExecutor(): Executor {
  return {
    // The help path never calls the executor — stubs can be minimal.
    execute: async () => undefined,
    validate: async () => ({ valid: true, checks: [] }),
  } as unknown as Executor;
}

// ---------------------------------------------------------------------------
// Capture helper — writes yaml to a tmp cwd, overlays env, builds createCli
// ---------------------------------------------------------------------------

interface ScenarioOpts {
  progName?: string;
  registryInjected?: boolean;
  apcli?: unknown;
}

function withScenario<T>(
  dir: string,
  run: (opts: ScenarioOpts) => T,
): T {
  const env = JSON.parse(
    fs.readFileSync(path.join(dir, "env.json"), "utf8"),
  ) as Record<string, string>;
  const opts = JSON.parse(
    fs.readFileSync(path.join(dir, "createCli.json"), "utf8"),
  ) as ScenarioOpts;

  const yamlPath = path.join(dir, "input.yaml");
  const hasYaml = fs.existsSync(yamlPath);

  const origCwd = process.cwd();
  const origEnv: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) origEnv[k] = process.env[k];
  // Always clear APCORE_CLI_APCLI before the scenario so test isolation
  // is deterministic even when the ambient shell has it set.
  origEnv.APCORE_CLI_APCLI = process.env.APCORE_CLI_APCLI;
  delete process.env.APCORE_CLI_APCLI;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apcli-fixture-"));
  try {
    if (hasYaml) {
      fs.copyFileSync(yamlPath, path.join(tmpDir, "apcore.yaml"));
    }
    process.chdir(tmpDir);
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    return run(opts);
  } finally {
    process.chdir(origCwd);
    for (const [k, v] of Object.entries(origEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

function captureHelp(dir: string): string {
  return withScenario(dir, (opts) => {
    const finalOpts: Record<string, unknown> = {
      progName: opts.progName ?? "apcore-cli",
    };
    if (opts.registryInjected) {
      finalOpts.registry = makeMockRegistry();
      finalOpts.executor = makeMockExecutor();
    }
    if (opts.apcli !== undefined) finalOpts.apcli = opts.apcli;
    const program = createCli(
      finalOpts as Parameters<typeof createCli>[0],
    );
    return program.helpInformation();
  });
}

// ---------------------------------------------------------------------------
// Golden generation — write expected-help.txt when APCLI_FIXTURE_UPDATE=1
// ---------------------------------------------------------------------------

function ensureGolden(dir: string): void {
  const goldenPath = path.join(dir, "expected-help.txt");
  const update = process.env.APCLI_FIXTURE_UPDATE === "1";
  if (!update && fs.existsSync(goldenPath)) return;
  const actual = captureHelp(dir);
  fs.writeFileSync(goldenPath, actual, "utf8");
}

// ---------------------------------------------------------------------------
// Dynamic scenario discovery
// ---------------------------------------------------------------------------

const scenarios = fs.existsSync(FIXTURE_ROOT)
  ? fs
      .readdirSync(FIXTURE_ROOT)
      .filter((name) =>
        fs.statSync(path.join(FIXTURE_ROOT, name)).isDirectory(),
      )
  : [];

beforeAll(() => {
  // First-run bootstrap: materialize golden files from the current TS impl
  // when they are missing. Subsequent runs compare against them.
  for (const scenario of scenarios) {
    ensureGolden(path.join(FIXTURE_ROOT, scenario));
  }
});

for (const scenario of scenarios) {
  describe(`apcli visibility — ${scenario}`, () => {
    it("matches golden --help (T-APCLI-31)", () => {
      const dir = path.join(FIXTURE_ROOT, scenario);
      const expected = fs.readFileSync(
        path.join(dir, "expected-help.txt"),
        "utf8",
      );
      const actual = captureHelp(dir);
      expect(actual).toBe(expected);
    });
  });
}
