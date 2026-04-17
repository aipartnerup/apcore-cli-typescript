/**
 * math.add — Add two numbers.
 *
 * Reference example mirroring apcore-cli-python/examples/extensions/math/add.py
 * and apcore-cli-rust/examples/extensions/math/add.rs.
 *
 * NOTE: The apcore-js Module API is still in flux (Registry/Executor types in
 * apcore-cli-typescript are local placeholder interfaces pending upstream
 * export). When apcore-js publishes its Module contract, this file will be
 * loadable by `createCli({ extensionsDir: "./examples/extensions" })`.
 */

import { Type, type Static } from "@sinclair/typebox";

export const InputSchema = Type.Object({
  a: Type.Integer({ description: "First operand" }),
  b: Type.Integer({ description: "Second operand" }),
});

export const OutputSchema = Type.Object({
  sum: Type.Integer(),
});

export type Input = Static<typeof InputSchema>;
export type Output = Static<typeof OutputSchema>;

export class MathAdd {
  static readonly moduleId = "math.add";
  static readonly description = "Add two numbers and return the sum";
  static readonly inputSchema = InputSchema;
  static readonly outputSchema = OutputSchema;

  execute(inputs: Input): Output {
    return { sum: inputs.a + inputs.b };
  }
}
