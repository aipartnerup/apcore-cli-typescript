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

# Execute a module
apcore-cli exec <module-id> --param value

# Pipe input via stdin
echo '{"key": "value"}' | apcore-cli exec <module-id> --stdin json
```

## Development

```bash
pnpm install
pnpm build
pnpm test
```

## License

MIT
