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
};

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

    // Tier 3: Config file
    const fileValue = this.resolveFromFile(key);
    if (fileValue !== undefined) {
      return fileValue;
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
