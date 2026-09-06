/**
 * ConfigResolver — 4-tier config resolution (CLI flag > env > file > default).
 *
 * Protocol spec: Configuration resolution
 */

import * as fs from "node:fs";
import { createRequire } from "node:module";
import yaml from "js-yaml";
import { warn as logWarn } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Default configuration values.
 *
 * Audit D9 (config cleanup, v0.6.x): the entries `sandbox.enabled`,
 * `cli.auto_approve`, `cli.stdin_buffer_limit`, and the eight `apcore-cli.*`
 * namespace aliases were removed because no production code path reads
 * them via `resolve()`. Sandbox is configured via the `--sandbox` CLI flag,
 * auto-approve via `--yes`, the stdin buffer is hard-coded, and namespace
 * aliases are registered separately by `apcore-js`'s Config Bus when
 * `registerConfigNamespace()` runs at `createCli` startup. The cross-key
 * file-lookup mechanism (`NAMESPACE_TO_LEGACY` / `LEGACY_TO_NAMESPACE`)
 * still works regardless — it does not depend on these DEFAULTS entries.
 */
export const DEFAULTS: Record<string, unknown> = {
  "extensions.root": "./extensions",
  "logging.level": "WARNING",
  "cli.help_text_max_length": 1000,
  // FE-11 config keys
  "cli.approval_timeout": 60,
  "cli.strategy": "standard",
  "cli.group_depth": 1,
  // ACL governance (FE-14 §5). `acl.root` is an APCORE-owned key — its
  // environment override is `APCORE_ACL_ROOT`, not `APCORE_CLI_ACL_ROOT`,
  // exactly as `extensions.root` is overridden by `APCORE_EXTENSIONS_ROOT`.
  // A missing root attaches nothing; there is deliberately no
  // `acl.enabled: false` kill switch (FE-14 §5, §7.3).
  "acl.root": "./acl",
  // Audit wiring (FE-14 §4.8). apcore emits one `AuditEntry` per
  // `checkAccess()` call, but only through an `auditLogger` callback, and
  // nothing in apcore wires these keys to one — the CLI is the consumer.
  // Both keys are apcore-owned, so their environment overrides are
  // `APCORE_ACL_*` and not `APCORE_CLI_ACL_*`, exactly like `acl.root`.
  //
  // `include_denied` governs DENIED decisions only, which is apcore's own
  // meaning (`schemas/acl-config.schema.json`: "Whether to log denied access
  // attempts"). It is NOT an inverted "quiet" switch: `false` still writes
  // every allow decision.
  "acl.audit.enabled": true,
  "acl.audit.include_denied": true,
  // Exposure filtering (FE-12)
  "expose.mode": "all",
  "expose.include": [],
  "expose.exclude": [],
  // Builtin group visibility (FE-13) — apcli.* keys are NOT in DEFAULTS.
  // The runtime reads them via resolveObject('apcli') (raw yaml walk) and
  // does not use the flat-key resolve() path. Python and Rust have no such
  // entries either. (D11-008 cleanup)
};

/**
 * Defaults published to the apcore-cli Config Bus namespace (apcore >= 0.15.0).
 *
 * Exported for testability. Mirrors the snake_case DEFAULTS entries, with
 * `apcli` expressed as a nested object (matches the natural yaml shape).
 */
export const NAMESPACE_DEFAULTS: Record<string, unknown> = {
  stdin_buffer_limit: 10_485_760,
  auto_approve: false,
  help_text_max_length: 1000,
  logging_level: "WARNING",
  approval_timeout: 60,
  strategy: "standard",
  group_depth: 1,
  // FE-13 — builtin group visibility configuration
  apcli: {
    mode: null,
    include: [] as string[],
    exclude: [] as string[],
    disable_env: false,
  },
};

/** Namespace key ↔ legacy key mapping for backward compatibility. */
const NAMESPACE_TO_LEGACY: Record<string, string> = {
  "apcore-cli.stdin_buffer_limit": "cli.stdin_buffer_limit",
  "apcore-cli.auto_approve": "cli.auto_approve",
  "apcore-cli.help_text_max_length": "cli.help_text_max_length",
  "apcore-cli.logging_level": "logging.level",
};
const LEGACY_TO_NAMESPACE: Record<string, string> = Object.fromEntries(
  Object.entries(NAMESPACE_TO_LEGACY).map(([k, v]) => [v, k]),
);

/**
 * Register the apcore-cli Config Bus namespace (apcore >= 0.15.0).
 * Safe to call even when apcore-js is unavailable or < 0.15.0.
 */
export function registerConfigNamespace(): void {
  try {
    // Use createRequire to load apcore-js from an ESM module without relying on
    // tsup's `shims` option (which injects a `require` into the bundled output
    // but not into vitest/tsx dev paths). Native `require()` at module scope is
    // a ReferenceError in strict ESM and would silently no-op via the catch.
    const nodeRequire = createRequire(import.meta.url);
    const { Config } = nodeRequire("apcore-js");
    if (typeof Config?.registerNamespace === "function") {
      Config.registerNamespace({
        name: "apcore-cli",
        envPrefix: "APCORE_CLI",
        defaults: NAMESPACE_DEFAULTS,
      });
    }
  } catch {
    // apcore-js not installed or < 0.15.0 — graceful no-op
  }
}

// ---------------------------------------------------------------------------
// ConfigResolver
// ---------------------------------------------------------------------------

/**
 * Resolves configuration from four tiers (highest to lowest priority):
 *   1. CLI flags
 *   2. Environment variables
 *   3. Config file (YAML/JSON)
 *   4. Built-in defaults
 */
