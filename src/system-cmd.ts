/**
 * System management commands — health, usage, enable, disable, reload, config (FE-11 F2).
 *
 * Each delegates to system.* modules via executor.
 * No-op if system modules are unavailable (graceful probe).
 */

import { Command } from "commander";
import type { Executor } from "./cli.js";
import { formatExecResult, resolveFormat } from "./output.js";
import { debug } from "./logger.js";

/**
 * Call a system module via executor.call() and return the result.
 */
async function callSystemModule(
  executor: Executor,
  moduleId: string,
  inputs: Record<string, unknown>,
): Promise<unknown> {
  if (executor.call) {
    return executor.call(moduleId, inputs);
  }
  return executor.execute(moduleId, inputs);
}

/**
 * Render health summary as TTY text.
 */
function formatHealthSummaryTty(result: Record<string, unknown>): void {
  const summary = (result.summary ?? {}) as Record<string, unknown>;
  const modules = (result.modules ?? []) as Record<string, unknown>[];

  if (modules.length === 0) {
    process.stdout.write("No modules found.\n");
    return;
  }

  const total = summary.total_modules ?? modules.length;
  process.stdout.write(`Health Overview (${total} modules)\n\n`);
  process.stdout.write(`  ${"Module".padEnd(28)} ${"Status".padEnd(12)} ${"Error Rate".padEnd(12)} Top Error\n`);
  process.stdout.write(`  ${"-".repeat(28)} ${"-".repeat(12)} ${"-".repeat(12)} ${"-".repeat(20)}\n`);

  for (const m of modules) {
    const top = m.top_error as Record<string, unknown> | undefined;
    const topStr = top ? `${top.code} (${top.count ?? "?"})` : "\u2014";
    const rate = `${((m.error_rate as number ?? 0) * 100).toFixed(1)}%`;
    process.stdout.write(
      `  ${String(m.module_id).padEnd(28)} ${String(m.status).padEnd(12)} ${rate.padEnd(12)} ${topStr}\n`,
    );
  }

  const parts: string[] = [];
  for (const key of ["healthy", "degraded", "error"]) {
    const count = summary[key] as number | undefined;
    if (count) parts.push(`${count} ${key}`);
  }
  process.stdout.write(`\nSummary: ${parts.join(", ") || "no data"}\n`);
}

/**
 * Render single-module health detail.
 */
function formatHealthModuleTty(result: Record<string, unknown>): void {
  process.stdout.write(`Module: ${result.module_id ?? "?"}\n`);
  process.stdout.write(`Status: ${result.status ?? "unknown"}\n`);
  const total = result.total_calls as number ?? 0;
  const errors = result.error_count as number ?? 0;
  const rate = result.error_rate as number ?? 0;
  const avg = result.avg_latency_ms as number ?? 0;
  const p99 = result.p99_latency_ms as number ?? 0;
  process.stdout.write(`Calls: ${total.toLocaleString()} total | ${errors.toLocaleString()} errors | ${(rate * 100).toFixed(1)}% error rate\n`);
  process.stdout.write(`Latency: ${avg.toFixed(0)}ms avg | ${p99.toFixed(0)}ms p99\n`);

  const recent = (result.recent_errors ?? []) as Record<string, unknown>[];
  if (recent.length > 0) {
    process.stdout.write(`\nRecent Errors (top ${recent.length}):\n`);
    for (const e of recent) {
      const count = e.count ?? "?";
      const last = e.last_occurred ?? "?";
      process.stdout.write(`  ${String(e.code ?? "?").padEnd(24)} x${count}  (last: ${last})\n`);
    }
  }
}

/**
 * Render usage summary as TTY text.
 */
function formatUsageSummaryTty(result: Record<string, unknown>): void {
  const modules = (result.modules ?? []) as Record<string, unknown>[];
  const period = result.period ?? "?";

  if (modules.length === 0) {
    process.stdout.write(`No usage data for period ${period}.\n`);
    return;
  }

  process.stdout.write(`Usage Summary (last ${period})\n\n`);
  process.stdout.write(`  ${"Module".padEnd(24)} ${"Calls".padStart(8)} ${"Errors".padStart(8)} ${"Avg Latency".padStart(12)} ${"Trend".padStart(10)}\n`);
  process.stdout.write(`  ${"-".repeat(24)} ${"-".repeat(8)} ${"-".repeat(8)} ${"-".repeat(12)} ${"-".repeat(10)}\n`);

  for (const m of modules) {
    const avg = `${((m.avg_latency_ms as number) ?? 0).toFixed(0)}ms`;
    process.stdout.write(
      `  ${String(m.module_id).padEnd(24)} ${String((m.call_count as number) ?? 0).padStart(8)} ` +
      `${String((m.error_count as number) ?? 0).padStart(8)} ${avg.padStart(12)} ${String(m.trend ?? "").padStart(10)}\n`,
    );
  }

  const totalCalls = (result.total_calls as number) ?? modules.reduce((s, m) => s + ((m.call_count as number) ?? 0), 0);
  const totalErrors = (result.total_errors as number) ?? modules.reduce((s, m) => s + ((m.error_count as number) ?? 0), 0);
  process.stdout.write(`\nTotal: ${totalCalls.toLocaleString()} calls | ${totalErrors.toLocaleString()} errors\n`);
}

