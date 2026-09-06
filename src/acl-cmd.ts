/**
 * `apcli acl` — author, inspect and lint access-control rules (FE-14 §4.4-§4.7).
 *
 * Four subcommands:
 *   - `list`     renders the attached rule set and its `default_effect`
 *   - `check`    evaluates a SIMULATED call through `ACL.checkAccess()`
 *   - `validate` reports every `RuleValidationFinding` from `validateRules()`
 *   - `status`   renders `Executor.governanceState()`
 *
 * Registered as a nested group under `apcli`, mirroring `apcli config` and
 * `apcli init` (FE-14 §4.10).
 */

import { Command, Option } from "commander";
import {
  Context,
  createIdentity,
  type ACL,
  type ACLRule,
  type Identity,
  type RuleValidationFinding,
} from "apcore-js";
import yaml from "js-yaml";
import { formatCsv, formatJsonl } from "apcore-toolkit";
import type { Executor, GovernanceState } from "./cli.js";
import { EXIT_CODES } from "./errors.js";
import { formatBoxTable, resolveFormat } from "./output.js";
import {
  collectRole,
  DEFAULT_IDENTITY_ID,
  DEFAULT_CLI_IDENTITY_TYPE,
  getCliIdentity,
  governanceProjection,
  IDENTITY_FLAGS,
  type CliIdentitySpec,
} from "./acl-loader.js";

/** The caller a real `apcli exec` presents. Never forged (FE-14 §7.2). */
const DEFAULT_CALLER = "@external";

const NO_ACL_MESSAGE = "No ACL configured; nothing to check.";

// ---------------------------------------------------------------------------
// Shared rendering helpers
// ---------------------------------------------------------------------------

/** Condition KEYS only, comma-joined in lexicographic order (FE-14 §4.4). */
function conditionKeys(conditions: unknown): string {
  if (conditions == null || typeof conditions !== "object" || Array.isArray(conditions)) {
    return "—";
  }
  const keys = Object.keys(conditions as Record<string, unknown>).sort();
  return keys.length > 0 ? keys.join(", ") : "—";
}

/** Wire-format (snake_case) view of one rule, as `--format json` emits it. */
function ruleToWire(rule: ACLRule, index: number): Record<string, unknown> {
  return {
    index,
    effect: rule.effect,
    approval: rule.approval ?? "not_required",
    callers: [...(rule.callers ?? [])],
    targets: [...(rule.targets ?? [])],
    conditions: rule.conditions ?? null,
    description: rule.description ?? "",
  };
}

/** Flat row shape for the tabular machine formats (csv / jsonl). */
function ruleToRow(rule: ACLRule, index: number): Record<string, unknown> {
  return {
    index,
    effect: rule.effect,
    approval: rule.approval ?? "not_required",
    callers: (rule.callers ?? []).join(","),
    targets: (rule.targets ?? []).join(","),
    conditions: conditionKeys(rule.conditions) === "—" ? "" : conditionKeys(rule.conditions),
    description: rule.description ?? "",
  };
}

/**
 * Build the `Context` for a simulated check.
 *
 * `callerId` is deliberately absent: apcore makes it settable only by
 * `Context.child()`, and `checkAccess()` takes the simulated caller as its own
 * argument (FE-14 §4.5, §7.2). `--depth N` populates a synthetic call chain,
 * which is the only thing the built-in `max_call_depth` handler reads.
 *
 * Returns `undefined` when no context-affecting flag was given, so a rule
 * carrying conditions reports apcore's once-per-rule "no context" non-match
 * (PROTOCOL_SPEC §6.5) rather than a silently different verdict. A Context IS
 * built whenever `--input` is present: §6.5 short-circuits every conditional
 * rule when the call supplies none, so an `arguments` condition would be
 * unreachable without one.
 */
