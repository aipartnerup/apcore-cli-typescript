#!/usr/bin/env tsx
/**
 * run-examples.ts — TypeScript port of apcore-cli-python/examples/run_examples.sh
 *
 * Exercises all example modules directly (no compiled CLI binary required).
 * The full CLI stack (apcli list/describe/completion) requires a live
 * apcore-js registry, which is pending upstream integration; those scenarios
 * are noted inline.
 *
 * Usage:
 *   npx tsx examples/run-examples.ts
 *
 * CI:
 *   pnpm run examples
 */

import { MathAdd } from "./extensions/math/add.js";
import { MathMultiply } from "./extensions/math/multiply.js";
import { TextUpper } from "./extensions/text/upper.js";
import { TextReverse } from "./extensions/text/reverse.js";
import { TextWordCount } from "./extensions/text/wordcount.js";
import { SysutilInfo } from "./extensions/sysutil/info.js";
import { SysutilEnv } from "./extensions/sysutil/env.js";
import { SysutilDisk } from "./extensions/sysutil/disk.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let failures = 0;

function section(n: number, label: string, cmd: string): void {
  console.log(`${n}. ${label}:`);
  console.log(`   $ ${cmd}`);
}

function show(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
  console.log();
}

function assert(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`   FAIL ${label}`);
    console.error(`        expected: ${e}`);
    console.error(`        got:      ${a}`);
    failures++;
  }
}

// ---------------------------------------------------------------------------
// Module registry (mirrors what apcli list would show)
// ---------------------------------------------------------------------------

const ALL_MODULES = [
  { id: MathAdd.moduleId, description: MathAdd.description, tag: "math" },
  { id: MathMultiply.moduleId, description: MathMultiply.description, tag: "math" },
  { id: TextUpper.moduleId, description: TextUpper.description, tag: "text" },
  { id: TextReverse.moduleId, description: TextReverse.description, tag: "text" },
  { id: TextWordCount.moduleId, description: TextWordCount.description, tag: "text" },
  { id: SysutilInfo.moduleId, description: SysutilInfo.description, tag: "sysutil" },
  { id: SysutilEnv.moduleId, description: SysutilEnv.description, tag: "sysutil" },
  { id: SysutilDisk.moduleId, description: SysutilDisk.description, tag: "sysutil" },
];

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

console.log("============================================");
console.log(" apcore-cli Examples (TypeScript / Node.js)");
console.log("============================================");
console.log();

// 1. List all modules
section(1, "List all modules", "apcore-cli apcli list --format json");
show(ALL_MODULES.map(({ id, description }) => ({ id, description })));

// 2. Filter by tag: math
section(2, "Filter by tag", "apcore-cli apcli list --tag math --format json");
show(
  ALL_MODULES.filter((m) => m.tag === "math").map(({ id, description }) => ({ id, description })),
);

// 3. Describe math.add
section(3, "Describe a module", "apcore-cli apcli describe math.add --format json");
show({
  id: MathAdd.moduleId,
  description: MathAdd.description,
  inputSchema: MathAdd.inputSchema,
  outputSchema: MathAdd.outputSchema,
});

// 4. Execute math.add
section(4, "Execute math.add with CLI flags", "apcore-cli math add --a 42 --b 58");
{
  const result = new MathAdd().execute({ a: 42, b: 58 });
  show(result);
  assert("math.add(42, 58)", result, { sum: 100 });
}

// 5. Execute math.multiply
section(5, "Execute math.multiply", "apcore-cli math multiply --a 6 --b 7");
{
  const result = new MathMultiply().execute({ a: 6, b: 7 });
  show(result);
  assert("math.multiply(6, 7)", result, { product: 42 });
}

// 6. Execute text.upper
section(6, "Execute text.upper", "apcore-cli text upper --text 'hello apcore'");
{
  const result = new TextUpper().execute({ text: "hello apcore" });
  show(result);
  assert("text.upper('hello apcore')", result, { result: "HELLO APCORE" });
}

