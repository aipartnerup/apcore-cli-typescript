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
import { getDisplay } from "./display-helpers.js";
import { warn } from "./logger.js";

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
  /** Validate inputs without executing. Returns a PreflightResult. */
  validate?(moduleId: string, input: Record<string, unknown>): Promise<PreflightResult>;
  /** Execute with pipeline trace. Returns [result, PipelineTrace]. */
  callWithTrace?(moduleId: string, input: Record<string, unknown>, options?: { strategy?: string }): Promise<[unknown, PipelineTrace]>;
  /** Stream execution — async iterator of chunks. */
  stream?(moduleId: string, input: Record<string, unknown>): AsyncIterable<unknown>;
  /** Call a module (synchronous-style, used by system commands). */
  call?(moduleId: string, input: Record<string, unknown>): Promise<unknown>;
}

/** Result of a preflight validation check. */
export interface PreflightCheck {
  check: string;
  passed: boolean;
  error?: unknown;
  warnings?: string[];
}

/** Result of executor.validate(). */
export interface PreflightResult {
  valid: boolean;
  requires_approval: boolean;
  checks: PreflightCheck[];
}

/** A single step in a pipeline trace. */
export interface PipelineTraceStep {
  name: string;
  duration_ms: number;
  skipped: boolean;
  skip_reason?: string;
}

/** Pipeline execution trace returned by callWithTrace(). */
export interface PipelineTrace {
  strategy_name: string;
  total_duration_ms: number;
  success: boolean;
  steps: PipelineTraceStep[];
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

/** Built-in command names that cannot be overridden by modules. */
export const BUILTIN_COMMANDS = [
  "completion",
  "config",
  "describe",
  "describe-pipeline",
  "disable",
  "enable",
  "exec",
  "health",
  "init",
  "list",
  "man",
  "reload",
  "usage",
  "validate",
];

// ---------------------------------------------------------------------------
// LazyModuleGroup
// ---------------------------------------------------------------------------

/**
 * Dynamically loads apcore modules as Commander subcommands from Registry.
 */
export class LazyModuleGroup {
  protected readonly registry: Registry;
  readonly executor: Executor;
  protected readonly helpTextMaxLength: number;
  protected commandCache: Map<string, Command> = new Map();
  /** alias -> canonical module_id (populated lazily) */
  protected aliasMap: Map<string, string> = new Map();
  /** module_id -> descriptor cache (populated during alias map build) */
  protected descriptorCache: Map<string, ModuleDescriptor> = new Map();
  protected aliasMapBuilt = false;

  constructor(registry: Registry, executor: Executor, helpTextMaxLength = 1000) {
    this.registry = registry;
    this.executor = executor;
    this.helpTextMaxLength = helpTextMaxLength;
  }

  /**
   * Build alias->module_id map from display overlay metadata.
   */
  buildAliasMap(): void {
    if (this.aliasMapBuilt) {
      return;
    }
    try {
      for (const descriptor of this.registry.listModules()) {
        const moduleId = descriptor.id;
        this.descriptorCache.set(moduleId, descriptor);
        const display = getDisplay(descriptor);
        const cliDisplay = (display.cli && typeof display.cli === "object" && !Array.isArray(display.cli))
          ? (display.cli as Record<string, unknown>)
          : {};
        const cliAlias = cliDisplay.alias as string | undefined;
        if (cliAlias && cliAlias !== moduleId) {
          this.aliasMap.set(cliAlias, moduleId);
        }
      }
      this.aliasMapBuilt = true;
    } catch {
      warn("Failed to build alias map from registry");
    }
  }

  /**
   * List all available command names from the Registry.
   */
  listCommands(): string[] {
    this.buildAliasMap();
    // Reverse map: module_id -> cli alias (if any)
    const reverse = new Map<string, string>();
    for (const [alias, moduleId] of this.aliasMap) {
      reverse.set(moduleId, alias);
    }
    const moduleIds = this.registry.listModules().map((m) => m.id);
    const names = moduleIds.map((mid) => reverse.get(mid) ?? mid);
    return [...new Set(names)].sort();
  }

