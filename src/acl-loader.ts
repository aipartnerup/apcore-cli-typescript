/**
 * ACL root resolution and loading (FE-14 §4.1 / §4.2).
 *
 * The CLI resolves an ACL root through the FE-07 4-tier chain and then
 * delegates the parse to apcore's `ACL.load`. It deliberately does NOT
 * reimplement YAML rule parsing: rule-key closure, `effect` / `approval` enum
 * closure and pattern-array arity are apcore's contract and are conformance
 * tested there (FE-14 §4.2).
 *
 * The missing-path invariant (PROTOCOL_SPEC §6.1, FE-14 §4.2 step 1) is
 * load-bearing: a resolved path that does not exist attaches NOTHING. It must
 * never synthesize an empty ACL, because an empty ACL with
 * `default_effect: deny` denies every call in every project that has no
 * `acl/` directory.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { ACL, ACLDeniedError, Context, createIdentity } from "apcore-js";
import type { AuditEntry, AuditLogger as AclAuditCallback } from "apcore-js";
import { ConfigResolver, DEFAULTS } from "./config.js";
import { EXIT_CODES } from "./errors.js";
import { info as logInfo } from "./logger.js";
import { getAuditLogger, type AclAuditRecord } from "./security/audit.js";

/** The conventional file name inside an ACL directory (apcore `ACL.discover`). */
export const GLOBAL_ACL_FILENAME = "global_acl.yaml";

/**
 * Resolve the ACL root through the FE-07 4-tier chain (FE-14 §4.1).
 *
 * | Tier | Source                                    |
 * |------|-------------------------------------------|
 * | 1    | `createCli({ acl })` / `--acl PATH`       |
 * | 2    | `APCORE_ACL_ROOT`                         |
 * | 3    | `acl.root` in `apcore.yaml`               |
 * | 4    | `./acl` (only when it exists)             |
 *
 * Tier 2 is apcore-prefixed rather than `APCORE_CLI_`-prefixed because
 * `acl.root` is an apcore-owned config key — the same precedent
 * `extensions.root` / `APCORE_EXTENSIONS_ROOT` already sets.
 *
 * Never throws: an unresolvable root is reported as `null`.
 */
export function resolveAclRoot(
  config: ConfigResolver,
  cliFlag?: string | null,
): string | null {
  // Tier 1 — explicit flag / create_cli argument.
  if (typeof cliFlag === "string" && cliFlag !== "") {
    return cliFlag;
  }

  // Tier 2 — apcore-owned env var.
  const env = process.env.APCORE_ACL_ROOT;
  if (env !== undefined && env !== "") {
    return env;
  }

  // Tier 3 — `acl.root` in apcore.yaml. `resolveObject` walks the raw yaml
  // tree, so it reports "absent" distinctly from the tier-4 default that
  // `resolve()` would fold in.
  let fileValue: unknown = null;
  try {
    fileValue = config.resolveObject("acl.root");
  } catch {
    fileValue = null;
  }
  if (typeof fileValue === "string" && fileValue !== "") {
    return fileValue;
  }

  // Tier 4 — the documented default, but only when it actually exists.
  // Returning "./acl" unconditionally would make every caller re-implement
  // the existence probe, and the missing-path invariant is exactly what this
  // tier is about.
  const fallback = (DEFAULTS["acl.root"] as string | undefined) ?? "./acl";
  try {
    return fs.existsSync(fallback) ? fallback : null;
  } catch {
    return null;
  }
}

/**
 * The file `loadCliAcl` last read, or `null` when nothing was loaded.
 *
 * `ACL` keeps its source path private, and `apcli acl list` / `status` have to
 * name the file they are reporting on, so the resolved path is recorded here
 * at load time.
 */
let _lastAclSource: string | null = null;

/** Path of the ACL document most recently loaded by {@link loadCliAcl}. */
export function getAclSource(): string | null {
  return _lastAclSource;
}

