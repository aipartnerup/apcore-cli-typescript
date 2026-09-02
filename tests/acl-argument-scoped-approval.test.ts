/**
 * End-to-end verification that an ACL-sourced approval requirement reaches
 * `CliApprovalHandler` (apcore-js >= 0.28.0, PROTOCOL_SPEC §6.1.6-§6.1.8,
 * §6.9 rows 3-5, apcore#108).
 *
 * Before spec v1.28.0 the Step-5 approval gate fired only when the module's own
 * `annotations.requiresApproval` was true, so the CLI's handler only ever saw
 * annotation-gated modules. The gate now fires on the **union** of the
 * annotation, an ACL rule carrying `approval: required`, and `gateDestructive` —
 * so a module annotated `requiresApproval: false` can now be routed through
 * `CliApprovalHandler`.
 *
 * That matters here because `requestApproval` carries two defensive
 * short-circuits that return "approved / not_required" when the request says
 * approval is not needed. They must stay inert against a real `ApprovalRequest`,
 * whose annotations the gate rewrites to the *effective* value. The equivalent
 * path was broken in apcore-cli-python, which is why this is measured rather
 * than inferred.
 */

import { describe, it, expect } from "vitest";
import { APCore, ACL } from "apcore-js";
import { CliApprovalHandler } from "../src/approval.js";

/**
 * Executor holding `git.push`, an argument-scoped approval rule ahead of a
 * broad allow, and the CLI's own approval handler.
 *
 * `autoApprove` selects the handler's disposition: `true` answers "approved",
 * `false` falls through to the TTY branch, which under vitest has no terminal
 * and therefore rejects. The rejecting variant is what makes these tests
 * discriminating — a call that merely succeeds proves nothing, since a gate
 * that never fired would also let it through.
 */
function appWithArgumentScopedRule(autoApprove: boolean) {
  const app = new APCore();
  app.registry.register("git.push", {
    moduleId: "git.push",
    annotations: { requiresApproval: false },
    inputSchema: {
      type: "object",
      properties: { remote: { type: "string" }, force: { type: "boolean" } },
    },
    execute: async (input: Record<string, unknown>) => ({
      pushed: true,
      force: input.force === true,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  const acl = new ACL(
    [
      {
        callers: ["*"],
        targets: ["git.push"],
        effect: "allow",
        approval: "required",
        conditions: { arguments: { has_key: ["force"] } },
      },
      { callers: ["*"], targets: ["*"], effect: "allow" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    "deny" as any,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const executor = app.executor as any;
  executor.setAcl(acl);
  executor.setApprovalHandler(new CliApprovalHandler(autoApprove));
  return executor;
}

describe("ACL argument-scoped approval reaches CliApprovalHandler", () => {
  it("runs an ungated call without consulting the handler", async () => {
    const executor = appWithArgumentScopedRule(/*autoApprove*/ true);

    await expect(
      executor.call("git.push", { remote: "origin" }),
    ).resolves.toEqual({ pushed: true, force: false });
  });

  it("routes an ACL-gated call through the handler and runs it", async () => {
    const executor = appWithArgumentScopedRule(/*autoApprove*/ true);

    await expect(
      executor.call("git.push", { remote: "origin", force: true }),
    ).resolves.toEqual({ pushed: true, force: true });
  });

  it("reports the governance-effective requirement from validate()", async () => {
    // §7.9.5: the union is what `apcli validate` and `--dry-run` forward.
    const executor = appWithArgumentScopedRule(/*autoApprove*/ true);

    const plain = await executor.validate("git.push", { remote: "origin" });
    const forced = await executor.validate("git.push", {
      remote: "origin",
      force: true,
    });

    expect(plain.requiresApproval).toBe(false);
    expect(forced.requiresApproval).toBe(true);
  });

  it("consults a refusing handler only for the ACL-matched call", async () => {
    // The discriminating case. Deliberately uses a stub rather than
    // `CliApprovalHandler` with auto-approve off: that handler's refusal
    // depends on `process.stdin.isTTY` being falsy, which holds in a vitest
    // worker and stops holding in configurations that run tests on the main
    // thread with a terminal attached. The stub removes the ambient dependency
    // and lets the test assert the stronger property directly — that the gate
    // *consulted a handler at all*, and for which call.
    const seen: string[] = [];
    const executor = appWithArgumentScopedRule(/*autoApprove*/ true);
    executor.setApprovalHandler({
      async requestApproval(request: { moduleId: string; arguments: Record<string, unknown> }) {
        seen.push(`${request.moduleId}(${Object.keys(request.arguments).sort().join(",")})`);
        return { status: "rejected", reason: "refused by the test handler" };
      },
      async checkApproval() {
        return { status: "rejected" };
      },
    });

    await expect(
      executor.call("git.push", { remote: "origin" }),
    ).resolves.toEqual({ pushed: true, force: false });
    expect(seen).toEqual([]);

    await expect(
      executor.call("git.push", { remote: "origin", force: true }),
    ).rejects.toThrow();
    expect(seen).toEqual(["git.push(force,remote)"]);
  });
});
