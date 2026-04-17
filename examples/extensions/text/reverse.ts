/**
 * text.reverse — Reverse a string.
 */

import { Type, type Static } from "@sinclair/typebox";

export const InputSchema = Type.Object({
  text: Type.String({ description: "Input text to reverse" }),
});

export const OutputSchema = Type.Object({
  result: Type.String(),
});

export type Input = Static<typeof InputSchema>;
export type Output = Static<typeof OutputSchema>;

export class TextReverse {
  static readonly moduleId = "text.reverse";
  static readonly description = "Reverse the characters in a string";
  static readonly inputSchema = InputSchema;
  static readonly outputSchema = OutputSchema;

  execute(inputs: Input): Output {
    // Use Array.from to handle surrogate pairs correctly.
    return { result: Array.from(inputs.text).reverse().join("") };
  }
}
