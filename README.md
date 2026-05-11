<div align="center">
  <img src="https://raw.githubusercontent.com/aiperceivable/apcore-cli/main/apcore-cli-logo.svg" alt="apcore-cli logo" width="200"/>
</div>

# apcore-cli

Terminal adapter for apcore. Execute AI-Perceivable modules from the command line.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-18%2B-blue.svg)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-275%2B%20passed-brightgreen.svg)]()

| | |
|---|---|
| **TypeScript SDK** | [github.com/aiperceivable/apcore-cli-typescript](https://github.com/aiperceivable/apcore-cli-typescript) |
| **Python SDK** | [github.com/aiperceivable/apcore-cli-python](https://github.com/aiperceivable/apcore-cli-python) |
| **Spec repo** | [github.com/aiperceivable/apcore-cli](https://github.com/aiperceivable/apcore-cli) |
| **apcore core** | [github.com/aiperceivable/apcore](https://github.com/aiperceivable/apcore) |

**apcore-cli** turns any [apcore](https://github.com/aiperceivable/apcore)-based project into a fully featured CLI tool — with **zero code changes** to your existing modules.

```
┌──────────────────┐
│  nestjs-apcore   │  <- your existing apcore project (unchanged)
│  express-apcore  │
│  ...             │
└────────┬─────────┘
         │  extensions directory
         v
┌──────────────────┐
│   apcore-cli     │  <- just install & point to extensions dir
└───┬──────────┬───┘
    │          │
    v          v
 Terminal    Unix
 Commands    Pipes
```

## Design Philosophy

- **Zero intrusion** -- your apcore project needs no code changes, no imports, no dependencies on apcore-cli
- **Zero configuration** -- point to an extensions directory, everything is auto-discovered
- **Pure adapter** -- apcore-cli reads from the apcore Registry; it never modifies your modules
- **Unix-native** -- JSON output for pipes, rich tables for terminals, STDIN input, shell completions

## Installation

```bash
pnpm add apcore-cli apcore-js
```

Requires Node.js 18+, `apcore-js >= 0.21.0`, and `apcore-toolkit >= 0.7.0`.

**v0.9.0 breaking change:** `apcore-toolkit` is now a **required** peer dependency (previously optional). All `--format` operations route through the toolkit's byte-equivalent reference implementations for csv / jsonl / markdown / skill. See [tech-design ADR-09](https://github.com/aiperceivable/apcore-cli/blob/main/docs/tech-design.md) for the rationale and migration notes.

```bash
pnpm add apcore-cli apcore-js apcore-toolkit
```

## Quick Start

### Zero-code approach

If you already have an apcore-based project with an extensions directory:

```bash
# Execute a module
apcore-cli --extensions-dir ./extensions math.add --a 42 --b 58

# Or set the env var once
export APCORE_EXTENSIONS_ROOT=./extensions
apcore-cli math.add --a 42 --b 58
```

All modules are auto-discovered. CLI flags are auto-generated from each module's JSON Schema.

### Programmatic approach (TypeScript API)

```typescript
import { createCli } from "apcore-cli";

// Build the CLI from an extensions directory (auto-discovers modules)
const cli = createCli("./extensions");
cli.parse(process.argv);
```

#### Pre-populated registry

Frameworks that register modules at runtime can pass a pre-populated `Registry` directly via `CreateCliOptions`, skipping filesystem discovery entirely:

```typescript
import { createCli } from "apcore-cli";
import type { CreateCliOptions } from "apcore-cli";

// registry and executor are already populated by your framework
const cli = createCli({
  registry,
  executor,
  progName: "myapp",
});
cli.parse(process.argv);
```

Or wire the `createCli` options-object form directly with a runtime-supplied registry/executor:

```typescript
import { createCli } from "apcore-cli";

async function main() {
  // Obtain registry/executor from your apcore-js setup
  // (e.g., via ExtensionsLoader or your framework's module discovery).
  // See apcore-js docs for the exact bootstrap API.
  const { registry, executor } = await bootstrapApcoreRuntime("./extensions");

  const cli = createCli({
    registry,
    executor,
    progName: "myapp",
    // expose: { mode: "include", include: ["admin.*"] },
    // apcli: { mode: "exclude", exclude: ["init"] },  // hide init from the apcli group
    // apcli: false,                                    // or hide the entire apcli group
    // extraCommands: [customCmd1, customCmd2],
  });
  cli.parse(process.argv);
}

main();
```

> **Known gap:** The `Registry`, `Executor`, and `ModuleDescriptor` types re-exported by `apcore-cli` are currently **local placeholder interfaces** pending upstream export from `apcore-js`. Direct construction (`new Registry(...)` / `new Executor(registry)`) is **not supported** at this version. Structural typing allows runtime apcore-js objects to satisfy these interfaces, so `createCli({ registry, executor })` works when you pass in objects produced by your apcore-js runtime.

## Integration with Existing Projects

### Typical apcore project structure

```
your-project/
├── extensions/          <- modules live here
│   ├── math/
│   │   └── add.ts
│   ├── text/
│   │   └── upper.ts
│   └── ...
├── your_app.ts          <- your existing code (untouched)
└── ...
```

### Adding CLI support

No changes to your project. Just install and run:

```bash
pnpm add apcore-cli apcore-js
apcore-cli --extensions-dir ./extensions list
apcore-cli --extensions-dir ./extensions math.add --a 5 --b 10
```

### STDIN piping (Unix pipes)

```bash
# Pipe JSON input
echo '{"a": 100, "b": 200}' | apcore-cli math.add --input -
# {"sum": 300}

# CLI flags override STDIN values
echo '{"a": 1, "b": 2}' | apcore-cli math.add --input - --a 999
# {"sum": 1001}

# Chain with other tools
apcore-cli sysutil.info | jq '.os, .hostname'
```

## CLI Reference

```
apcore-cli [OPTIONS] COMMAND [ARGS]
```

### Global Options

| Option | Default | Description |
|--------|---------|-------------|
| `--extensions-dir` | `./extensions` | Path to apcore extensions directory |
| `--log-level` | `WARNING` | Logging: `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `--version` | | Show version and exit |
| `--help` | | Show help and exit |
| `--verbose` | | Show all options in help (including built-in options) |
| `--man` | | Output man page in roff format (use with `--help`) |

### Built-in Commands (the `apcli` group)

Starting in **v0.7.0**, all built-in commands live under an `apcli` sub-group
(see the `RESERVED_GROUP_NAMES` collision surface in `src/builtin-group.ts`).
Invocation:

```bash
apcore-cli apcli list
apcore-cli apcli describe math.add
apcore-cli apcli exec math.add --a 5 --b 10
```

> **Migration note (v0.8):** Root-level built-ins (`apcore-cli list`, `apcore-cli describe`, …) were removed in v0.8 — use `<cli> apcli <subcommand>`.
> Only the `apcli` group is supported; legacy root-level shims have been retired.
> Embedded integrations (host CLIs that inject a `registry`) never had root-level
> built-ins in the first place. See the full migration timeline in the spec repo:
> [`docs/features/builtin-group.md §11 Migration`](../apcore-cli/docs/features/builtin-group.md#11-migration).

The canonical 13 `apcli` subcommands:

**Module invocation & discovery**

| Command | Description |
|---------|-------------|
| `apcli list` | List available modules with search, status, tag/annotation filters, sort, and dependency inspection (see `registerListCommand` in `src/discovery.ts`) |
| `apcli describe <module_id>` | Show full module metadata, schemas, and annotations (see `registerDescribeCommand` in `src/discovery.ts`) |
| `apcli describe-pipeline <module_id>` | Inspect the execution pipeline for a module (strategies, hooks, middleware; see `registerPipelineCommand` in `src/strategy.ts`) |
| `apcli exec <module_id>` | Internal routing alias for module execution (see `registerExecCommand` in `src/discovery.ts`) |
| `apcli usage <module_id>` | Show usage examples and flag hints for a module (see `registerUsageCommand` in `src/system-cmd.ts`) |

**System management**

| Command | Description |
|---------|-------------|
| `apcli config` | Inspect effective configuration and precedence (see `registerConfigCommand` in `src/system-cmd.ts`) |
| `apcli health` | Run health checks on registry, executor, config, and auth (see `registerHealthCommand` in `src/system-cmd.ts`) |
| `apcli reload` | Reload registry / rediscover extensions (see `registerReloadCommand` in `src/system-cmd.ts`) |
| `apcli enable <module_id>` | Enable a disabled module (see `registerEnableCommand` in `src/system-cmd.ts`) |
| `apcli disable <module_id>` | Disable a module without removing it (see `registerDisableCommand` in `src/system-cmd.ts`) |

**Workflow**

| Command | Description |
|---------|-------------|
| `apcli init module <id>` | Scaffold a new module (TS/JS/YAML binding) into the extensions or commands directory (see `registerInitCommand` in `src/init-cmd.ts`) |
| `apcli validate` | Validate modules and configuration against JSON Schema (see `registerValidateCommand` in `src/discovery.ts`) |

**Shell integration**

| Command | Description |
|---------|-------------|
| `apcli completion <shell>` | Generate shell completion script for bash / zsh / fish (see `registerCompletionCommand` in `src/shell.ts`) |
| `man [command]` (root) | Generate a man page in roff format for a single command or the whole program (see `configureManHelp` in `src/shell.ts`). Stays at the root (meta-command). |

#### Standalone vs. embedded surfaces

| Mode | Invocation | Notes |
|------|------------|-------|
| **Standalone** (`apcore-cli`) | `apcore-cli apcli <subcommand>` | Discovery flags (`--extensions-dir`, `--commands-dir`, `--binding`) are registered. Only the `apcli` group is supported (legacy root-level shims were removed in v0.8). |
| **Embedded** (`createCli({ registry, … })`) | `<host-cli> apcli <subcommand>` | Discovery flags are gated off (injected registry already supplies modules). Only the `apcli` group is supported. |

### Module Execution Options

When executing a module (e.g. `apcore-cli math.add`), these built-in options are available (hidden by default; use `--verbose` to show in `--help`):

| Option | Description |
|--------|-------------|
| `--input -` | Read JSON input from STDIN |
| `--yes` / `-y` | Bypass approval prompts |
| `--large-input` | Allow STDIN input larger than 10MB |
| `--format <fmt>` | Output format: `json`, `table`, `csv`, `yaml`, `jsonl`, `markdown`, `skill`. **v0.9.0:** `csv` / `jsonl` are byte-identical across SDKs via `apcore-toolkit.formatCsv` / `formatJsonl`. Fixes the prior heterogeneous-keys data-loss bug (header was derived from first row only). |
| `--sandbox` | Run module in a subprocess sandbox (re-exec with stripped env; 64MiB stdout/stderr cap; 300s default timeout). Hidden by default — set `APCORE_CLI_SANDBOX=1` to enable globally. |
| `--dry-run` | Run preflight checks (schema, ACL, approval) without executing (FE-11) |
| `--trace` | Emit execution pipeline trace (strategy, hooks, middleware timings) |
| `--stream` | Stream results line-by-line for stream-capable modules |
| `--strategy <name>` | Override execution strategy: `standard`, `internal`, `testing`, `performance`, or `minimal` |
| `--fields <csv>` | Select output fields via dot-path notation (e.g. `result.sum,meta.duration`) |
| `--approval-timeout <seconds>` | Override approval timeout (default `60`) |
| `--approval-token <token>` | Provide a pre-obtained approval token (bypasses interactive prompt) |

Schema-generated flags (e.g. `--a`, `--b`) are added automatically from the module's `input_schema`.

#### `list` command flags (v0.6.0)

The `list` command supports enhanced filtering and inspection flags:

| Option | Description |
|--------|-------------|
| `--search <query>` | Fuzzy search across module IDs, descriptions, and annotations |
| `--status <state>` | Filter by status (e.g. `enabled`, `disabled`, `deprecated`) |
| `--annotation <key=value>` | Filter by an annotation key/value pair |
| `--sort <field>` | Sort by `name`, `status`, or other indexed fields |
| `--reverse` | Reverse sort order |
| `--deprecated` | Include deprecated modules in the output |
| `--deps` | Show dependency graph for each module |

### Exit Codes

The exit codes below are also exported as the `EXIT_CODES` const-object from `apcore-cli` (canonical source: `src/errors.ts`) and are mapped from thrown errors via `exitCodeForError()`.

| Code | `EXIT_CODES` key | Meaning |
|------|------------------|---------|
| `0` | `SUCCESS` | Success |
| `1` | `MODULE_EXECUTE_ERROR` / `MODULE_TIMEOUT` | Module execution error |
| `2` | `INVALID_CLI_INPUT` | Invalid CLI input |
| `44` | `MODULE_NOT_FOUND` / `MODULE_LOAD_ERROR` / `MODULE_DISABLED` / `DEPENDENCY_NOT_FOUND` / `DEPENDENCY_VERSION_MISMATCH` | Module not found / disabled / load error |
| `45` | `SCHEMA_VALIDATION_ERROR` | Schema validation error |
| `46` | `APPROVAL_DENIED` / `APPROVAL_TIMEOUT` | Approval denied or timed out |
| `47` | `CONFIG_NOT_FOUND` / `CONFIG_INVALID` | Configuration error |
| `48` | `SCHEMA_CIRCULAR_REF` | Schema circular reference |
| `77` | `ACL_DENIED` | ACL denied |
| `130` | *(no key — set by signal handler)* | Execution cancelled (Ctrl+C) |

## Configuration

apcore-cli uses a 4-tier configuration precedence:

1. **CLI flag** (highest): `--extensions-dir ./custom`
2. **Environment variable**: `APCORE_EXTENSIONS_ROOT=./custom`
3. **Config file**: `apcore.yaml`
4. **Default** (lowest): `./extensions`

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `APCORE_EXTENSIONS_ROOT` | Path to extensions directory | `./extensions` |
| `APCORE_CLI_AUTO_APPROVE` | Set to `1` to bypass all approval prompts | *(unset)* |
| `APCORE_CLI_LOGGING_LEVEL` | CLI-specific log level (takes priority over `APCORE_LOGGING_LEVEL`) | `WARNING` |
| `APCORE_LOGGING_LEVEL` | Global apcore log level (fallback when `APCORE_CLI_LOGGING_LEVEL` is unset) | `WARNING` |
| `APCORE_AUTH_API_KEY` | API key for remote registry authentication | *(unset)* |
| `APCORE_CLI_SANDBOX` | Set to `1` to enable subprocess sandboxing | *(unset)* |
| `APCORE_CLI_HELP_TEXT_MAX_LENGTH` | Maximum characters for CLI option help text before truncation | `1000` |
| `APCORE_CLI_APPROVAL_TIMEOUT` | Default approval prompt timeout in seconds | `60` |
| `APCORE_CLI_STRATEGY` | Default execution strategy (`standard`, `internal`, `testing`, `performance`, `minimal`) | `standard` |
| `APCORE_CLI_GROUP_DEPTH` | Maximum nesting depth when rendering grouped module command trees | `2` |
| `APCORE_CLI_APCLI` | Override apcli group visibility (Tier 2). Accepts `show`/`1`/`true` → all, `hide`/`0`/`false` → none. Sealed by `apcli.disable_env: true`. | *(unset)* |

### Config File (`apcore.yaml`)

```yaml
extensions:
  root: ./extensions
logging:
  level: DEBUG
sandbox:
  enabled: false
cli:
  help_text_max_length: 1000
  approval_timeout: 60      # seconds
  strategy: standard        # standard | internal | testing | performance | minimal
  group_depth: 2            # grouped-module command-tree nesting depth
apcli:                      # built-in command group visibility (FE-13)
  mode: all                 # all | none | include | exclude
  include: []               # subcommand allowlist when mode=include
  exclude: []               # subcommand denylist when mode=exclude
  disable_env: false        # set true to seal Tier 2 (APCORE_CLI_APCLI env var)
```

## Features

- **Auto-discovery** -- all modules in the extensions directory are found and exposed as CLI commands
- **Auto-generated flags** -- JSON Schema `input_schema` is converted to `--flag value` CLI options with type validation
- **Boolean flag pairs** -- `--verbose` / `--no-verbose` from `"type": "boolean"` schema properties
- **Enum choices** -- `"enum": ["json", "csv"]` becomes `--format json` with Commander validation
- **STDIN piping** -- `--input -` reads JSON from STDIN, CLI flags override for duplicate keys
- **TTY-adaptive output** -- rich tables for terminals, JSON for pipes (configurable via `--format`)
- **Approval gate** -- TTY-aware HITL prompts for modules with `requires_approval: true`, with `--yes` bypass and 60s timeout
- **Schema validation** -- inputs validated against JSON Schema before execution, with `$ref`/`allOf`/`anyOf`/`oneOf` resolution
- **Security** -- API key auth (keyring + AES-256-GCM), append-only audit logging, subprocess sandboxing (re-exec model, env stripping, 64MiB output cap)
- **Shell completions** -- `apcore-cli completion bash|zsh|fish` generates completion scripts with dynamic module ID completion
- **Man pages** -- `apcore-cli man <command>` for single commands, or `--help --man` for a complete program man page. `configureManHelp()` provides one-line integration for downstream projects
- **Documentation URL** -- `setDocsUrl()` adds doc links to help footers and man pages
- **Audit logging** -- all executions logged to `~/.apcore-cli/audit.jsonl` with SHA-256 input hashing

## How It Works

### Mapping: apcore to CLI

| apcore | CLI |
|--------|-----|
| `module_id` (`math.add`) | Command name (`apcore-cli math.add`) |
| `description` | `--help` text |
| `input_schema.properties` | CLI flags (`--a`, `--b`) |
| `input_schema.required` | Validated post-collection via ajv (required fields shown as `[required]` in `--help`) |
| `annotations.requires_approval` | HITL approval prompt |

### Architecture

```
User / AI Agent (terminal)
    |
    v
apcore-cli (the adapter)
    |
    +-- ConfigResolver       4-tier config precedence
    +-- LazyModuleGroup      Dynamic Commander command generation
    +-- schema_parser        JSON Schema -> Commander options
    +-- ref_resolver         $ref / allOf / anyOf / oneOf
    +-- approval             TTY-aware HITL approval
    +-- output               TTY-adaptive JSON/table output
    +-- AuditLogger          JSON Lines execution logging
    +-- Sandbox              Subprocess isolation (re-exec, env stripped, output capped)
    |
    v
apcore Registry + Executor (your modules, unchanged)
```

## API Overview

**Classes:** `LazyModuleGroup`, `GroupedModuleGroup`, `ApcliGroup`, `ExposureFilter`, `CliApprovalHandler`, `ConfigResolver`, `AuthProvider`, `ConfigEncryptor`, `AuditLogger`, `Sandbox`

**Interfaces:** `CreateCliOptions`, `Registry`, `Executor`, `ModuleDescriptor`, `APCore`, `ApcliConfig`, `ApcliMode`, `StrategyInfo`, `StrategyStep`

**Functions:** `createCli`, `main`, `buildModuleCommand`, `validateModuleId`, `collectInput`, `schemaToCliOptions`, `reconvertEnumValues`, `resolveRefs`, `checkApproval`, `formatExecResult`, `registerListCommand`, `registerDescribeCommand`, `registerExecCommand`, `registerValidateCommand`, `registerHealthCommand`, `registerUsageCommand`, `registerEnableCommand`, `registerDisableCommand`, `registerReloadCommand`, `registerConfigCommand`, `registerCompletionCommand`, `registerPipelineCommand`, `registerInitCommand`, `setAuditLogger`, `getAuditLogger`, `setVerboseHelp`, `setDocsUrl`, `configureManHelp`, `exitCodeForError`

**Errors:** `ApprovalTimeoutError`, `ApprovalDeniedError`, `AuthenticationError`, `ConfigDecryptionError`, `ModuleExecutionError`, `ModuleNotFoundError`, `SchemaValidationError`

## Development

The conformance suite under `tests/conformance/` reads shared fixtures from
the **spec repo** (`aiperceivable/apcore-cli`). Clone it as a sibling of
this repo, or point `APCORE_CLI_SPEC_REPO` at an existing checkout:

```bash
# One-time: clone both repos side by side
git clone https://github.com/aiperceivable/apcore-cli.git
git clone https://github.com/aiperceivable/apcore-cli-typescript.git

cd apcore-cli-typescript
pnpm install
pnpm test                        # reads fixtures from ../apcore-cli/conformance/
pnpm build                       # compile TypeScript
```

Alternative layout (spec repo checked out elsewhere):

```bash
export APCORE_CLI_SPEC_REPO=/path/to/apcore-cli
pnpm test
```

CI does this automatically — see `.github/workflows/ci.yml`.

## License

Apache-2.0