function buildCheckContext(
  spec: CliIdentitySpec | null,
  depth?: number,
  hasArguments = false,
): Context | undefined {
  const hasIdentity =
    spec != null &&
    (spec.id !== undefined ||
      spec.type !== undefined ||
      (spec.roles !== undefined && spec.roles.length > 0));
  // `depth === undefined` — value-independent, matching Python's
  // `depth is not None` / Rust's `depth.is_some()`. An EXPLICIT `--depth 0`
  // must still build a Context (with an empty, length-0 call chain): folding
  // it into "no context-affecting flag was given" made a rule conditioned on
  // `max_call_depth` UNEVALUABLE instead of evaluating it against a 0-length
  // chain, which can flip the allow/deny decision relative to Python/Rust —
  // a security-relevant divergence, not a cosmetic one.
  if (!hasIdentity && !hasArguments && depth === undefined) {
    return undefined;
  }

  let identity: Identity | null = null;
  if (hasIdentity) {
    identity = createIdentity(
      spec!.id ?? DEFAULT_IDENTITY_ID,
      spec!.type ?? DEFAULT_CLI_IDENTITY_TYPE,
      spec!.roles ?? [],
    );
  }

  if (depth !== undefined && depth > 0) {
    // `max_call_depth` reads only `context.callChain.length`, so a synthetic
    // chain of the requested depth is the whole of what the condition needs.
    const chain = Array.from({ length: depth }, (_, i) => `synthetic.frame${i}`);
    return new Context(randomTraceId(), null, chain, null, identity);
  }
  return Context.create(identity);
}

function randomTraceId(): string {
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += "0123456789abcdef"[Math.floor(Math.random() * 16)];
  }
  return out;
}

/** Resolve a per-command identity flag, falling back to the global one. */
function mergeIdentity(
  local: { identityId?: string; identityType?: string; role?: string[] },
): CliIdentitySpec | null {
  const global = getCliIdentity();
  const id = local.identityId ?? global?.id;
  const type = local.identityType ?? global?.type;
  const roles =
    local.role !== undefined && local.role.length > 0 ? local.role : global?.roles;
  if (id === undefined && type === undefined && (roles === undefined || roles.length === 0)) {
    return null;
  }
  return { id, type, roles };
}

// ---------------------------------------------------------------------------
// registerAclCommand
// ---------------------------------------------------------------------------

/**
 * Register the `acl` nested group on the `apcli` group (FE-14 §4.10).
 *
 * @param apcliGroup - The built-in group to attach to.
 * @param executor   - The CLI's executor, for `acl status`.
 * @param acl        - The attached ACL, or `null` when none is configured.
 * @param source     - The file `acl` was loaded from, for display.
 */
export function registerAclCommand(
  apcliGroup: Command,
  executor: Executor,
  acl: ACL | null,
  source: string | null = null,
): void {
  const aclGroup = new Command("acl").description(
    "Inspect and lint the access-control rule set.",
  );

  registerListSubcommand(aclGroup, acl, source);
  registerCheckSubcommand(aclGroup, acl);
  registerValidateSubcommand(aclGroup, acl);
  registerStatusSubcommand(aclGroup, executor, acl, source);

  apcliGroup.addCommand(aclGroup);
}

// ---------------------------------------------------------------------------
// acl list (FE-14 §4.4)
// ---------------------------------------------------------------------------

