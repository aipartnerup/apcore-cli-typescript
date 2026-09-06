/**
 * FE-14 ACL Governance — verification matrix T-ACL-01..30.
 *
 * T-ACL-24 (an ACL rule carrying `approval: required` on a module annotated
 * `requires_approval: false` routes to `CliApprovalHandler`) is covered by the
 * pre-existing `tests/acl-argument-scoped-approval.test.ts`, including its
 * discriminating refusing-handler case.
 *
 * The §4.8 audit-wiring cases (T-ACL-26, 27, 27a, 27b, 27c) were once recorded
 * here as blocked on an upstream public `ACL.setAuditLogger`. That claim was
 * wrong and has been retracted: all three SDKs accept the callback as a
 * constructor argument, so the load-then-construct sequence needs nothing
 * upstream.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Command } from "commander";
import { ACL, APCore } from "apcore-js";

import { registerAclCommand } from "../src/acl-cmd.js";
import {
  ACL_AUDIT_ENABLED_ENV,
  ACL_AUDIT_INCLUDE_DENIED_ENV,
  aclAuditEnabled,
  aclAuditIncludeDenied,
  assertDelegatedAccess,
  buildCliContext,
  getAttachedAcl,
  DEFAULT_IDENTITY_ID,
  IDENTITY_FLAGS,
  getAclSource,
  loadCliAcl,
  resolveAclRoot,
  setAttachedAcl,
  setCliIdentity,
  warnStrategyBypassesAcl,
} from "../src/acl-loader.js";
import {
  AuditLogger,
  getAuditLogger,
  setAuditLogger,
} from "../src/security/audit.js";
import { ConfigResolver, DEFAULTS } from "../src/config.js";
import { EXIT_CODES, exitCodeForError } from "../src/errors.js";
import { createCli } from "../src/main.js";
import type { Executor, GovernanceState, Registry, ModuleDescriptor } from "../src/cli.js";

// ---------------------------------------------------------------------------
// Spawn interception (§4.10)
// ---------------------------------------------------------------------------

/**
 * `child_process.spawn` is replaced for this file so the §4.10 tests can
 * observe whether a subprocess would have been created.
 *
 * The requirement is that a denied call is refused BEFORE the spawn, which an
 * exit-code assertion alone cannot distinguish from "spawned, then failed" —
 * so the spawn itself has to be the observation. Reaching it throws a sentinel
 * rather than starting a real child: these tests are about the access
 * decision, not about subprocess mechanics, which `tests/security/sandbox.test.ts`
 * already covers.
 */
const spawnMock = vi.hoisted(() => ({ calls: [] as unknown[][] }));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return {
    ...actual,
    spawn: (...args: unknown[]) => {
      spawnMock.calls.push(args);
      throw new Error("__SPAWN_REACHED__");
    },
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const THREE_RULE_ACL = `
default_effect: deny
rules:
  - callers: ["@external"]
    targets: ["system.control.*"]
    effect: deny
    description: no external control
  - callers: ["*"]
    targets: ["db.migrate"]
    effect: allow
    approval: required
    description: migrations need a human
    conditions:
      roles: ["admin"]
  - callers: ["*"]
    targets: ["db.read"]
    effect: allow
    description: reads are open
`;

const ARGUMENT_SCOPED_ACL = `
default_effect: deny
rules:
  - callers: ["*"]
    targets: ["git.push"]
    effect: allow
    description: forced pushes are scoped
    conditions:
      arguments:
        has_key: ["force"]
`;

const CLEAN_ACL = `
default_effect: deny
rules:
  - callers: ["*"]
    targets: ["*"]
    effect: allow
    description: everything
`;

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "acl-fe14-"));
}

/** Write `content` to `<dir>/<name>` and return the absolute path. */
function writeFile(dir: string, name: string, content: string): string {
  const p = path.join(dir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
  return p;
}

function aclFrom(content: string): { acl: ACL; source: string; dir: string } {
  const dir = tempDir();
  const source = writeFile(dir, "global_acl.yaml", content);
  return { acl: ACL.load(source), source, dir };
}

const GOVERNANCE_DEFAULTS: GovernanceState = {
  controlModulesRegistered: true,
  readModulesRegistered: true,
  aclConfigured: false,
  builtinAclGateWired: true,
  approvalHandlerConfigured: false,
  builtinApprovalGateWired: true,
  policyStrict: false,
  allControlModulesRequireApproval: false,
  unprotectedControlSurface: true,
};

function fakeExecutor(state: Partial<GovernanceState> = {}): Executor {
  return {
    call: async () => ({}),
    validate: async () => ({ valid: true, requiresApproval: false, checks: [] }),
    governanceState: () => ({ ...GOVERNANCE_DEFAULTS, ...state }),
  } as unknown as Executor;
}

// ---------------------------------------------------------------------------
// Command harness
// ---------------------------------------------------------------------------

interface RunResult {
  code: number | undefined;
  stdout: string;
  stderr: string;
}

async function runAcl(
  argv: string[],
  opts: { acl?: ACL | null; source?: string | null; executor?: Executor } = {},
): Promise<RunResult> {
  const out: string[] = [];
  const err: string[] = [];
  const stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
  const stderrSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: unknown) => {
      err.push(String(chunk));
      return true;
    });
  let code: number | undefined;
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((c?: number) => {
    code = c;
    throw new Error("__EXIT__");
  }) as never);

  const group = new Command("apcli").exitOverride();
  registerAclCommand(
    group,
    opts.executor ?? fakeExecutor(),
    opts.acl ?? null,
    opts.source ?? null,
  );

  try {
    await group.parseAsync(argv, { from: "user" });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== "__EXIT__") throw e;
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  }
  return { code, stdout: out.join(""), stderr: err.join("") };
}

// ---------------------------------------------------------------------------
// Environment isolation
// ---------------------------------------------------------------------------

const ORIG_CWD = process.cwd();
const ORIG_ACL_ROOT = process.env.APCORE_ACL_ROOT;
const tempDirs: string[] = [];

beforeEach(() => {
  delete process.env.APCORE_ACL_ROOT;
  setCliIdentity(null);
  setAttachedAcl(null);
});

