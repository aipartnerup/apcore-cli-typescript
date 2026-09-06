/**
 * Keep the test suite out of the developer's real `~/.apcore-cli/audit.jsonl`.
 *
 * `createCli` installs an `AuditLogger` with no explicit path (parity with
 * Python's `__main__.py`), so it falls back to `AuditLogger.DEFAULT_PATH` —
 * the user's home. Every test that builds a CLI therefore appended real
 * execution records to a real file that is never cleaned up; one measured run
 * grew it by 1272 bytes, and the file had accumulated 238 KB. FE-14 §4.8's ACL
 * decision records are written through the same logger, which is what made the
 * leak visible, but the cause predates them.
 *
 * apcore-cli-python fixed the identical problem with a session-scoped autouse
 * fixture in `tests/conftest.py` that redirects `AuditLogger.DEFAULT_PATH` into
 * `tmp_path`. This is the vitest equivalent, registered as `setupFiles` so it
 * runs before every test file's own module body — including any logger built at
 * module scope.
 *
 * **Test-only.** Nothing in `src/` knows about this: production still resolves
 * the default path from `os.homedir()`, and the redirect exists solely so a
 * `pnpm test` leaves the home directory byte-for-byte unchanged.
 *
 * The temp path deliberately keeps the `.apcore-cli/audit.jsonl` tail, so
 * `tests/security/audit.test.ts`'s two `DEFAULT_PATH` assertions still hold and
 * still mean what they were written to mean — the *shape* of the default path,
 * not the developer's actual home. Tests that pass an explicit path (which is
 * most of `audit.test.ts`) are unaffected either way.
 */

import * as os from "node:os";
import * as path from "node:path";
import { AuditLogger } from "../../src/security/audit.js";

// Per worker process, so parallel test files never contend for one file. The
// directory is deliberately NOT pre-created: `AuditLogger`'s own
// `ensureDirectory` makes it on construction, so a worker that never builds a
// logger leaves nothing behind at all.
const TEST_AUDIT_HOME = path.join(
  os.tmpdir(),
  `apcore-cli-test-audit-${process.pid}`,
  ".apcore-cli",
);

/**
 * Global under which the production default — the value `src/` computed from
 * `os.homedir()` before the redirect replaced it — stays reachable.
 *
 * Without this the redirect would quietly hollow out
 * `tests/security/audit.test.ts`'s "uses default path based on home directory"
 * case: its assertions would still pass, against a path that is no longer the
 * home one. That test keeps asserting the real thing by reading this.
 */
export const REAL_DEFAULT_PATH_GLOBAL = "__apcoreCliRealAuditDefaultPath";

(globalThis as Record<string, unknown>)[REAL_DEFAULT_PATH_GLOBAL] =
  AuditLogger.DEFAULT_PATH;

// `DEFAULT_PATH` is `static readonly`, which TypeScript enforces at compile
// time only — at runtime it is an ordinary writable class field. Redefining it
// (rather than assigning through a cast) keeps the property non-writable, so a
// stray assignment in a test still fails the way it would in production.
Object.defineProperty(AuditLogger, "DEFAULT_PATH", {
  value: path.join(TEST_AUDIT_HOME, "audit.jsonl"),
  writable: false,
  enumerable: true,
  configurable: true,
});
