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
import { ExposureFilter } from "./exposure.js";
import { warn } from "./logger.js";
import { RESERVED_GROUP_NAMES } from "./builtin-group.js";
import { EXIT_CODES } from "./errors.js";

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

/** Strategy info returned by Executor.describePipeline(). */
export interface StrategyInfo {
  name: string;
  stepCount: number;
  stepNames: string[];
  description: string;
}

/** A step in the executor strategy (shape parity with apcore-js Step). */
export interface StrategyStep {
  name: string;
  pure?: boolean;
  removable: boolean;
  timeoutMs?: number;
}

/** Placeholder for apcore-js Executor. Shape-compatible with apcore-js >= 0.19.0. */
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
  /**
   * Describe the executor's currently-set strategy. Returns StrategyInfo
   * (apcore-js >= 0.18.0). Takes no arguments — to introspect a different
   * strategy, use `Executor.listStrategies()` (static) via `executor.constructor`.
   */
  describePipeline?(): StrategyInfo;
  /** The current execution strategy object, exposing step metadata. */
  currentStrategy?: { readonly steps: readonly StrategyStep[] };
}

/** Result of a preflight validation check. */
export interface PreflightCheck {
  readonly check: string;
  readonly passed: boolean;
  readonly error?: unknown;
  readonly warnings?: string[];
}

/** Result of executor.validate() — parity with apcore-js PreflightResult. */
export interface PreflightResult {
  readonly valid: boolean;
  readonly requiresApproval: boolean;
  readonly checks: readonly PreflightCheck[];
  readonly errors?: ReadonlyArray<Record<string, unknown>>;
}

/** A single step in a pipeline trace — parity with apcore-js StepTrace. */
export interface PipelineTraceStep {
  readonly name: string;
  readonly durationMs: number;
  readonly skipped: boolean;
  readonly skipReason?: string | null;
}

/** Pipeline execution trace returned by callWithTrace() — parity with apcore-js PipelineTrace. */
export interface PipelineTrace {
  readonly moduleId?: string;
  readonly strategyName: string;
  readonly totalDurationMs: number;
  readonly success: boolean;
  readonly steps: readonly PipelineTraceStep[];
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

// FE-13 (builtin-group) replaced the per-command collision constant with a
// live Commander tree walk (root + apcli subgroup). The reserved top-level
// group name is `apcli` (see RESERVED_GROUP_NAMES in ./builtin-group.ts);
// individual subcommand names are no longer a global namespace since they
// live under the apcli/ prefix.

/**
 * Hard-fail with exit 2 when a module resolves to a reserved CLI name.
 * FE-13 §4.10 enumerates three cases: explicit group, auto-group prefix,
 * and top-level alias/id. Error messages identify both the module id and
 * the offending name for debuggability.
 */
function assertNotReserved(
  kind: "group" | "auto-group" | "top-level",
  name: string,
  moduleId: string,
): void {
  if (!RESERVED_GROUP_NAMES.has(name)) return;
  let msg: string;
  if (kind === "group") {
    msg =
      `Error: Module '${moduleId}': display.cli.group '${name}' is reserved. ` +
      `Use a different CLI alias or set display.cli.group to another value.\n`;
  } else if (kind === "auto-group") {
    msg =
      `Error: Module '${moduleId}': auto-group '${name}' is reserved. ` +
      `Rename the module id or set display.cli.group to another value.\n`;
  } else {
    msg =
      `Error: Module '${moduleId}': top-level CLI name '${name}' is reserved. ` +
      `Use a different CLI alias.\n`;
  }
  process.stderr.write(msg);
  process.exit(EXIT_CODES.INVALID_CLI_INPUT);
}

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
  /** Exposure filter (FE-12) — controls which modules appear as CLI commands */
  exposureFilter: ExposureFilter;

  constructor(registry: Registry, executor: Executor, helpTextMaxLength = 1000, exposureFilter?: ExposureFilter) {
    super(registry, executor, helpTextMaxLength);
    this.exposureFilter = exposureFilter ?? new ExposureFilter();
  }

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
   *
   * FE-13: hard-fails with exit 2 when a module resolves to the reserved
   * `apcli` namespace in any of three ways — explicit `display.cli.group`,
   * auto-grouped dotted prefix, or top-level alias/id. See spec §4.10.
   */
  buildGroupMap(): void {
    if (this.groupMapBuilt) {
      return;
    }
    this.buildAliasMap();
    for (const descriptor of this.registry.listModules()) {
      const moduleId = descriptor.id;
      const cached = this.descriptorCache.get(moduleId);
      if (!cached) {
        continue;
      }
      if (!this.exposureFilter.isExposed(moduleId)) {
        continue;
      }

      // Detect reserved-name collisions BEFORE routing — spec §4.10 three
      // cases: explicit group, auto-group prefix, top-level name.
      const display = getDisplay(cached);
      const cliDisplay = (display.cli && typeof display.cli === "object" && !Array.isArray(display.cli))
        ? (display.cli as Record<string, unknown>)
        : {};
      const explicitGroup = typeof cliDisplay.group === "string" && cliDisplay.group !== ""
        ? (cliDisplay.group as string)
        : undefined;
      if (explicitGroup !== undefined) {
        assertNotReserved("group", explicitGroup, moduleId);
      }

      const [group, cmd] = GroupedModuleGroup.resolveGroup(moduleId, cached);
      if (group !== null && explicitGroup === undefined) {
        // Auto-grouped (e.g. `apcli.foo` → group=`apcli`).
        assertNotReserved("auto-group", group, moduleId);
      }
      if (group === null) {
        assertNotReserved("top-level", cmd, moduleId);
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
    this.groupMapBuilt = true;
  }

  /**
   * List all available command names: group names + top-level module names.
   *
   * FE-13: the built-in subcommand list is no longer folded in here — those
   * commands live under the `apcli` prefix and are registered directly by
   * `createCli`.
   */
  override listCommands(): string[] {
    this.buildGroupMap();
    const groupNames = [...this.groupMap.keys()].filter(
      (g) => !RESERVED_GROUP_NAMES.has(g),
    );
    const topNames = [...this.topLevelModules.keys()];
    return [...new Set([...groupNames, ...topNames])].sort();
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
