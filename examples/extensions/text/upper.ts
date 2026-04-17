/**
 * text.upper — Uppercase a string.
 */

import { Type, type Static } from "@sinclair/typebox";

export const InputSchema = Type.Object({
  text: Type.String({ description: "Input text to uppercase" }),
});

export const OutputSchema = Type.Object({
  result: Type.String(),
});

export type Input = Static<typeof InputSchema>;
export type Output = Static<typeof OutputSchema>;

export class TextUpper {
  static readonly moduleId = "text.upper";
  static readonly description = "Convert input text to uppercase";
  static readonly inputSchema = InputSchema;
  static readonly outputSchema = OutputSchema;

  execute(inputs: Input): Output {
    return { result: inputs.text.toUpperCase() };
  }
}
