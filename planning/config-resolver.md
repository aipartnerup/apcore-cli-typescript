# FE-07: Config Resolver

> **Priority:** P0 (Foundation)
> **Source:** `src/config.ts`
> **Tests:** `tests/config.test.ts`
> **Reference:** `../apcore-cli-python/src/apcore_cli/config.py`
> **Dependencies:** None

## Overview

4-tier configuration resolution: CLI flag > Environment variable > Config file (YAML) > Defaults.

The `ConfigResolver` class resolves configuration values using a strict precedence
hierarchy. Config files are loaded from `apcore.yaml` using `js-yaml`, flattened to
dot-separated keys, and cached for the lifetime of the resolver.

## Key Differences from Python

| Python | TypeScript |
|--------|-----------|
| `yaml.safe_load(f)` | `yaml.load(content, { schema: yaml.DEFAULT_SCHEMA })` |
| `open(path)` | `fs.readFileSync(path, 'utf-8')` |
| `os.environ.get()` | `process.env[key]` |
| `dict[str, Any]` | `Record<string, unknown>` |

## Tasks

### Task 1: ConfigResolver class and defaults (RED → GREEN → REFACTOR)

**Tests to write first:**
```typescript
describe("ConfigResolver", () => {
  it("returns default value when no other source provides one");
  it("returns undefined for unknown keys with no default");
  it("accepts custom defaults via constructor");
});
```

**Implementation:**
- `DEFAULTS` constant with all default values (already exists)
- `ConfigResolver` constructor accepting `cliFlags` and `configPath`
- `resolve(key)` returning `DEFAULTS[key]` as tier 4 fallback

### Task 2: resolve() with 4-tier precedence (RED → GREEN → REFACTOR)

**Tests to write first:**
```typescript
describe("resolve()", () => {
  it("returns CLI flag value (tier 1) when present");
  it("returns env var value (tier 2) when CLI flag absent");
  it("returns config file value (tier 3) when env and CLI absent");
  it("returns default (tier 4) when all else absent");
  it("CLI flag overrides env var");
  it("env var overrides config file");
  it("ignores null CLI flag values");
  it("ignores empty string env var values");
});
```

**Implementation:**
- Tier 1: Check `cliFlags[cliFlag ?? key]`, skip if `null`/`undefined`
- Tier 2: Check `process.env[envVar]`, skip if `undefined` or `""`
- Tier 3: Check cached config file value
- Tier 4: Return `DEFAULTS[key]`

### Task 3: Config file loading and flattening (RED → GREEN → REFACTOR)

**Tests to write first:**
```typescript
describe("config file loading", () => {
  it("loads and flattens nested YAML config");
  it("returns null for missing config file (no error)");
  it("returns null for malformed YAML (logs warning)");
  it("returns null for non-dict YAML (logs warning)");
  it("flattens nested keys to dot notation (e.g., 'logging.level')");
  it("resolves values from loaded config file");
});
```

**Implementation:**
- `_loadConfigFile()`: read file via `fs.readFileSync`, parse via `yaml.load()`
- Handle `ENOENT` → return `null`
- Handle YAML parse errors → log warning, return `null`
- `_flattenDict(obj, prefix)`: recursive flattening to dot-notation keys
- Cache result in `fileCache`
