# FE-04: Discovery

> **Priority:** P1
> **Source:** `src/discovery.ts`
> **Tests:** `tests/discovery.test.ts`
> **Reference:** `../apcore-cli-python/src/apcore_cli/discovery.py`
> **Dependencies:** FE-08 (Output Formatter)

## Overview

The `list` and `describe` built-in commands for module discovery. `list` shows all
registered modules with optional tag filtering (AND logic). `describe` shows full
metadata, schemas, and annotations for a single module.

## Key Differences from Python

| Python | TypeScript |
|--------|-----------|
| `@cli.command("list")` | `cli.command("list")` on Commander |
| `click.option("--tag", multiple=True)` | `cmd.option("--tag <tag>", "...", collect)` with custom collect fn |
| `click.argument("module_id")` | `cmd.argument("<module-id>")` |
| `click.Choice(["table", "json"])` | `cmd.option("--format <format>").choices(["table", "json"])` |

## Tasks

### Task 1: list command with tag filtering (RED → GREEN → REFACTOR)

**Tests:**
```typescript
describe("list command", () => {
  it("lists all modules from registry");
  it("filters modules by single tag (AND)");
  it("filters modules by multiple tags (AND logic)");
  it("outputs in table format");
  it("outputs in JSON format");
  it("uses TTY-adaptive default format");
  it("shows 'No modules found.' for empty registry");
  it("shows 'No modules found matching tags:' when filter yields empty");
  it("validates tag format (exits 2 on invalid)");
  it("accepts valid tags: lowercase alphanumeric + hyphens + underscores");
});
```

**Implementation:**
- Register `list` subcommand on Commander
- `--tag <tag>` option (repeatable → collected into array)
- `--format <format>` option with choices `["table", "json"]`
- Tag validation: `/^[a-z][a-z0-9_-]*$/`
- Filter: `modules.filter(m => filterTags.every(t => m.tags?.includes(t)))`
- Call `formatModuleList()` from output formatter

### Task 2: describe command (RED → GREEN → REFACTOR)

**Tests:**
```typescript
describe("describe command", () => {
  it("shows full metadata for a valid module ID");
  it("exits 44 when module not found");
  it("validates module ID format (exits 2 on invalid)");
  it("outputs in table format");
  it("outputs in JSON format");
  it("uses TTY-adaptive default format");
});
```

**Implementation:**
- Register `describe <module-id>` subcommand
- `--format <format>` option with choices `["table", "json"]`
- `validateModuleId()` → look up in registry → exit 44 if not found
- Call `formatModuleDetail()` from output formatter

### Task 3: registerDiscoveryCommands wiring (RED → GREEN → REFACTOR)

**Tests:**
```typescript
describe("registerDiscoveryCommands()", () => {
  it("adds 'list' and 'describe' as subcommands");
  it("list and describe are accessible via program.commands");
});
```

**Implementation:**
- `registerDiscoveryCommands(cli, registry)`:
  - Create list command, add to cli
  - Create describe command, add to cli
  - Wire registry into command actions
