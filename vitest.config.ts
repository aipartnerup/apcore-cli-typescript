import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
    // Redirects AuditLogger.DEFAULT_PATH into a temp directory so no test run
    // writes to the developer's real `~/.apcore-cli/audit.jsonl`. Mirrors the
    // session-scoped autouse fixture in apcore-cli-python's tests/conftest.py.
    setupFiles: ["tests/setup/audit-isolation.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      // Cross-SDK parity (audit D5-004, 2026-05-08): match Python
      // `fail_under = 85` in pyproject.toml and Rust `cargo llvm-cov
      // --fail-under-lines 85`. CI fails coverage runs below this floor.
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 75,
        statements: 85,
      },
    },
  },
});
