/**
 * Conformance — Algorithm C-SNAKE: snake_case multi-word kwargs flow from
 * CLI parsing to the input dict that `Executor.execute(module_id, input)`
 * receives. Fixture lives in the spec repo at
 *   ../apcore-cli/conformance/fixtures/snake-case-kwargs/cases.json
 * and is shared verbatim with the Python and Rust SDK runners.
 *
 * Catches the regression where commander's auto-camelCase mapping (e.g.
 * `--has-solution` -> `options.hasSolution`) was forwarded directly to the
 * module without being reverse-mapped to the schema's snake_case property
 * names. Targets the per-module Command produced by buildModuleCommand,
 * which is the layer where schema-derived flags live.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";

import type { Executor, ModuleDescriptor } from "../../src/cli.js";
import { buildModuleCommand } from "../../src/main.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SPEC_REPO_ROOT =
  process.env.APCORE_CLI_SPEC_REPO ??
  path.resolve(__dirname, "../../../apcore-cli");
const FIXTURE_PATH = path.join(
  SPEC_REPO_ROOT,
  "conformance/fixtures/snake-case-kwargs/cases.json",
);

interface SnakeCaseCase {
  id: string;
  args: string[];
  expected_input: Record<string, unknown>;
}

interface SnakeCaseFixture {
  module_id: string;
  input_schema: Record<string, unknown>;
  test_cases: SnakeCaseCase[];
}

const fixture = JSON.parse(
  fs.readFileSync(FIXTURE_PATH, "utf8"),
) as SnakeCaseFixture;

describe("conformance — snake_case kwargs (Algorithm C-SNAKE)", () => {
  for (const tc of fixture.test_cases) {
    it(`${tc.id}: ${tc.args.join(" ") || "<no flags>"}`, async () => {
      const moduleDef: ModuleDescriptor = {
        id: fixture.module_id,
        name: fixture.module_id,
        description: "Snake-case kwargs conformance fixture",
        inputSchema: fixture.input_schema,
      };
      const captured: { input?: Record<string, unknown> } = {};
      const executor: Executor = {
        execute: vi
          .fn()
          .mockImplementation(
            async (_id: string, input: Record<string, unknown>) => {
              captured.input = input;
              return { ok: true };
            },
          ),
      };
      const cmd = buildModuleCommand(moduleDef, executor);
      cmd.exitOverride();
      cmd.configureOutput({ writeOut: () => {}, writeErr: () => {} });
      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation((code?: number | string) => {
          throw Object.assign(new Error(`exit:${code}`), {
            exitCode: Number(code ?? 0),
          });
        });
      try {
        // Force JSON output so the action handler doesn't try to render a
        // table / interactive prompt; -y skips approval gates if any.
        await cmd.parseAsync([
          "node",
          fixture.module_id,
          "--format",
          "json",
          "-y",
          ...tc.args,
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (!msg.startsWith("exit:0")) {
          throw err;
        }
      } finally {
        exitSpy.mockRestore();
      }
      expect(executor.execute).toHaveBeenCalledTimes(1);
      const actual = captured.input ?? {};
      for (const [key, expected] of Object.entries(tc.expected_input)) {
        expect(
          actual[key],
          `expected input["${key}"] === ${JSON.stringify(expected)}, got ${JSON.stringify(actual[key])}; full input=${JSON.stringify(actual)}`,
        ).toEqual(expected);
      }
    });
  }
});