afterEach(() => {
  process.chdir(ORIG_CWD);
  if (ORIG_ACL_ROOT === undefined) delete process.env.APCORE_ACL_ROOT;
  else process.env.APCORE_ACL_ROOT = ORIG_ACL_ROOT;
  setCliIdentity(null);
  setAttachedAcl(null);
  vi.restoreAllMocks();
  for (const d of tempDirs.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

function scratch(): string {
  const d = tempDir();
  tempDirs.push(d);
  return d;
}

// ---------------------------------------------------------------------------
// §4.1 root resolution — T-ACL-01..05
// ---------------------------------------------------------------------------

describe("resolveAclRoot — FE-14 §4.1 four-tier chain", () => {
  it("T-ACL-01: no acl/ directory resolves to null (no enforcement)", () => {
    const dir = scratch();
    process.chdir(dir);
    expect(resolveAclRoot(new ConfigResolver())).toBeNull();
  });

  it("T-ACL-01: a null root loads nothing — no synthesized default-deny ACL", () => {
    const dir = scratch();
    expect(loadCliAcl(path.join(dir, "does-not-exist"))).toBeNull();
  });

  it("T-ACL-02: ./acl in cwd is the tier-4 default once it exists", () => {
    const dir = scratch();
    writeFile(path.join(dir, "acl"), "global_acl.yaml", CLEAN_ACL);
    process.chdir(dir);
    expect(resolveAclRoot(new ConfigResolver())).toBe(DEFAULTS["acl.root"]);
  });

  it("T-ACL-03: tier 1 (--acl / create_cli acl=) beats acl.root in apcore.yaml", () => {
    const dir = scratch();
    writeFile(dir, "apcore.yaml", "acl:\n  root: ./from-yaml\n");
    process.chdir(dir);
    expect(resolveAclRoot(new ConfigResolver(), "./custom.yaml")).toBe("./custom.yaml");
  });

  it("T-ACL-04: tier 2 (APCORE_ACL_ROOT) beats tier 3 (apcore.yaml)", () => {
    const dir = scratch();
    writeFile(dir, "apcore.yaml", "acl:\n  root: ./from-yaml\n");
    process.chdir(dir);
    process.env.APCORE_ACL_ROOT = "./from-env";
    expect(resolveAclRoot(new ConfigResolver())).toBe("./from-env");
  });

  it("T-ACL-04: the env var is apcore-prefixed, not APCORE_CLI_-prefixed", () => {
    const dir = scratch();
    process.chdir(dir);
    process.env.APCORE_CLI_ACL_ROOT = "./wrong-prefix";
    try {
      expect(resolveAclRoot(new ConfigResolver())).toBeNull();
    } finally {
      delete process.env.APCORE_CLI_ACL_ROOT;
    }
  });

  it("tier 3: acl.root in apcore.yaml is read when no flag or env is set", () => {
    const dir = scratch();
    writeFile(dir, "apcore.yaml", "acl:\n  root: ./from-yaml\n");
    process.chdir(dir);
    expect(resolveAclRoot(new ConfigResolver())).toBe("./from-yaml");
  });
});

describe("loadCliAcl — FE-14 §4.2 directory convention", () => {
  it("T-ACL-05: a directory with no global_acl.yaml attaches nothing", () => {
    const dir = scratch();
    fs.mkdirSync(path.join(dir, "acl"));
    expect(loadCliAcl(path.join(dir, "acl"))).toBeNull();
  });

  it("T-ACL-02: a directory holding global_acl.yaml loads it", () => {
    const dir = scratch();
    writeFile(path.join(dir, "acl"), "global_acl.yaml", CLEAN_ACL);
    const acl = loadCliAcl(path.join(dir, "acl"));
    expect(acl).not.toBeNull();
    expect(acl!.rules).toHaveLength(1);
    expect(getAclSource()).toBe(path.join(dir, "acl", "global_acl.yaml"));
  });

  it("a file root is loaded directly", () => {
    const dir = scratch();
    const file = writeFile(dir, "custom.yaml", CLEAN_ACL);
    const acl = loadCliAcl(file);
    expect(acl!.defaultEffect).toBe("deny");
    expect(getAclSource()).toBe(file);
  });
});

// ---------------------------------------------------------------------------
// §6 structurally invalid documents — T-ACL-06..08
// ---------------------------------------------------------------------------

describe("invalid ACL documents exit 47 (FE-14 §6, FR-14-09)", () => {
  const cases: Array<[string, string, string, RegExp]> = [
    [
      "T-ACL-06",
      "an unknown rule key",
      `default_effect: deny\nrules:\n  - callers: ["*"]\n    targets: ["*"]\n    effect: allow\n    bogus_key: 1\n`,
      /Rule 0 carries 'bogus_key'/,
    ],
    [
      "T-ACL-07",
      "effect: permit (enum closure)",
      `default_effect: deny\nrules:\n  - callers: ["*"]\n    targets: ["*"]\n    effect: permit\n`,
      /Rule 0 has invalid effect 'permit'/,
    ],
    [
      "T-ACL-08",
      "callers: [] (pattern-array arity)",
      `default_effect: deny\nrules:\n  - callers: []\n    targets: ["*"]\n    effect: allow\n`,
      /Rule 0 'callers' has an illegal pattern-array shape/,
    ],
  ];

  for (const [id, label, body, messagePattern] of cases) {
    it(`${id}: ${label} raises ACL_RULE_ERROR, which maps to exit 47`, () => {
      const dir = scratch();
      const file = writeFile(dir, "bad.yaml", body);
      let caught: unknown;
      try {
        loadCliAcl(file);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as { code?: string }).code).toBe("ACL_RULE_ERROR");
      expect((caught as Error).message).toMatch(messagePattern);
      // The message names the rule INDEX, which is what makes it actionable.
      expect((caught as Error).message).toMatch(/Rule 0/);
      expect(exitCodeForError(caught)).toBe(47);
    });
  }

  it("T-ACL-06: createCli exits 47 on a malformed ./acl/global_acl.yaml", () => {
    const dir = scratch();
    writeFile(
      path.join(dir, "acl"),
      "global_acl.yaml",
      `default_effect: deny\nrules:\n  - callers: ["*"]\n    targets: ["*"]\n    effect: permit\n`,
    );
    process.chdir(dir);
    const err: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => {
      err.push(String(c));
      return true;
    });
    let code: number | undefined;
    vi.spyOn(process, "exit").mockImplementation(((c?: number) => {
      code = c;
      throw new Error("__EXIT__");
    }) as never);

    expect(() => createCli({ progName: "t" })).toThrow("__EXIT__");
    expect(code).toBe(47);
    expect(err.join("")).toMatch(/Invalid ACL configuration in .*global_acl\.yaml/);
  });
});

// ---------------------------------------------------------------------------
// §6.1 exit-code map — T-ACL-30 (TypeScript half)
// ---------------------------------------------------------------------------

describe("exit-code map (FE-14 §6.1, T-ACL-30)", () => {
  it("maps ACL_RULE_ERROR to 47 (CONFIG_INVALID), never to 77", () => {
    expect(EXIT_CODES.ACL_RULE_ERROR).toBe(47);
    expect(EXIT_CODES.ACL_RULE_ERROR).not.toBe(EXIT_CODES.ACL_DENIED);
    const err = Object.assign(new Error("bad rules"), { code: "ACL_RULE_ERROR" });
    expect(exitCodeForError(err)).toBe(47);
  });

  it("keeps 77 reserved for an actual access decision", () => {
    const err = Object.assign(new Error("denied"), { code: "ACL_DENIED" });
    expect(exitCodeForError(err)).toBe(77);
  });
});

// ---------------------------------------------------------------------------
// §4.4 acl list — T-ACL-09, T-ACL-10
// ---------------------------------------------------------------------------

describe("apcli acl list (FE-14 §4.4)", () => {
  it("T-ACL-09: --format json returns 3 rules in definition order, index 0..2", async () => {
    const { acl, source, dir } = aclFrom(THREE_RULE_ACL);
    tempDirs.push(dir);
    const res = await runAcl(["acl", "list", "--format", "json"], { acl, source });
    const payload = JSON.parse(res.stdout);
    expect(payload.source).toBe(source);
    expect(payload.default_effect).toBe("deny");
    expect(payload.rules).toHaveLength(3);
    expect(payload.rules.map((r: { index: number }) => r.index)).toEqual([0, 1, 2]);
    expect(payload.rules[0].targets).toEqual(["system.control.*"]);
    expect(payload.rules[1].approval).toBe("required");
    // Machine output stays lossless: full condition bodies, not just keys.
    expect(payload.rules[1].conditions).toEqual({ roles: ["admin"] });
    expect(payload.rules[2].conditions).toBeNull();
  });

  it("T-ACL-10: with no ACL, json emits the empty document and exits 0", async () => {
    const res = await runAcl(["acl", "list", "--format", "json"]);
    expect(JSON.parse(res.stdout)).toEqual({
      source: null,
      default_effect: null,
      rules: [],
    });
    // Listing nothing is not an error.
    expect(res.code).toBeUndefined();
    expect(res.stderr).toBe("");
  });

  it("T-ACL-10: with no ACL, table prints 'No ACL configured.' and exits 0", async () => {
    const res = await runAcl(["acl", "list", "--format", "table"]);
    expect(res.stdout).toBe("No ACL configured.\n");
    expect(res.code).toBeUndefined();
  });

  it("table output names the source, the default effect and the rule count", async () => {
    const { acl, source, dir } = aclFrom(THREE_RULE_ACL);
    tempDirs.push(dir);
    const res = await runAcl(["acl", "list", "--format", "table"], { acl, source });
    expect(res.stdout).toContain(`Default effect: deny   (source: ${source}, 3 rules)`);
    expect(res.stdout).toContain("Effect");
    expect(res.stdout).toContain("no external control");
  });

  it("the Conditions column lists keys only, lexicographically, '—' when none", async () => {
    const { acl, source, dir } = aclFrom(THREE_RULE_ACL);
    tempDirs.push(dir);
    const res = await runAcl(["acl", "list", "--format", "table"], { acl, source });
    const lines = res.stdout.split("\n");
    const roleRule = lines.find((l) => l.includes("migrations need a human"))!;
    expect(roleRule).toContain("roles");
    // Full bodies stay out of the table — that is what --format json is for.
    expect(roleRule).not.toContain("admin");
    const openRule = lines.find((l) => l.includes("reads are open"))!;
    expect(openRule).toContain("—");
  });
});

// ---------------------------------------------------------------------------
// §4.5 acl check — T-ACL-11..16
// ---------------------------------------------------------------------------

describe("apcli acl check (FE-14 §4.5)", () => {
  it("T-ACL-11: an allow rule exits 0 and reports the matched rule index", async () => {
    const { acl, source, dir } = aclFrom(THREE_RULE_ACL);
    tempDirs.push(dir);
    const res = await runAcl(["acl", "check", "db.read", "--format", "json"], {
      acl,
      source,
    });
    const payload = JSON.parse(res.stdout);
    expect(payload.access).toBe("allow");
    expect(payload.matched_rule_index).toBe(2);
    expect(payload.caller).toBe("@external");
    expect(res.code).toBe(0);
  });

  it("T-ACL-12: a deny rule exits 77 and names caller -> target", async () => {
    const { acl, source, dir } = aclFrom(THREE_RULE_ACL);
    tempDirs.push(dir);
    const res = await runAcl(
      ["acl", "check", "system.control.disable", "--format", "json"],
      { acl, source },
    );
    expect(JSON.parse(res.stdout).access).toBe("deny");
    expect(res.code).toBe(77);
    expect(res.stderr).toContain("Access denied: @external -> system.control.disable");
  });

  it("T-ACL-13: allow + approval:required exits 0, NOT 77", async () => {
    const { acl, source, dir } = aclFrom(THREE_RULE_ACL);
    tempDirs.push(dir);
    const res = await runAcl(
      ["acl", "check", "db.migrate", "--role", "admin", "--format", "json"],
      { acl, source },
    );
    const payload = JSON.parse(res.stdout);
    expect(payload.access).toBe("allow");
    // Authorization and approval are independent axes (§6.1.6): the call IS
    // permitted, it just needs a human first.
    expect(payload.approval_required).toBe(true);
    expect(res.code).toBe(0);
  });

  it("T-ACL-14: --role admin satisfies conditions: {roles: [admin]}", async () => {
    const { acl, source, dir } = aclFrom(THREE_RULE_ACL);
    tempDirs.push(dir);
    const res = await runAcl(
      ["acl", "check", "db.migrate", "--role", "admin", "--format", "json"],
      { acl, source },
    );
    expect(JSON.parse(res.stdout).matched_rule_index).toBe(1);
  });

  it("T-ACL-15: without --role the rule does not match and default_effect applies", async () => {
    const { acl, source, dir } = aclFrom(THREE_RULE_ACL);
    tempDirs.push(dir);
    const res = await runAcl(["acl", "check", "db.migrate", "--format", "json"], {
      acl,
      source,
    });
    const payload = JSON.parse(res.stdout);
    expect(payload.access).toBe("deny");
    expect(payload.matched_rule_index).toBeNull();
    expect(res.code).toBe(77);
  });

  it("T-ACL-16: --input supplies the arguments projection (key presence only)", async () => {
    const { acl, source, dir } = aclFrom(ARGUMENT_SCOPED_ACL);
    tempDirs.push(dir);
    const forced = await runAcl(
      ["acl", "check", "git.push", "--input", '{"force": true}', "--format", "json"],
      { acl, source },
    );
    expect(JSON.parse(forced.stdout).access).toBe("allow");
    expect(forced.code).toBe(0);

    const plain = await runAcl(
      ["acl", "check", "git.push", "--input", '{"remote": "origin"}', "--format", "json"],
      { acl, source },
    );
    expect(JSON.parse(plain.stdout).access).toBe("deny");
  });

  it("--input rejects a non-object / malformed JSON with exit 2", async () => {
    const { acl, source, dir } = aclFrom(ARGUMENT_SCOPED_ACL);
    tempDirs.push(dir);
    const notObject = await runAcl(
      ["acl", "check", "git.push", "--input", "[1,2]"],
      { acl, source },
    );
    expect(notObject.code).toBe(2);
    const malformed = await runAcl(
      ["acl", "check", "git.push", "--input", "{oops"],
      { acl, source },
    );
    expect(malformed.code).toBe(2);
  });

  it("--caller simulates an arbitrary caller; nothing is executed", async () => {
    const { acl, source, dir } = aclFrom(THREE_RULE_ACL);
    tempDirs.push(dir);
    const res = await runAcl(
      [
        "acl",
        "check",
        "system.control.disable",
        "--caller",
        "ops.deploy",
        "--format",
        "json",
      ],
      { acl, source },
    );
    const payload = JSON.parse(res.stdout);
    expect(payload.caller).toBe("ops.deploy");
    // The deny rule is scoped to @external, so a different caller falls through.
    expect(payload.matched_rule_index).toBeNull();
  });

  it("--depth populates a synthetic call chain for max_call_depth", async () => {
    const dir = scratch();
    const source = writeFile(
      dir,
      "depth.yaml",
      `default_effect: deny\nrules:\n  - callers: ["*"]\n    targets: ["*"]\n    effect: allow\n    description: shallow only\n    conditions:\n      max_call_depth: 2\n`,
    );
    const acl = ACL.load(source);
    const shallow = await runAcl(
      ["acl", "check", "db.read", "--depth", "1", "--format", "json"],
      { acl, source },
    );
    expect(JSON.parse(shallow.stdout).access).toBe("allow");
    const deep = await runAcl(
      ["acl", "check", "db.read", "--depth", "5", "--format", "json"],
      { acl, source },
    );
    expect(JSON.parse(deep.stdout).access).toBe("deny");
  });

  // --- Regression: `--depth 0` must still build a (length-0) Context ---
  //
  // `buildCheckContext`'s guard previously folded an EXPLICIT `--depth 0`
  // into "no context-affecting flag was given" (`depth <= 0`), so no Context
  // was built at all and the `max_call_depth` condition was UNEVALUABLE,
  // falling through to `default_effect`. Python's acl_loader.py and Rust's
  // acl_cmd.rs both key off "was --depth supplied at all" (`depth is not
  // None` / `depth.is_some()`), value-independent — so `--depth 0` there
  // builds a Context with an empty call chain, which satisfies a
  // `max_call_depth: 0` (or any non-negative threshold) condition. The two
  // implementations must reach the same allow/deny verdict for the same
  // input; this is a security-relevant divergence, not a cosmetic one.
  it("--depth 0 builds a length-0 Context, matching Python/Rust (not folded into 'no context')", async () => {
    const dir = scratch();
    const source = writeFile(
      dir,
      "depth-zero.yaml",
      `default_effect: deny\nrules:\n  - callers: ["*"]\n    targets: ["*"]\n    effect: allow\n    description: root call only\n    conditions:\n      max_call_depth: 0\n`,
    );
    const acl = ACL.load(source);
    const res = await runAcl(
      ["acl", "check", "db.read", "--depth", "0", "--format", "json"],
      { acl, source },
    );
    const payload = JSON.parse(res.stdout);
    // A Context WAS built (empty call chain, length 0 <= 0), so the rule
    // matches and access is allow — not a default_effect fallthrough deny.
    expect(payload.access).toBe("allow");
    expect(payload.matched_rule_index).toBe(0);
    expect(res.code).toBe(0);
  });

  it("table output shows both axes and the matched rule description", async () => {
    const { acl, source, dir } = aclFrom(THREE_RULE_ACL);
    tempDirs.push(dir);
    const res = await runAcl(
      ["acl", "check", "db.migrate", "--role", "admin", "--format", "table"],
      { acl, source },
    );
    expect(res.stdout).toContain("Target:   db.migrate");
    expect(res.stdout).toContain("Caller:   @external");
    expect(res.stdout).toContain('Decision: ALLOW  (rule #1: "migrations need a human")');
    expect(res.stdout).toContain("Approval: REQUIRED");
    expect(res.stdout).toMatch(/Reason:\s+\S+/);
  });

  it("with no ACL attached, check exits 47 with the documented message", async () => {
    const res = await runAcl(["acl", "check", "db.read"]);
    expect(res.code).toBe(47);
    expect(res.stderr).toContain("No ACL configured; nothing to check.");
  });
});

// ---------------------------------------------------------------------------
// §4.6 acl validate — T-ACL-17..19
// ---------------------------------------------------------------------------

describe("apcli acl validate (FE-14 §4.6)", () => {
  it("T-ACL-17: an unregistered condition key exits 47 and names index/path/key/effect", async () => {
    const dir = scratch();
    const source = writeFile(
      dir,
      "unregistered.yaml",
      `default_effect: allow\nrules:\n  - callers: ["*"]\n    targets: ["*"]\n    effect: deny\n    description: typo\n    conditions:\n      mispelled: true\n`,
    );
    // ACL.load warns rather than throwing on an unregistered key — handlers are
    // registered process-wide and legitimately after load, which is exactly why
    // `validate` is the deterministic check.
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const acl = ACL.load(source);
    const res = await runAcl(["acl", "validate", "--format", "json"], { acl, source });
    const payload = JSON.parse(res.stdout);
    expect(payload.count).toBe(1);
    expect(payload.findings[0].rule_index).toBe(0);
    expect(payload.findings[0].condition_path).toBe("mispelled");
    expect(payload.findings[0].condition_key).toBe("mispelled");
    expect(payload.findings[0].effect).toBe("deny");
    expect(res.code).toBe(47);
  });

  it("T-ACL-18: an async-only handler renders sync:no / async:yes — columns not collapsed", async () => {
    const key = `asyncOnly${Date.now()}`;
    ACL.registerAsyncCondition(key, { evaluate: async () => true });
    const dir = scratch();
    const source = writeFile(
      dir,
      "async-only.yaml",
      `default_effect: deny\nrules:\n  - callers: ["*"]\n    targets: ["*"]\n    effect: allow\n    description: async only\n    conditions:\n      ${key}: true\n`,
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const acl = ACL.load(source);

    const json = await runAcl(["acl", "validate", "--format", "json"], { acl, source });
    const finding = JSON.parse(json.stdout).findings[0];
    expect(finding.sync_resolvable).toBe(false);
    expect(finding.async_resolvable).toBe(true);

    const table = await runAcl(["acl", "validate", "--format", "table"], { acl, source });
    expect(table.stdout).toContain("Sync");
    expect(table.stdout).toContain("Async");
    const row = table.stdout.split("\n").find((l) => l.includes(key))!;
    // Two distinct cells: "no" for sync, "yes" for async.
    expect(row).toMatch(/\bno\b.*\byes\b/);
  });

  it("T-ACL-19: a clean rule set reports 0 findings and exits 0", async () => {
    const { acl, source, dir } = aclFrom(CLEAN_ACL);
    tempDirs.push(dir);
    const table = await runAcl(["acl", "validate", "--format", "table"], { acl, source });
    expect(table.stdout).toBe("0 findings\n");
    expect(table.code).toBe(0);

    const json = await runAcl(["acl", "validate", "--format", "json"], { acl, source });
    expect(JSON.parse(json.stdout)).toEqual({ count: 0, findings: [] });
    expect(json.code).toBe(0);
  });

  it("with no ACL attached, validate exits 47", async () => {
    const res = await runAcl(["acl", "validate"]);
    expect(res.code).toBe(47);
    expect(res.stderr).toContain("No ACL configured; nothing to check.");
  });
});

// ---------------------------------------------------------------------------
// §4.7 acl status — T-ACL-20, T-ACL-21
// ---------------------------------------------------------------------------

describe("apcli acl status (FE-14 §4.7)", () => {
  it("T-ACL-20: control modules with no ACL report unprotected_control_surface: true", async () => {
    const res = await runAcl(["acl", "status", "--format", "json"], {
      executor: fakeExecutor({ aclConfigured: false, unprotectedControlSurface: true }),
    });
    const payload = JSON.parse(res.stdout);
    expect(payload.control_modules_registered).toBe(true);
    expect(payload.acl_configured).toBe(false);
    expect(payload.unprotected_control_surface).toBe(true);
    expect(payload.acl_source).toBeNull();
    // Reporting a posture is not a failure — only --strict changes the code.
    expect(res.code).toBe(0);
  });

  it("T-ACL-02: with an ACL attached, status reports 'ACL configured: yes' and names the file", async () => {
    const { acl, source, dir } = aclFrom(CLEAN_ACL);
    tempDirs.push(dir);
    const res = await runAcl(["acl", "status", "--format", "table"], {
      acl,
      source,
      executor: fakeExecutor({ aclConfigured: true, unprotectedControlSurface: false }),
    });
    expect(res.stdout).toContain(`ACL configured:               yes  (${source})`);
    expect(res.stdout).toContain("Unprotected control surface:  NO");
    expect(res.code).toBe(0);
  });

  it("T-ACL-21: --strict with an unprotected surface exits 47", async () => {
    const res = await runAcl(["acl", "status", "--strict", "--format", "json"], {
      executor: fakeExecutor({ unprotectedControlSurface: true }),
    });
    expect(res.code).toBe(47);
    expect(res.stderr).toContain("Unprotected control surface.");
  });

  it("T-ACL-21: --strict with a protected surface still exits 0", async () => {
    const res = await runAcl(["acl", "status", "--strict", "--format", "json"], {
      executor: fakeExecutor({ aclConfigured: true, unprotectedControlSurface: false }),
    });
    expect(res.code).toBe(0);
  });

  it("renders all nine observations, with the derived flag separated", async () => {
    const res = await runAcl(["acl", "status", "--format", "table"], {
      executor: fakeExecutor(),
    });
    for (const label of [
      "Control modules registered:",
      "Read modules registered:",
      "ACL configured:",
      "Built-in ACL gate wired:",
      "Approval handler configured:",
      "Built-in approval gate wired:",
      "Policy strict:",
      "All control modules gated:",
      "Unprotected control surface:",
    ]) {
      expect(res.stdout).toContain(label);
    }
    expect(res.stdout).toContain("─".repeat(33));
  });
});

// ---------------------------------------------------------------------------
// §4.9 live surfaces — T-ACL-22, T-ACL-23
// ---------------------------------------------------------------------------

describe("an attached ACL makes existing surfaces live (FE-14 §4.9)", () => {
  /** Real APCore holding `db.migrate` behind a deny rule. */
  function deniedApp() {
    const app = new APCore();
    app.registry.register("db.migrate", {
      moduleId: "db.migrate",
      inputSchema: { type: "object", properties: {} },
      execute: async () => ({ migrated: true }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const executor = app.executor as any;
    executor.setAcl(
      new ACL(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [{ callers: ["*"], targets: ["db.migrate"], effect: "deny" }] as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "allow" as any,
      ),
    );
    return executor;
  }

  it("T-ACL-22: a denied call raises ACL_DENIED, which the CLI maps to exit 77", async () => {
    const executor = deniedApp();
    let caught: unknown;
    try {
      await executor.call("db.migrate", {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { code?: string }).code).toBe("ACL_DENIED");
    expect(exitCodeForError(caught)).toBe(77);
  });

  it("T-ACL-23: preflight reports the acl check as failed, and 77 is the first failed code", async () => {
    const { firstFailedExitCode } = await import("../src/output.js");
    const executor = deniedApp();
    const preflight = await executor.validate("db.migrate", {});
    expect(preflight.valid).toBe(false);
    const aclCheck = preflight.checks.find(
      (c: { check: string }) => c.check === "acl",
    );
    expect(aclCheck).toBeDefined();
    expect(aclCheck.passed).toBe(false);
    expect(firstFailedExitCode(preflight)).toBe(77);
  });
});

// ---------------------------------------------------------------------------
// §4.10 every execution path is gated — T-ACL-31, 32, 34
// ---------------------------------------------------------------------------

describe("delegated execution paths are gated (FE-14 §4.10)", () => {
  const SANDBOX_ACL = `
default_effect: allow
rules:
  - callers: ["*"]
    targets: ["ops.control"]
    effect: deny
    description: no control modules
  - callers: ["*"]
    targets: ["db.migrate"]
    effect: allow
    approval: required
    description: migrations need a human
`;

  function attach(body: string | null): void {
    if (body === null) {
      setAttachedAcl(null);
      return;
    }
    const { acl, dir } = aclFrom(body);
    tempDirs.push(dir);
    setAttachedAcl(acl);
  }

  /** Executor that records in-process calls, so "did it run?" is observable. */
  function recordingExecutor(): { executor: Executor; calls: string[] } {
    const calls: string[] = [];
    const executor = {
      call: async (moduleId: string) => {
        calls.push(moduleId);
        return { ran: true };
      },
    } as unknown as Executor;
    return { executor, calls };
  }

  async function sandboxModule(): Promise<typeof import("../src/security/sandbox.js")> {
    return import("../src/security/sandbox.js");
  }

  beforeEach(() => {
    spawnMock.calls.length = 0;
  });

  it("T-ACL-31: --sandbox on a denied module exits 77 and never spawns", async () => {
    attach(SANDBOX_ACL);
    const { Sandbox } = await sandboxModule();
    const { executor, calls } = recordingExecutor();

    const err = await new Sandbox(true)
      .execute("ops.control", {}, executor)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as { code?: string }).code).toBe("ACL_DENIED");
    expect(exitCodeForError(err)).toBe(77);
    // The whole point: refused BEFORE the subprocess exists. Asserting only on
    // the exit code would not distinguish "refused before the spawn" from
    // "spawned, then failed".
    expect(spawnMock.calls).toHaveLength(0);
    expect(calls).toEqual([]);
  });

  it("T-ACL-31: the same call without --sandbox is denied too — one rule, both paths", async () => {
    // The discriminating half. If the in-process path let this through, the
    // case above would be proving nothing about the ACL.
    attach(SANDBOX_ACL);
    const app = new APCore();
    app.registry.register("ops.control", {
      moduleId: "ops.control",
      inputSchema: { type: "object", properties: {} },
      execute: async () => ({ ran: true }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const executor = app.executor as any;
    executor.setAcl(getAttachedAcl());

    const err = await executor.call("ops.control", {}).catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe("ACL_DENIED");
    expect(exitCodeForError(err)).toBe(77);
  });

  it("T-ACL-31: with the rule removed, BOTH paths succeed", async () => {
    // The control. Without it, a gate that refused everything — or refused for
    // an unrelated reason — would pass the two cases above.
    attach("default_effect: allow\nrules: []\n");
    const { Sandbox } = await sandboxModule();
    const { executor, calls } = recordingExecutor();

    // In-process path runs.
    await expect(
      new Sandbox(false).execute("ops.control", {}, executor),
    ).resolves.toEqual({ ran: true });
    expect(calls).toEqual(["ops.control"]);

    // Sandboxed path: the gate lets it through, so the spawn IS reached.
    await expect(
      new Sandbox(true).execute("ops.control", {}, executor),
    ).rejects.toThrow("__SPAWN_REACHED__");
    expect(spawnMock.calls).toHaveLength(1);
  });

  it("T-ACL-31: with no ACL configured at all, the sandbox path is unchanged", async () => {
    // Enforcement is on only when configured — a project without an `acl/`
    // directory must behave exactly as it did before FE-14.
    attach(null);
    const { Sandbox } = await sandboxModule();
    const { executor } = recordingExecutor();
    await expect(
      new Sandbox(true).execute("ops.control", {}, executor),
    ).rejects.toThrow("__SPAWN_REACHED__");
    expect(spawnMock.calls).toHaveLength(1);
  });

  it("T-ACL-32: --sandbox on an allowed module reaches the subprocess normally", async () => {
    attach(SANDBOX_ACL);
    const { Sandbox } = await sandboxModule();
    const { executor } = recordingExecutor();

    await expect(
      new Sandbox(true).execute("db.read", { limit: 1 }, executor),
    ).rejects.toThrow("__SPAWN_REACHED__");
    expect(spawnMock.calls).toHaveLength(1);
    // Isolation is unaffected: the gate is a decision, not a change of path.
    const argv = spawnMock.calls[0][1] as string[];
    expect(argv).toContain("--internal-sandbox-runner");
    expect(argv).toContain("db.read");
  });

  it("the gate reads the arguments projection, so argument-scoped rules apply", async () => {
    attach(`
default_effect: allow
rules:
  - callers: ["*"]
    targets: ["git.push"]
    effect: deny
    description: no forced pushes
    conditions:
      arguments:
        has_key: ["force"]
`);
    const { Sandbox } = await sandboxModule();
    const { executor } = recordingExecutor();

    const denied = await new Sandbox(true)
      .execute("git.push", { force: true }, executor)
      .catch((e: unknown) => e);
    expect((denied as { code?: string }).code).toBe("ACL_DENIED");
    expect(spawnMock.calls).toHaveLength(0);

    await expect(
      new Sandbox(true).execute("git.push", { remote: "origin" }, executor),
    ).rejects.toThrow("__SPAWN_REACHED__");
    expect(spawnMock.calls).toHaveLength(1);
  });

  it("T-ACL-34: an ACL-sourced approval:required reaches the CLI approval gate on the sandboxed path", async () => {
    attach(SANDBOX_ACL);
    const { checkApproval } = await import("../src/approval.js");
    // Annotated `requires_approval: false` — only the ACL rule demands a human.
    const moduleDef = {
      moduleId: "db.migrate",
      description: "",
      annotations: { requires_approval: false },
    } as unknown as ModuleDescriptor;

    const aclRequiresApproval = assertDelegatedAccess("db.migrate", {});
    expect(aclRequiresApproval).toBe(true);

    // Non-TTY under vitest, so a gate that fires refuses. That refusal IS the
    // observation: it can only happen if the ACL requirement composed with the
    // annotation.
    await expect(
      checkApproval(moduleDef, /*autoApprove*/ false, 1, aclRequiresApproval),
    ).rejects.toThrow(/requires approval/);
  });

  it("T-ACL-34: without the ACL requirement the same module is not gated", async () => {
    // The control for the case above.
    const { checkApproval } = await import("../src/approval.js");
    const moduleDef = {
      moduleId: "db.migrate",
      description: "",
      annotations: { requires_approval: false },
    } as unknown as ModuleDescriptor;
    await expect(
      checkApproval(moduleDef, /*autoApprove*/ false, 1, /*aclRequiresApproval*/ false),
    ).resolves.toBeUndefined();
  });

  it("assertDelegatedAccess is a no-op when no ACL is configured", () => {
    attach(null);
    expect(assertDelegatedAccess("anything.at.all", { a: 1 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §6.2 strategy bypass warning — T-ACL-25
// ---------------------------------------------------------------------------

describe("strategy bypass warning (FE-14 §6.2)", () => {
  function captureStderr(fn: () => void): string {
    const out: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => {
      out.push(String(c));
      return true;
    });
    try {
      fn();
    } finally {
      spy.mockRestore();
    }
    return out.join("");
  }

  it("T-ACL-25: --strategy testing with an ACL attached warns that the CONFIGURED ACL is not enforced", () => {
    setAttachedAcl(aclFrom(CLEAN_ACL).acl);
    const msg = captureStderr(() => warnStrategyBypassesAcl("testing"));
    expect(msg).toContain("Using 'testing' strategy");
    expect(msg).toContain("configured ACL is not enforced");
  });

  it("the warning extends to 'internal' and 'minimal'", () => {
    setAttachedAcl(aclFrom(CLEAN_ACL).acl);
    for (const strategy of ["internal", "minimal"]) {
      expect(captureStderr(() => warnStrategyBypassesAcl(strategy))).toContain(
        `Using '${strategy}' strategy`,
      );
    }
  });

  it("stays silent for strategies that keep the acl_check step", () => {
    setAttachedAcl(aclFrom(CLEAN_ACL).acl);
    expect(captureStderr(() => warnStrategyBypassesAcl("standard"))).toBe("");
    expect(captureStderr(() => warnStrategyBypassesAcl("performance"))).toBe("");
  });

  it("stays silent when no ACL is configured — there is nothing to bypass", () => {
    setAttachedAcl(null);
    expect(captureStderr(() => warnStrategyBypassesAcl("testing"))).toBe("");
  });
});

// ---------------------------------------------------------------------------
// §4.2 attachment policy — T-ACL-28, T-ACL-29
// ---------------------------------------------------------------------------

describe("attachment policy (FE-14 §4.2)", () => {
  function makeRegistry(): Registry {
    return {
      list: () => [],
      getDefinition: (id: string) =>
        id === "system.health.summary"
          ? ({ moduleId: id } as unknown as ModuleDescriptor)
          : null,
    } as unknown as Registry;
  }

  function makeSpyExecutor(): { executor: Executor; attached: unknown[] } {
    const attached: unknown[] = [];
    const executor = {
      call: async () => ({}),
      validate: async () => ({ valid: true, requiresApproval: false, checks: [] }),
      setAcl: (acl: unknown) => attached.push(acl),
      governanceState: () => ({ ...GOVERNANCE_DEFAULTS }),
    } as unknown as Executor;
    return { executor, attached };
  }

  it("T-ACL-28: a host-supplied executor with no acl= keeps its own governance", () => {
    const dir = scratch();
    // A discoverable ACL sits right there in the cwd — and is deliberately
    // NOT attached over the host's configuration.
    writeFile(path.join(dir, "acl"), "global_acl.yaml", CLEAN_ACL);
    process.chdir(dir);
    const { executor, attached } = makeSpyExecutor();
    createCli({ progName: "t", registry: makeRegistry(), executor });
    expect(attached).toHaveLength(0);
  });

  it("T-ACL-29: a host-supplied executor WITH acl= gets the explicitly-passed ACL", () => {
    const dir = scratch();
    const source = writeFile(dir, "explicit.yaml", CLEAN_ACL);
    const { executor, attached } = makeSpyExecutor();
    createCli({ progName: "t", registry: makeRegistry(), executor, acl: source });
    expect(attached).toHaveLength(1);
    expect((attached[0] as ACL).rules).toHaveLength(1);
  });

  it("T-ACL-29: a pre-built ACL instance is attached as given", () => {
    const { acl, dir } = aclFrom(CLEAN_ACL);
    tempDirs.push(dir);
    const { executor, attached } = makeSpyExecutor();
    createCli({ progName: "t", registry: makeRegistry(), executor, acl });
    expect(attached[0]).toBe(acl);
  });

  it("T-ACL-01: with no ACL anywhere, nothing is attached and behaviour is unchanged", () => {
    const dir = scratch();
    process.chdir(dir);
    const { executor, attached } = makeSpyExecutor();
    const program = createCli({ progName: "t", registry: makeRegistry(), executor });
    expect(attached).toHaveLength(0);
    expect(program.commands.map((c) => c.name())).toContain("apcli");
  });
});

// ---------------------------------------------------------------------------
// §4.3 identity flags
// ---------------------------------------------------------------------------

describe("identity flags (FE-14 §4.3)", () => {
  it("builds no Context when none of the three flags is given", () => {
    setCliIdentity(null);
    expect(buildCliContext()).toBeUndefined();
  });

  it("builds a Context carrying the asserted roles, and never a callerId", () => {
    setCliIdentity({ id: "alice", type: "service", roles: ["admin", "ops"] });
    const ctx = buildCliContext();
    expect(ctx).toBeDefined();
    expect(ctx!.identity?.id).toBe("alice");
    expect(ctx!.identity?.type).toBe("service");
    expect([...(ctx!.identity?.roles ?? [])]).toEqual(["admin", "ops"]);
    // §7.2 — a top-level CLI invocation is always the effective caller
    // `@external`; the CLI must never forge a callerId.
    expect(ctx!.callerId).toBeNull();
  });

  it("defaults Identity.type to 'user' when only --role is given", () => {
    setCliIdentity({ roles: ["admin"] });
    expect(buildCliContext()!.identity?.type).toBe("user");
  });

  it("defaults Identity.id to the '@cli' synthetic principal", () => {
    // Normative and identical across the three SDKs. The `@` prefix follows
    // apcore's convention for synthetic principals (`@external`, `@system`),
    // so the default cannot be confused with a real user whose id is `cli`.
    expect(DEFAULT_IDENTITY_ID).toBe("@cli");
    setCliIdentity({ roles: ["admin"] });
    expect(buildCliContext()!.identity?.id).toBe(DEFAULT_IDENTITY_ID);
  });

  it("registers the three flags globally on the program", () => {
    const dir = scratch();
    process.chdir(dir);
    const program = createCli({ progName: "t" });
    const longs = program.options.map((o) => o.long);
    expect(longs).toContain("--identity-id");
    expect(longs).toContain("--identity-type");
    expect(longs).toContain("--role");
  });

  it("documents each identity flag as an unauthenticated assertion (§7.1)", () => {
    const dir = scratch();
    process.chdir(dir);
    const program = createCli({ progName: "t" });
    for (const long of ["--identity-id", "--identity-type", "--role"]) {
      const opt = program.options.find((o) => o.long === long)!;
      expect(opt.description).toMatch(/[Uu]nauthenticated assertion/);
    }
  });
});

// ---------------------------------------------------------------------------
// §4.3 / §4.5 flag wording and precedence
// ---------------------------------------------------------------------------

/**
 * The `acl check` flag surface, pinned directly rather than through the
 * `apcli-visibility` golden fixture.
 *
 * The fixture captures ROOT help only, and its byte-match is `xfail` in at
 * least one sibling SDK — so a reword of a SUBCOMMAND flag would pass every
 * local check and still break cross-SDK parity. These assertions are the
 * thing that would go red.
 */
describe("acl check flag wording (FE-14 §4.5)", () => {
  const EXPECTED: ReadonlyArray<[string, string, string]> = [
    [
      "--caller",
      "--caller <id>",
      "Simulated caller ID (default: @external). Nothing is executed, so any value is accepted.",
    ],
    [
      "--identity-id",
      "--identity-id <id>",
      "Assert Identity.id for ACL conditions. Unauthenticated assertion, not authentication.",
    ],
    [
      "--identity-type",
      "--identity-type <type>",
      "Assert Identity.type for ACL conditions (default: user). Unauthenticated assertion, not authentication.",
    ],
    [
      "--role",
      "--role <role>",
      "Assert an Identity role for ACL conditions. Repeatable. Unauthenticated assertion, not authentication.",
    ],
    [
      "--depth",
      "--depth <n>",
      "Simulated call-chain depth for the max_call_depth condition.",
    ],
    [
      "--input",
      "--input <json>",
      "Argument map for the arguments condition. Key presence only; values are not compared.",
    ],
  ];

  function checkCommand(): Command {
    const group = new Command("apcli");
    registerAclCommand(group, fakeExecutor(), null, null);
    return group.commands
      .find((c) => c.name() === "acl")!
      .commands.find((c) => c.name() === "check")!;
  }

  for (const [long, flags, description] of EXPECTED) {
    it(`${long} carries its pinned flags string and help text`, () => {
      const opt = checkCommand().options.find((o) => o.long === long);
      expect(opt, `${long} is not registered on acl check`).toBeDefined();
      expect(opt!.flags).toBe(flags);
      expect(opt!.description).toBe(description);
    });
  }

  it("the three identity flags read identically at root and on acl check", () => {
    // Same flag, two levels, one wording — enforced structurally by sharing
    // IDENTITY_FLAGS rather than by two files agreeing to stay in step.
    const dir = scratch();
    process.chdir(dir);
    const program = createCli({ progName: "t" });
    const sub = checkCommand();
    for (const key of ["id", "type", "role"] as const) {
      const spec = IDENTITY_FLAGS[key];
      const rootOpt = program.options.find((o) => o.flags === spec.flags);
      const subOpt = sub.options.find((o) => o.flags === spec.flags);
      expect(rootOpt, `${spec.flags} missing at root`).toBeDefined();
      expect(subOpt, `${spec.flags} missing on acl check`).toBeDefined();
      expect(subOpt!.description).toBe(rootOpt!.description);
      expect(subOpt!.description).toBe(spec.description);
    }
  });

  it("--caller states its default inline and does not repeat it via [default:]", () => {
    const opt = checkCommand().options.find((o) => o.long === "--caller")!;
    expect(opt.description).toContain("(default: @external)");
    // A Commander default would make canonicalFormatHelp append a second,
    // identical statement of the same fact.
    expect(opt.defaultValue).toBeUndefined();
  });

  it("--caller still defaults to @external at runtime", async () => {
    const { acl, source, dir } = aclFrom(THREE_RULE_ACL);
    tempDirs.push(dir);
    const res = await runAcl(["acl", "check", "db.read", "--format", "json"], {
      acl,
      source,
    });
    expect(JSON.parse(res.stdout).caller).toBe("@external");
  });
});

describe("identity flag precedence, root vs acl check (FE-14 §4.3, §4.5)", () => {
  const IDENTITY_ACL = `
default_effect: deny
rules:
  - callers: ["*"]
    targets: ["db.migrate"]
    effect: allow
    description: admins only
    conditions:
      roles: ["admin"]
  - callers: ["*"]
    targets: ["svc.ping"]
    effect: allow
    description: services only
    conditions:
      identity_types: ["service"]
  - callers: ["*"]
    targets: ["svc.deploy"]
    effect: allow
    description: admin services only
    conditions:
      identity_types: ["service"]
      roles: ["admin"]
  - callers: ["*"]
    targets: ["svc.guest"]
    effect: allow
    description: guest services only
    conditions:
      identity_types: ["service"]
      roles: ["guest"]
`;

  async function decide(argv: string[]): Promise<string> {
    const { acl, source, dir } = aclFrom(IDENTITY_ACL);
    tempDirs.push(dir);
    const res = await runAcl([...argv, "--format", "json"], { acl, source });
    return JSON.parse(res.stdout).access as string;
  }

  it("a root identity flag applies when acl check does not restate it", async () => {
    setCliIdentity({ roles: ["admin"] });
    expect(await decide(["acl", "check", "db.migrate"])).toBe("allow");
  });

  it("a subcommand flag overrides its root counterpart for that invocation", async () => {
    setCliIdentity({ roles: ["viewer"] });
    expect(await decide(["acl", "check", "db.migrate", "--role", "admin"])).toBe("allow");

    setCliIdentity({ roles: ["admin"] });
    expect(await decide(["acl", "check", "db.migrate", "--role", "viewer"])).toBe("deny");
  });

  it("overriding one flag leaves the other root flags in force", async () => {
    // --identity-type comes from root, --role from the subcommand: the merge
    // is per-flag, not all-or-nothing.
    setCliIdentity({ type: "service", roles: ["viewer"] });
    expect(await decide(["acl", "check", "svc.ping", "--role", "admin"])).toBe("allow");
  });

  it("merges per FIELD, not all-or-nothing: root type + subcommand role together", async () => {
    // THE discriminating case. `svc.deploy` requires BOTH conditions, and each
    // is supplied at a different level: `identity_types: [service]` only at
    // root, `roles: [admin]` only at the subcommand. The rule matches only if
    // restating --role preserved the root's --identity-type.
    //
    // The natural-but-wrong implementation — `buildIdentity(sub) ?? root`, or
    // any other `sub ?? root` shape — discards EVERY root field the moment one
    // subcommand flag is restated, leaving type at its "user" default and
    // silently dropping a field the caller never withdrew. That form denies
    // this call.
    setCliIdentity({ type: "service" });
    expect(await decide(["acl", "check", "svc.deploy", "--role", "admin"])).toBe("allow");
  });

  it("the same call is denied when the root type is genuinely absent", async () => {
    // The control for the case above: identical argv, no root --identity-type.
    // Without it the rule must NOT match — otherwise the test above would pass
    // for a reason unrelated to the merge.
    setCliIdentity(null);
    expect(await decide(["acl", "check", "svc.deploy", "--role", "admin"])).toBe("deny");
  });

  it("§4.5 worked example: root type+role, subcommand role → type=service, roles=[guest]", async () => {
    // `--identity-type service --role admin ... acl check --role guest`
    // resolves to type=service, roles=["guest"]: the restated field wins, the
    // unrestated one survives. Asserted from both sides — the guest rule
    // matches and the admin rule does not — so neither a dropped root field
    // nor an ignored subcommand override can pass.
    setCliIdentity({ type: "service", roles: ["admin"] });
    expect(await decide(["acl", "check", "svc.guest", "--role", "guest"])).toBe("allow");

    setCliIdentity({ type: "service", roles: ["admin"] });
    expect(await decide(["acl", "check", "svc.deploy", "--role", "guest"])).toBe("deny");
  });

  it("an id restated at the subcommand does not discard the root's type or roles", async () => {
    // Same property on the third axis: --identity-id is the restated field.
    setCliIdentity({ type: "service", roles: ["admin"] });
    expect(
      await decide(["acl", "check", "svc.deploy", "--identity-id", "runner-7"]),
    ).toBe("allow");
  });

  it("with no identity anywhere, a conditional rule does not match", async () => {
    setCliIdentity(null);
    expect(await decide(["acl", "check", "db.migrate"])).toBe("deny");
  });
});

// ---------------------------------------------------------------------------
// §4.1 / §4.10 registration
// ---------------------------------------------------------------------------

describe("registration (FE-14 §4.1, §4.10)", () => {
  it("--acl registers in standalone mode only", () => {
    const dir = scratch();
    process.chdir(dir);
    const standalone = createCli({ progName: "t" });
    expect(standalone.options.map((o) => o.long)).toContain("--acl");

    const embedded = createCli({
      progName: "t",
      registry: { list: () => [], getDefinition: () => null } as unknown as Registry,
      executor: fakeExecutor(),
    });
    expect(embedded.options.map((o) => o.long)).not.toContain("--acl");
  });

  it("acl registers as a nested group with list/check/validate/status", () => {
    const group = new Command("apcli");
    registerAclCommand(group, fakeExecutor(), null, null);
    const acl = group.commands.find((c) => c.name() === "acl")!;
    expect(acl).toBeDefined();
    expect(acl.commands.map((c) => c.name()).sort()).toEqual([
      "check",
      "list",
      "status",
      "validate",
    ]);
  });

  it("acl is NOT always-registered: mode:'include' without it leaves it out", () => {
    const dir = scratch();
    process.chdir(dir);
    const program = createCli({
      progName: "t",
      registry: { list: () => [], getDefinition: () => null } as unknown as Registry,
      executor: fakeExecutor(),
      apcli: { mode: "include", include: ["list"] },
    });
    const group = program.commands.find((c) => c.name() === "apcli")!;
    expect(group.commands.map((c) => c.name())).not.toContain("acl");
  });

  it("acl registers under mode:'include' when explicitly listed", () => {
    const dir = scratch();
    process.chdir(dir);
    const program = createCli({
      progName: "t",
      registry: { list: () => [], getDefinition: () => null } as unknown as Registry,
      executor: fakeExecutor(),
      apcli: { mode: "include", include: ["acl"] },
    });
    const group = program.commands.find((c) => c.name() === "apcli")!;
    expect(group.commands.map((c) => c.name())).toContain("acl");
  });
});

// ---------------------------------------------------------------------------
// §4.8 audit wiring — T-ACL-26, 27, 27a, 27b, 27c
// ---------------------------------------------------------------------------

describe("audit wiring (FE-14 §4.8)", () => {
  /** Rule 0 allows `db.read`, rule 1 denies `ops.control`, default deny. */
  const AUDIT_ACL = `
default_effect: deny
rules:
  - callers: ["*"]
    targets: ["db.read"]
    effect: allow
    description: reads are open
  - callers: ["*"]
    targets: ["ops.control"]
    effect: deny
    description: no control
`;

  /**
   * The §4.8 requirement-1 fixture: a file whose governing default is `allow`.
   * A rebuild passing a literal `"deny"` inverts this, and NOTHING written
   * against a `deny`-defaulted file would notice.
   */
  const ALLOW_DEFAULT_ACL = `
default_effect: allow
rules:
  - callers: ["*"]
    targets: ["ops.control"]
    effect: deny
    description: no control
`;

  /** apcore's 13 AuditEntry fields, in declaration order, snake_case. */
  const WIRE_FIELDS = [
    "timestamp",
    "caller_id",
    "target_id",
    "decision",
    "reason",
    "matched_rule",
    "matched_rule_index",
    "identity_type",
    "roles",
    "call_depth",
    "trace_id",
    "handler_error",
    "approval_required",
  ];

  let originalAuditLogger: AuditLogger | null = null;

  beforeEach(() => {
    originalAuditLogger = getAuditLogger();
    delete process.env[ACL_AUDIT_ENABLED_ENV];
    delete process.env[ACL_AUDIT_INCLUDE_DENIED_ENV];
  });

  afterEach(() => {
    setAuditLogger(originalAuditLogger);
    delete process.env[ACL_AUDIT_ENABLED_ENV];
    delete process.env[ACL_AUDIT_INCLUDE_DENIED_ENV];
  });

  /**
   * Lay out a project: `<dir>/acl/global_acl.yaml`, an optional `apcore.yaml`,
   * and an FE-05 audit log pointed at a temp file. `process.chdir` makes it the
   * cwd, so `loadCliAcl` reads exactly the config a real run would.
   */
  function project(
    aclBody: string,
    apcoreYaml: string | null = null,
  ): { dir: string; logPath: string } {
    const dir = scratch();
    writeFile(path.join(dir, "acl"), "global_acl.yaml", aclBody);
    if (apcoreYaml !== null) writeFile(dir, "apcore.yaml", apcoreYaml);
    process.chdir(dir);
    const logPath = path.join(dir, "audit.jsonl");
    setAuditLogger(new AuditLogger(logPath));
    return { dir, logPath };
  }

  function entries(logPath: string): Record<string, unknown>[] {
    if (!fs.existsSync(logPath)) return [];
    return fs
      .readFileSync(logPath, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  /** Capture every ACL `ACL.load` hands back, so "was it rebuilt?" is decidable. */
  function spyOnLoad(): ACL[] {
    const loaded: ACL[] = [];
    const realLoad = ACL.load.bind(ACL);
    vi.spyOn(ACL, "load").mockImplementation((p: string) => {
      const acl = realLoad(p);
      loaded.push(acl);
      return acl;
    });
    return loaded;
  }

  /** Run a real access decision through the CLI's own gate. */
  function decide(moduleId: string): unknown {
    try {
      return assertDelegatedAccess(moduleId, {});
    } catch (e) {
      return e;
    }
  }

  it("§5: both keys are in DEFAULTS and both default to true", () => {
    expect(DEFAULTS["acl.audit.enabled"]).toBe(true);
    expect(DEFAULTS["acl.audit.include_denied"]).toBe(true);
    const dir = scratch();
    process.chdir(dir);
    expect(aclAuditEnabled(new ConfigResolver())).toBe(true);
    expect(aclAuditIncludeDenied(new ConfigResolver())).toBe(true);
  });

  it("§5: APCORE_ACL_AUDIT_ENABLED / _INCLUDE_DENIED override the defaults", () => {
    const dir = scratch();
    process.chdir(dir);
    process.env[ACL_AUDIT_ENABLED_ENV] = "false";
    process.env[ACL_AUDIT_INCLUDE_DENIED_ENV] = "0";
    expect(aclAuditEnabled(new ConfigResolver())).toBe(false);
    expect(aclAuditIncludeDenied(new ConfigResolver())).toBe(false);
    // A value that is neither truthy nor falsy must not read as `false`: a typo
    // in the variable name's VALUE must not silently switch auditing off.
    process.env[ACL_AUDIT_ENABLED_ENV] = "maybe";
    expect(aclAuditEnabled(new ConfigResolver())).toBe(true);
  });

  it("T-ACL-26: acl.audit.enabled true, a denied call writes one entry with decision deny and all 13 fields", () => {
    const { logPath } = project(AUDIT_ACL);
    const acl = loadCliAcl("./acl");
    expect(acl).not.toBeNull();
    setAttachedAcl(acl);

    const outcome = decide("ops.control");
    expect((outcome as { code?: string }).code).toBe("ACL_DENIED");

    const written = entries(logPath);
    expect(written).toHaveLength(1);
    const entry = written[0];
    // All 13 fields, in apcore's declaration order, in their snake_case wire
    // form — `handler_error` and `approval_required` included. The log is a
    // cross-language artifact: a reader must not have to know which SDK wrote
    // the line, so camelCased keys here would be a defect even though
    // apcore-js surfaces the object that way.
    expect(Object.keys(entry)).toEqual(WIRE_FIELDS);
    expect(entry.decision).toBe("deny");
    expect(entry.caller_id).toBe("@external");
    expect(entry.target_id).toBe("ops.control");
    expect(entry.reason).toBe("rule_match");
    expect(entry.matched_rule_index).toBe(1);
    expect(entry.matched_rule).toBe("no control");
    expect(entry.handler_error).toBeNull();
    expect(entry.approval_required).toBe(false);
    expect(typeof entry.timestamp).toBe("string");
  });

  it("T-ACL-26: an allowed call is audited too — one entry per checkAccess", () => {
    const { logPath } = project(AUDIT_ACL);
    setAttachedAcl(loadCliAcl("./acl"));
    expect(decide("db.read")).toBe(false);
    const written = entries(logPath);
    expect(written).toHaveLength(1);
    expect(written[0].decision).toBe("allow");
    expect(written[0].target_id).toBe("db.read");
  });

  it("T-ACL-27: include_denied false suppresses the deny entry and keeps the allow entry", () => {
    const { logPath } = project(
      AUDIT_ACL,
      "acl:\n  audit:\n    include_denied: false\n",
    );
    setAttachedAcl(loadCliAcl("./acl"));

    expect((decide("ops.control") as { code?: string }).code).toBe("ACL_DENIED");
    expect(decide("db.read")).toBe(false);

    const written = entries(logPath);
    // The key governs DENIED decisions only — apcore's own meaning
    // (`schemas/acl-config.schema.json`), not an inverted "quiet" switch. An
    // implementation that read it backwards would write exactly one entry too,
    // which is why the surviving entry's decision is asserted.
    expect(written).toHaveLength(1);
    expect(written[0].decision).toBe("allow");
    expect(written[0].target_id).toBe("db.read");
    expect(written.some((e) => e.decision === "deny")).toBe(false);
  });

  it("T-ACL-27a: acl.audit.enabled false installs no callback and performs NO rebuild", () => {
    const loaded = spyOnLoad();
    const { logPath } = project(AUDIT_ACL, "acl:\n  audit:\n    enabled: false\n");
    const acl = loadCliAcl("./acl");

    // The requirement is "no rebuild", which "nothing was written" does not
    // establish: a rebuild carrying a callback that happens to write nothing
    // would pass that. Reference equality with what `ACL.load` returned is the
    // observation that actually distinguishes them.
    expect(loaded).toHaveLength(1);
    expect(acl).toBe(loaded[0]);
    // And the provenance a rebuild would have cost: `reload()` needs the
    // `_yamlPath` only `ACL.load` sets.
    expect(() => acl!.reload()).not.toThrow();

    setAttachedAcl(acl);
    expect((decide("ops.control") as { code?: string }).code).toBe("ACL_DENIED");
    expect(decide("db.read")).toBe(false);
    expect(entries(logPath)).toHaveLength(0);
  });

  it("T-ACL-27a: with auditing ENABLED the ACL is rebuilt — the contrast that makes the identity check discriminating", () => {
    const loaded = spyOnLoad();
    project(AUDIT_ACL);
    const acl = loadCliAcl("./acl");
    expect(loaded).toHaveLength(1);
    expect(acl).not.toBe(loaded[0]);
    // §4.8 requirement 2, stated rather than hidden: the rebuilt ACL loses
    // `reload()`. Accepted — no apcore-cli SDK calls it, and an embedder that
    // needs it supplies its own ACL through `createCli({ acl })`.
    expect(() => acl!.reload()).toThrow();
  });

  it("T-ACL-27b: default_effect: allow survives the rebuild, and an unmatched call is PERMITTED", () => {
    const { logPath } = project(ALLOW_DEFAULT_ACL);
    const acl = loadCliAcl("./acl");
    expect(acl).not.toBeNull();

    // §4.8 requirement 1. A rebuild passing a literal "deny" inverts the
    // governing default of every call no rule matched — silently, and every
    // test using a `deny`-defaulted file passes against that defect.
    expect(acl!.defaultEffect).toBe("allow");

    setAttachedAcl(acl);
    expect(decide("anything.unmatched")).toBe(false);

    const written = entries(logPath);
    expect(written).toHaveLength(1);
    expect(written[0].decision).toBe("allow");
    expect(written[0].reason).toBe("default_effect");
    expect(written[0].matched_rule_index).toBeNull();

    // The file's rules are carried unchanged alongside its default: a rule
    // still denies, so "allow" above is the default speaking, not an empty ACL.
    expect(acl!.rules).toHaveLength(1);
    expect((decide("ops.control") as { code?: string }).code).toBe("ACL_DENIED");
  });

  it("T-ACL-27c: an embedder-supplied ACL is attached unchanged, never rebuilt", () => {
    const dir = scratch();
    process.chdir(dir);
    // Auditing is ON (the default) — this is the case where a rebuild would
    // otherwise happen.
    expect(aclAuditEnabled(new ConfigResolver())).toBe(true);

    const { acl, dir: aclDir } = aclFrom(CLEAN_ACL);
    tempDirs.push(aclDir);

    const attached: unknown[] = [];
    const executor = {
      call: async () => ({}),
      validate: async () => ({ valid: true, requiresApproval: false, checks: [] }),
      setAcl: (a: unknown) => attached.push(a),
      governanceState: () => ({ ...GOVERNANCE_DEFAULTS }),
    } as unknown as Executor;
    const registry = {
      list: () => [],
      getDefinition: (id: string) =>
        id === "system.health.summary"
          ? ({ moduleId: id } as unknown as ModuleDescriptor)
          : null,
    } as unknown as Registry;

    createCli({ progName: "t", registry, executor, acl });

    expect(attached).toHaveLength(1);
    // Identity, not equivalence: a rebuild would produce an ACL that is deeply
    // equal and is NOT the host's object.
    expect(attached[0]).toBe(acl);
    // Which is what keeps `reload()` available to the embedder that needs it.
    expect(() => (attached[0] as ACL).reload()).not.toThrow();
  });
});
