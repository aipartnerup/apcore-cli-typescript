/**
 * Module-ID validation.
 *
 * Mirrors `apcore-cli-python/src/apcore_cli/validate.py` and
 * `apcore-cli-rust/src/validate.rs` so embedders comparing the three SDKs
 * find the helper at the same path in each tree (audit D8-W2).
 */

import { EXIT_CODES } from "./errors.js";

/** Module-ID syntax: dot-separated lowercase segments, each `[a-z][a-z0-9_]*`. */
const MODULE_ID_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

/**
 * Maximum allowed module-ID length in characters.
 *
 * Tracks PROTOCOL_SPEC §2.7 EBNF constraint #1 — bumped from 128 to 192 in
 * spec 1.6.0-draft to accommodate Java/.NET deep-namespace FQN-derived IDs.
 * Filesystem-safe (192 + ".binding.yaml".length = 205 < 255).
 */
export const MAX_MODULE_ID_LENGTH = 192;

/**
 * Validate that a module ID conforms to the expected format.
 *
 * Pattern: `[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*` — max 192 chars.
 *
 * On invalid input, writes a human-readable error to stderr and calls
 * `process.exit(EXIT_CODES.INVALID_CLI_INPUT)`. Cross-SDK parity with Python
 * `apcore_cli.validate.validate_module_id` and Rust `validate_module_id`.
 */
export function validateModuleId(moduleId: string): void {
  if (moduleId.length > MAX_MODULE_ID_LENGTH) {
    process.stderr.write(
      `Error: Invalid module ID format: '${moduleId}'. Maximum length is ${MAX_MODULE_ID_LENGTH} characters.\n`,
    );
    process.exit(EXIT_CODES.INVALID_CLI_INPUT);
  }
  if (!MODULE_ID_PATTERN.test(moduleId)) {
    process.stderr.write(
      `Error: Invalid module ID format: '${moduleId}'.\n`,
    );
    process.exit(EXIT_CODES.INVALID_CLI_INPUT);
  }
}