function registerListSubcommand(
  aclGroup: Command,
  acl: ACL | null,
  source: string | null,
): void {
  const cmd = new Command("list")
    .description("Show the attached rules in definition (evaluation) order.")
    .addOption(
      new Option("--format <format>", "Output format.")
        .choices(["table", "json", "csv", "yaml", "jsonl"]),
    )
    .action((opts: { format?: string }) => {
      const fmt = resolveFormat(opts.format);
      const rules = acl ? [...acl.rules] : [];
      const payload = {
        source: acl ? source : null,
        default_effect: acl ? acl.defaultEffect : null,
        rules: rules.map(ruleToWire),
      };

      if (fmt === "json") {
        process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
        return;
      }
      if (fmt === "yaml") {
        process.stdout.write(yaml.dump(payload, { lineWidth: -1 }));
        return;
      }
      if (fmt === "csv" || fmt === "jsonl") {
        // Listing nothing is not an error — emit an empty document, not a
        // failure (FE-14 §4.4).
        if (rules.length === 0) return;
        const rows = rules.map(ruleToRow);
        process.stdout.write(fmt === "csv" ? formatCsv(rows) : formatJsonl(rows));
        return;
      }

      // table
      if (!acl) {
        process.stdout.write("No ACL configured.\n");
        return;
      }
      const plural = rules.length === 1 ? "rule" : "rules";
      process.stdout.write(
        `Default effect: ${acl.defaultEffect}   ` +
          `(source: ${source ?? "unknown"}, ${rules.length} ${plural})\n\n`,
      );
      const rows = rules.map((r, i) => [
        String(i),
        r.effect,
        r.approval ?? "not_required",
        (r.callers ?? []).join(", "),
        (r.targets ?? []).join(", "),
        conditionKeys(r.conditions),
        r.description ?? "",
      ]);
      process.stdout.write(
        formatBoxTable(
          ["#", "Effect", "Approval", "Callers", "Targets", "Conditions", "Description"],
          rows,
          [true],
        ),
      );
    });
  aclGroup.addCommand(cmd);
}

// ---------------------------------------------------------------------------
// acl check (FE-14 §4.5)
// ---------------------------------------------------------------------------

function registerCheckSubcommand(aclGroup: Command, acl: ACL | null): void {
  const cmd = new Command("check")
    .description(
      "Evaluate a simulated call against the rule set. Executes nothing.",
    )
    .argument("<target>", "Target module ID.")
    // `--caller` deliberately carries NO Commander default: the help text
    // states the default inline, and a second `[default: @external]` appended
    // by the formatter would say the same thing twice. Resolved at the use
    // site instead.
    .option(
      "--caller <id>",
      "Simulated caller ID (default: @external). Nothing is executed, so any value is accepted.",
    )
    // The three identity flags are the ROOT declarations, reused verbatim.
    // `apcli acl check --role admin db.read` reads far better than
    // `apcore-cli --role admin apcli acl check db.read`, and Commander will
    // not accept a root option after a subcommand — so the flags exist at both
    // levels, and share one definition so they cannot drift apart.
    .option(IDENTITY_FLAGS.id.flags, IDENTITY_FLAGS.id.description)
    .option(IDENTITY_FLAGS.type.flags, IDENTITY_FLAGS.type.description)
    .option(
      IDENTITY_FLAGS.role.flags,
      IDENTITY_FLAGS.role.description,
      collectRole,
      [] as string[],
    )
    .option(
      "--depth <n>",
      "Simulated call-chain depth for the max_call_depth condition.",
      (v: string) => parseInt(v, 10),
    )
    .option(
      "--input <json>",
      "Argument map for the arguments condition. Key presence only; values are not compared.",
    )
    .addOption(
      new Option("--format <format>", "Output format.").choices(["table", "json"]),
    )
    .action((
      target: string,
      opts: {
        caller?: string;
        identityId?: string;
        identityType?: string;
        role: string[];
        depth?: number;
        input?: string;
        format?: string;
      },
    ) => {
      if (!acl) {
        process.stderr.write(`Error: ${NO_ACL_MESSAGE}\n`);
        process.exit(EXIT_CODES.ACL_RULE_ERROR);
      }

      let args: Record<string, unknown> | null = null;
      if (opts.input !== undefined) {
        try {
          const parsed: unknown = JSON.parse(opts.input);
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            process.stderr.write("Error: --input JSON must be an object.\n");
            process.exit(EXIT_CODES.INVALID_CLI_INPUT);
          }
          args = parsed as Record<string, unknown>;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(`Error: --input is not valid JSON: ${msg}\n`);
          process.exit(EXIT_CODES.INVALID_CLI_INPUT);
        }
      }

      // `--caller` defaults to what a real `apcli exec` would present.
      const caller = opts.caller ?? DEFAULT_CALLER;
      const context = buildCheckContext(mergeIdentity(opts), opts.depth, args !== null);

      // checkAccess, NEVER check(): the boolean fails closed on approval, so a
      // call that is allowed but needs a human would read as "denied"
      // (FE-14 §4.5).
      const decision = acl.checkAccess(
        caller,
        target,
        context ?? null,
        args ? { arguments: governanceProjection(args) } : null,
      );

      const fmt = resolveFormat(opts.format);
      if (fmt === "json" || fmt !== "table") {
        process.stdout.write(
          JSON.stringify(
            {
              target,
              caller,
              access: decision.access,
              approval_required: decision.approvalRequired,
              matched_rule_index: decision.matchedRuleIndex,
              reason: decision.reason,
            },
            null,
            2,
          ) + "\n",
        );
      } else {
        const idx = decision.matchedRuleIndex;
        let ruleNote = "(no rule matched)";
        if (idx !== null && idx >= 0 && idx < acl.rules.length) {
          const desc = acl.rules[idx].description;
          ruleNote = desc ? `(rule #${idx}: "${desc}")` : `(rule #${idx})`;
        }
        process.stdout.write(
          `Target:   ${target}\n` +
            `Caller:   ${caller}\n` +
            `Decision: ${decision.access.toUpperCase()}  ${ruleNote}\n` +
            `Approval: ${decision.approvalRequired ? "REQUIRED" : "NOT REQUIRED"}\n` +
            `Reason:   ${decision.reason}\n`,
        );
      }

      // An allow-with-approval outcome exits 0: authorization and approval are
      // independent axes, and conflating "needs a human" with "denied" would
      // make this exit code unusable for scripted policy checks (FE-14 §4.5).
      if (decision.access === "deny") {
        process.stderr.write(`Access denied: ${caller} -> ${target}\n`);
        process.exit(EXIT_CODES.ACL_DENIED);
      }
      process.exit(EXIT_CODES.SUCCESS);
    });
  aclGroup.addCommand(cmd);
}

