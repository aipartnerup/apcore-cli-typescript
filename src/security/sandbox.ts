/**
 * Sandbox — Subprocess isolation for module execution.
 *
 * Protocol spec: Security — sandboxed execution (tech-design §8.6.4).
 *
 * Implementation status: PASSTHROUGH. The `--sandbox` flag is wired but
 * subprocess isolation is not yet implemented. When enabled, execute() throws
 * a clear error directing users to run without --sandbox. When disabled, it
 * delegates directly to the Executor. A real subprocess runner is tracked as
 * future work.
 */

import type { Executor } from "../cli.js";
import { ModuleExecutionError } from "../errors.js";

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------

/**
 * Executes modules in an isolated subprocess to limit the blast radius
 * of untrusted or third-party modules.
 *
 * When disabled (the default), delegates directly to the Executor.
 * When enabled, throws a clear error — subprocess isolation is not yet
 * implemented in the TypeScript port.
 *
 * Audit D1-005 parity (v0.6.x): the `timeoutSeconds` parameter mirrors
 * the Rust `Sandbox::new(enabled, timeout_ms)` and Python
 * `Sandbox(enabled, timeout_seconds)` constructors. The value is currently
 * stored but unused — it will become active when subprocess isolation
 * is implemented.
 */
export class Sandbox {
  private readonly enabled: boolean;
  private readonly timeoutSeconds: number;

  constructor(enabled = false, timeoutSeconds = 300) {
    this.enabled = enabled;
    this.timeoutSeconds = timeoutSeconds;
    void this.timeoutSeconds; // suppress unused-private warning until subprocess runner lands
  }

  /**
   * Execute a module, optionally inside a sandboxed subprocess.
   *
   * @throws {ModuleExecutionError} if the sandbox is enabled (subprocess
   *   isolation is not yet implemented in the TypeScript port).
   */
  async execute(
    moduleId: string,
    inputData: Record<string, unknown>,
    executor: Executor,
  ): Promise<unknown> {
    if (this.enabled) {
      throw new ModuleExecutionError(
        `Sandbox subprocess isolation is not yet implemented in the TypeScript ` +
          `port. Run '${moduleId}' without --sandbox, or set sandbox.enabled=false ` +
          `in config. See tech-design §8.6.4 for the design.`,
      );
    }
    return executor.execute(moduleId, inputData);
  }
}
