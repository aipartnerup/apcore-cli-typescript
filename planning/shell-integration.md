# FE-06: Shell Integration

> **Priority:** P2
> **Source:** `src/shell.ts`
> **Tests:** `tests/shell.test.ts`
> **Reference:** `../apcore-cli-python/src/apcore_cli/shell.py`
> **Dependencies:** None

## Overview

Shell completion script generation (bash, zsh, fish) and roff-formatted man page
generation. Completion scripts call back into the CLI to dynamically discover module IDs.
Man pages document commands, options, environment variables, and exit codes.

## Key Differences from Python

| Python | TypeScript |
|--------|-----------|
| `shlex.quote(prog_name)` | Custom shell quoting (or use single quotes) |
| `python3 -c "import sys,json;..."` | `node -e "..."` for JSON processing in completions |
| `click.Command.params` → `click.Option` | `Command.options` iteration on Commander |
| `date.today().strftime(...)` | `new Date().toISOString().slice(0, 10)` |
| `apcore_cli.__version__` | Read from `package.json` or hardcoded version |

## Tasks

### Task 1: Bash completion generation (RED → GREEN → REFACTOR)

**Tests:**
```typescript
describe("bash completion", () => {
  it("generates valid bash completion script");
  it("includes compgen for built-in commands");
  it("includes dynamic module ID lookup");
  it("uses shell-safe quoting for prog name");
  it("generates valid function name from prog name");
});
```

**Implementation:**
- `_makeFunctionName(progName)`: replace non-alphanumeric with `_`, prefix with `_`
- `_shellQuote(s)`: wrap in single quotes, escape internal single quotes
- `_generateBashCompletion(progName)`: compgen-based script
  - Level 1: built-in commands (list, describe, completion, man)
  - Level 2 after exec: dynamic module list via `${progName} list --format json | node -e "..."`

### Task 2: Zsh and Fish completion generation (RED → GREEN → REFACTOR)

**Tests:**
```typescript
describe("zsh completion", () => {
  it("generates valid zsh completion script");
  it("includes #compdef directive");
  it("includes _arguments with subcommand routing");
  it("includes dynamic module ID completion for exec");
});

describe("fish completion", () => {
  it("generates valid fish completion script");
  it("includes complete -c directives for built-in commands");
  it("includes dynamic module completion for exec");
});
```

**Implementation:**
- `_generateZshCompletion(progName)`: `#compdef`, `_arguments`, `_describe`, dynamic modules via `compadd`
- `_generateFishCompletion(progName)`: `complete -c` directives, `__fish_use_subcommand` conditions

### Task 3: completion command CLI wiring (RED → GREEN → REFACTOR)

**Tests:**
```typescript
describe("completion command", () => {
  it("registers 'completion' subcommand");
  it("accepts shell argument (bash|zsh|fish)");
  it("outputs generated script to stdout");
  it("uses resolved prog name from Commander context");
});
```

**Implementation:**
- Register `completion <shell>` command with argument choices `["bash", "zsh", "fish"]`
- Action: dispatch to appropriate generator, write to stdout

### Task 4: Man page generation (RED → GREEN → REFACTOR)

**Tests:**
```typescript
describe("man page generation", () => {
  it("generates valid roff-formatted man page");
  it("includes .TH header with title, date, version");
  it("includes NAME section");
  it("includes SYNOPSIS section with options");
  it("includes DESCRIPTION section from command help");
  it("includes OPTIONS section with all flags");
  it("includes ENVIRONMENT section with APCORE_* vars");
  it("includes EXIT CODES section with all codes");
  it("includes SEE ALSO section");
  it("exits 2 for unknown command name");
  it("registers 'man' subcommand");
});
```

**Implementation:**
- `_generateManPage(commandName, command, progName)`:
  - `.TH` header: title, section 1, date, package label, manual label
  - `.SH NAME`: prog-command — short description
  - `.SH SYNOPSIS`: `_buildSynopsis()` from command options
  - `.SH DESCRIPTION`: command help text (escape roff special chars)
  - `.SH OPTIONS`: iterate command options, format `.TP` entries
  - `.SH ENVIRONMENT`: APCORE_EXTENSIONS_ROOT, APCORE_CLI_AUTO_APPROVE, APCORE_CLI_LOGGING_LEVEL, APCORE_LOGGING_LEVEL
  - `.SH EXIT CODES`: all 10 exit codes
  - `.SH SEE ALSO`: cross-references
- `_buildSynopsis(command, progName, commandName)`: reflect actual options
- Register `man <command>` subcommand
