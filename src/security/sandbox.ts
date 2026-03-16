/**
 * Sandbox — Subprocess isolation for module execution.
 *
 * Protocol spec: Security — sandboxed execution
 */

import * as child_process from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Executor } from "../cli.js";
import { ModuleExecutionError } from "../errors.js";

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------

/**
 * Executes modules in an isolated subprocess to limit the blast radius
 * of untrusted or third-party modules.
 *
 * When disabled, delegates directly to the Executor.
 */
export class Sandbox {
  private readonly enabled: boolean;

  constructor(enabled = false) {
    this.enabled = enabled;
  }

  /**
   * Execute a module, optionally inside a sandboxed subprocess.
   */
  async execute(
    moduleId: string,
    inputData: Record<string, unknown>,
    executor: Executor,
  ): Promise<unknown> {
    if (!this.enabled) {
      return executor.execute(moduleId, inputData);
    }
    return this.sandboxedExecute(moduleId, inputData);
  }

  private sandboxedExecute(
    moduleId: string,
    inputData: Record<string, unknown>,
  ): unknown {
    // Build restricted environment
    const env: Record<string, string> = {};
    for (const key of ["PATH", "NODE_PATH", "LANG", "LC_ALL"]) {
      if (process.env[key]) {
        env[key] = process.env[key]!;
      }
    }
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith("APCORE_") && value) {
        env[key] = value;
      }
    }

    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "apcore_sandbox_"),
    );

    try {
      env.HOME = tmpDir;
      env.TMPDIR = tmpDir;

      const script = [
        "let d='';",
        "process.stdin.setEncoding('utf-8');",
        "process.stdin.on('data',c=>d+=c);",
        "process.stdin.on('end',()=>{",
        "  const input=JSON.parse(d);",
        `  process.stdout.write(JSON.stringify({error:"Sandbox runner not yet implemented for module: ${moduleId}"}));`,
        "});",
      ].join("");

      const result = child_process.execFileSync(
        process.execPath,
        ["-e", script],
        {
          input: JSON.stringify(inputData),
          env,
          cwd: tmpDir,
          timeout: 300_000,
          maxBuffer: 10 * 1024 * 1024,
        },
      );

      return JSON.parse(result.toString("utf-8"));
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        "killed" in err &&
        (err as Record<string, unknown>).killed
      ) {
        throw new ModuleExecutionError(
          `Error: Module '${moduleId}' timed out in sandbox.`,
        );
      }
      const stderr =
        err instanceof Error && "stderr" in err
          ? String((err as Record<string, unknown>).stderr)
          : String(err);
      throw new ModuleExecutionError(
        `Error: Module '${moduleId}' execution failed: ${stderr}`,
      );
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Best effort cleanup
      }
    }
  }
}
