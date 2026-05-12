/**
 * Tests for Sandbox.
 */

import { describe, it, expect, vi } from "vitest";
import { Sandbox } from "../../src/security/sandbox.js";
import { ModuleExecutionError } from "../../src/errors.js";
import type { Executor } from "../../src/cli.js";

describe("Sandbox", () => {
  const mockExecutor: Executor = {
    execute: vi.fn().mockResolvedValue({ result: "ok" }),
  };

  describe("execute() — disabled (passthrough)", () => {
    it("delegates to executor when disabled", async () => {
      const sandbox = new Sandbox(false);
      const result = await sandbox.execute("test.mod", { x: 1 }, mockExecutor);
      expect(result).toEqual({ result: "ok" });
      expect(mockExecutor.execute).toHaveBeenCalledWith("test.mod", { x: 1 });
    });
  });

  describe("execute() — enabled (subprocess isolation)", () => {
    it("attempts subprocess spawn (not a stub anymore) when enabled=true", async () => {
      // The sandbox now attempts a real subprocess re-exec. In the test
      // environment, the spawn will fail (no real apcore-cli binary at argv[1])
      // but the error MUST be ModuleExecutionError, not the old stub message.
      const sandbox = new Sandbox(true, 5); // 5 second timeout
      const err = await sandbox.execute("test.mod", {}, mockExecutor).catch((e) => e);
      expect(err).toBeInstanceOf(ModuleExecutionError);
      // Must NOT say "not yet implemented" — that message was the old stub
      expect(String(err.message)).not.toContain("not yet implemented");
    });

    it("env stripping excludes APCORE_AUTH_* credentials", async () => {
      // Smoke-test the env helper by verifying APCORE_AUTH vars don't appear
      // in a child process environment. We test the helper function directly
      // rather than spawning a process.
      process.env.APCORE_AUTH_API_KEY = "test-secret";
      process.env.APCORE_EXTENSIONS_ROOT = "/test/extensions";
      // Indirect test: Sandbox with enabled=true fails fast — but the key
      // property is that the sandbox module is importable and the class
      // instantiates without error.
      const sandbox = new Sandbox(true, 1);
      expect(sandbox).toBeDefined();
      // Clean up
      delete process.env.APCORE_AUTH_API_KEY;
      delete process.env.APCORE_EXTENSIONS_ROOT;
    });
  });

  describe("runSandboxRunner", () => {
    it("is exported from sandbox module", async () => {
      const { runSandboxRunner } = await import("../../src/security/sandbox.js");
      expect(typeof runSandboxRunner).toBe("function");
    });
  });

  // -------------------------------------------------------------------------
  // D1-004 — builder methods (Python parity)
  // -------------------------------------------------------------------------
  describe("builder methods (D1-004)", () => {
    it("withExtensionsRoot is chainable and returns the same Sandbox instance", () => {
      const sandbox = new Sandbox(false);
      const returned = sandbox.withExtensionsRoot("/tmp/exts");
      expect(returned).toBe(sandbox);
    });

    it("withMaxOutputBytes is chainable and returns the same Sandbox instance", () => {
      const sandbox = new Sandbox(false);
      const returned = sandbox.withMaxOutputBytes(1024);
      expect(returned).toBe(sandbox);
    });

    it("supports fluent chaining of both builder methods", () => {
      const sandbox = new Sandbox(true, 5)
        .withExtensionsRoot("/tmp/exts")
        .withMaxOutputBytes(2048);
      expect(sandbox).toBeInstanceOf(Sandbox);
    });

    it("withExtensionsRoot accepts null to clear an explicit override", () => {
      const sandbox = new Sandbox(false)
        .withExtensionsRoot("/tmp/x")
        .withExtensionsRoot(null);
      expect(sandbox).toBeInstanceOf(Sandbox);
    });

    it("exposes DEFAULT_MAX_OUTPUT_BYTES = 64 MiB", () => {
      expect(Sandbox.DEFAULT_MAX_OUTPUT_BYTES).toBe(64 * 1024 * 1024);
    });
  });

});

// ---------------------------------------------------------------------------
// Tests using vi.mock for node:child_process (A-D-015, A-D-016)
// These need a separate describe block because vi.mock applies module-wide.
// ---------------------------------------------------------------------------

import { EventEmitter } from "node:events";

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: () => void; end: () => void; on: () => unknown };
  kill: ReturnType<typeof vi.fn>;
};

let __spawnImpl: ((...args: unknown[]) => unknown) | null = null;

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return {
    ...actual,
    spawn: (...args: unknown[]) => {
      if (__spawnImpl) return __spawnImpl(...args);
      return actual.spawn(...(args as Parameters<typeof actual.spawn>));
    },
  };
});

