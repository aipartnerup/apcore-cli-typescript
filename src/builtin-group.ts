/**
 * Built-in Command Group (FE-13).
 *
 * Encapsulates visibility resolution and subcommand filtering for the
 * reserved `apcli` group. Instantiated once by createCli() and attached
 * to the root command.
 *
 * Shape mirrors `src/exposure.ts` ExposureFilter: private constructor,
 * named static factories, and a small set of predicate methods.
 * See the feature spec §4.2–4.7 for authoritative semantics.
 */

import { EXIT_CODES } from "./errors.js";
import { warn } from "./logger.js";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

/**
 * Resolved visibility mode.
 *
 * `"auto"` is an internal sentinel — it is never returned from
 * {@link ApcliGroup.resolveVisibility} and is rejected when supplied via
 * user config (CliConfig or apcore.yaml).
 */
export type ApcliMode = "auto" | "all" | "none" | "include" | "exclude";

/**
 * User-facing apcli config shape.
 *
 * Boolean shorthand maps to `{mode: "all"}` / `{mode: "none"}`.
 * Object form rejects `"auto"` per spec §4.2 (internal sentinel only).
 */
export type ApcliConfig =
  | boolean
  | {
      mode?: Exclude<ApcliMode, "auto">;
      include?: string[];
      exclude?: string[];
      disableEnv?: boolean;
    };

/** Set of group names reserved by apcore-cli (checked in cli.ts). */
export const RESERVED_GROUP_NAMES: ReadonlySet<string> = new Set(["apcli"]);

const VALID_USER_MODES: ReadonlySet<string> = new Set([
  "all",
  "none",
  "include",
  "exclude",
]);

/**
 * Canonical set of apcli subcommand names.
 *
 * Declarative mirror of the registration TABLE in `src/main.ts`
 * (`_registerApcliSubcommands`). Used by `_normalizeList` to warn on
 * unknown entries in include/exclude lists (spec §7 error table / T-APCLI-25).
 *
 * Keep in sync with main.ts TABLE if subcommands are added or removed.
 */
export const APCLI_SUBCOMMAND_NAMES: ReadonlySet<string> = new Set([
  "list",
  "describe",
  "exec",
  "validate",
  "init",
  "health",
  "usage",
  "enable",
  "disable",
  "reload",
  "config",
  "completion",
  "describe-pipeline",
]);

// ---------------------------------------------------------------------------
// ApcliGroup
// ---------------------------------------------------------------------------

interface ApcliGroupInit {
  mode: ApcliMode;
  include: string[];
  exclude: string[];
  disableEnv: boolean;
  registryInjected: boolean;
  fromCliConfig: boolean;
}

/**
 * Visibility configuration for the built-in `apcli` command group.
 *
 * Instantiated via {@link ApcliGroup.fromCliConfig} (Tier 1) or
 * {@link ApcliGroup.fromYaml} (Tier 3). The constructor is private to
 * preserve the Tier-1-vs-Tier-3 flag distinction.
 */
export class ApcliGroup {
  private readonly _mode: ApcliMode;
  private readonly _include: string[];
  private readonly _exclude: string[];
  private readonly _disableEnv: boolean;
  private readonly _registryInjected: boolean;
  private readonly _fromCliConfig: boolean;

  private constructor(init: ApcliGroupInit) {
    this._mode = init.mode;
    this._include = init.include;
    this._exclude = init.exclude;
    this._disableEnv = init.disableEnv;
    this._registryInjected = init.registryInjected;
    this._fromCliConfig = init.fromCliConfig;
  }

  /**
   * Tier 1 constructor — config came from `createCli({ apcli })`.
   *
   * A non-auto mode from this tier wins over env var and yaml.
   */
  static fromCliConfig(
    config: ApcliConfig | undefined,
    opts: { registryInjected: boolean },
  ): ApcliGroup {
    return ApcliGroup._build(config, opts, /*fromCliConfig*/ true);
  }

