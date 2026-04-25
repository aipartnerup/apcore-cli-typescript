/**
 * Sandbox — Subprocess isolation for module execution.
 *
 * Protocol spec: Security — sandboxed execution (tech-design §8.6.4).
 *
 * Uses a re-exec model: spawns `node <this-binary> --internal-sandbox-runner
 * <module_id>` with a stripped environment and isolated HOME/TMPDIR.
 * The child reads JSON from stdin, runs the module via a fresh
 * Registry+Executor, and writes JSON to stdout.
 */

import type { Executor } from "../cli.js";
import { ModuleExecutionError } from "../errors.js";

// Environment forwarding strategy: allow PATH, LANG, LC_ALL + all APCORE_*
// except APCORE_AUTH_* (credentials must not cross the trust boundary).
const SANDBOX_ALLOW_KEYS = ["PATH", "LANG", "LC_ALL"];
const SANDBOX_ALLOW_PREFIX = "APCORE_";
const SANDBOX_DENY_PREFIX = "APCORE_AUTH_";
// Explicit deny-list for known credential keys (defense-in-depth mirroring Rust).
const SANDBOX_DENY_KEYS: readonly string[] = ["APCORE_AUTH_API_KEY"];

const SANDBOX_OUTPUT_SIZE_LIMIT = 64 * 1024 * 1024; // 64 MiB

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------

/**
 * Executes modules in an isolated subprocess to limit the blast radius
 * of untrusted or third-party modules.
 *
 * When disabled (the default), delegates directly to the Executor.
 * When enabled, spawns a restricted child process via re-exec with
 * `--internal-sandbox-runner <module_id>`.
 */
export class Sandbox {
  private readonly enabled: boolean;
  private readonly timeoutSeconds: number;

  constructor(enabled = false, timeoutSeconds = 300) {
    this.enabled = enabled;
    this.timeoutSeconds = timeoutSeconds;
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
    return this._sandboxedExecute(moduleId, inputData);
  }

  private async _sandboxedExecute(
    moduleId: string,
    inputData: Record<string, unknown>,
  ): Promise<unknown> {
    const { spawn } = await import("node:child_process");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { mkdtempSync, rmSync } = await import("node:fs");

    const tmpDir = mkdtempSync(join(tmpdir(), "apcore_sandbox_"));

    const env = buildSandboxEnv(tmpDir);
    const binaryPath = process.argv[1];
    const child = spawn(process.execPath, [binaryPath, "--internal-sandbox-runner", moduleId], {
      env,
      cwd: tmpDir,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let totalBytes = 0;
    let sizeExceeded = false;

    child.stdout.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > SANDBOX_OUTPUT_SIZE_LIMIT) {
        sizeExceeded = true;
        child.kill("SIGKILL");
        return;
      }
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.stdin.write(JSON.stringify(inputData));
    child.stdin.end();

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(
          new ModuleExecutionError(
            `Sandbox module '${moduleId}' timed out after ${this.timeoutSeconds}s.`,
          ),
        );
      }, this.timeoutSeconds * 1000);

      child.on("close", (code) => {
        clearTimeout(timer);
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }

        if (sizeExceeded) {
          reject(new ModuleExecutionError(`Sandbox module '${moduleId}' output exceeded 64MiB limit.`));
          return;
        }
        if (code !== 0) {
          reject(new ModuleExecutionError(
            `Sandbox module '${moduleId}' exited with code ${code}.${stderr ? ` stderr: ${stderr}` : ""}`,
          ));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new ModuleExecutionError(
            `Sandbox module '${moduleId}' returned non-JSON output: ${stdout.slice(0, 200)}`,
          ));
        }
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(new ModuleExecutionError(`Failed to spawn sandbox process: ${err.message}`));
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Sandbox runner (invoked as a child process via --internal-sandbox-runner)
// ---------------------------------------------------------------------------

/**
 * Entry point for the sandbox child process.
 * Called when `--internal-sandbox-runner <module_id>` appears in argv.
 * Reads JSON from stdin, runs the module, writes JSON to stdout.
 */
export async function runSandboxRunner(moduleId: string): Promise<void> {
  const extensionsRoot = process.env.APCORE_EXTENSIONS_ROOT ?? "./extensions";
  // Dynamic import avoids circular deps and keeps the sandbox runner
  // isolated from the host CLI initialization code.
  const apcore = await import("apcore-js").catch(() => {
    process.stderr.write(
      "sandbox runner: apcore-js is not available in the sandboxed environment.\n",
    );
    process.exit(1);
  });
  if (!apcore) return;

  let inputJson = "";
  for await (const chunk of process.stdin) {
    inputJson += chunk.toString();
  }

  let inputData: Record<string, unknown>;
  try {
    inputData = JSON.parse(inputJson);
  } catch {
    process.stderr.write("sandbox runner: failed to parse stdin as JSON.\n");
    process.exit(1);
    return;
  }

  const registry = new apcore.Registry({ extensionsDir: extensionsRoot });
  await registry.discover();
  const executor = new apcore.Executor({ registry });
  try {
    const result = await executor.call(moduleId, inputData);
    process.stdout.write(JSON.stringify(result));
    process.exit(0);
  } catch (err: unknown) {
    process.stderr.write(`sandbox runner error: ${err}\n`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSandboxEnv(tmpDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of SANDBOX_ALLOW_KEYS) {
    if (process.env[key]) env[key] = process.env[key];
  }
  for (const [key, val] of Object.entries(process.env)) {
    if (
      key.startsWith(SANDBOX_ALLOW_PREFIX) &&
      !key.startsWith(SANDBOX_DENY_PREFIX) &&
      !(SANDBOX_DENY_KEYS as readonly string[]).includes(key)
    ) {
      env[key] = val;
    }
  }
  env.HOME = tmpDir;
  env.TMPDIR = tmpDir;
  return env;
}
