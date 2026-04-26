# apcore-cli-typescript Examples

This directory provides reference module implementations for the TypeScript CLI port,
mirroring `apcore-cli-python/examples/` and `apcore-cli-rust/examples/`.

## Layout

```
examples/
├── extensions/
│   ├── math/
│   │   ├── add.ts          → math.add (a + b)
│   │   └── multiply.ts     → math.multiply (a × b)
│   ├── text/
│   │   ├── upper.ts        → text.upper (uppercase)
│   │   ├── reverse.ts      → text.reverse (reverse string)
│   │   └── wordcount.ts    → text.wordcount (chars / words / lines)
│   └── sysutil/
│       ├── info.ts         → sysutil.info (OS / Node / hostname)
│       ├── env.ts          → sysutil.env (read env var)
│       └── disk.ts         → sysutil.disk (filesystem usage)
└── README.md               (this file)
```

Each module exports a class with:

- `static moduleId` — dotted module identifier (e.g. `"math.add"`).
- `static description` — one-line human-readable summary.
- `static inputSchema` / `static outputSchema` — typebox schemas convertible
  to JSON Schema for the apcore-js Module API.
- `execute(inputs)` — synchronous handler returning an `Output`.

## Running the examples

`examples/run-examples.ts` is the TypeScript e2e runner for this SDK. It exercises all 8 example
modules across 16 scenarios (including STDIN piping and module chaining) and
verifies outputs, so it can be used as a CI smoke test.

```bash
# One-off
npx tsx examples/run-examples.ts

# Via npm script
pnpm run-examples
```

Scenarios 15 (shell completion) and 16 (module help) note that they require a
compiled CLI binary and a live apcore-js registry — those steps are skipped
with an inline message rather than a hard failure.

## Type-checking the examples

The main `tsconfig.json` excludes the `examples/` tree to keep the published
build minimal. To type-check the example modules in isolation:

```bash
npx tsc --noEmit -p tsconfig.examples.json
```

## Known gap

The apcore-js Module API is still in flux — `Registry` and `Executor` types
re-exported by `apcore-cli-typescript` are local placeholder interfaces
pending upstream export. Once apcore-js publishes its loader / module
contract, these example files will be loadable directly via:

```ts
import { createCli } from "apcore-cli";
const cli = createCli({ extensionsDir: "./examples/extensions" });
cli.parse(process.argv);
```

At that point `run-examples.ts` can be extended to exercise the full CLI
stack (list, describe, completion) end-to-end.
