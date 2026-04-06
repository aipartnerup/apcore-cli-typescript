/**
 * JSON Schema -> Commander options mapping.
 *
 * Protocol spec: Schema-driven argument parsing
 */

import type { OptionConfig } from "./main.js";
import { EXIT_CODES } from "./errors.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Sentinel type marker for boolean flags. */
const BOOLEAN_FLAG = Symbol("BOOLEAN_FLAG");

type TypeResult = "string" | "int" | "float" | typeof BOOLEAN_FLAG | "file";

/**
 * Map JSON Schema type to a type identifier.
 */
export function mapType(propName: string, propSchema: Record<string, unknown>): TypeResult {
  const schemaType = propSchema.type as string | undefined;

  // Check file convention
  if (
    schemaType === "string" &&
    (propName.endsWith("_file") || propSchema["x-cli-file"] === true)
  ) {
    return "file";
  }

  const typeMap: Record<string, TypeResult> = {
    string: "string",
    integer: "int",
    number: "float",
    boolean: BOOLEAN_FLAG,
    object: "string",
    array: "string",
  };

  if (!schemaType) {
    return "string";
  }

  return typeMap[schemaType] ?? "string";
}

/**
 * Extract help text from schema property, preferring x-llm-description.
 */
export function extractHelp(propSchema: Record<string, unknown>, maxLength = 1000): string | undefined {
  let text = propSchema["x-llm-description"] as string | undefined;
  if (!text) {
    text = propSchema.description as string | undefined;
  }
  if (!text) {
    return undefined;
  }
  if (maxLength > 0 && text.length > maxLength) {
    return text.slice(0, maxLength - 3) + "...";
  }
  return text;
}

// ---------------------------------------------------------------------------
// schemaToCliOptions
// ---------------------------------------------------------------------------

/** Reserved CLI option names that cannot be used by schema properties. */
const RESERVED_NAMES = new Set(["input", "yes", "large_input", "format", "sandbox"]);

/**
 * Convert a JSON Schema `properties` object into an array of
 * Commander option configurations.
 */
export function schemaToCliOptions(
  schema: Record<string, unknown>,
  maxHelpLength = 1000,
): OptionConfig[] {
  const properties = (schema.properties ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const requiredList = (schema.required ?? []) as string[];
  const options: OptionConfig[] = [];
  const flagNames: Record<string, string> = {};

  for (const [propName, propSchema] of Object.entries(properties)) {
    const flagName = "--" + propName.replace(/_/g, "-");

    // Collision detection
    if (flagName in flagNames) {
      process.stderr.write(
        `Error: Flag name collision: properties '${propName}' and '${flagNames[flagName]}' both map to '${flagName}'.\n`,
      );
      process.exit(EXIT_CODES.INVALID_CLI_INPUT);
    }
    flagNames[flagName] = propName;

    // Reserved name check
    if (RESERVED_NAMES.has(propName)) {
      process.stderr.write(
        `Error: Module schema property '${propName}' conflicts with a reserved CLI option name. Rename the property.\n`,
      );
      process.exit(EXIT_CODES.INVALID_CLI_INPUT);
    }

    const typeResult = mapType(propName, propSchema);
    const isRequired = requiredList.includes(propName);
    const helpBase = extractHelp(propSchema, maxHelpLength);
    const helpText = isRequired
      ? (helpBase ? helpBase + " " : "") + "[required]"
      : helpBase ?? "";
    const defaultValue = propSchema.default as unknown;

    if (typeResult === BOOLEAN_FLAG) {
      // Boolean flag pair: --flag/--no-flag
      const flagBase = propName.replace(/_/g, "-");
      const defaultVal = (propSchema.default as boolean) ?? false;
      options.push({
        name: propName,
        flags: `--${flagBase}, --no-${flagBase}`,
        description: helpText,
        defaultValue: defaultVal,
        required: isRequired,
        isBooleanFlag: true,
      });
    } else if ("enum" in propSchema && Array.isArray(propSchema.enum)) {
      const enumValues = propSchema.enum as unknown[];
      if (enumValues.length === 0) {
        // Empty enum — fall back to plain string option
        options.push({
          name: propName,
          flags: `${flagName} <value>`,
          description: helpText,
          defaultValue,
          required: isRequired,
        });
      } else {
        const stringValues = enumValues.map(String);
        const enumOriginalTypes: Record<string, string> = {};
        for (const v of enumValues) {
          if (typeof v === "number" && Number.isInteger(v)) {
            enumOriginalTypes[String(v)] = "int";
          } else if (typeof v === "number") {
            enumOriginalTypes[String(v)] = "float";
          } else if (typeof v === "boolean") {
            enumOriginalTypes[String(v)] = "bool";
          }
        }
        options.push({
          name: propName,
          flags: `${flagName} <value>`,
          description: helpText,
          defaultValue:
            defaultValue !== undefined ? String(defaultValue) : undefined,
          required: isRequired,
          choices: stringValues,
          enumOriginalTypes:
            Object.keys(enumOriginalTypes).length > 0
              ? enumOriginalTypes
              : undefined,
        });
      }
    } else {
      // Standard option
      let parseArg: ((value: string) => unknown) | undefined;
      if (typeResult === "int") {
        parseArg = (v: string) => {
          const n = parseInt(v, 10);
          if (isNaN(n)) throw new Error(`Invalid integer: ${v}`);
          return n;
        };
      } else if (typeResult === "float") {
        parseArg = (v: string) => {
          const n = parseFloat(v);
          if (isNaN(n)) throw new Error(`Invalid number: ${v}`);
          return n;
        };
      }
      options.push({
        name: propName,
        flags: `${flagName} <value>`,
        description: helpText,
        defaultValue,
        required: isRequired,
        parseArg,
      });
    }
  }

  return options;
}