// ---------------------------------------------------------------------------
// acl validate (FE-14 §4.6)
// ---------------------------------------------------------------------------

function findingToWire(f: RuleValidationFinding): Record<string, unknown> {
  return {
    rule_index: f.ruleIndex,
    condition_path: f.conditionPath,
    condition_key: f.conditionKey,
    effect: f.effect,
    // Reported separately and NEVER collapsed into one boolean: a finding with
    // sync=false / async=true is an async-only handler — working under
    // asyncCheck(), unevaluable under check() (PROTOCOL_SPEC §6.1.3 rule 3).
    sync_resolvable: f.syncResolvable,
    async_resolvable: f.asyncResolvable,
  };
}

function registerValidateSubcommand(aclGroup: Command, acl: ACL | null): void {
  const cmd = new Command("validate")
    .description("Report every structural or registry fault in the rule set.")
    .addOption(
      new Option("--format <format>", "Output format.").choices(["table", "json"]),
    )
    .action((opts: { format?: string }) => {
      if (!acl) {
        process.stderr.write(`Error: ${NO_ACL_MESSAGE}\n`);
        process.exit(EXIT_CODES.ACL_RULE_ERROR);
      }

      const findings = [...acl.validateRules()];
      const fmt = resolveFormat(opts.format);

      if (fmt === "json" || fmt !== "table") {
        process.stdout.write(
          JSON.stringify(
            { count: findings.length, findings: findings.map(findingToWire) },
            null,
            2,
          ) + "\n",
        );
      } else if (findings.length === 0) {
        process.stdout.write("0 findings\n");
      } else {
        const plural = findings.length === 1 ? "finding" : "findings";
        process.stdout.write(`${findings.length} ${plural}:\n\n`);
        const rows = findings.map((f) => [
          String(f.ruleIndex),
          f.conditionPath,
          f.conditionKey ?? "—",
          f.effect,
          f.syncResolvable ? "yes" : "no",
          f.asyncResolvable ? "yes" : "no",
        ]);
        process.stdout.write(
          formatBoxTable(
            ["Rule", "Path", "Key", "Effect", "Sync", "Async"],
            rows,
            [true, false, false, false, true, true],
          ),
        );
        process.stdout.write(
          "\nA finding on a `deny` rule is the consequential one: that rule now denies\n" +
            "every call it matches.\n",
        );
      }

      // Strict, CI-friendly default: any finding is a failure. The JSON output
      // carries each finding's `effect` so a caller that wants to gate only on
      // deny rules can do so (FE-14 §4.6, open question 1).
      process.exit(
        findings.length === 0 ? EXIT_CODES.SUCCESS : EXIT_CODES.ACL_RULE_ERROR,
      );
    });
  aclGroup.addCommand(cmd);
}

