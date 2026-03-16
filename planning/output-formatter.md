# FE-08: Output Formatter

> **Priority:** P1
> **Source:** `src/output.ts`
> **Tests:** `tests/output.test.ts`
> **Reference:** `../apcore-cli-python/src/apcore_cli/output.py`
> **Dependencies:** None

## Overview

TTY-adaptive output formatting. When stdout is a TTY, render human-readable tables.
When piped, output JSON. Handles module lists, module detail, and execution results.

## Key Differences from Python

| Python | TypeScript |
|--------|-----------|
| `rich.table.Table` | Plain-text column-aligned tables (no heavy dep) |
| `rich.syntax.Syntax` | `JSON.stringify(obj, null, 2)` |
| `rich.console.Console` | `process.stdout.write()` |
| `sys.stdout.isatty()` | `process.stdout.isTTY` |
| `click.echo()` | `process.stdout.write()` / `console.log()` |
| `click.echo(err=True)` | `process.stderr.write()` |
| `dataclasses.asdict()` | Object spread / manual conversion |

## Tasks

### Task 1: resolveFormat() and truncate helper (RED → GREEN → REFACTOR)

**Tests:**
```typescript
describe("resolveFormat()", () => {
  it("returns explicit format when provided");
  it("returns 'table' when stdout is TTY and no explicit format");
  it("returns 'json' when stdout is not TTY and no explicit format");
});

describe("truncate()", () => {
  it("returns text unchanged when under max length");
  it("truncates and adds '...' when over max length");
  it("handles exact max length without truncation");
});
```

**Implementation:**
- `resolveFormat(explicitFormat?)` — already partially implemented
- `truncate(text, maxLength = 80)` — simple string truncation

### Task 2: formatModuleList() (RED → GREEN → REFACTOR)

**Tests:**
```typescript
describe("formatModuleList()", () => {
  it("outputs JSON array for json format");
  it("outputs plain-text table for table format");
  it("shows 'No modules found.' for empty list (table)");
  it("shows 'No modules found matching tags:' when filter active (table)");
  it("includes id, description, tags in each entry");
  it("truncates description at 80 chars in table format");
  it("outputs [] for empty list (json)");
});
```

**Implementation:**
- JSON: `JSON.stringify(modules.map(m => ({ id, description, tags })), null, 2)`
- Table: Column-aligned plain text with headers (ID | Description | Tags)
- Use `truncate()` for description column

### Task 3: formatModuleDetail() (RED → GREEN → REFACTOR)

**Tests:**
```typescript
describe("formatModuleDetail()", () => {
  it("outputs full JSON object for json format");
  it("outputs structured text for table format");
  it("includes input/output schemas when present");
  it("includes annotations (non-default values only)");
  it("includes extension metadata (x- prefixed fields)");
  it("includes tags when present");
  it("omits empty sections");
});
```

**Implementation:**
- JSON: serialize full module metadata object
- Table: sections — Description, Input Schema (pretty JSON), Output Schema, Annotations, Extension Metadata, Tags
- Annotations: filter out falsy/default values

### Task 4: formatExecResult() (RED → GREEN → REFACTOR)

**Tests:**
```typescript
describe("formatExecResult()", () => {
  it("outputs nothing for null result");
  it("outputs JSON for dict result when format is json");
  it("outputs key/value table for dict result when format is table");
  it("outputs JSON for array result regardless of format");
  it("outputs plain text for string result");
  it("outputs string representation for scalar result");
  it("uses resolveFormat() for TTY-adaptive default");
});
```

**Implementation:**
- `null` → no output
- Dict + table → key/value plain-text table
- Dict/Array + json → `JSON.stringify(result, null, 2)`
- String → direct output
- Other → `String(result)`