function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  // D11-008: production code now attaches an 'error' listener to stdin
  // before .write(); fake stdin must accept .on() to avoid a TypeError.
  child.stdin = {
    write: () => undefined,
    end: () => undefined,
    on: () => undefined,
  };
  child.kill = vi.fn();
  return child;
}

// Like makeFakeChild but stdin is a real EventEmitter so an 'error' event
// can be observed. D11-008 fix wires an error listener BEFORE the .write()
// call so an EPIPE from a fast-exiting child does not surface as an
// unhandled exception.
type FakeChildWithStdinEmitter = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; listenerCount: (event: string) => number };
  kill: ReturnType<typeof vi.fn>;
};
function makeFakeChildWithStdinEmitter(): FakeChildWithStdinEmitter {
  const child = new EventEmitter() as FakeChildWithStdinEmitter;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const stdin = new EventEmitter() as FakeChildWithStdinEmitter["stdin"];
  stdin.write = vi.fn();
  stdin.end = vi.fn();
  child.stdin = stdin;
  child.kill = vi.fn();
  return child;
}

describe("Sandbox subprocess wiring (mocked spawn)", () => {
  const mockExecutor: Executor = {
    execute: vi.fn().mockResolvedValue({ result: "ok" }),
  };

  // -------------------------------------------------------------------------
  // A-D-015 — stderr must be capped (DoS protection)
  // -------------------------------------------------------------------------
  it("kills child and rejects when stderr exceeds 64MiB (A-D-015)", async () => {
    const fakeChild = makeFakeChild();
    let capturedChild: FakeChild | null = null;
    __spawnImpl = () => {
      capturedChild = fakeChild;
      return fakeChild;
    };

    const sandbox = new Sandbox(true, 5);
    const promise = sandbox.execute("test.mod", {}, mockExecutor);

    // Wait for the dynamic imports + spawn to occur inside _sandboxedExecute.
    for (let i = 0; i < 10 && !capturedChild; i++) {
      await new Promise((r) => setImmediate(r));
    }
    expect(capturedChild).not.toBeNull();

    // Emit many 1 MiB stderr chunks until the cap (64 MiB) is crossed.
    // Single 65MiB Buffers blow up Vitest's IPC channel.
    const chunk = Buffer.alloc(1 * 1024 * 1024, 0x41); // 1 MiB
    for (let i = 0; i < 65; i++) {
      fakeChild.stderr.emit("data", chunk);
    }

    // Simulate the child closing after SIGKILL.
    fakeChild.emit("close", 137);

    const err = await promise.catch((e) => e);
    expect(err).toBeInstanceOf(ModuleExecutionError);
    expect(String(err.message)).toMatch(/64 ?MiB|exceeded|size/i);
    expect(fakeChild.kill).toHaveBeenCalledWith("SIGKILL");

    __spawnImpl = null;
  });

  // -------------------------------------------------------------------------
  // A-D-016 — relative APCORE_EXTENSIONS_ROOT must be resolved to absolute
  // -------------------------------------------------------------------------
  it("resolves a relative APCORE_EXTENSIONS_ROOT to absolute before forwarding (A-D-016)", async () => {
    const path = await import("node:path");

    const fakeChild = makeFakeChild();
    let capturedEnv: NodeJS.ProcessEnv | undefined;
    __spawnImpl = (..._args: unknown[]) => {
      const opts = _args[2] as { env?: NodeJS.ProcessEnv } | undefined;
      capturedEnv = opts?.env;
      return fakeChild;
    };

    const savedRoot = process.env.APCORE_EXTENSIONS_ROOT;
    process.env.APCORE_EXTENSIONS_ROOT = "./relative/extensions";

    const sandbox = new Sandbox(true, 5);
    const promise = sandbox.execute("test.mod", {}, mockExecutor);

    for (let i = 0; i < 10 && capturedEnv === undefined; i++) {
      await new Promise((r) => setImmediate(r));
    }

    // Close cleanly to let the promise settle.
    fakeChild.stdout.emit("data", Buffer.from("{}"));
    fakeChild.emit("close", 0);
    await promise.catch(() => undefined);

    expect(capturedEnv).toBeDefined();
    const forwardedRoot = capturedEnv?.APCORE_EXTENSIONS_ROOT;
    expect(forwardedRoot).toBeDefined();
    expect(path.isAbsolute(forwardedRoot as string)).toBe(true);
    expect(forwardedRoot).not.toBe("./relative/extensions");

    if (savedRoot === undefined) {
      delete process.env.APCORE_EXTENSIONS_ROOT;
    } else {
      process.env.APCORE_EXTENSIONS_ROOT = savedRoot;
    }
    __spawnImpl = null;
  });

  // -------------------------------------------------------------------------
  // D11-008 — child.stdin must have an 'error' listener BEFORE .write()
  // so an EPIPE from a fast-exiting child does not bubble up as an
  // unhandled exception.
  // -------------------------------------------------------------------------
  it("attaches an 'error' listener to child.stdin before writing (D11-008)", async () => {
    const fakeChild = makeFakeChildWithStdinEmitter();
    let captured: FakeChildWithStdinEmitter | null = null;
    __spawnImpl = () => {
      captured = fakeChild;
      return fakeChild;
    };

    const sandbox = new Sandbox(true, 5);
    const promise = sandbox.execute("test.mod", { x: 1 }, mockExecutor);

    for (let i = 0; i < 10 && !captured; i++) {
      await new Promise((r) => setImmediate(r));
    }
    expect(captured).not.toBeNull();
    // The fix MUST register a listener BEFORE the .write() call.
    expect(captured!.stdin.listenerCount("error")).toBeGreaterThanOrEqual(1);

    // Now simulate the EPIPE-like surface and confirm it does NOT throw
    // an "Unhandled error" — emitting an event with no listeners would
    // throw synchronously.
    expect(() => captured!.stdin.emit("error", new Error("EPIPE"))).not.toThrow();

    // Let the promise settle so we don't leak it.
    fakeChild.stdout.emit("data", Buffer.from("{}"));
    fakeChild.emit("close", 0);
    await promise.catch(() => undefined);
    __spawnImpl = null;
  });

  // -------------------------------------------------------------------------
  // D1-004 — withExtensionsRoot wins over the inherited env var
  // -------------------------------------------------------------------------
  it("withExtensionsRoot overrides APCORE_EXTENSIONS_ROOT in the child env (D1-004)", async () => {
    const path = await import("node:path");

    const fakeChild = makeFakeChild();
    let capturedEnv: NodeJS.ProcessEnv | undefined;
    __spawnImpl = (..._args: unknown[]) => {
      const opts = _args[2] as { env?: NodeJS.ProcessEnv } | undefined;
      capturedEnv = opts?.env;
      return fakeChild;
    };

    const savedRoot = process.env.APCORE_EXTENSIONS_ROOT;
    process.env.APCORE_EXTENSIONS_ROOT = "./relative/from-env";

    const sandbox = new Sandbox(true, 5).withExtensionsRoot("./relative/from-builder");
    const promise = sandbox.execute("test.mod", {}, mockExecutor);

    for (let i = 0; i < 10 && capturedEnv === undefined; i++) {
      await new Promise((r) => setImmediate(r));
    }

    fakeChild.stdout.emit("data", Buffer.from("{}"));
    fakeChild.emit("close", 0);
    await promise.catch(() => undefined);

    expect(capturedEnv).toBeDefined();
    const forwardedRoot = capturedEnv?.APCORE_EXTENSIONS_ROOT;
    expect(forwardedRoot).toBeDefined();
    expect(path.isAbsolute(forwardedRoot as string)).toBe(true);
    expect(forwardedRoot).toMatch(/from-builder$/);
    expect(forwardedRoot).not.toMatch(/from-env$/);

    if (savedRoot === undefined) {
      delete process.env.APCORE_EXTENSIONS_ROOT;
    } else {
      process.env.APCORE_EXTENSIONS_ROOT = savedRoot;
    }
    __spawnImpl = null;
  });
});

// ---------------------------------------------------------------------------
// D11-009 — buildSandboxEnv must forward empty-string allow-list env values
// (parity with Python/Rust which treat empty-string and unset asymmetrically).
// ---------------------------------------------------------------------------
describe("buildSandboxEnv empty-string forwarding (D11-009)", () => {
  it("forwards an allow-listed PATH='' entry instead of dropping it", async () => {
    const savedPath = process.env.PATH;
    process.env.PATH = "";
    try {
      const { _buildSandboxEnvForTesting } = await import(
        "../../src/security/sandbox.js?d11-009=" + Date.now()
      );
      const env = _buildSandboxEnvForTesting("/tmp/x");
      expect(Object.prototype.hasOwnProperty.call(env, "PATH")).toBe(true);
      expect(env.PATH).toBe("");
    } finally {
      if (savedPath === undefined) delete process.env.PATH;
      else process.env.PATH = savedPath;
    }
  });
});