  /**
   * Get or lazily build a Commander Command for the given module.
   */
  getCommand(cmdName: string): Command | null {
    if (this.commandCache.has(cmdName)) {
      return this.commandCache.get(cmdName)!;
    }

    // Resolve alias -> canonical module_id
    this.buildAliasMap();
    const moduleId = this.aliasMap.get(cmdName) ?? cmdName;

    // Look up in descriptor cache or registry
    let moduleDef = this.descriptorCache.get(moduleId);
    if (!moduleDef) {
      moduleDef = this.registry.getModule(moduleId) ?? undefined;
    }
    if (!moduleDef) {
      return null;
    }

    const cmd = buildModuleCommand(moduleDef, this.executor, this.helpTextMaxLength, cmdName);
    this.commandCache.set(cmdName, cmd);
    return cmd;
  }
}

// ---------------------------------------------------------------------------
// LazyGroup — A Commander Command group for a single namespace
// ---------------------------------------------------------------------------

/**
 * Command group for a single namespace — lazily builds subcommands.
 */
export class LazyGroup {
  private readonly members: Map<string, [string, ModuleDescriptor]>;
  private readonly _executor: Executor;
  private readonly _helpTextMaxLength: number;
  private readonly _cmdCache: Map<string, Command> = new Map();
  readonly command: Command;

  constructor(
    members: Map<string, [string, ModuleDescriptor]>,
    executor: Executor,
    name: string,
    helpTextMaxLength = 1000,
  ) {
    this.members = members;
    this._executor = executor;
    this._helpTextMaxLength = helpTextMaxLength;
    this.command = new Command(name).description(`${name} commands`);

    // Build and register all subcommands
    for (const [cmdName, [, descriptor]] of this.members) {
      const cmd = buildModuleCommand(
        descriptor,
        this._executor,
        this._helpTextMaxLength,
        cmdName,
      );
      this._cmdCache.set(cmdName, cmd);
      this.command.addCommand(cmd);
    }
  }

  listCommands(): string[] {
    return [...this.members.keys()].sort();
  }

  getCommand(cmdName: string): Command | null {
    if (this._cmdCache.has(cmdName)) {
      return this._cmdCache.get(cmdName)!;
    }
    const entry = this.members.get(cmdName);
    if (!entry) {
      return null;
    }
    const [, descriptor] = entry;
    const cmd = buildModuleCommand(
      descriptor,
      this._executor,
      this._helpTextMaxLength,
      cmdName,
    );
    this._cmdCache.set(cmdName, cmd);
    return cmd;
  }
}

// ---------------------------------------------------------------------------
// GroupedModuleGroup
// ---------------------------------------------------------------------------

/**
 * Extended LazyModuleGroup that organises modules into named groups.
 *
 * Modules with dotted IDs (e.g., "math.add") are automatically grouped
 * by their namespace prefix. The display overlay can override grouping
 * via metadata.display.cli.group.
 */
export class GroupedModuleGroup extends LazyModuleGroup {
  /** groupName -> { cmdName -> [moduleId, descriptor] } */
  private groupMap: Map<string, Map<string, [string, ModuleDescriptor]>> = new Map();
  /** cmdName -> [moduleId, descriptor] for top-level (ungrouped) modules */
  private topLevelModules: Map<string, [string, ModuleDescriptor]> = new Map();
  /** Cached LazyGroup instances */
  private groupCache: Map<string, LazyGroup> = new Map();
  private groupMapBuilt = false;

  /**
   * Determine (groupName | null, commandName) for a module from its display overlay.
   *
   * @param groupDepth  Number of dotted segments to consume as the group prefix.
   *                    Defaults to 1 (e.g., "math.add" → group="math", cmd="add").
   *                    Set to 2 for multi-level grouping (e.g., "math.trig.sin" →
   *                    group="math.trig", cmd="sin").
   */
  static resolveGroup(moduleId: string, descriptor: ModuleDescriptor, groupDepth = 1): [string | null, string] {
    if (!moduleId) {
      warn("Empty module_id encountered in resolveGroup");
      return [null, ""];
    }

    const display = getDisplay(descriptor);
    const cliDisplay = (display.cli && typeof display.cli === "object" && !Array.isArray(display.cli))
      ? (display.cli as Record<string, unknown>)
      : {};
    const explicitGroup = cliDisplay.group;

    // Explicit non-empty string group
    if (typeof explicitGroup === "string" && explicitGroup !== "") {
      return [explicitGroup, (cliDisplay.alias as string | undefined) ?? moduleId];
    }
    // Explicit empty string = opt-out (top-level)
    if (explicitGroup === "") {
      return [null, (cliDisplay.alias as string | undefined) ?? moduleId];
    }

    // Auto-extraction from alias or module_id with configurable depth
    const cliName = (cliDisplay.alias as string | undefined) ?? moduleId;
    if (cliName.includes(".")) {
      const parts = cliName.split(".");
      const depth = Math.max(1, Math.min(groupDepth, parts.length - 1));
      const group = parts.slice(0, depth).join(".");
      const cmd = parts.slice(depth).join(".");
      return [group, cmd];
    }
    return [null, cliName];
  }

