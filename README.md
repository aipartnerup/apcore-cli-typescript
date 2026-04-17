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

Requires Node.js 18+ and `apcore-js >= 0.17.1`.

**Optional:** install `apcore-toolkit` (>=0.4.0) to enable display overlay and registry writer integration via `applyToolkitIntegration`, `DisplayResolver`, and `RegistryWriter`.

```bash
pnpm add apcore-cli apcore-js
pnpm add -D apcore-toolkit  # optional, for display overlay / registry writer
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
| `--verbose` | | Show all options in help (including built-in apcore options) |
| `--man` | | Output man page in roff format (use with `--help`) |

### Built-in Commands

The canonical 14 built-in commands (see `BUILTIN_COMMANDS` in `src/cli.ts`):

**Module invocation & discovery**

| Command | Description |
|---------|-------------|
| `list` | List available modules with search, status, tag/annotation filters, sort, and dependency inspection (see `src/commands/list-cmd.ts`) |
| `describe <module_id>` | Show full module metadata, schemas, and annotations (see `src/commands/describe-cmd.ts`) |
| `describe-pipeline <module_id>` | Inspect the execution pipeline for a module (strategies, hooks, middleware; see `src/commands/describe-pipeline-cmd.ts`) |
| `exec <module_id>` | Internal routing alias for module execution (see `src/commands/exec-cmd.ts`) |
| `usage <module_id>` | Show usage examples and flag hints for a module (see `src/commands/usage-cmd.ts`) |

**System management**

| Command | Description |
|---------|-------------|
| `config` | Inspect effective configuration and precedence (see `src/commands/system-cmd.ts`) |
| `health` | Run health checks on registry, executor, config, and auth (see `src/commands/system-cmd.ts`) |
| `reload` | Reload registry / rediscover extensions (see `src/commands/system-cmd.ts`) |
| `enable <module_id>` | Enable a disabled module (see `src/commands/system-cmd.ts`) |
| `disable <module_id>` | Disable a module without removing it (see `src/commands/system-cmd.ts`) |

**Workflow**

| Command | Description |
|---------|-------------|
| `init` | Scaffold a starter `apcore.yaml` / extensions layout (see `src/commands/init-cmd.ts`) |
| `validate` | Validate modules and configuration against JSON Schema (see `src/commands/validate-cmd.ts`) |

**Shell integration**

| Command | Description |
|---------|-------------|
| `completion <shell>` | Generate shell completion script for bash / zsh / fish (see `src/commands/completion-cmd.ts`) |
| `man [command]` | Generate a man page in roff format for a single command or the whole program (see `src/man.ts`) |

### Module Execution Options

When executing a module (e.g. `apcore-cli math.add`), these built-in options are available (hidden by default; use `--verbose` to show in `--help`):

| Option | Description |
|--------|-------------|
| `--input -` | Read JSON input from STDIN |
| `--yes` / `-y` | Bypass approval prompts |
| `--large-input` | Allow STDIN input larger than 10MB |
| `--format <fmt>` | Output format: `json`, `table`, `csv`, `yaml`, or `jsonl` |
| `--sandbox` | Run module in subprocess sandbox (not yet implemented — always hidden) |
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

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Module execution error |
| `2` | Invalid CLI input |
| `44` | Module not found / disabled / load error |
| `45` | Schema validation error |
| `46` | Approval denied or timed out |
| `47` | Configuration error |
| `48` | Schema circular reference |
| `77` | ACL denied |
| `130` | Execution cancelled (Ctrl+C) |

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
- **Security** -- API key auth (keyring + AES-256-GCM), append-only audit logging, subprocess sandboxing (stub — not yet runnable)
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
    +-- Sandbox              Subprocess isolation (stub — not yet runnable)
    |
    v
apcore Registry + Executor (your modules, unchanged)
```

## API Overview

**Classes:** `LazyModuleGroup`, `ConfigResolver`, `AuthProvider`, `ConfigEncryptor`, `AuditLogger`, `Sandbox`

**Interfaces:** `CreateCliOptions`, `Registry`, `Executor`, `ModuleDescriptor`

**Functions:** `createCli`, `main`, `buildModuleCommand`, `validateModuleId`, `collectInput`, `schemaToCliOptions`, `reconvertEnumValues`, `resolveRefs`, `checkApproval`, `resolveFormat`, `formatModuleList`, `formatModuleDetail`, `formatExecResult`, `registerDiscoveryCommands`, `registerShellCommands`, `setAuditLogger`, `getAuditLogger`, `setVerboseHelp`, `setDocsUrl`, `buildProgramManPage`, `configureManHelp`, `exitCodeForError`, `mapType`, `extractHelp`, `truncate`

**Errors:** `ApprovalTimeoutError`, `ApprovalDeniedError`, `AuthenticationError`, `ConfigDecryptionError`, `ModuleExecutionError`, `ModuleNotFoundError`, `SchemaValidationError`

## Development

```bash
git clone https://github.com/aiperceivable/apcore-cli-typescript.git
cd apcore-cli-typescript
pnpm install
pnpm test                        # 275 tests across 17 suites
pnpm build                       # compile TypeScript
```

## License

Apache-2.0
