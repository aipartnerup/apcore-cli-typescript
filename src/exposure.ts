/**
 * Module Exposure Filtering (FE-12).
 *
 * Provides declarative control over which discovered modules are exposed
 * as CLI commands. Supports three modes: all, include (whitelist), and
 * exclude (blacklist) with glob-pattern matching on module IDs.
 */

import { warn } from "./logger.js";

// ---------------------------------------------------------------------------
// Glob pattern compiler
// ---------------------------------------------------------------------------

/** Escape special regex characters in a string. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compile a glob pattern to a regex.
 *
 * - `*` matches a single dotted segment (no dots): `[^.]*`
 * - `**` matches across segments (any characters including dots): `.+`
 * - Literal text is matched exactly via regex escaping.
 */
export function compilePattern(pattern: string): RegExp {
  const sentinel = "\x00GLOB\x00";
  const escaped = pattern.replaceAll("**", sentinel);
  const parts = escaped.split("*");
  const regexParts = parts.map((p) => {
    const restored = p.replaceAll(sentinel, "**");
    return escapeRegex(restored);
  });
  let regex = regexParts.join("[^.]*");
  regex = regex.replaceAll("\\*\\*", ".+");
  return new RegExp(`^${regex}$`);
}

/** Test whether a moduleId matches a glob pattern. */
export function globMatch(moduleId: string, pattern: string): boolean {
  return compilePattern(pattern).test(moduleId);
}

// ---------------------------------------------------------------------------
// ExposureFilter
// ---------------------------------------------------------------------------

/**
 * Determines which modules are exposed as CLI commands.
 *
 * Filtering modes:
 * - `all`: every discovered module becomes a CLI command (default).
 * - `include`: only modules matching at least one include pattern are exposed.
 * - `exclude`: all modules are exposed except those matching any exclude pattern.
 */
export class ExposureFilter {
  readonly _mode: string;
  private readonly _compiledInclude: RegExp[];
  private readonly _compiledExclude: RegExp[];

  constructor(mode = "all", include?: string[], exclude?: string[]) {
    this._mode = mode;
    const dedup = (arr: string[]) => [...new Set(arr)];
    this._compiledInclude = dedup(include ?? []).map(compilePattern);
    this._compiledExclude = dedup(exclude ?? []).map(compilePattern);
  }

  /** Return true if the module should be exposed as a CLI command. */
  isExposed(moduleId: string): boolean {
    if (this._mode === "all") return true;
    if (this._mode === "include") {
      return this._compiledInclude.some((rx) => rx.test(moduleId));
    }
    if (this._mode === "exclude") {
      return !this._compiledExclude.some((rx) => rx.test(moduleId));
    }
    return false;
  }

  /** Partition moduleIds into [exposed, hidden] lists. */
  filterModules(moduleIds: string[]): [string[], string[]] {
    const exposed: string[] = [];
    const hidden: string[] = [];
    for (const mid of moduleIds) {
      (this.isExposed(mid) ? exposed : hidden).push(mid);
    }
    return [exposed, hidden];
  }

  /**
   * Create an ExposureFilter from a parsed config dict.
   *
   * Expected: `{ expose: { mode: "include", include: ["admin.*"] } }`
   */
  static fromConfig(config: Record<string, unknown>): ExposureFilter {
    const expose = config.expose ?? {};
    if (typeof expose !== "object" || expose === null || Array.isArray(expose)) {
      warn("Invalid 'expose' config (expected dict), using mode: all.");
      return new ExposureFilter();
    }

    const exposeObj = expose as Record<string, unknown>;
    const mode = (exposeObj.mode as string) ?? "all";
    if (!["all", "include", "exclude"].includes(mode)) {
      throw new Error(
        `Invalid expose mode: '${mode}'. Must be one of: all, include, exclude.`,
      );
    }

    let include = exposeObj.include ?? [];
    if (!Array.isArray(include)) {
      warn("Invalid 'expose.include' (expected list), ignoring.");
      include = [];
    }

    let exclude = exposeObj.exclude ?? [];
    if (!Array.isArray(exclude)) {
      warn("Invalid 'expose.exclude' (expected list), ignoring.");
      exclude = [];
    }

    const filterList = (arr: unknown[], label: string): string[] => {
      const result: string[] = [];
      for (const p of arr) {
        if (!p) {
          warn(`Empty pattern in expose.${label}, skipping.`);
        } else {
          result.push(String(p));
        }
      }
      return result;
    };

    return new ExposureFilter(
      mode,
      filterList(include as unknown[], "include"),
      filterList(exclude as unknown[], "exclude"),
    );
  }
}