  /**
   * Tier 3 constructor — config came from `apcore.yaml`.
   *
   * Env var (Tier 2) may override the yaml-supplied mode.
   */
  static fromYaml(
    config: unknown,
    opts: { registryInjected: boolean },
  ): ApcliGroup {
    return ApcliGroup._build(
      config as ApcliConfig | undefined,
      opts,
      /*fromCliConfig*/ false,
    );
  }

  // -------------------------------------------------------------------------
  // Internal builder — shared by both factories
  // -------------------------------------------------------------------------

  private static _build(
    config: ApcliConfig | undefined,
    opts: { registryInjected: boolean },
    fromCliConfig: boolean,
  ): ApcliGroup {
    // Boolean shorthand → normalized object form.
    if (config === true) {
      return new ApcliGroup({
        mode: "all",
        include: [],
        exclude: [],
        disableEnv: false,
        registryInjected: opts.registryInjected,
        fromCliConfig,
      });
    }
    if (config === false) {
      return new ApcliGroup({
        mode: "none",
        include: [],
        exclude: [],
        disableEnv: false,
        registryInjected: opts.registryInjected,
        fromCliConfig,
      });
    }

    // Missing / nullish → auto-detect (mode left as internal sentinel).
    if (config === undefined || config === null) {
      return new ApcliGroup({
        mode: "auto",
        include: [],
        exclude: [],
        disableEnv: false,
        registryInjected: opts.registryInjected,
        fromCliConfig,
      });
    }

    if (typeof config !== "object" || Array.isArray(config)) {
      // Unexpected shape — refuse to silently coerce.
      process.stderr.write(
        `Error: apcli config must be a boolean or object; got ${Array.isArray(config) ? "array" : typeof config}.\n`,
      );
      process.exit(EXIT_CODES.INVALID_CLI_INPUT);
    }

    const cfg = config as Record<string, unknown>;

    // Mode validation. `"auto"` and unknown values are rejected.
    let mode: ApcliMode;
    if (cfg.mode === undefined || cfg.mode === null) {
      // Object form without mode (e.g. `{disableEnv: true}`) → mode auto.
      mode = "auto";
    } else if (typeof cfg.mode !== "string") {
      process.stderr.write(
        `Error: apcli.mode must be a string; got ${typeof cfg.mode}. ` +
          `Expected one of all|none|include|exclude.\n`,
      );
      process.exit(EXIT_CODES.INVALID_CLI_INPUT);
    } else if (!VALID_USER_MODES.has(cfg.mode)) {
      process.stderr.write(
        `Error: apcli.mode '${cfg.mode}' is invalid. ` +
          `Expected one of all|none|include|exclude.\n`,
      );
      process.exit(EXIT_CODES.INVALID_CLI_INPUT);
    } else {
      mode = cfg.mode as ApcliMode;
    }

    // include / exclude lists — warn on non-array, keep entries as-is.
    const include = ApcliGroup._normalizeList(cfg.include, "include");
    const exclude = ApcliGroup._normalizeList(cfg.exclude, "exclude");

    // disableEnv — accept both camelCase (JS object literal) and snake_case
    // (yaml-per-spec §4.2 / §10.3). Must be boolean; warn + treat as false
    // otherwise.
    const rawDisableEnv =
      cfg.disableEnv !== undefined
        ? cfg.disableEnv
        : (cfg as Record<string, unknown>)["disable_env"];
    let disableEnv = false;
    if (rawDisableEnv !== undefined) {
      if (typeof rawDisableEnv === "boolean") {
        disableEnv = rawDisableEnv;
      } else {
        warn(
          `apcli.disable_env must be boolean; got ${typeof rawDisableEnv}. Treating as false.`,
        );
      }
    }

    return new ApcliGroup({
      mode,
      include,
      exclude,
      disableEnv,
      registryInjected: opts.registryInjected,
      fromCliConfig,
    });
  }

