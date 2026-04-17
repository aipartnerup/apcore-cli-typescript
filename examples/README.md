# apcore-cli-typescript Examples

This directory mirrors `apcore-cli-python/examples/` and `apcore-cli-rust/examples/`
to provide reference module implementations across the three CLI ports.

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

## Type-checking the examples

The main `tsconfig.json` excludes the `examples/` tree to keep the published
build minimal. To type-check the example modules in isolation:

```bash
npx tsc --noEmit -p tsconfig.examples.json
```

## Future work

The apcore-js Module API is still in flux — `Registry` and `Executor` types
re-exported by `apcore-cli-typescript` are local placeholder interfaces
pending upstream export. Once apcore-js publishes its loader / module
contract, these example files will be loadable directly via:

```ts
import { createCli } from "apcore-cli";
const cli = createCli({ extensionsDir: "./examples/extensions" });
cli.parse(process.argv);
```

A future task should also port `apcore-cli-python/examples/run_examples.sh`
to TypeScript (as `run-examples.ts` or a tsx-based wrapper) so the e2e
flows can be exercised in CI.
