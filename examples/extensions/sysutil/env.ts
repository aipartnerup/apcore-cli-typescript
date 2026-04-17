/**
 * sysutil.env — Read an environment variable.
 */

import { Type, type Static } from "@sinclair/typebox";

export const InputSchema = Type.Object({
  name: Type.String({ description: "Environment variable name" }),
  default: Type.Optional(
    Type.String({ description: "Default value when the variable is unset" }),
  ),
});

export const OutputSchema = Type.Object({
  name: Type.String(),
  value: Type.Union([Type.String(), Type.Null()]),
  source: Type.Union([Type.Literal("env"), Type.Literal("default"), Type.Literal("missing")]),
});

export type Input = Static<typeof InputSchema>;
export type Output = Static<typeof OutputSchema>;

export class SysutilEnv {
  static readonly moduleId = "sysutil.env";
  static readonly description = "Read an environment variable, optionally with a default";
  static readonly inputSchema = InputSchema;
  static readonly outputSchema = OutputSchema;

  execute(inputs: Input): Output {
    const value = process.env[inputs.name];
    if (value !== undefined) {
      return { name: inputs.name, value, source: "env" };
    }
    if (inputs.default !== undefined) {
      return { name: inputs.name, value: inputs.default, source: "default" };
    }
    return { name: inputs.name, value: null, source: "missing" };
  }
}