  /**
   * Build the group map from registry modules.
   */
  buildGroupMap(): void {
    if (this.groupMapBuilt) {
      return;
    }
    try {
      this.buildAliasMap();
      for (const descriptor of this.registry.listModules()) {
        const moduleId = descriptor.id;
        const cached = this.descriptorCache.get(moduleId);
        if (!cached) {
          continue;
        }
        const [group, cmd] = GroupedModuleGroup.resolveGroup(moduleId, cached);
        if (group === null) {
          this.topLevelModules.set(cmd, [moduleId, cached]);
        } else if (!/^[a-z][a-z0-9_-]*$/.test(group)) {
          warn(
            `Module '${moduleId}': group name '${group}' is not shell-safe — treating as top-level.`,
          );
          this.topLevelModules.set(cmd, [moduleId, cached]);
        } else {
          if (!this.groupMap.has(group)) {
            this.groupMap.set(group, new Map());
          }
          this.groupMap.get(group)!.set(cmd, [moduleId, cached]);
        }
      }
      // Warn on builtin collisions
      for (const groupName of this.groupMap.keys()) {
        if (BUILTIN_COMMANDS.includes(groupName)) {
          warn(
            `Group name '${groupName}' collides with a built-in command and will be ignored`,
          );
        }
      }
      this.groupMapBuilt = true;
    } catch {
      warn("Failed to build group map");
    }
  }

  /**
   * List all available command names: builtins + group names + top-level module names.
   */
  override listCommands(): string[] {
    this.buildGroupMap();
    const groupNames = [...this.groupMap.keys()].filter(
      (g) => !BUILTIN_COMMANDS.includes(g),
    );
    const topNames = [...this.topLevelModules.keys()];
    return [...new Set([...BUILTIN_COMMANDS, ...groupNames, ...topNames])].sort();
  }

  /**
   * Get a command by name: check builtins -> group cache -> group map -> top-level modules.
   */
  override getCommand(cmdName: string): Command | null {
    this.buildGroupMap();

    // Check group cache
    if (this.groupCache.has(cmdName)) {
      return this.groupCache.get(cmdName)!.command;
    }

    // Check if it's a group
    if (this.groupMap.has(cmdName)) {
      const lazyGrp = new LazyGroup(
        this.groupMap.get(cmdName)!,
        this.executor,
        cmdName,
        this.helpTextMaxLength,
      );
      this.groupCache.set(cmdName, lazyGrp);
      return lazyGrp.command;
    }

    // Check top-level modules
    if (this.topLevelModules.has(cmdName)) {
      if (this.commandCache.has(cmdName)) {
        return this.commandCache.get(cmdName)!;
      }
      const [, descriptor] = this.topLevelModules.get(cmdName)!;
      const cmd = buildModuleCommand(
        descriptor,
        this.executor,
        this.helpTextMaxLength,
        cmdName,
      );
      this.commandCache.set(cmdName, cmd);
      return cmd;
    }

    return null;
  }

  /** Expose groupMap for testing. */
  getGroupMap(): Map<string, Map<string, [string, ModuleDescriptor]>> {
    return this.groupMap;
  }

  /** Expose topLevelModules for testing. */
  getTopLevelModules(): Map<string, [string, ModuleDescriptor]> {
    return this.topLevelModules;
  }

  /** Expose groupMapBuilt for testing. */
  isGroupMapBuilt(): boolean {
    return this.groupMapBuilt;
  }
}