// ---------------------------------------------------------------------------
// Audit wiring (FE-14 §4.8)
// ---------------------------------------------------------------------------

/** Environment override for `acl.audit.enabled` (FE-14 §5). */
export const ACL_AUDIT_ENABLED_ENV = "APCORE_ACL_AUDIT_ENABLED";

/** Environment override for `acl.audit.include_denied` (FE-14 §5). */
export const ACL_AUDIT_INCLUDE_DENIED_ENV = "APCORE_ACL_AUDIT_INCLUDE_DENIED";

/** Truthy / falsy spellings accepted from the environment, case-insensitive. */
const TRUE_WORDS: ReadonlySet<string> = new Set(["1", "true", "yes", "on"]);
const FALSE_WORDS: ReadonlySet<string> = new Set(["0", "false", "no", "off"]);

/**
 * Coerce a config value to a boolean. YAML and DEFAULTS already give a real
 * boolean; the environment can only give a string. An unrecognized value falls
 * back to the default rather than being read as `false` — a typo in
 * `APCORE_ACL_AUDIT_ENABLED` must not silently switch auditing off.
 */
function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (TRUE_WORDS.has(normalized)) return true;
    if (FALSE_WORDS.has(normalized)) return false;
  }
  return fallback;
}

function auditFlag(
  config: ConfigResolver | null | undefined,
  key: string,
  envVar: string,
): boolean {
  const fallback = DEFAULTS[key] !== false;
  let raw: unknown;
  try {
    raw = (config ?? new ConfigResolver()).resolve(key, undefined, envVar);
  } catch {
    // A config file we cannot read is not a reason to change the audit
    // posture: fall back to the env var, then to the default.
    raw = process.env[envVar];
  }
  return asBool(raw, fallback);
}

/** Whether ACL decisions are written to the FE-05 audit log (FE-14 §5). */
export function aclAuditEnabled(config?: ConfigResolver | null): boolean {
  return auditFlag(config, "acl.audit.enabled", ACL_AUDIT_ENABLED_ENV);
}

/**
 * Whether **denied** decisions are written (FE-14 §5).
 *
 * apcore's own meaning ("Whether to log denied access attempts"), not an
 * inverted one: `false` suppresses deny entries and keeps every allow entry.
 */
export function aclAuditIncludeDenied(config?: ConfigResolver | null): boolean {
  return auditFlag(
    config,
    "acl.audit.include_denied",
    ACL_AUDIT_INCLUDE_DENIED_ENV,
  );
}

/**
 * Adapt one apcore `AuditEntry` to the `snake_case` wire form FE-05 writes.
 *
 * All 13 fields are carried verbatim — `handler_error` and `approval_required`
 * included — because `~/.apcore-cli/audit.jsonl` is read by tooling that is not
 * this SDK. apcore-js surfaces the entry camelCased while apcore-python surfaces
 * it snake_cased, so both spellings are accepted on the way in and exactly one
 * comes out: a line written by the TypeScript CLI must be byte-comparable with
 * the Python and Rust ones.
 */
export function toAclAuditRecord(entry: AuditEntry): AclAuditRecord {
  const raw = entry as unknown as Record<string, unknown>;
  const read = (camel: string, snake: string): unknown =>
    raw[camel] !== undefined ? raw[camel] : raw[snake];

  const str = (value: unknown): string | null =>
    typeof value === "string" ? value : null;
  const num = (value: unknown): number | null =>
    typeof value === "number" ? value : null;

  return {
    timestamp: str(raw.timestamp) ?? new Date().toISOString(),
    caller_id: str(read("callerId", "caller_id")) ?? "",
    target_id: str(read("targetId", "target_id")) ?? "",
    decision: str(raw.decision) ?? "",
    reason: str(raw.reason) ?? "",
    matched_rule: str(read("matchedRule", "matched_rule")),
    matched_rule_index: num(read("matchedRuleIndex", "matched_rule_index")),
    identity_type: str(read("identityType", "identity_type")),
    roles: Array.isArray(raw.roles) ? raw.roles.map(String) : [],
    call_depth: num(read("callDepth", "call_depth")),
    trace_id: str(read("traceId", "trace_id")),
    handler_error: str(read("handlerError", "handler_error")),
    approval_required: read("approvalRequired", "approval_required") === true,
  };
}

