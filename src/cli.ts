/**
 * LazyModuleGroup — Dynamic command loading from Registry.
 *
 * Equivalent to the Python LazyModuleGroup. Dynamically discovers apcore
 * modules from the Registry and exposes them as Commander subcommands.
 *
 * Protocol spec: CLI command structure & lazy loading
 */

import { Command } from "commander";
import { buildModuleCommand } from "./main.js";

// TODO: Import Registry and Executor from apcore-js once available
// import type { Registry, Executor, ModuleDescriptor } from "apcore-js";

// ---------------------------------------------------------------------------
// Placeholder types until apcore-js types are available
// ---------------------------------------------------------------------------

/** Placeholder for apcore-js Registry. */
export interface Registry {
  listModules(): ModuleDescriptor[];
  getModule(moduleId: string): ModuleDescriptor | null;
}

/** Placeholder for apcore-js Executor. */
export interface Executor {
  execute(moduleId: string, input: Record<string, unknown>): Promise<unknown>;
}

/** Placeholder for apcore-js ModuleDescriptor. */
export interface ModuleDescriptor {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  requiresApproval?: boolean;
  annotations?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// LazyModuleGroup
// ---------------------------------------------------------------------------

/**
 * Dynamically loads apcore modules as Commander subcommands from Registry.
 *
 * TODO: Implement lazy loading — commands should only be fully built when
 * actually invoked, not at registration time.
 */
export class LazyModuleGroup {
  private readonly registry: Registry;
  readonly executor: Executor;
  private commandCache: Map<string, Command> = new Map();

  constructor(registry: Registry, executor: Executor) {
    this.registry = registry;
    this.executor = executor;
  }

  /**
   * List all available command names from the Registry.
   *
   * TODO: Implement registry enumeration.
   */
  listCommands(): string[] {
    // TODO: Query registry for all module IDs
    return this.registry.listModules().map((m) => m.id);
  }

  /**
   * Get or lazily build a Commander Command for the given module.
   *
   * TODO: Implement lazy command construction with schema-based options.
   */
  getCommand(cmdName: string): Command | null {
    if (this.commandCache.has(cmdName)) {
      return this.commandCache.get(cmdName)!;
    }

    const moduleDef = this.registry.getModule(cmdName);
    if (!moduleDef) {
      return null;
    }

    const cmd = buildModuleCommand(moduleDef, this.executor);
    this.commandCache.set(cmdName, cmd);
    return cmd;
  }
}
