/**
 * JSON Schema $ref resolver.
 *
 * Protocol spec: Schema resolution & $ref handling
 */

import { EXIT_CODES } from "./errors.js";

// ---------------------------------------------------------------------------
// resolveRefs
// ---------------------------------------------------------------------------

/**
 * Resolve all $ref references in a JSON Schema.
 * Returns a fully inlined schema with $defs/definitions removed.
 */
export function resolveRefs(
  schema: Record<string, unknown>,
  maxDepth = 32,
  moduleId = "",
): Record<string, unknown> {
  const cloned = structuredClone(schema);
  const defs = (cloned.$defs ?? cloned.definitions ?? {}) as Record<
    string,
    unknown
  >;
  const result = resolveNode(
    cloned,
    defs,
    new Set<string>(),
    0,
    maxDepth,
    moduleId,
  ) as Record<string, unknown>;

  // Remove definition keys
  delete result.$defs;
  delete result.definitions;
  return result;
}

function resolveNode(
  node: unknown,
  defs: Record<string, unknown>,
  visited: Set<string>,
  depth: number,
  maxDepth: number,
  moduleId: string,
): unknown {
  if (typeof node !== "object" || node === null || Array.isArray(node)) {
    return node;
  }

  const obj = node as Record<string, unknown>;

  // Handle $ref
  if ("$ref" in obj) {
    const refPath = obj.$ref as string;

    if (depth >= maxDepth) {
      process.stderr.write(
        `Error: $ref resolution depth exceeded maximum of ${maxDepth} for module '${moduleId}'.\n`,
      );
      process.exit(EXIT_CODES.SCHEMA_CIRCULAR_REF);
    }

    if (visited.has(refPath)) {
      process.stderr.write(
        `Error: Circular $ref detected in schema for module '${moduleId}' at path '${refPath}'.\n`,
      );
      process.exit(EXIT_CODES.SCHEMA_CIRCULAR_REF);
    }

    // Parse ref target: extract key from "#/$defs/Address" → "Address"
    const parts = refPath.split("/");
    const key = parts[parts.length - 1];

    if (!(key in defs)) {
      process.stderr.write(
        `Error: Unresolvable $ref '${refPath}' in schema for module '${moduleId}'.\n`,
      );
      process.exit(EXIT_CODES.SCHEMA_VALIDATION_ERROR);
    }

    const newVisited = new Set(visited);
    newVisited.add(refPath);
    return resolveNode(defs[key], defs, newVisited, depth + 1, maxDepth, moduleId);
  }

  // Handle allOf
  if ("allOf" in obj && Array.isArray(obj.allOf)) {
    const merged: Record<string, unknown> = {
      properties: {},
      required: [] as string[],
    };
    for (const subSchema of obj.allOf as unknown[]) {
      const resolved = resolveNode(
        subSchema,
        defs,
        visited,
        depth + 1,
        maxDepth,
        moduleId,
      ) as Record<string, unknown>;
      if (resolved.properties) {
        Object.assign(
          merged.properties as Record<string, unknown>,
          resolved.properties,
        );
      }
      if (Array.isArray(resolved.required)) {
        (merged.required as string[]).push(...resolved.required);
      }
    }
    // Deduplicate required
    merged.required = [...new Set(merged.required as string[])];
    // Copy non-composition keys
    for (const [k, v] of Object.entries(obj)) {
      if (k !== "allOf" && !(k in merged)) {
        merged[k] = v;
      }
    }
    return merged;
  }

  // Handle anyOf / oneOf
  for (const keyword of ["anyOf", "oneOf"]) {
    if (keyword in obj && Array.isArray(obj[keyword])) {
      const merged: Record<string, unknown> = {
        properties: {},
        required: [] as string[],
      };
      const allRequiredSets: Set<string>[] = [];
      for (const subSchema of obj[keyword] as unknown[]) {
        const resolved = resolveNode(
          subSchema,
          defs,
          visited,
          depth + 1,
          maxDepth,
          moduleId,
        ) as Record<string, unknown>;
        if (resolved.properties) {
          Object.assign(
            merged.properties as Record<string, unknown>,
            resolved.properties,
          );
        }
        if (Array.isArray(resolved.required)) {
          allRequiredSets.push(new Set(resolved.required as string[]));
        }
      }
      // Required = intersection of all branches
      if (allRequiredSets.length > 0) {
        let intersection = allRequiredSets[0];
        for (let i = 1; i < allRequiredSets.length; i++) {
          intersection = new Set(
            [...intersection].filter((x) => allRequiredSets[i].has(x)),
          );
        }
        merged.required = [...intersection];
      } else {
        merged.required = [];
      }
      // Copy non-composition keys
      for (const [k, v] of Object.entries(obj)) {
        if (k !== keyword && !(k in merged)) {
          merged[k] = v;
        }
      }
      return merged;
    }
  }

  // Recursively process nested properties
  if ("properties" in obj && typeof obj.properties === "object" && obj.properties !== null) {
    const props = obj.properties as Record<string, unknown>;
    for (const [propName, propSchema] of Object.entries(props)) {
      props[propName] = resolveNode(
        propSchema,
        defs,
        visited,
        depth + 1,
        maxDepth,
        moduleId,
      );
    }
  }

  return obj;
}
