/**
 * Pipeline strategy commands — describe-pipeline (FE-11 F8).
 */

import { Command, Option } from "commander";
import type { Executor, StrategyInfo } from "./cli.js";
import { resolveFormat } from "./output.js";

/**
 * Look up `StrategyInfo` for an arbitrary strategy name.
 *
 * apcore-js exposes two introspection entry points:
 *   - `Executor.listStrategies()` (static): returns info for all globally
 *     registered strategies.
 *   - `executor.describePipeline()` (instance, no args): returns info for
 *     the executor's *currently-set* strategy only.
 *
 * To describe a non-current strategy we need the static `listStrategies`.
 * We reach it via the runtime constructor of the executor instance so the
 * CLI does not have to directly import the apcore-js `Executor` class
 * (preserves the loose structural contract used elsewhere in this package).
 *
 * Returns `{ info, isCurrent }` so the caller does not need a second
 * `describePipeline()` invocation to ask the same "is this the current
 * strategy?" question — only the current strategy exposes step-level
 * metadata (`executor.currentStrategy.steps`).
 */
function lookupStrategyInfo(
  executor: Executor,
  strategyName: string,
): { info: StrategyInfo | null; isCurrent: boolean } {
  // 1. Is the requested strategy the executor's current one?
  if (typeof executor.describePipeline === "function") {
    try {
      const current = executor.describePipeline();
      if (current && current.name === strategyName) {
        return { info: current, isCurrent: true };
      }
    } catch {
      // Fall through to the static lookup.
    }
  }

  // 2. Walk the static registry via the constructor.
  const ctor = (executor as unknown as { constructor?: unknown }).constructor as
    | { listStrategies?: () => StrategyInfo[] }
    | undefined;
  if (ctor && typeof ctor.listStrategies === "function") {
    try {
      const all = ctor.listStrategies();
      const info = all.find((s) => s.name === strategyName) ?? null;
      return { info, isCurrent: false };
    } catch {
      return { info: null, isCurrent: false };
    }
  }
  return { info: null, isCurrent: false };
}

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

      // Look up info for the requested strategy (current strategy via
      // describePipeline(), arbitrary strategy via Executor.listStrategies()).
      const { info, isCurrent } = lookupStrategyInfo(executor, opts.strategy);

      if (info) {
        // Step metadata (pure/removable/timeoutMs) is only available for the
        // executor's *current* strategy via `currentStrategy.steps` — other
        // registered strategies expose only their `StrategyInfo` summary.
        const strategySteps = isCurrent ? (executor.currentStrategy?.steps ?? []) : [];
        const header = `Pipeline: ${info.name} (${info.stepCount} steps)`;

        if (fmt === "json" || !process.stdout.isTTY) {
          const payload = {
            strategy: info.name,
            step_count: info.stepCount,
            description: info.description,
            steps: info.stepNames.map((name, i) => {
              const stepMeta = strategySteps[i];
              return {
                index: i + 1,
                name,
                pure: stepMeta?.pure ?? false,
                removable: stepMeta?.removable ?? true,
                timeout_ms: stepMeta?.timeoutMs ?? null,
              };
            }),
          };
          process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
        } else {
          process.stdout.write(`${header}\n\n`);
          process.stdout.write(`  ${"#".padEnd(4)} ${"Step".padEnd(28)} ${"Pure".padEnd(6)} ${"Removable".padEnd(11)} Timeout\n`);
          process.stdout.write(`  ${"-".repeat(4)} ${"-".repeat(28)} ${"-".repeat(6)} ${"-".repeat(11)} ${"-".repeat(8)}\n`);
          for (let i = 0; i < info.stepNames.length; i++) {
            const stepMeta = strategySteps[i];
            const pure = stepMeta?.pure ? "yes" : "no";
            const removable = stepMeta?.removable !== false ? "yes" : "no";
            const timeout = stepMeta?.timeoutMs ? `${stepMeta.timeoutMs}ms` : "\u2014";
            process.stdout.write(`  ${String(i + 1).padEnd(4)} ${info.stepNames[i].padEnd(28)} ${pure.padEnd(6)} ${removable.padEnd(11)} ${timeout}\n`);
          }
        }
        return;
      }

      // Fall back to static preset info for known strategies.
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
    });
  cli.addCommand(pipelineCmd);
}
