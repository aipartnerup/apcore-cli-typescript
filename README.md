# apcore-cli

TypeScript CLI wrapper for the apcore core SDK. Exposes apcore modules as CLI commands with JSON Schema-driven argument parsing, 4-tier config resolution, and security features.

## Install

```bash
pnpm add apcore-cli apcore-js
```

## Usage

```bash
# List available modules
apcore-cli list

# Describe a module
apcore-cli describe <module-id>

# Execute a module directly
apcore-cli <module-id> --param value

# Pipe input via stdin
echo '{"key": "value"}' | apcore-cli <module-id> --input -
```

## Features

- **Config Resolution** — 4-tier precedence: CLI flags > env vars > config file > defaults
- **Schema-Driven Args** — JSON Schema properties auto-mapped to CLI options
- **Approval Gate** — interactive approval prompts for sensitive modules
- **Audit Logging** — JSONL execution trail with salted input hashing
- **Sandbox Execution** — subprocess isolation for untrusted modules
- **Discovery** — list and describe registered modules
- **Shell Integration** — bash/zsh/fish completions and man page generation
- **Output Formatting** — table and JSON output modes

## API Overview

**Classes:** `LazyModuleGroup`, `ConfigResolver`, `AuthProvider`, `ConfigEncryptor`, `AuditLogger`, `Sandbox`

**Functions:** `createCli`, `main`, `buildModuleCommand`, `validateModuleId`, `collectInput`, `schemaToCliOptions`, `reconvertEnumValues`, `resolveRefs`, `checkApproval`, `resolveFormat`, `formatModuleList`, `formatModuleDetail`, `formatExecResult`, `registerDiscoveryCommands`, `registerShellCommands`, `setAuditLogger`, `getAuditLogger`, `exitCodeForError`, `mapType`, `extractHelp`, `truncate`

**Errors:** `ApprovalTimeoutError`, `ApprovalDeniedError`, `AuthenticationError`, `ConfigDecryptionError`, `ModuleExecutionError`, `ModuleNotFoundError`, `SchemaValidationError`

## Development

```bash
pnpm install
pnpm build
pnpm test
```

## License

MIT