/**
 * Register system management commands. No-op if system modules are not available.
 */
export async function registerSystemCommands(
  cli: Command,
  executor: Executor,
): Promise<void> {
  // Probe: check if system modules exist
  try {
    if (executor.validate) {
      await executor.validate("system.health.summary", {});
    } else {
      await callSystemModule(executor, "system.health.summary", { include_healthy: true });
    }
  } catch {
    debug("System modules not available; skipping system command registration.");
    return;
  }

  // health command
  const healthCmd = new Command("health")
    .description("Show module health status. Optionally specify a module ID for details.")
    .argument("[module-id]", "Module ID for detailed health")
    .option("--threshold <number>", "Error rate threshold (default: 0.01).", parseFloat, 0.01)
    .option("--all", "Include healthy modules.", false)
    .option("--errors <count>", "Max recent errors (module detail only).", parseInt, 10)
    .option("--format <format>", "Output format.")
    .action(async (moduleId: string | undefined, opts: { threshold: number; all: boolean; errors: number; format?: string }) => {
      const fmt = resolveFormat(opts.format);
      try {
        if (moduleId) {
          const result = await callSystemModule(executor, "system.health.module", {
            module_id: moduleId,
            error_limit: opts.errors,
          }) as Record<string, unknown>;
          if (fmt === "json" || !process.stdout.isTTY) {
            process.stdout.write(JSON.stringify(result, null, 2) + "\n");
          } else {
            formatHealthModuleTty(result);
          }
        } else {
          const result = await callSystemModule(executor, "system.health.summary", {
            error_rate_threshold: opts.threshold,
            include_healthy: opts.all,
          }) as Record<string, unknown>;
          if (fmt === "json" || !process.stdout.isTTY) {
            process.stdout.write(JSON.stringify(result, null, 2) + "\n");
          } else {
            formatHealthSummaryTty(result);
          }
        }
      } catch (e) {
        process.stderr.write(`Error: ${e instanceof Error ? e.message : e}\n`);
        process.exit(1);
      }
    });
  cli.addCommand(healthCmd);

  // usage command
  const usageCmd = new Command("usage")
    .description("Show module usage statistics. Optionally specify a module ID for details.")
    .argument("[module-id]", "Module ID for detailed usage")
    .option("--period <period>", "Time window: 1h, 24h, 7d, 30d.", "24h")
    .option("--format <format>", "Output format.")
    .action(async (moduleId: string | undefined, opts: { period: string; format?: string }) => {
      const fmt = resolveFormat(opts.format);
      try {
        let result: unknown;
        if (moduleId) {
          result = await callSystemModule(executor, "system.usage.module", {
            module_id: moduleId,
            period: opts.period,
          });
        } else {
          result = await callSystemModule(executor, "system.usage.summary", {
            period: opts.period,
          });
        }
        if (fmt === "json" || !process.stdout.isTTY) {
          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        } else if (moduleId) {
          formatExecResult(result, fmt);
        } else {
          formatUsageSummaryTty(result as Record<string, unknown>);
        }
      } catch (e) {
        process.stderr.write(`Error: ${e instanceof Error ? e.message : e}\n`);
        process.exit(1);
      }
    });
  cli.addCommand(usageCmd);

  // enable command
  const enableCmd = new Command("enable")
    .description("Enable a disabled module at runtime.")
    .argument("<module-id>", "Module ID to enable")
    .requiredOption("--reason <reason>", "Reason for enabling (required for audit).")
    .option("-y, --yes", "Skip approval prompt.", false)
    .option("--format <format>", "Output format.")
    .action(async (moduleId: string, opts: { reason: string; yes: boolean; format?: string }) => {
      if (!opts.yes) {
        process.stderr.write("Note: This command requires approval. Use --yes to bypass.\n");
      }
      const fmt = resolveFormat(opts.format);
      try {
        const result = await callSystemModule(executor, "system.control.toggle_feature", {
          module_id: moduleId,
          enabled: true,
          reason: opts.reason,
        }) as Record<string, unknown>;
        if (fmt === "json" || !process.stdout.isTTY) {
          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        } else {
          process.stdout.write(`Module '${moduleId}' enabled.\n  Reason: ${opts.reason}\n`);
        }
      } catch (e) {
        process.stderr.write(`Error: ${e instanceof Error ? e.message : e}\n`);
        process.exit(1);
      }
    });
  cli.addCommand(enableCmd);

  // disable command
  const disableCmd = new Command("disable")
    .description("Disable a module at runtime (calls are rejected until re-enabled).")
    .argument("<module-id>", "Module ID to disable")
    .requiredOption("--reason <reason>", "Reason for disabling (required for audit).")
    .option("-y, --yes", "Skip approval prompt.", false)
    .option("--format <format>", "Output format.")
    .action(async (moduleId: string, opts: { reason: string; yes: boolean; format?: string }) => {
      if (!opts.yes) {
        process.stderr.write("Note: This command requires approval. Use --yes to bypass.\n");
      }
      const fmt = resolveFormat(opts.format);
      try {
        const result = await callSystemModule(executor, "system.control.toggle_feature", {
          module_id: moduleId,
          enabled: false,
          reason: opts.reason,
        }) as Record<string, unknown>;
        if (fmt === "json" || !process.stdout.isTTY) {
          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        } else {
          process.stdout.write(`Module '${moduleId}' disabled.\n  Reason: ${opts.reason}\n`);
        }
      } catch (e) {
        process.stderr.write(`Error: ${e instanceof Error ? e.message : e}\n`);
        process.exit(1);
      }
    });
  cli.addCommand(disableCmd);

  // reload command
  const reloadCmd = new Command("reload")
    .description("Hot-reload a module from disk.")
    .argument("<module-id>", "Module ID to reload")
    .requiredOption("--reason <reason>", "Reason for reload (required for audit).")
    .option("-y, --yes", "Skip approval prompt.", false)
    .option("--format <format>", "Output format.")
    .action(async (moduleId: string, opts: { reason: string; yes: boolean; format?: string }) => {
      if (!opts.yes) {
        process.stderr.write("Note: This command requires approval. Use --yes to bypass.\n");
      }
      const fmt = resolveFormat(opts.format);
      try {
        const result = await callSystemModule(executor, "system.control.reload_module", {
          module_id: moduleId,
          reason: opts.reason,
        }) as Record<string, unknown>;
        if (fmt === "json" || !process.stdout.isTTY) {
          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        } else {
          const prev = result.previous_version ?? "?";
          const newVer = result.new_version ?? "?";
          const dur = result.reload_duration_ms ?? "?";
          process.stdout.write(`Module '${moduleId}' reloaded.\n`);
          process.stdout.write(`  Version: ${prev} -> ${newVer}\n`);
          process.stdout.write(`  Duration: ${dur}ms\n`);
        }
      } catch (e) {
        process.stderr.write(`Error: ${e instanceof Error ? e.message : e}\n`);
        process.exit(1);
      }
    });
  cli.addCommand(reloadCmd);

  // config group (get/set)
  const configGroup = new Command("config")
    .description("Read or update runtime configuration.");

  const configGetCmd = new Command("get")
    .description("Read a configuration value by dot-path key.")
    .argument("<key>", "Configuration key (dot-path)")
    .option("--format <format>", "Output format.", "table")
    .action(async (key: string, opts: { format?: string }) => {
      const fmt = resolveFormat(opts.format);
      try {
        const result = await callSystemModule(executor, "system.config.get", { key });
        const value = (result as Record<string, unknown>)?.value ?? result;
        if (fmt === "json" || !process.stdout.isTTY) {
          process.stdout.write(JSON.stringify({ key, value }, null, 2) + "\n");
        } else {
          process.stdout.write(`${key} = ${JSON.stringify(value)}\n`);
        }
      } catch (e) {
        process.stderr.write(`Error: ${e instanceof Error ? e.message : e}\n`);
        process.exit(1);
      }
    });
  configGroup.addCommand(configGetCmd);

  const configSetCmd = new Command("set")
    .description("Update a runtime configuration value (requires approval).")
    .argument("<key>", "Configuration key (dot-path)")
    .argument("<value>", "New value")
    .requiredOption("--reason <reason>", "Reason for config change (required for audit).")
    .option("--format <format>", "Output format.")
    .action(async (key: string, value: string, opts: { reason: string; format?: string }) => {
      const fmt = resolveFormat(opts.format);
      // Attempt to parse value as JSON for typed values
      let parsedValue: unknown;
      try {
        parsedValue = JSON.parse(value);
      } catch {
        parsedValue = value;
      }

      try {
        const result = await callSystemModule(executor, "system.control.update_config", {
          key,
          value: parsedValue,
          reason: opts.reason,
        }) as Record<string, unknown>;
        if (fmt === "json" || !process.stdout.isTTY) {
          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        } else {
          const old = result.old_value ?? "?";
          const newVal = result.new_value ?? "?";
          process.stdout.write(`Config updated: ${key}\n`);
          process.stdout.write(`  ${JSON.stringify(old)} -> ${JSON.stringify(newVal)}\n`);
          process.stdout.write(`  Reason: ${opts.reason}\n`);
        }
      } catch (e) {
        process.stderr.write(`Error: ${e instanceof Error ? e.message : e}\n`);
        process.exit(1);
      }
    });
  configGroup.addCommand(configSetCmd);

  cli.addCommand(configGroup);
}
