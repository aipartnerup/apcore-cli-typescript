/**
 * text.wordcount — Count words, characters, and lines in a string.
 */

import { Type, type Static } from "@sinclair/typebox";

export const InputSchema = Type.Object({
  text: Type.String({ description: "Input text to analyse" }),
});

export const OutputSchema = Type.Object({
  characters: Type.Integer(),
  words: Type.Integer(),
  lines: Type.Integer(),
});

export type Input = Static<typeof InputSchema>;
export type Output = Static<typeof OutputSchema>;

export class TextWordCount {
  static readonly moduleId = "text.wordcount";
  static readonly description = "Count words, characters, and lines in a text string";
  static readonly inputSchema = InputSchema;
  static readonly outputSchema = OutputSchema;

  execute(inputs: Input): Output {
    const text = inputs.text;
    return {
      characters: text.length,
      words: text.trim() === "" ? 0 : text.trim().split(/\s+/).length,
      lines: text.split("\n").length,
    };
  }
}
