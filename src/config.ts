/**
 * ConfigResolver — 4-tier config resolution (CLI flag > env > file > default).
 *
 * Protocol spec: Configuration resolution
 */

import * as fs from "node:fs";
import yaml from "js-yaml";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Default configuration values. */
export const DEFAULTS: Record<string, unknown> = {
  "extensions.root": "./extensions",
  "logging.level": "WARNING",
  "sandbox.enabled": false,
  "cli.stdin_buffer_limit": 10_485_760,
  "cli.auto_approve": false,
  "cli.help_text_max_length": 1000,
  // Namespace-mode aliases (apcore >= 0.15.0 Config Bus)
  "apcore-cli.stdin_buffer_limit": 10_485_760,
  "apcore-cli.auto_approve": false,
  "apcore-cli.help_text_max_length": 1000,
  "apcore-cli.logging_level": "WARNING",
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
    // Dynamic import to avoid hard failure when apcore-js is not available
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Config } = require("apcore-js");
    if (typeof Config?.registerNamespace === "function") {
      Config.registerNamespace({
        name: "apcore-cli",
        envPrefix: "APCORE_CLI",
        defaults: {
          stdin_buffer_limit: 10_485_760,
          auto_approve: false,
          help_text_max_length: 1000,
          logging_level: "WARNING",
        },
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

  constructor(cliFlags?: Record<string, unknown>, configPath?: string) {
    this.cliFlags = cliFlags ?? {};
    this.configPath = configPath ?? "apcore.yaml";
  }

  /**
   * Resolve a single configuration key across all four tiers.
   */
  resolve(key: string, cliFlag?: string, envVar?: string): unknown {
    // Tier 1: CLI flag
    const flagKey = cliFlag ?? key;
    if (flagKey in this.cliFlags) {
      const value = this.cliFlags[flagKey];
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
      console.warn(
        `Configuration file '${this.configPath}' is malformed, using defaults.`,
      );
      return null;
    }

    let parsed: unknown;
    try {
      parsed = yaml.load(content);
    } catch {
      console.warn(
        `Configuration file '${this.configPath}' is malformed, using defaults.`,
      );
      return null;
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.warn(
        `Configuration file '${this.configPath}' is malformed, using defaults.`,
      );
      return null;
    }

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