export class ConfigResolver {
  private readonly cliFlags: Record<string, unknown>;
  private readonly configPath: string;
  private fileCache: Record<string, unknown> | null = null;
  private fileCacheLoaded = false;
  /**
   * Raw parsed yaml root (pre-flatten). Populated alongside `fileCache`
   * on load. Used by `resolveObject()` to walk nested paths without
   * invoking `flattenDict` — see FE-13 spec §4.8 M1 note.
   * `null` when no config file is present or parsing fails.
   */
  private _rawConfig: Record<string, unknown> | null = null;

  constructor(cliFlags?: Record<string, unknown>, configPath?: string) {
    this.cliFlags = cliFlags ?? {};
    this.configPath = configPath ?? "apcore.yaml";
  }

  /**
   * Resolve a single configuration key across all four tiers.
   */
  resolve(key: string, cliFlag?: string, envVar?: string): unknown {
    // Tier 1: CLI flag
    //
    // Cross-SDK parity (D11-007, 2026-04-26): only consult `cliFlags` when
    // the caller passed an explicit `cliFlag` argument. Previously this code
    // used `cliFlag ?? key` which silently fell back to looking up the
    // config key itself in the cliFlags map — a phantom Tier-1 lookup that
    // could shadow file/default values when callers populated cliFlags with
    // config-keyed entries. Python (config.py:66) and Rust (config.rs:119)
    // skip Tier-1 entirely when the flag arg is None / missing; TS now
    // matches.
    if (cliFlag !== undefined && cliFlag in this.cliFlags) {
      const value = this.cliFlags[cliFlag];
      if (value !== null && value !== undefined) {
        return value;
      }
    }

    // Tier 2: Environment variable
    if (envVar) {
      const envValue = process.env[envVar];
      if (envValue !== undefined && envValue !== "") {
        return envValue;
      }
    }

    // Tier 3: Config file (try both namespace and legacy keys)
    const fileValue = this.resolveFromFile(key);
    if (fileValue !== undefined) {
      return fileValue;
    }
    const altKey = NAMESPACE_TO_LEGACY[key] ?? LEGACY_TO_NAMESPACE[key];
    if (altKey) {
      const altFileValue = this.resolveFromFile(altKey);
      if (altFileValue !== undefined) {
        return altFileValue;
      }
    }

    // Tier 4: Defaults
    return DEFAULTS[key];
  }

  /**
   * Load a value from the config file using a dot-separated key path.
   */
  private resolveFromFile(key: string): unknown {
    if (!this.fileCacheLoaded) {
      this.fileCache = this.loadConfigFile();
      this.fileCacheLoaded = true;
    }
    if (this.fileCache === null) {
      return undefined;
    }
    return this.fileCache[key];
  }

  /**
   * Resolve a configuration key to its raw nested value (FE-13).
   *
   * Unlike `resolve()`, this method does NOT flatten the yaml tree — it
   * walks the dot-separated path directly against the parsed yaml root.
   * This lets callers retrieve non-leaf structures (booleans, arrays,
   * objects) such as the `apcli` visibility config, which is naturally
   * shaped as a nested object in apcore.yaml.
   *
   * Semantics:
   *   - Returns `null` when no config file is loaded or when the path is
   *     not present / descends into a non-object node (including arrays).
   *   - Returns the raw value (boolean / array / object / scalar) when the
   *     full path resolves to a leaf or intermediate node.
   *
   * Intentionally DOES NOT consult DEFAULTS, env vars, or CLI flags — it is
   * strictly a yaml-tree accessor. Scalar `resolve()` semantics are
   * unaffected.
   */
  resolveObject(key: string): unknown {
    // Ensure raw config is populated (lazy load parity with `resolve`).
    if (!this.fileCacheLoaded) {
      this.fileCache = this.loadConfigFile();
      this.fileCacheLoaded = true;
    }
    if (this._rawConfig == null) {
      return null;
    }
    const parts = key.split(".");
    let cur: unknown = this._rawConfig;
    for (const p of parts) {
      if (
        cur != null &&
        typeof cur === "object" &&
        !Array.isArray(cur) &&
        p in (cur as Record<string, unknown>)
      ) {
        cur = (cur as Record<string, unknown>)[p];
      } else {
        return null;
      }
    }
    return cur;
  }

  /**
   * Load and flatten a YAML config file.
   */
  private loadConfigFile(): Record<string, unknown> | null {
    let content: string;
    try {
      content = fs.readFileSync(this.configPath, "utf-8");
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
        return null;
      }
      logWarn(
        `Configuration file '${this.configPath}' is malformed, using defaults.`,
      );
      return null;
    }

    let parsed: unknown;
    try {
      parsed = yaml.load(content);
    } catch {
      logWarn(
        `Configuration file '${this.configPath}' is malformed, using defaults.`,
      );
      return null;
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      logWarn(
        `Configuration file '${this.configPath}' is malformed, using defaults.`,
      );
      return null;
    }

    // Record the pre-flatten root for resolveObject() (FE-13).
    this._rawConfig = parsed as Record<string, unknown>;
    return this.flattenDict(parsed as Record<string, unknown>);
  }

  /**
   * Flatten nested dict to dot-notation keys.
   */
  private flattenDict(
    d: Record<string, unknown>,
    prefix = "",
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(d)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
      ) {
        Object.assign(
          result,
          this.flattenDict(value as Record<string, unknown>, fullKey),
        );
      } else {
        result[fullKey] = value;
      }
    }
    return result;
  }
}
