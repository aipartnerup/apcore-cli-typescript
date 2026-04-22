# apcore-cli TypeScript — Implementation Overview

> Ported from [apcore-cli-python](../apcore-cli-python) reference implementation.
> Source docs: [apcore protocol spec](../apcore/PROTOCOL_SPEC.md)

## Project Summary

**apcore-cli** is a terminal adapter for the apcore module ecosystem. It wraps any
apcore-based project into a fully-featured CLI with zero code changes to existing
modules.

- **Language:** TypeScript (ESM, Node.js 18+)
- **CLI framework:** Commander.js (replaces Python Click)
- **Schema validation:** Ajv 8 (replaces Python jsonschema)
- **Config parsing:** js-yaml
- **Test framework:** Vitest
- **Build:** tsup

## Architecture

```
User / AI Agent (terminal)
    |
    v
apcore-cli (the adapter)
    |
    +-- ConfigResolver         4-tier config precedence
    +-- LazyModuleGroup        Dynamic Commander command generation
    +-- SchemaParser           JSON Schema -> Commander options
    +-- RefResolver            $ref / allOf / anyOf / oneOf
    +-- ApprovalGate           TTY-aware HITL approval
    +-- OutputFormatter        TTY-adaptive JSON/table output
    +-- AuditLogger            JSON Lines execution logging
    +-- Sandbox                Child process isolation
    |
    v
apcore-js Registry + Executor (your modules, unchanged)
```

## Features (10 total)

| # | Feature | ID | Priority | Status | Files | Depends On |
|---|---------|-----|----------|--------|-------|------------|
| 1 | Config Resolver | FE-07 | P0 | completed | `config.ts` | — |
| 2 | Core Dispatcher | FE-01 | P0 | completed | `main.ts`, `cli.ts` | FE-07, FE-02, FE-03, FE-08 |
| 3 | Schema Parser | FE-02 | P0 | completed | `schema-parser.ts`, `ref-resolver.ts` | — |
| 4 | Output Formatter | FE-08 | P1 | completed | `output.ts` | — |
| 5 | Discovery | FE-04 | P1 | completed | `discovery.ts` | FE-08 |
| 6 | Approval Gate | FE-03 | P1 | completed | `approval.ts`, `errors.ts` | — |
| 7 | Security Manager | FE-05 | P1-P2 | completed | `security/*.ts`, `errors.ts` | FE-07 |
| 8 | Shell Integration | FE-06 | P2 | completed | `shell.ts` | — |
| 9 | Exposure Filtering | FE-12 | P1 | completed | `exposure.ts`, `cli.ts`, `main.ts`, `config.ts`, `discovery.ts`, `output.ts` | FE-01, FE-04, FE-07 |
| 10 | [Built-in Command Group (apcli)](./builtin-group/) | FE-13 | P0 | completed | `builtin-group.ts` (new) + `cli.ts`, `main.ts`, `config.ts`, `discovery.ts`, `system-cmd.ts`, `shell.ts`, `strategy.ts`, `init-cmd.ts`, `index.ts` | FE-01, FE-04, FE-07, FE-09, FE-11, FE-12 |

## Implementation Order

```
Phase 1 (Foundation):
  FE-07 Config Resolver  ─┐
  FE-02 Schema Parser    ─┤
  FE-08 Output Formatter ─┤
  FE-03 Approval Gate    ─┘── can be done in parallel

Phase 2 (Core):
  FE-01 Core Dispatcher  ── depends on all Phase 1
  FE-04 Discovery        ── depends on FE-08

Phase 3 (Security & Shell):
  FE-05 Security Manager ── depends on FE-07
  FE-06 Shell Integration ── standalone

Phase 4 (Surface refinement — v0.6+):
  FE-12 Exposure Filtering ── completed (0.6.0)
  FE-13 Built-in Command Group (apcli) ── completed (breaking change, v0.7.0)
```

## TypeScript-Specific Adaptations

| Python | TypeScript | Notes |
|--------|-----------|-------|
| Click | Commander.js | Custom Group → custom command registration |
| jsonschema | Ajv 8 | Draft 2020-12 support |
| Rich tables | Plain text tables | No heavy dep; simple column alignment |
| PyYAML | js-yaml | `yaml.load()` → `yaml.load(str, { schema: yaml.DEFAULT_SCHEMA })` |
| `sys.stdin.read()` | `process.stdin` | Async stream reading |
| `sys.exit(N)` | `process.exit(N)` | Same semantics |
| `os.environ` | `process.env` | Same semantics |
| `signal.SIGALRM` | `setTimeout` / `AbortController` | No SIGALRM in Node.js |
| `subprocess.run()` | `child_process.execFileSync()` / `fork()` | JSON stdio |
| `hashlib.sha256` | `crypto.createHash('sha256')` | Node.js built-in |
| `cryptography` (AES-GCM) | `crypto.createCipheriv('aes-256-gcm')` | Node.js built-in |
| `keyring` | `keytar` (optional) | OS keychain access |
| Pydantic schema detection | N/A | TS port only handles dict schemas |
| `click.echo(err=True)` | `process.stderr.write()` | |
| `re.fullmatch()` | `RegExp.test()` with anchors | |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Module execution error |
| 2 | Invalid CLI input or missing argument |
| 44 | Module not found, disabled, or failed to load |
| 45 | Input failed JSON Schema validation |
| 46 | Approval denied, timed out, or no interactive terminal |
| 47 | Configuration error |
| 48 | Schema contains circular `$ref` |
| 77 | ACL denied |
| 130 | Cancelled by user (Ctrl-C) |

## Test Strategy

- **Unit tests:** Each feature file has a corresponding `tests/*.test.ts`
- **Security tests:** `tests/security/*.test.ts`
- **All tests use Vitest** with globals enabled
- **Coverage target:** 85%+
- **TDD approach:** Red → Green → Refactor per task