/**
 * The callback handed to `new ACL(...)` — apcore emits exactly one entry per
 * `checkAccess()` call and this is what turns it into an audit-log line.
 *
 * The FE-05 logger is looked up per call rather than captured, so an ACL built
 * before `setAuditLogger()` runs still logs, and one built in a process that
 * never installed a logger simply writes nothing.
 */
export function createAclAuditCallback(includeDenied: boolean): AclAuditCallback {
  return (entry: AuditEntry): void => {
    try {
      const record = toAclAuditRecord(entry);
      // §4.8: `include_denied` suppresses DENY entries only. Allow entries are
      // still written — this is apcore's key, not an inverted CLI one.
      if (!includeDenied && record.decision === "deny") return;
      getAuditLogger()?.logAclDecision(record);
    } catch {
      // An audit failure MUST NOT change an access decision: this callback runs
      // inside `checkAccess`, so a throw here would turn a logging fault into a
      // failed call. Write errors are already warned about once by AuditLogger.
    }
  };
}

/**
 * Attach the audit callback to a freshly loaded ACL (FE-14 §4.8).
 *
 * `ACL.load` takes no callback, and no SDK offers a lossless attach after the
 * fact, so the CLI reads the file and constructs the ACL it actually attaches:
 *
 * ```ts
 * const src = ACL.load(resolvedPath);
 * const acl = new ACL(src.rules, src.defaultEffect, auditCallback);
 * ```
 *
 * Two load-bearing properties of that construction:
 *
 * 1. **`defaultEffect` is carried from the source ACL, never hardcoded.** A
 *    file may legitimately declare `default_effect: allow`; passing a literal
 *    `"deny"` would silently invert the governing default of every call no rule
 *    matched, and every test written against a `deny`-defaulted file would pass
 *    anyway. Only `src.defaultEffect` reproduces the file.
 * 2. **The rebuilt ACL loses `reload()`**, which needs the `_yamlPath` only
 *    `ACL.load` sets. Accepted and documented rather than worked around: no
 *    apcore-cli SDK calls `reload()` on any path, and an embedder that needs it
 *    supplies its own ACL through `createCli({ acl })`, which §4.2 attaches
 *    unchanged and never rebuilds.
 *
 * With auditing disabled the loaded ACL is returned AS IS — no rebuild, no
 * callback — so the `reload()` caveat applies to the auditing path only.
 */
export function withAclAudit(src: ACL, config?: ConfigResolver | null): ACL {
  if (!aclAuditEnabled(config)) return src;
  return new ACL(
    // `rules` is a frozen snapshot; the constructor wants a mutable array.
    [...src.rules],
    src.defaultEffect,
    createAclAuditCallback(aclAuditIncludeDenied(config)),
  );
}

/**
 * Load an ACL from a resolved root (FE-14 §4.2).
 *
 * Applies exactly the directory convention apcore's `ACL.discover` documents:
 *
 * 1. Path does not exist        → attach nothing, return `null`.
 * 2. Path is a directory        → load `<root>/global_acl.yaml`; absent → `null`.
 * 3. Path is a file             → load it directly.
 *
 * On success the FE-14 §4.8 audit callback is attached (see
 * {@link withAclAudit}) unless `acl.audit.enabled` is false, in which case the
 * `ACL.load` result is returned directly.
 *
 * @throws Whatever `ACL.load` raises — `ConfigNotFoundError` (the path vanished
 *   between resolve and load) or `ACLRuleError` (structurally invalid
 *   document). Both map to exit 47; see `exitCodeForError`.
 */
