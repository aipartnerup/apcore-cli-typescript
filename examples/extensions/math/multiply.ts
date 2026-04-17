/**
 * math.multiply — Multiply two numbers.
 *
 * Reference example mirroring apcore-cli-python/examples/extensions/math/multiply.py.
 */

import { Type, type Static } from "@sinclair/typebox";

export const InputSchema = Type.Object({
  a: Type.Integer({ description: "First operand" }),
  b: Type.Integer({ description: "Second operand" }),
});

export const OutputSchema = Type.Object({
  product: Type.Integer(),
});

export type Input = Static<typeof InputSchema>;
export type Output = Static<typeof OutputSchema>;

export class MathMultiply {
  static readonly moduleId = "math.multiply";
  static readonly description = "Multiply two numbers and return the product";
  static readonly inputSchema = InputSchema;
  static readonly outputSchema = OutputSchema;

  execute(inputs: Input): Output {
    return { product: inputs.a * inputs.b };
  }
}
