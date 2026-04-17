/**
 * sysutil.disk — Get disk usage statistics for a path.
 */

import * as fs from "node:fs";
import { Type, type Static } from "@sinclair/typebox";

export const InputSchema = Type.Object({
  path: Type.String({
    description: "Filesystem path to check",
    default: "/",
  }),
});

export const OutputSchema = Type.Object({
  path: Type.String(),
  total: Type.String(),
  used: Type.String(),
  free: Type.String(),
  percent_used: Type.Number(),
});

export type Input = Static<typeof InputSchema>;
export type Output = Static<typeof OutputSchema>;

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  for (const unit of units) {
    if (value < 1024) {
      return `${value.toFixed(1)} ${unit}`;
    }
    value /= 1024;
  }
  return `${value.toFixed(1)} PB`;
}

export class SysutilDisk {
  static readonly moduleId = "sysutil.disk";
  static readonly description = "Get disk usage statistics for a given path";
  static readonly inputSchema = InputSchema;
  static readonly outputSchema = OutputSchema;

  execute(inputs: Input): Output {
    const targetPath = inputs.path ?? "/";
    // Node 18.15+ provides fs.statfsSync; fall back to a stat call
    // (which lacks free/total info) on older Node versions.
    const statfs = (fs as unknown as {
      statfsSync?: (p: string) => {
        bsize: number;
        blocks: number;
        bavail: number;
      };
    }).statfsSync;

    if (typeof statfs !== "function") {
      return {
        path: targetPath,
        total: "n/a (Node < 18.15)",
        used: "n/a",
        free: "n/a",
        percent_used: 0,
      };
    }

    const stat = statfs(targetPath);
    const total = stat.bsize * stat.blocks;
    const free = stat.bsize * stat.bavail;
    const used = total - free;
    return {
      path: targetPath,
      total: formatBytes(total),
      used: formatBytes(used),
      free: formatBytes(free),
      percent_used: total > 0 ? Math.round((used / total) * 1000) / 10 : 0,
    };
  }
}
