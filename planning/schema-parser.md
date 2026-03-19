# FE-02: Schema Parser

> **Priority:** P0 (Foundation)
> **Source:** `src/schema-parser.ts`, `src/ref-resolver.ts`
> **Tests:** `tests/schema-parser.test.ts`, `tests/ref-resolver.test.ts`
> **Reference:** `../apcore-cli-python/src/apcore_cli/schema_parser.py`, `../apcore-cli-python/src/apcore_cli/ref_resolver.py`
> **Dependencies:** None

## Overview

Converts JSON Schema properties to Commander.js option configurations. Handles type
mapping, boolean flag pairs, enum choices, help text extraction, flag collision
detection, and reserved name collision. Also resolves `$ref`, `allOf`, `anyOf`, `oneOf`
in schemas before option generation.

## Key Differences from Python

| Python (Click) | TypeScript (Commander) |
|----------------|----------------------|
| `click.Option(["--flag"])` | `OptionConfig { flags: "--flag <value>" }` |
| `click.Choice(values)` | `OptionConfig { choices: values }` |
| `click.Path(exists=True)` | Flag with description hint (Commander has no Path type) |
| `_BOOLEAN_FLAG` sentinel | `isBooleanFlag: true` in OptionConfig |
| `option._enum_original_types` | `OptionConfig.enumOriginalTypes` map |
| `click.STRING/INT/FLOAT` | Parse functions: `String`, `parseInt`, `parseFloat` |

## Tasks

### Task 1: Basic type mapping (RED → GREEN → REFACTOR)

**Tests (schema-parser.test.ts):**
```typescript
describe("mapType()", () => {
  it("maps 'string' to string type");
  it("maps 'integer' to parseInt parser");
  it("maps 'number' to parseFloat parser");
  it("maps 'boolean' to boolean flag marker");
  it("maps 'object' to string type (serialized JSON)");
  it("maps 'array' to string type (serialized JSON)");
  it("defaults to string for unknown types");
  it("defaults to string when type is missing");
  it("detects file convention (_file suffix or x-cli-file)");
});
```

**Implementation:**
- `mapType(propName, propSchema)` → returns type identifier or parser function reference
- File convention: property name ends with `_file` or has `x-cli-file: true`

### Task 2: schemaToCommanderOptions — property iteration (RED → GREEN → REFACTOR)

**Tests:**
```typescript
describe("schemaToCommanderOptions()", () => {
  it("returns empty array for schema with no properties");
  it("generates option for string property");
  it("generates option for integer property");
  it("generates option for number property");
  it("converts underscore to hyphen in flag names");
  it("marks required fields with [required] in help text");
  it("does NOT set required=true at Commander level (STDIN compatibility)");
  it("uses property default value");
});
```

**Implementation:**
- Iterate `schema.properties`, generate `OptionConfig` for each
- Flag name: `--` + property name with `_` → `-`
- Required annotation in help text only (not Commander enforcement)
- Default from `schema.properties[name].default`

### Task 3: Boolean flags and enum choices (RED → GREEN → REFACTOR)

**Tests:**
```typescript
describe("boolean and enum handling", () => {
  it("generates --flag/--no-flag pair for boolean type");
  it("uses boolean default from schema (default: false)");
  it("generates choices for enum values");
  it("converts enum values to strings for Commander choices");
  it("handles empty enum array gracefully");
  it("stores original enum types for reconversion");
});
```

**Implementation:**
- Boolean: flags string `"--flag, --no-flag"`, default from schema
- Enum: `choices: enum.map(String)`, store original types map
- Empty enum: fall back to plain string option

### Task 4: Help text extraction and flag collision detection (RED → GREEN → REFACTOR)

**Tests:**
```typescript
describe("help text and collisions", () => {
  it("extracts help from x-llm-description (preferred)");
  it("falls back to description");
  it("truncates help text at 1000 chars (default)");
  it("returns undefined help when no description");
  it("exits 48 on flag name collision");
  it("exits 2 on reserved name collision (input, yes, format, sandbox, largeInput)");
});
```

**Implementation:**
- `extractHelp(propSchema, maxLength)` → check `x-llm-description`, then `description`, truncate at configurable limit (default 1000)
- Collision map: track `flagName → propName`, error on duplicate
- Reserved names: `input`, `yes`, `largeInput`, `format`, `sandbox`

### Task 5: $ref resolution (RED → GREEN → REFACTOR)

**Tests (ref-resolver.test.ts):**
```typescript
describe("resolveRefs()", () => {
  it("returns schema unchanged when no $refs");
  it("inlines a simple $ref from $defs");
  it("inlines a simple $ref from definitions");
  it("removes $defs and definitions from result");
  it("resolves nested $refs recursively");
  it("exits 48 on circular $ref");
  it("exits 48 when depth exceeds maxDepth");
  it("exits 45 on unresolvable $ref");
});
```

**Implementation:**
- `resolveRefs(schema, maxDepth, moduleId)` → deep clone, resolve, strip defs
- `_resolveNode(node, defs, visited, depth, maxDepth, moduleId)`:
  - `$ref`: parse path, check visited/depth, inline from defs
  - Recursively process `properties`
- Exit codes: 48 (circular/depth), 45 (unresolvable)

### Task 6: allOf / anyOf / oneOf composition (RED → GREEN → REFACTOR)

**Tests:**
```typescript
describe("schema composition", () => {
  it("merges allOf: combines properties and required");
  it("merges anyOf: combines properties, intersects required");
  it("merges oneOf: combines properties, intersects required");
  it("copies non-composition keys from parent node");
  it("resolves $refs within composition branches");
});
```

**Implementation:**
- `allOf`: merge all properties, concatenate required
- `anyOf`/`oneOf`: merge all properties, **intersect** required
- Copy non-keyword keys from parent

### Task 7: reconvertEnumValues (RED → GREEN → REFACTOR)

**Tests:**
```typescript
describe("reconvertEnumValues()", () => {
  it("converts string '42' back to number for numeric enum");
  it("converts string '3.14' back to float for float enum");
  it("converts string 'true' back to boolean");
  it("leaves non-enum values unchanged");
  it("handles null/undefined values gracefully");
});
```

**Implementation:**
- Iterate options with `enumOriginalTypes`
- Match string value → original type → cast (parseInt, parseFloat, boolean parse)
