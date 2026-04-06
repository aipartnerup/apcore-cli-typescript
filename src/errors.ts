/**
 * Error classes and exit code mapping for apcore-cli.
 *
 * Protocol spec: Error handling & exit codes
 */

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/** Thrown when the user does not approve module execution within the timeout. */
export class ApprovalTimeoutError extends Error {
  constructor(message = "Approval timed out") {
    super(message);
    this.name = "ApprovalTimeoutError";
  }
}

/** Thrown when API key authentication fails or is missing. */
export class AuthenticationError extends Error {
  constructor(message = "Authentication failed") {
    super(message);
    this.name = "AuthenticationError";
  }
}

/** Thrown when encrypted config cannot be decrypted. */
export class ConfigDecryptionError extends Error {
  constructor(message = "Config decryption failed") {
    super(message);
    this.name = "ConfigDecryptionError";
  }
}

/** Thrown when module execution fails. */
export class ModuleExecutionError extends Error {
  constructor(message = "Module execution failed") {
    super(message);
    this.name = "ModuleExecutionError";
  }
}

/** Thrown when approval is denied by the user. */
export class ApprovalDeniedError extends Error {
  constructor(message = "Approval denied") {
    super(message);
    this.name = "ApprovalDeniedError";
  }
}

/** Thrown when schema validation fails. */
export class SchemaValidationError extends Error {
  constructor(message = "Schema validation failed") {
    super(message);
    this.name = "SchemaValidationError";
  }
}

/** Thrown when a module is not found. */
export class ModuleNotFoundError extends Error {
  constructor(message = "Module not found") {
    super(message);
    this.name = "ModuleNotFoundError";
  }
}

// ---------------------------------------------------------------------------
// Exit code map
// ---------------------------------------------------------------------------

export const EXIT_CODES = {
  SUCCESS: 0,
  MODULE_EXECUTE_ERROR: 1,
  MODULE_TIMEOUT: 1,
  INVALID_CLI_INPUT: 2,
  MODULE_NOT_FOUND: 44,
  MODULE_LOAD_ERROR: 44,
  MODULE_DISABLED: 44,
  SCHEMA_VALIDATION_ERROR: 45,
  APPROVAL_DENIED: 46,
  APPROVAL_TIMEOUT: 46,
  CONFIG_NOT_FOUND: 47,
  CONFIG_INVALID: 47,
  SCHEMA_CIRCULAR_REF: 48,
  ACL_DENIED: 77,
  // Config Bus errors (apcore >= 0.15.0)
  CONFIG_NAMESPACE_RESERVED: 78,
  CONFIG_NAMESPACE_DUPLICATE: 78,
  CONFIG_ENV_PREFIX_CONFLICT: 78,
  CONFIG_ENV_MAP_CONFLICT: 78,
  CONFIG_MOUNT_ERROR: 66,
  CONFIG_BIND_ERROR: 65,
  ERROR_FORMATTER_DUPLICATE: 70,
  KEYBOARD_INTERRUPT: 130,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a caught error to the appropriate process exit code.
 * Also checks for apcore error codes on the error object.
 */
export function exitCodeForError(error: unknown): ExitCode {
  if (error instanceof ApprovalTimeoutError) {
    return EXIT_CODES.APPROVAL_TIMEOUT;
  }
  if (error instanceof ApprovalDeniedError) {
    return EXIT_CODES.APPROVAL_DENIED;
  }
  if (error instanceof AuthenticationError) {
    return EXIT_CODES.ACL_DENIED;
  }
  if (error instanceof ConfigDecryptionError) {
    return EXIT_CODES.CONFIG_INVALID;
  }
  if (error instanceof SchemaValidationError) {
    return EXIT_CODES.SCHEMA_VALIDATION_ERROR;
  }
  if (error instanceof ModuleNotFoundError) {
    return EXIT_CODES.MODULE_NOT_FOUND;
  }
  if (error instanceof ModuleExecutionError) {
    return EXIT_CODES.MODULE_EXECUTE_ERROR;
  }

  // Check for apcore error codes on the error object
  if (error instanceof Error) {
    const code = (error as unknown as Record<string, unknown>).code as string | undefined;
    const codeMap: Record<string, ExitCode> = {
      MODULE_NOT_FOUND: EXIT_CODES.MODULE_NOT_FOUND,
      MODULE_LOAD_ERROR: EXIT_CODES.MODULE_LOAD_ERROR,
      MODULE_DISABLED: EXIT_CODES.MODULE_DISABLED,
      SCHEMA_VALIDATION_ERROR: EXIT_CODES.SCHEMA_VALIDATION_ERROR,
      SCHEMA_CIRCULAR_REF: EXIT_CODES.SCHEMA_CIRCULAR_REF,
      APPROVAL_DENIED: EXIT_CODES.APPROVAL_DENIED,
      APPROVAL_TIMEOUT: EXIT_CODES.APPROVAL_TIMEOUT,
      APPROVAL_PENDING: EXIT_CODES.APPROVAL_DENIED,
      CONFIG_NOT_FOUND: EXIT_CODES.CONFIG_NOT_FOUND,
      CONFIG_INVALID: EXIT_CODES.CONFIG_INVALID,
      MODULE_EXECUTE_ERROR: EXIT_CODES.MODULE_EXECUTE_ERROR,
      MODULE_TIMEOUT: EXIT_CODES.MODULE_TIMEOUT,
      ACL_DENIED: EXIT_CODES.ACL_DENIED,
      // Config Bus errors (apcore >= 0.15.0)
      CONFIG_NAMESPACE_RESERVED: EXIT_CODES.CONFIG_NAMESPACE_RESERVED,
      CONFIG_NAMESPACE_DUPLICATE: EXIT_CODES.CONFIG_NAMESPACE_DUPLICATE,
      CONFIG_ENV_PREFIX_CONFLICT: EXIT_CODES.CONFIG_ENV_PREFIX_CONFLICT,
      CONFIG_MOUNT_ERROR: EXIT_CODES.CONFIG_MOUNT_ERROR,
      CONFIG_BIND_ERROR: EXIT_CODES.CONFIG_BIND_ERROR,
      ERROR_FORMATTER_DUPLICATE: EXIT_CODES.ERROR_FORMATTER_DUPLICATE,
    };
    if (code && code in codeMap) {
      return codeMap[code];
    }
  }

  return EXIT_CODES.MODULE_EXECUTE_ERROR;
}