export function loadCliAcl(root: string, config?: ConfigResolver | null): ACL | null {
  _lastAclSource = null;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(root);
  } catch {
    // Missing path — the hard invariant. No enforcement, no synthesized ACL.
    return null;
  }

  let target = root;
  if (stat.isDirectory()) {
    target = path.join(root, GLOBAL_ACL_FILENAME);
    if (!fs.existsSync(target)) {
      return null;
    }
  }

  // Recorded BEFORE the parse so a failed load can name the file it tried
  // rather than the (possibly directory) root the user configured.
  _lastAclSource = target;
  return withAclAudit(ACL.load(target), config);
}

// ---------------------------------------------------------------------------
// Identity flags (FE-14 §4.3)
// ---------------------------------------------------------------------------

/**
 * The identity asserted on the command line via `--identity-id`,
 * `--identity-type` and `--role`.
 *
 * These are UNAUTHENTICATED assertions (FE-14 §7.1). They make a rule set
 * evaluable locally; they are not a deployment's access control. A rule
 * granting on `roles: [admin]` is trivially satisfied by anyone who can run
 * the binary.
 */
export interface CliIdentitySpec {
  id?: string;
  type?: string;
  roles?: string[];
}

/**
 * Default `Identity.id` when `--identity-type` / `--role` are given without
 * `--identity-id`. `Identity` requires an id, and this is the synthetic
 * principal standing in for "whoever ran the binary".
 *
 * The `@` prefix follows apcore's convention for synthetic principals
 * (`@external`, `@system`), so it cannot be confused with a real user whose id
 * is literally `cli`. It carries no privilege of its own. Normative and
 * identical across the three SDKs — Python and Rust export the same value
 * under the same name.
 */
export const DEFAULT_IDENTITY_ID = "@cli";

/** Default `Identity.type` (FE-14 §4.3). */
export const DEFAULT_CLI_IDENTITY_TYPE = "user";

/**
 * The identity flags' Commander declarations, shared verbatim between the root
 * program and `apcli acl check` (FE-14 §4.3, §4.5).
 *
 * `acl check` carries its own copies so `apcli acl check --role admin db.read`
 * works — Commander does not accept a root option after a subcommand — and the
 * same flag must not read two ways inside one CLI. Defining each flag and its
 * help text ONCE is what makes that structural rather than a convention two
 * files have to keep agreeing on.
 *
 * §7.1 requires every one of these to carry the assertion warning: a rule set
 * granting on `roles: [admin]` is trivially satisfied by anyone who can run
 * the binary.
 */
export const IDENTITY_FLAGS = {
  id: {
    flags: "--identity-id <id>",
    description:
      "Assert Identity.id for ACL conditions. Unauthenticated assertion, not authentication.",
  },
  type: {
    flags: "--identity-type <type>",
    description:
      "Assert Identity.type for ACL conditions (default: user). Unauthenticated assertion, not authentication.",
  },
  role: {
    flags: "--role <role>",
    description:
      "Assert an Identity role for ACL conditions. Repeatable. Unauthenticated assertion, not authentication.",
  },
} as const;