  /**
   * Normalize an include/exclude list. Non-array → warn and return [].
   *
   * Unknown but well-formed entries emit a WARNING (spec §7 error table,
   * T-APCLI-25) but are retained in the returned list for forward-compat —
   * if apcore-cli later adds a subcommand named `foo`, existing configs
   * continue to work without a config change. At runtime, unknown names
   * simply never match any registered subcommand.
   */
  private static _normalizeList(raw: unknown, label: string): string[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) {
      warn(`apcli.${label} must be a list; got ${typeof raw}. Ignoring.`);
      return [];
    }
    const out: string[] = [];
    for (const entry of raw) {
      if (typeof entry === "string" && entry.length > 0) {
        if (!APCLI_SUBCOMMAND_NAMES.has(entry)) {
          warn(
            `Unknown apcli subcommand '${entry}' in ${label} list — ignoring.`,
          );
        }
        out.push(entry);
      } else {
        warn(`apcli.${label} contains non-string entry; skipping.`);
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Resolve effective visibility mode after applying tier precedence.
   *
   * Returns one of `"all" | "none" | "include" | "exclude"` — never `"auto"`.
   *
   * Tier order (spec §4.4):
   *   1. CliConfig non-auto wins outright.
   *   2. `APCORE_CLI_APCLI` env var (unless sealed by disableEnv).
   *   3. yaml non-auto.
   *   4. Auto-detect from registryInjected.
   */
  resolveVisibility(): "all" | "none" | "include" | "exclude" {
    // Tier 1 — CliConfig non-auto.
    if (this._fromCliConfig && this._mode !== "auto") {
      return this._mode;
    }

    // Tier 2 — env var (unless sealed).
    if (!this._disableEnv) {
      const envMode = this._parseEnv(process.env.APCORE_CLI_APCLI);
      if (envMode !== null) {
        return envMode;
      }
    }

    // Tier 3 — yaml non-auto.
    if (this._mode !== "auto") {
      return this._mode;
    }

    // Tier 4 — auto-detect.
    return this._registryInjected ? "none" : "all";
  }

  /**
   * True iff `subcommand` passes the include/exclude filter.
   *
   * Callers MUST first check {@link resolveVisibility} — this method throws
   * under modes `"all"` or `"none"` (caller bug per spec §4.6).
   */
  isSubcommandIncluded(subcommand: string): boolean {
    const mode = this.resolveVisibility();
    if (mode === "include") return this._include.includes(subcommand);
    if (mode === "exclude") return !this._exclude.includes(subcommand);
    throw new Error(
      `isSubcommandIncluded called under mode '${mode}'; caller should bypass.`,
    );
  }

  /** True iff the `apcli` group itself should appear in root `--help`. */
  isGroupVisible(): boolean {
    return this.resolveVisibility() !== "none";
  }

  // -------------------------------------------------------------------------
  // Env parser (Tier 2) — co-located per spec §4.4
  // -------------------------------------------------------------------------

  /**
   * Parse APCORE_CLI_APCLI. Case-insensitive.
   *
   * - `show` / `1` / `true` → `"all"`
   * - `hide` / `0` / `false` → `"none"`
   * - Empty / unset → `null`
   * - Anything else → warn and return `null`
   */
  private _parseEnv(raw: string | undefined): "all" | "none" | null {
    if (raw === undefined || raw === "") return null;
    const normalized = raw.toLowerCase();
    if (normalized === "show" || normalized === "1" || normalized === "true") {
      return "all";
    }
    if (
      normalized === "hide" ||
      normalized === "0" ||
      normalized === "false"
    ) {
      return "none";
    }
    warn(
      `Unknown APCORE_CLI_APCLI value '${raw}', ignoring. ` +
        `Expected: show, hide, 1, 0, true, false.`,
    );
    return null;
  }
}