// 7. Execute text.reverse
section(7, "Execute text.reverse", "apcore-cli text reverse --text 'apcore-cli'");
{
  const result = new TextReverse().execute({ text: "apcore-cli" });
  show(result);
  assert("text.reverse('apcore-cli')", result, { result: "ilc-erocpa" });
}

// 8. Execute text.wordcount
section(
  8,
  "Execute text.wordcount",
  "apcore-cli text wordcount --text 'hello world from apcore'",
);
{
  const result = new TextWordCount().execute({ text: "hello world from apcore" });
  show(result);
  assert("text.wordcount characters", result.characters, 23);
  assert("text.wordcount words", result.words, 4);
  assert("text.wordcount lines", result.lines, 1);
}

// 9. Pipe JSON via STDIN — simulated: CLI merges stdin JSON then applies flags
section(9, "Pipe JSON via STDIN", "echo '{\"a\": 100, \"b\": 200}' | apcore-cli math add --input -");
{
  // STDIN: {"a": 100, "b": 200}  (no flag overrides)
  const stdin = { a: 100, b: 200 };
  const result = new MathAdd().execute(stdin);
  show(result);
  assert("math.add via stdin", result, { sum: 300 });
}

// 10. CLI flag overrides STDIN value
section(
  10,
  "CLI flag overrides STDIN",
  "echo '{\"a\": 1, \"b\": 2}' | apcore-cli math add --input - --a 999",
);
{
  // STDIN: {"a": 1, "b": 2}, flag --a 999 wins → merged: {a: 999, b: 2}
  const stdin = { a: 1, b: 2 };
  const flags = { a: 999 };
  const merged = { ...stdin, ...flags };
  const result = new MathAdd().execute(merged);
  show(result);
  assert("math.add stdin+flag override", result, { sum: 1001 });
}

// 11. Get system info
section(11, "Get system info", "apcore-cli sysutil info");
{
  const result = new SysutilInfo().execute({});
  show(result);
  // spot-check: node_version must start with "v"
  assert("sysutil.info node_version prefix", result.node_version.startsWith("v"), true);
}

// 12. Read environment variable
section(12, "Read environment variable", "apcore-cli sysutil env --name HOME");
{
  const result = new SysutilEnv().execute({ name: "HOME" });
  show(result);
  assert("sysutil.env name", result.name, "HOME");
  assert("sysutil.env source", ["env", "missing"].includes(result.source), true);
}

// 13. Check disk usage
section(13, "Check disk usage", "apcore-cli sysutil disk --path /");
{
  const result = new SysutilDisk().execute({ path: "/" });
  show(result);
  assert("sysutil.disk path", result.path, "/");
}

// 14. Chain modules: math.add result → parse sum → format message
section(
  14,
  "Chain modules — add result parsed to message",
  "apcore-cli math add --a 5 --b 10 | node -e \"...\"",
);
{
  const addResult = new MathAdd().execute({ a: 5, b: 10 });
  console.log(`   math.add returned: ${JSON.stringify(addResult)}`);
  const msg = `The sum is ${addResult.sum}`;
  console.log(`   Parsed: ${msg}`);
  console.log();
  assert("chain: math.add sum", addResult.sum, 15);
  assert("chain: message", msg, "The sum is 15");
}

// 15. Shell completion — requires compiled CLI binary
section(15, "Generate bash completion", "apcore-cli apcli completion bash | head -5");
console.log("   [requires compiled CLI + apcore-js registry — run: pnpm build && apcore-cli apcli completion bash]");
console.log();

// 16. Module help — requires compiled CLI binary
section(16, "Module help (auto-generated from schema)", "apcore-cli math add --help");
console.log("   [requires compiled CLI + apcore-js registry — run: pnpm build && apcore-cli math add --help]");
console.log("   Schema-derived flags for math.add:");
console.log("     --a <integer>   First operand   [required]");
console.log("     --b <integer>   Second operand  [required]");
console.log();

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log("============================================");
if (failures === 0) {
  console.log(" All examples completed successfully!");
} else {
  console.log(` ${failures} example(s) FAILED — see output above.`);
}
console.log("============================================");

if (failures > 0) {
  process.exit(1);
}