/** Commander's collector for the repeatable `--role` flag. */
export function collectRole(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

let _cliIdentity: CliIdentitySpec | null = null;

/**
 * Record the identity asserted by the global identity flags.
 *
 * Pass `null` (or a spec with no fields set) to clear it — when none of the
 * three flags is given no `Identity` is constructed at all, and conditional
 * rules keyed on `roles` / `identity_types` simply do not match, with apcore's
 * once-per-rule "no context" warning (FE-14 §4.3).
 */
export function setCliIdentity(spec: CliIdentitySpec | null): void {
  if (
    spec == null ||
    (spec.id === undefined &&
      spec.type === undefined &&
      (spec.roles === undefined || spec.roles.length === 0))
  ) {
    _cliIdentity = null;
    return;
  }
  _cliIdentity = spec;
}

/** The identity spec currently asserted by the global flags, if any. */
export function getCliIdentity(): CliIdentitySpec | null {
  return _cliIdentity;
}

/**
 * Build a `Context` carrying the asserted identity, or `undefined` when no
 * identity flag was given.
 *
 * `Context.callerId` is NEVER set here. apcore makes it settable only by
 * `Context.child()`, so a top-level CLI invocation is always the effective
 * caller `@external` — and a flag that forged it would let any user assume any
 * module's identity (FE-14 §7.2).
 */
export function buildCliContext(spec: CliIdentitySpec | null = _cliIdentity): Context | undefined {
  if (spec == null) return undefined;
  try {
    const identity = createIdentity(
      spec.id ?? DEFAULT_IDENTITY_ID,
      spec.type ?? DEFAULT_CLI_IDENTITY_TYPE,
      spec.roles ?? [],
    );
    return Context.create(identity);
  } catch {
    // A Context we cannot build is not worth aborting a call over — the
    // conditional rules simply stay unmatched, exactly as if no flag was given.
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Strategy-bypass warning (FE-14 §6.2)
// ---------------------------------------------------------------------------

/**
 * Strategies whose pipeline omits the `acl_check` step. Bypassing a
 * *configured* ACL is a materially different event from running with no rules
 * at all, which is why the warning names the strategy and says "configured".
 */
const ACL_BYPASSING_STRATEGIES: ReadonlySet<string> = new Set([
  "internal",
  "testing",
  "minimal",
]);

/**
 * The ACL attached to the CLI's executor, or `null` when none is configured.
 *
 * Held here, not only on the executor, because §4.10's delegated execution
 * paths need to reach an access decision in the PARENT process — before they
 * hand a call to something that carries no ACL at all.
 */
let _attachedAcl: ACL | null = null;

/** Record the ACL attached to the CLI's executor (`null` clears it). */
export function setAttachedAcl(acl: ACL | null): void {
  _attachedAcl = acl;
}

/** The attached ACL, or `null` when enforcement is not configured. */
export function getAttachedAcl(): ACL | null {
  return _attachedAcl;
}

/** Whether an ACL is attached to the CLI's executor. */
export function isAclAttached(): boolean {
  return _attachedAcl !== null;
}

/**
 * Emit the FE-14 §6.2 banner when the selected strategy removes the ACL gate
 * while an ACL is actually attached. Silent when no ACL is configured — there
 * is nothing to bypass.
 */
export function warnStrategyBypassesAcl(strategy?: string | null): void {
  if (_attachedAcl === null) return;
  if (typeof strategy !== "string" || !ACL_BYPASSING_STRATEGIES.has(strategy)) return;
  process.stderr.write(
    `⚠ Using '${strategy}' strategy — the configured ACL is not enforced.\n`,
  );
}

/**
 * Resolve + load + attach the CLI's ACL, mapping every failure onto the
 * documented exit codes (FE-14 §6).
 *
 * Returns the loaded ACL and the file it came from. `[null, null]` means "no
 * enforcement", which is silent and successful.
 */
export function loadAclOrExit(
  root: string,
  config?: ConfigResolver | null,
): [ACL | null, string | null] {
  try {
    const acl = loadCliAcl(root, config);
    return [acl, acl ? getAclSource() : null];
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    const detail = err instanceof Error ? err.message : String(err);
    const named = getAclSource() ?? root;
    if (code === "CONFIG_NOT_FOUND") {
      process.stderr.write(`Error: ACL file not found: ${named}\n`);
    } else {
      process.stderr.write(`Error: Invalid ACL configuration in ${named}: ${detail}\n`);
    }
    // 47 — the rule set could not be READ. Not 77: that stays reserved for a
    // real access decision (FE-14 §6.1).
    process.exit(EXIT_CODES.ACL_RULE_ERROR);
  }
}

/**
 * Note the "no enforcement" outcome (FE-14 §6, row 1). Silent above
 * `--log-level INFO` — a project with no `acl/` directory is the normal case,
 * not a fault.
 */
export function noteNoAclConfigured(root: string | null): void {
  logInfo(
    root === null
      ? "No ACL root resolved — access control is not enforced."
      : `No ACL loaded from '${root}' — access control is not enforced.`,
  );
}

// ---------------------------------------------------------------------------
// §4.10 — gating the execution paths that carry no ACL
// ---------------------------------------------------------------------------

/**
 * Build the §6.1.8 governance projection of an argument map.
 *
 * apcore computes this internally at pipeline Step 3 and hands it to the ACL
 * check at Step 4, but does not export the builder, so the CLI mirrors it. It
 * carries the argument KEY SET and each key's JSON type name, and never a
 * value — a projection that cannot hold a value cannot leak one.
 */
export function governanceProjection(args: Record<string, unknown> | null | undefined): {
  keys: string[];
  types: Record<string, string>;
} {
  const keys: string[] = [];
  const types: Record<string, string> = {};
  for (const [key, value] of Object.entries(args ?? {})) {
    // A protocol-level key, not caller input (PROTOCOL_SPEC §7.4).
    if (key === "_approval_token") continue;
    keys.push(key);
    types[key] = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  }
  return { keys, types };
}

/**
 * Reach an access decision for a call the CLI is about to hand to an execution
 * path that does NOT carry the attached ACL (FE-14 §4.10).
 *
 * Attaching an ACL to the executor gates the calls that go *through that
 * executor*, and nothing else. `--sandbox` re-execs into a child that builds a
 * fresh `Registry` + `Executor` from `APCORE_EXTENSIONS_ROOT`, so without this
 * the ACL is silently and completely bypassed — a **security** flag switching
 * off access control, which inverts the user's intent.
 *
 * The decision is made HERE, in the parent, which already holds the ACL: one
 * enforcement point rather than one per execution mechanism. The child
 * re-loading the ACL is explicitly NOT the control — the sandbox forwards a
 * narrow environment allowlist by design, so a child's view of `acl.root` is
 * neither guaranteed nor trustworthy as a gate.
 *
 * The caller is always `@external`: a real invocation never forges a caller
 * (§7.2), exactly as on the in-process path.
 *
 * @returns whether the matched rule requires the call to be put to a human.
 *   That requirement composes with the module's own annotation before the
 *   CLI's approval gate runs, or the same rule would demand a human on one
 *   path and not the other.
 * @throws {ACLDeniedError} when the rule set denies the call. Carries
 *   `code: "ACL_DENIED"`, so the CLI's existing cascade exits 77.
 */
export function assertDelegatedAccess(
  moduleId: string,
  inputData?: Record<string, unknown> | null,
): boolean {
  const acl = _attachedAcl;
  // No ACL configured is not a denial — enforcement is on only when
  // configured, and every project without an `acl/` directory must behave
  // exactly as it did before (§4.2, §7.4).
  if (acl === null) return false;

  // A Context is ALWAYS supplied, even when no identity flag was given.
  // §6.5 makes a conditional rule non-matching when the call supplies none,
  // and apcore's pipeline creates one at Step 1 for every real call — so
  // passing `null` here would leave every conditional rule inert on this path
  // while it fires on the in-process one. That is the same class of silent
  // bypass §4.10 exists to close, one level down.
  //
  // (`apcli acl check` deliberately does the opposite: it SIMULATES a call,
  // and a flagless simulation is honestly context-free. Here the call is real.)
  const decision = acl.checkAccess(
    DELEGATED_CALLER,
    moduleId,
    buildCliContext() ?? Context.create(null),
    { arguments: governanceProjection(inputData) },
  );

  if (decision.access === "deny") {
    throw new ACLDeniedError(DELEGATED_CALLER, moduleId);
  }
  return decision.approvalRequired;
}

/** The caller a real invocation presents. Never forged (FE-14 §7.2). */
const DELEGATED_CALLER = "@external";
