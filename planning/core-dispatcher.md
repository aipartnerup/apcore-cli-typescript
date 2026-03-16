# FE-01: Core Dispatcher

> **Priority:** P0 (Core — implements after foundation features)
> **Source:** `src/main.ts`, `src/cli.ts`
> **Tests:** `tests/cli.test.ts`
> **Reference:** `../apcore-cli-python/src/apcore_cli/cli.py`, `../apcore-cli-python/src/apcore_cli/__main__.py`
> **Dependencies:** FE-07 (Config), FE-02 (Schema), FE-03 (Approval), FE-08 (Output)

## Overview

The core dispatcher is the CLI orchestration layer. It creates the Commander program,
lazily loads apcore modules as subcommands via `LazyModuleGroup`, builds Commander
commands from module input schemas, collects input from STDIN and CLI flags, validates
input, checks approval, executes modules (optionally sandboxed), logs audit entries, and
formats output.

## Key Differences from Python

| Python (Click) | TypeScript (Commander) |
|----------------|----------------------|
| `click.Group(cls=LazyModuleGroup)` | Manual command registration on `program` |
| `@click.option(...)` | `cmd.option(flags, desc, parser)` |
| `click.Command(callback=fn)` | `cmd.action(fn)` |
| `click.echo(err=True)` | `process.stderr.write(msg + '\n')` |
| `sys.stdin.read()` | `await readStdin()` (stream-based) |
| `jsonschema.validate()` | `ajv.validate(schema, data)` |
| Sync execution | Async action handlers |

## Tasks

### Task 1: LazyModuleGroup — listCommands and getCommand (RED → GREEN → REFACTOR)

**Tests:**
```typescript
describe("LazyModuleGroup", () => {
  it("lists builtin command names + module IDs from registry");
  it("returns sorted, deduplicated command list");
  it("returns null for unknown command name");
  it("returns cached command on second call");
  it("looks up module in registry and builds command");
  it("handles registry.listModules() throwing gracefully");
});
```

**Implementation:**
- `BUILTIN_COMMANDS = ["list", "describe", "completion", "man"]`
- `listCommands()`: merge builtins + `registry.listModules().map(m => m.id)`, sort, dedupe
- `getCommand(name)`: check cache → check registry → call `buildModuleCommand()` → cache
- Graceful error handling on registry failures

### Task 2: buildModuleCommand — schema to Commander command (RED → GREEN → REFACTOR)

**Tests:**
```typescript
describe("buildModuleCommand()", () => {
  it("creates a Commander command with module ID as name");
  it("sets module description as command help");
  it("adds schema-generated options from input_schema");
  it("adds built-in options (--input, --yes, --format, --sandbox, --large-input)");
  it("handles module with no input_schema");
  it("handles module with empty properties");
  it("exits 2 when schema property name conflicts with reserved option");
  it("resolves $refs in schema before generating options");
});
```

**Implementation:**
- Extract `inputSchema` from `moduleDef` (handle dict schemas)
- Resolve `$ref`s via `resolveRefs()`
- Generate options via `schemaToCommanderOptions()`
- Add built-in options: `--input`, `--yes/-y`, `--large-input`, `--format`, `--sandbox`
- Reserved name collision check before adding schema options
- Set `cmd.action(callback)` (wired in Task 6)

### Task 3: collectInput — STDIN + CLI merge (RED → GREEN → REFACTOR)

**Tests:**
```typescript
describe("collectInput()", () => {
  it("returns CLI kwargs when no stdin flag");
  it("reads STDIN JSON when flag is '-'");
  it("merges STDIN and CLI (CLI wins on conflict)");
  it("exits 2 when STDIN exceeds 10MB without --large-input");
  it("allows large STDIN when --large-input is true");
  it("exits 2 when STDIN is not valid JSON");
  it("exits 2 when STDIN JSON is not an object");
  it("handles empty STDIN gracefully");
  it("strips null/undefined CLI kwargs");
});
```

