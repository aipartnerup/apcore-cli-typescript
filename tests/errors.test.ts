/**
 * Tests for error classes and exit code mapping.
 */

import { describe, it, expect } from "vitest";
import {
  ApprovalTimeoutError,
  ApprovalDeniedError,
  AuthenticationError,
  ConfigDecryptionError,
  ModuleExecutionError,
  ModuleNotFoundError,
  SchemaValidationError,
  EXIT_CODES,
  exitCodeForError,
} from "../src/errors.js";

describe("Error classes", () => {
  it("creates ApprovalTimeoutError with correct name", () => {
    const err = new ApprovalTimeoutError();
    expect(err.name).toBe("ApprovalTimeoutError");
    expect(err).toBeInstanceOf(Error);
  });

  it("creates AuthenticationError with correct name", () => {
    const err = new AuthenticationError();
    expect(err.name).toBe("AuthenticationError");
    expect(err).toBeInstanceOf(Error);
  });

  it("creates ConfigDecryptionError with correct name", () => {
    const err = new ConfigDecryptionError();
    expect(err.name).toBe("ConfigDecryptionError");
    expect(err).toBeInstanceOf(Error);
  });

  it("creates ModuleExecutionError with correct name", () => {
    const err = new ModuleExecutionError();
    expect(err.name).toBe("ModuleExecutionError");
    expect(err).toBeInstanceOf(Error);
  });

  it("creates ApprovalDeniedError with correct name", () => {
    const err = new ApprovalDeniedError();
    expect(err.name).toBe("ApprovalDeniedError");
    expect(err).toBeInstanceOf(Error);
  });

  it("creates SchemaValidationError with correct name", () => {
    const err = new SchemaValidationError();
    expect(err.name).toBe("SchemaValidationError");
    expect(err).toBeInstanceOf(Error);
  });

  it("creates ModuleNotFoundError with correct name", () => {
    const err = new ModuleNotFoundError();
    expect(err.name).toBe("ModuleNotFoundError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("EXIT_CODES", () => {
  it("has expected exit code values", () => {
    expect(EXIT_CODES.SUCCESS).toBe(0);
    expect(EXIT_CODES.MODULE_EXECUTE_ERROR).toBe(1);
    expect(EXIT_CODES.INVALID_CLI_INPUT).toBe(2);
    expect(EXIT_CODES.MODULE_NOT_FOUND).toBe(44);
    expect(EXIT_CODES.SCHEMA_VALIDATION_ERROR).toBe(45);
    expect(EXIT_CODES.APPROVAL_DENIED).toBe(46);
    expect(EXIT_CODES.CONFIG_NOT_FOUND).toBe(47);
    expect(EXIT_CODES.SCHEMA_CIRCULAR_REF).toBe(48);
    expect(EXIT_CODES.ACL_DENIED).toBe(77);
    expect(EXIT_CODES.KEYBOARD_INTERRUPT).toBe(130);
  });
});

describe("exitCodeForError", () => {
  it("maps ApprovalTimeoutError to exit code 46", () => {
    expect(exitCodeForError(new ApprovalTimeoutError())).toBe(EXIT_CODES.APPROVAL_TIMEOUT);
  });

  it("maps AuthenticationError to exit code 77", () => {
    expect(exitCodeForError(new AuthenticationError())).toBe(EXIT_CODES.ACL_DENIED);
  });

  it("maps ConfigDecryptionError to exit code 47", () => {
    expect(exitCodeForError(new ConfigDecryptionError())).toBe(EXIT_CODES.CONFIG_INVALID);
  });

  it("maps ModuleExecutionError to exit code 1", () => {
    expect(exitCodeForError(new ModuleExecutionError())).toBe(EXIT_CODES.MODULE_EXECUTE_ERROR);
  });

  it("maps ApprovalDeniedError to exit code 46", () => {
    expect(exitCodeForError(new ApprovalDeniedError())).toBe(EXIT_CODES.APPROVAL_DENIED);
  });

  it("maps SchemaValidationError to exit code 45", () => {
    expect(exitCodeForError(new SchemaValidationError())).toBe(EXIT_CODES.SCHEMA_VALIDATION_ERROR);
  });

  it("maps ModuleNotFoundError to exit code 44", () => {
    expect(exitCodeForError(new ModuleNotFoundError())).toBe(EXIT_CODES.MODULE_NOT_FOUND);
  });

  it("maps error with apcore code property", () => {
    const err = Object.assign(new Error("test"), { code: "ACL_DENIED" });
    expect(exitCodeForError(err)).toBe(EXIT_CODES.ACL_DENIED);
  });

  it("maps unknown errors to exit code 1", () => {
    expect(exitCodeForError(new Error("unknown"))).toBe(EXIT_CODES.MODULE_EXECUTE_ERROR);
  });

  // Config Bus error codes (apcore >= 0.15.0)
  it("maps APPROVAL_PENDING to exit code 46", () => {
    const err = Object.assign(new Error("test"), { code: "APPROVAL_PENDING" });
    expect(exitCodeForError(err)).toBe(EXIT_CODES.APPROVAL_DENIED);
  });

  it("maps CONFIG_NAMESPACE_RESERVED to exit code 78", () => {
    const err = Object.assign(new Error("test"), { code: "CONFIG_NAMESPACE_RESERVED" });
    expect(exitCodeForError(err)).toBe(EXIT_CODES.CONFIG_NAMESPACE_RESERVED);
  });

  it("maps CONFIG_NAMESPACE_DUPLICATE to exit code 78", () => {
    const err = Object.assign(new Error("test"), { code: "CONFIG_NAMESPACE_DUPLICATE" });
    expect(exitCodeForError(err)).toBe(EXIT_CODES.CONFIG_NAMESPACE_DUPLICATE);
  });

  it("maps CONFIG_ENV_PREFIX_CONFLICT to exit code 78", () => {
    const err = Object.assign(new Error("test"), { code: "CONFIG_ENV_PREFIX_CONFLICT" });
    expect(exitCodeForError(err)).toBe(EXIT_CODES.CONFIG_ENV_PREFIX_CONFLICT);
  });

  it("maps CONFIG_MOUNT_ERROR to exit code 66", () => {
    const err = Object.assign(new Error("test"), { code: "CONFIG_MOUNT_ERROR" });
    expect(exitCodeForError(err)).toBe(EXIT_CODES.CONFIG_MOUNT_ERROR);
  });

  it("maps CONFIG_BIND_ERROR to exit code 65", () => {
    const err = Object.assign(new Error("test"), { code: "CONFIG_BIND_ERROR" });
    expect(exitCodeForError(err)).toBe(EXIT_CODES.CONFIG_BIND_ERROR);
  });

  it("maps ERROR_FORMATTER_DUPLICATE to exit code 70", () => {
    const err = Object.assign(new Error("test"), { code: "ERROR_FORMATTER_DUPLICATE" });
    expect(exitCodeForError(err)).toBe(EXIT_CODES.ERROR_FORMATTER_DUPLICATE);
  });
});
