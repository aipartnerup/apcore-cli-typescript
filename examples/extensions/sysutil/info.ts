/**
 * sysutil.info — Get basic system information.
 */

import * as os from "node:os";
import * as path from "node:path";
import { Type, type Static } from "@sinclair/typebox";

export const InputSchema = Type.Object({});

export const OutputSchema = Type.Object({
  os: Type.String(),
  os_version: Type.String(),
  architecture: Type.String(),
  hostname: Type.String(),
  node_version: Type.String(),
  user: Type.String(),
  cwd: Type.String(),
});

export type Input = Static<typeof InputSchema>;
export type Output = Static<typeof OutputSchema>;

export class SysutilInfo {
  static readonly moduleId = "sysutil.info";
  static readonly description = "Get basic system information (OS, Node, hostname)";
  static readonly inputSchema = InputSchema;
  static readonly outputSchema = OutputSchema;

  execute(_inputs: Input): Output {
    return {
      os: os.type(),
      os_version: os.release(),
      architecture: os.arch(),
      hostname: os.hostname(),
      node_version: process.version,
      user: process.env.USER ?? process.env.USERNAME ?? "unknown",
      cwd: process.cwd(),
    };
  }
}

// Suppress the unused import warning for `path` (kept for parity with sister
// implementations that may need it for cross-platform path handling).
void path;