**Implementation:**
- `collectInput(stdinFlag, cliKwargs, largeInput)` → async
- Read stdin: `await readStdin()` — collect chunks from `process.stdin`
- Size check: encode to UTF-8, compare against 10MB limit
- Parse JSON, validate is object
- Merge: `{ ...stdinData, ...cliKwargsNonNull }`

### Task 4: validateModuleId (RED → GREEN → REFACTOR)

**Tests:**
```typescript
describe("validateModuleId()", () => {
  it("accepts valid module IDs (e.g., 'math.add')");
  it("accepts single-segment IDs (e.g., 'health')");
  it("exits 2 for IDs exceeding 128 characters");
  it("exits 2 for IDs with invalid characters");
  it("exits 2 for IDs starting with a digit");
  it("exits 2 for IDs with consecutive dots");
  it("exits 2 for empty string");
});
```

**Implementation:**
- Max length: 128 characters
- Pattern: `/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/`
- Exit 2 on failure with descriptive error to stderr

### Task 5: createCli — full wiring (RED → GREEN → REFACTOR)

**Tests:**
```typescript
describe("createCli()", () => {
  it("creates a Commander program with given name");
  it("sets version option");
  it("adds --extensions-dir option");
  it("adds --log-level option");
  it("exits 47 when extensions directory does not exist");
  it("exits 47 when extensions directory is not readable");
  it("initializes registry and executor from extensions dir");
  it("registers discovery commands");
  it("registers shell commands");
  it("initializes audit logger");
});
```

**Implementation:**
- `createCli(extensionsDir?, progName?)`:
  - Resolve extensions dir via `ConfigResolver`
  - Pre-parse `--extensions-dir` from `process.argv`
  - Validate directory exists and is readable
  - Create `Registry` and `Executor` from apcore-js
  - Initialize `AuditLogger`
  - Build Commander program with global options
  - Register `LazyModuleGroup` commands
  - Register discovery and shell commands
- Log level: 3-tier (CLI flag > `APCORE_CLI_LOGGING_LEVEL` > `APCORE_LOGGING_LEVEL` > WARNING)

### Task 6: Module execution callback (RED → GREEN → REFACTOR)

**Tests:**
```typescript
describe("module execution callback", () => {
  it("collects input from STDIN and CLI flags");
  it("reconverts enum values");
  it("validates input against schema (exits 45 on failure)");
  it("checks approval gate before execution");
  it("executes module via executor");
  it("supports sandbox execution");
  it("logs audit entry on success");
  it("logs audit entry on error");
  it("formats result using output formatter");
  it("maps apcore error codes to CLI exit codes");
  it("exits 130 on Ctrl-C / SIGINT");
});
```

**Implementation:**
- Action handler callback for each module command:
  1. Separate built-in options from schema kwargs
  2. `collectInput(stdinFlag, kwargs, largeInput)`
  3. `reconvertEnumValues(merged, options)`
  4. Validate with Ajv: `ajv.validate(schema, merged)` → exit 45 on failure
  5. `checkApproval(moduleDef, autoApprove)`
  6. `sandbox.execute(moduleId, merged, executor)` with timing
  7. Audit log (success)
  8. `formatExecResult(result, format)`
  9. Error handling: map error codes → exit codes
  10. SIGINT handler → exit 130

**Error code mapping:**
```typescript
const ERROR_CODE_MAP: Record<string, number> = {
  MODULE_NOT_FOUND: 44,
  MODULE_LOAD_ERROR: 44,
  MODULE_DISABLED: 44,
  SCHEMA_VALIDATION_ERROR: 45,
  SCHEMA_CIRCULAR_REF: 48,
  APPROVAL_DENIED: 46,
  APPROVAL_TIMEOUT: 46,
  CONFIG_NOT_FOUND: 47,
  CONFIG_INVALID: 47,
  MODULE_EXECUTE_ERROR: 1,
  MODULE_TIMEOUT: 1,
  ACL_DENIED: 77,
};
```