// ---------------------------------------------------------------------------
// acl status (FE-14 §4.7)
// ---------------------------------------------------------------------------

/** Label / field pairs in the order §4.7 renders them. */
const STATUS_ROWS: ReadonlyArray<[string, keyof GovernanceState]> = [
  ["Control modules registered:", "controlModulesRegistered"],
  ["Read modules registered:", "readModulesRegistered"],
  ["ACL configured:", "aclConfigured"],
  ["Built-in ACL gate wired:", "builtinAclGateWired"],
  ["Approval handler configured:", "approvalHandlerConfigured"],
  ["Built-in approval gate wired:", "builtinApprovalGateWired"],
  ["Policy strict:", "policyStrict"],
  ["All control modules gated:", "allControlModulesRequireApproval"],
];

/** snake_case wire names for the nine observations (cross-SDK CLI contract). */
const STATUS_WIRE: ReadonlyArray<[string, keyof GovernanceState]> = [
  ...STATUS_ROWS.map(([, field]) => [toSnake(field), field] as [string, keyof GovernanceState]),
  ["unprotected_control_surface", "unprotectedControlSurface"],
];

function toSnake(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function registerStatusSubcommand(
  aclGroup: Command,
  executor: Executor,
  acl: ACL | null,
  source: string | null,
): void {
  const cmd = new Command("status")
    .description("Report what is actually gating the registry.")
    .option(
      "--strict",
      "Exit 47 when the control surface is unprotected.",
      false,
    )
    .addOption(
      new Option("--format <format>", "Output format.").choices(["table", "json"]),
    )
    .action((opts: { strict: boolean; format?: string }) => {
      if (typeof executor.governanceState !== "function") {
        process.stderr.write(
          "Error: this executor does not expose governanceState(); " +
            "upgrade apcore-js to >= 0.29.0.\n",
        );
        process.exit(EXIT_CODES.MODULE_EXECUTE_ERROR);
      }

      const state = executor.governanceState();
      const fmt = resolveFormat(opts.format);

      if (fmt === "json" || fmt !== "table") {
        const payload: Record<string, unknown> = {};
        for (const [wire, field] of STATUS_WIRE) {
          payload[wire] = state[field];
        }
        payload.acl_source = acl ? source : null;
        process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
      } else {
        const lines: string[] = [];
        for (const [label, field] of STATUS_ROWS) {
          let value = state[field] ? "yes" : "no";
          if (field === "aclConfigured" && state[field] && source) {
            value += `  (${source})`;
          }
          lines.push(label.padEnd(30) + value);
        }
        lines.push("─".repeat(33));
        lines.push(
          "Unprotected control surface:".padEnd(30) +
            (state.unprotectedControlSurface ? "YES" : "NO"),
        );
        process.stdout.write(lines.join("\n") + "\n");
      }

      if (opts.strict && state.unprotectedControlSurface) {
        process.stderr.write("Unprotected control surface.\n");
        process.exit(EXIT_CODES.ACL_RULE_ERROR);
      }
      process.exit(EXIT_CODES.SUCCESS);
    });
  aclGroup.addCommand(cmd);
}
