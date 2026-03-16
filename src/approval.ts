/**
 * Interactive approval prompts with timeout.
 *
 * Protocol spec: Approval workflow
 */

import * as readline from "node:readline";
import type { ModuleDescriptor } from "./cli.js";
import { ApprovalTimeoutError, EXIT_CODES } from "./errors.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get an annotation value from either a dict or an object.
 */
function getAnnotation(
  annotations: unknown,
  key: string,
  defaultValue: unknown = undefined,
): unknown {
  if (!annotations || typeof annotations !== "object") return defaultValue;
  const ann = annotations as Record<string, unknown>;
  return key in ann ? ann[key] : defaultValue;
}

// ---------------------------------------------------------------------------
// checkApproval
// ---------------------------------------------------------------------------

/**
 * Check if module requires approval and handle accordingly.
 * Returns normally if approved (or approval not required).
 * Calls process.exit(46) if denied/timed out/non-TTY.
 */
export async function checkApproval(
  moduleDef: ModuleDescriptor,
  autoApprove: boolean,
): Promise<void> {
  const annotations = moduleDef.annotations;

  // Check if approval is required
  let requiresApproval: boolean;
  if (moduleDef.requiresApproval !== undefined) {
    requiresApproval = moduleDef.requiresApproval;
  } else if (annotations) {
    requiresApproval = getAnnotation(annotations, "requires_approval", false) === true;
  } else {
    return; // No annotations, no approval needed
  }

  if (!requiresApproval) {
    return;
  }

  const moduleId = moduleDef.id;

  // Bypass: autoApprove flag (highest priority)
  if (autoApprove) {
    return;
  }

  // Bypass: APCORE_CLI_AUTO_APPROVE env var
  const envVal = process.env.APCORE_CLI_AUTO_APPROVE ?? "";
  if (envVal === "1") {
    return;
  }
  if (envVal !== "" && envVal !== "1") {
    process.stderr.write(
      `Warning: APCORE_CLI_AUTO_APPROVE is set to '${envVal}', expected '1'. Ignoring.\n`,
    );
  }

  // Non-TTY check
  if (!process.stdin.isTTY) {
    process.stderr.write(
      `Error: Module '${moduleId}' requires approval but no interactive ` +
        "terminal is available. Use --yes or set APCORE_CLI_AUTO_APPROVE=1 " +
        "to bypass.\n",
    );
    process.exit(EXIT_CODES.APPROVAL_DENIED);
  }

  // TTY prompt
  await promptWithTimeout(moduleDef, 60);
}

/**
 * Display approval prompt with timeout.
 */
async function promptWithTimeout(
  moduleDef: ModuleDescriptor,
  timeout: number,
): Promise<void> {
  // Clamp timeout
  timeout = Math.max(1, Math.min(timeout, 3600));

  const moduleId = moduleDef.id;
  const annotations = moduleDef.annotations;
  const message =
    (annotations
      ? (getAnnotation(annotations, "approval_message") as string | undefined)
      : undefined) ??
    `Module '${moduleId}' requires approval to execute.`;

  process.stderr.write(message + "\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const answer = await Promise.race([
      new Promise<string>((resolve) => {
        rl.question("Proceed? [y/N] ", (ans) => resolve(ans));
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new ApprovalTimeoutError(
            `Approval prompt timed out after ${timeout} seconds.`,
          ));
        }, timeout * 1000);
      }),
    ]);

    // Clear the timeout — prompt resolved before timeout fired
    if (timer) clearTimeout(timer);

    const normalized = answer.trim().toLowerCase();
    if (normalized === "y" || normalized === "yes") {
      return;
    }

    process.stderr.write("Error: Approval denied.\n");
    process.exit(EXIT_CODES.APPROVAL_DENIED);
  } catch (err) {
    if (timer) clearTimeout(timer);
    if (err instanceof ApprovalTimeoutError) {
      process.stderr.write(
        `Error: Approval prompt timed out after ${timeout} seconds.\n`,
      );
      process.exit(EXIT_CODES.APPROVAL_TIMEOUT);
    }
    throw err;
  } finally {
    rl.close();
  }
}
