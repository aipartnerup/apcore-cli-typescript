/**
 * Pipeline strategy commands — describe-pipeline (FE-11 F8).
 */

import { Command, Option } from "commander";
import type { Executor } from "./cli.js";
import { resolveFormat } from "./output.js";

/** Preset pipeline steps for each strategy. */
const PRESET_STEPS: Record<string, string[]> = {
  standard: [
    "context_creation",
    "call_chain_guard",
    "module_lookup",
    "acl_check",
    "approval_gate",
    "middleware_before",
    "input_validation",
    "execute",
    "output_validation",
    "middleware_after",
    "return_result",
  ],
  internal: [
    "context_creation",
    "call_chain_guard",
    "module_lookup",
    "middleware_before",
    "input_validation",
    "execute",
    "output_validation",
    "middleware_after",
    "return_result",
  ],
  testing: [
    "context_creation",
    "module_lookup",
    "middleware_before",
    "input_validation",
    "execute",
    "output_validation",
    "middleware_after",
    "return_result",
  ],
  performance: [
    "context_creation",
    "call_chain_guard",
    "module_lookup",
    "acl_check",
    "approval_gate",
    "input_validation",
    "execute",
    "output_validation",
    "return_result",
  ],
  minimal: [
    "context_creation",
    "module_lookup",
    "execute",
    "return_result",
  ],
};

/**
 * Register the describe-pipeline command.
 */
export function registerPipelineCommand(cli: Command, executor: Executor): void {
  const pipelineCmd = new Command("describe-pipeline")
    .description("Show the execution pipeline steps for a strategy.")
    .addOption(
      new Option("--strategy <name>", "Strategy to describe (default: standard).")
        .choices(["standard", "internal", "testing", "performance", "minimal"])
        .default("standard"),
    )
    .option("--format <format>", "Output format.")
    .action((opts: { strategy: string; format?: string }) => {
      const fmt = resolveFormat(opts.format);

      // Try to get strategy info from executor
      let strategyObj: { steps: Array<{ name: string; pure?: boolean; removable?: boolean; timeout_ms?: number }> } | null = null;
      const ex = executor as unknown as Record<string, unknown>;
      if (typeof ex._resolve_strategy_name === "function" || typeof ex._resolveStrategyName === "function") {
        try {
          const fn = (ex._resolve_strategy_name ?? ex._resolveStrategyName) as (name: string) => unknown;
          strategyObj = fn(opts.strategy) as { steps: Array<{ name: string; pure?: boolean; removable?: boolean; timeout_ms?: number }> } | null;
        } catch {
          strategyObj = null;
        }
      }

      if (!strategyObj) {
        // Provide static info for known strategies with metadata columns.
        const steps = PRESET_STEPS[opts.strategy] ?? [];
        const pureSteps = new Set([
          "context_creation", "call_chain_guard", "module_lookup", "acl_check", "input_validation",
        ]);
        const nonRemovable = new Set([
          "context_creation", "module_lookup", "execute", "return_result",
        ]);

        if (fmt === "json" || !process.stdout.isTTY) {
          const payload = {
            strategy: opts.strategy,
            step_count: steps.length,
            steps: steps.map((s, i) => ({
              index: i + 1,
              name: s,
              pure: pureSteps.has(s),
              removable: !nonRemovable.has(s),
            })),
          };
          process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
        } else {
          process.stdout.write(`Pipeline: ${opts.strategy} (${steps.length} steps)\n\n`);
          process.stdout.write(`  ${"#".padEnd(4)} ${"Step".padEnd(28)} ${"Pure".padEnd(6)} ${"Removable".padEnd(11)} Timeout\n`);
          process.stdout.write(`  ${"-".repeat(4)} ${"-".repeat(28)} ${"-".repeat(6)} ${"-".repeat(11)} ${"-".repeat(8)}\n`);
          for (let i = 0; i < steps.length; i++) {
            const pure = pureSteps.has(steps[i]) ? "yes" : "no";
            const removable = nonRemovable.has(steps[i]) ? "no" : "yes";
            process.stdout.write(`  ${String(i + 1).padEnd(4)} ${steps[i].padEnd(28)} ${pure.padEnd(6)} ${removable.padEnd(11)} \u2014\n`);
          }
        }
        return;
      }

      // Use actual strategy object for detailed info
      const stepsInfo = strategyObj.steps.map((step) => ({
        name: step.name,
        pure: step.pure ?? false,
        removable: step.removable ?? true,
        timeout_ms: step.timeout_ms ?? null,
      }));

      if (fmt === "json" || !process.stdout.isTTY) {
        const payload = {
          strategy: opts.strategy,
          step_count: stepsInfo.length,
          steps: stepsInfo.map((s, i) => ({ index: i + 1, ...s })),
        };
        process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
      } else {
        process.stdout.write(`Pipeline: ${opts.strategy} (${stepsInfo.length} steps)\n\n`);
        process.stdout.write(`  ${"#".padEnd(4)} ${"Step".padEnd(28)} ${"Pure".padEnd(6)} ${"Removable".padEnd(11)} Timeout\n`);
        process.stdout.write(`  ${"-".repeat(4)} ${"-".repeat(28)} ${"-".repeat(6)} ${"-".repeat(11)} ${"-".repeat(8)}\n`);
        for (let i = 0; i < stepsInfo.length; i++) {
          const s = stepsInfo[i];
          const pure = s.pure ? "yes" : "no";
          const removable = s.removable ? "yes" : "no";
          const timeout = s.timeout_ms !== null ? `${s.timeout_ms}ms` : "\u2014";
          process.stdout.write(`  ${String(i + 1).padEnd(4)} ${s.name.padEnd(28)} ${pure.padEnd(6)} ${removable.padEnd(11)} ${timeout}\n`);
        }
      }
    });
  cli.addCommand(pipelineCmd);
}
