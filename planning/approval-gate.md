# FE-03: Approval Gate

> **Priority:** P1
> **Source:** `src/approval.ts`
> **Tests:** `tests/approval.test.ts`
> **Reference:** `../apcore-cli-python/src/apcore_cli/approval.py`
> **Dependencies:** None

## Overview

Human-in-the-loop approval for modules marked `requires_approval: true`. Prompts the
user interactively with a configurable timeout. Supports bypass via `--yes` flag or
`APCORE_CLI_AUTO_APPROVE=1` environment variable. Non-TTY environments error
immediately.

## Key Differences from Python

| Python | TypeScript |
|--------|-----------|
| `signal.SIGALRM` | `setTimeout()` + `AbortController` |
| `click.confirm()` | `readline.createInterface()` with manual prompt |
| `sys.stdin.isatty()` | `process.stdin.isTTY` |
| `sys.exit(46)` | `process.exit(46)` |
| Windows `ctypes` async interrupt | Not needed (Node.js is cross-platform) |

## Tasks

### Task 1: checkApproval with bypass logic (RED → GREEN → REFACTOR)

**Tests:**
```typescript
describe("checkApproval()", () => {
  it("returns immediately when module does not require approval");
  it("returns immediately when autoApprove is true");
  it("returns immediately when APCORE_CLI_AUTO_APPROVE=1");
  it("logs warning when APCORE_CLI_AUTO_APPROVE is set to invalid value");
  it("handles missing annotations gracefully");
  it("handles annotations as dict");
  it("handles annotations as object with requires_approval property");
});
```

**Implementation:**
- Extract `requires_approval` from `moduleDef.annotations` (dict or object)
- Check bypass: `autoApprove` → `APCORE_CLI_AUTO_APPROVE` → proceed to prompt
- Helper: `getAnnotation(annotations, key, default)` for dict/object polymorphism

### Task 2: Non-TTY rejection (RED → GREEN → REFACTOR)

**Tests:**
```typescript
describe("non-TTY handling", () => {
  it("exits 46 when stdin is not a TTY and no bypass provided");
  it("outputs helpful error message suggesting --yes or env var");
});
```

**Implementation:**
- Check `process.stdin.isTTY`
- If not TTY: write error to stderr, `process.exit(46)`

### Task 3: TTY prompt with timeout (RED → GREEN → REFACTOR)

**Tests:**
```typescript
describe("TTY prompt", () => {
  it("approves on 'y' input");
  it("approves on 'yes' input (case-insensitive)");
  it("denies on 'n' input (exits 46)");
  it("denies on empty input (exits 46)");
  it("denies on any non-yes input (exits 46)");
  it("times out after configured seconds (exits 46)");
  it("clamps timeout to 1-3600 range");
  it("displays module ID in prompt message");
  it("displays custom approval_message when present");
});
```

**Implementation:**
- `promptWithTimeout(moduleDef, timeout = 60)` → async
- Use `readline.createInterface({ input: process.stdin, output: process.stderr })`
- Wrap in `Promise.race()` with `setTimeout` for timeout
- Accept `y` / `yes` (case-insensitive), reject everything else
- Clean up readline interface in `finally` block
- Clamp timeout: `Math.max(1, Math.min(timeout, 3600))`

### Task 4: ApprovalTimeoutError integration (RED → GREEN → REFACTOR)

**Tests:**
```typescript
describe("ApprovalTimeoutError", () => {
  it("is thrown on timeout");
  it("has correct name property");
  it("maps to exit code 46 via exitCodeForError");
});
```

**Implementation:**
- Already defined in `errors.ts`
- Ensure `checkApproval` throws `ApprovalTimeoutError` on timeout (or exits directly)
- Verify `exitCodeForError` maps it correctly
