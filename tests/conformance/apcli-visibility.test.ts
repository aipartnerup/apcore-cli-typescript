/**
 * FE-13 cross-language conformance fixture tests (T-APCLI-31).
 *
 * All fixtures (create_cli.json / env.json / input.yaml / expected_help.txt)
 * live in the spec repo at
 *   ../apcore-cli/conformance/fixtures/apcli-visibility/<scenario>/
 * and are shared across every SDK. Help output is byte-matched against the
 * canonical clap-style format — TS reaches parity via
 * src/canonical-help.ts (a Commander configureHelp override).
 *
 * Shared files use snake_case keys; the TS loader maps them to camelCase
 * at the test boundary.
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
// In CI the spec repo is checked out separately; `APCORE_CLI_SPEC_REPO`
// points at that checkout. Locally fall back to the sibling directory
// layout (aipartnerup/apcore-cli alongside this repo).
const SPEC_REPO_ROOT =
  process.env.APCORE_CLI_SPEC_REPO ??
  path.resolve(__dirname, "../../../apcore-cli");
const FIXTURE_ROOT = path.join(
  SPEC_REPO_ROOT,
  "conformance/fixtures/apcli-visibility",
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

interface SharedCreateCli {
  prog_name?: string;
  registry_injected?: boolean;
  apcli?: unknown;
}

function mapSharedOpts(shared: SharedCreateCli): ScenarioOpts {
  const out: ScenarioOpts = {};
  if (shared.prog_name !== undefined) out.progName = shared.prog_name;
  if (shared.registry_injected !== undefined)
    out.registryInjected = shared.registry_injected;
  if (shared.apcli !== undefined) out.apcli = shared.apcli;
  return out;
}

function withScenario<T>(
  scenario: string,
  run: (opts: ScenarioOpts) => T,
): T {
  const dir = path.join(FIXTURE_ROOT, scenario);
  const env = JSON.parse(
    fs.readFileSync(path.join(dir, "env.json"), "utf8"),
  ) as Record<string, string>;
  const shared = JSON.parse(
    fs.readFileSync(path.join(dir, "create_cli.json"), "utf8"),
  ) as SharedCreateCli;
  const opts = mapSharedOpts(shared);

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

function captureHelp(scenario: string): string {
  return withScenario(scenario, (opts) => {
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
// Golden regeneration — writes into the SPEC REPO when APCLI_FIXTURE_UPDATE=1.
// Off by default: the golden is a cross-language contract, not a local
// snapshot. Humans curate it; this flag is only for iterating on the
// canonical format during development.
// ---------------------------------------------------------------------------

function maybeRegenerateGolden(scenario: string): void {
  if (process.env.APCLI_FIXTURE_UPDATE !== "1") return;
  const goldenPath = path.join(FIXTURE_ROOT, scenario, "expected_help.txt");
  fs.writeFileSync(goldenPath, captureHelp(scenario), "utf8");
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
  for (const scenario of scenarios) {
    maybeRegenerateGolden(scenario);
  }
});

for (const scenario of scenarios) {
  describe(`apcli visibility — ${scenario}`, () => {
    it("matches golden --help (T-APCLI-31)", () => {
      const expected = fs.readFileSync(
        path.join(FIXTURE_ROOT, scenario, "expected_help.txt"),
        "utf8",
      );
      const actual = captureHelp(scenario);
      expect(actual).toBe(expected);
    });
  });
}
