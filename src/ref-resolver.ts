/**
 * JSON Schema $ref resolver.
 *
 * Protocol spec: Schema resolution & $ref handling
 */

import { CircularRefError, MaxDepthExceededError, UnresolvableRefError } from "./errors.js";

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
      throw new MaxDepthExceededError(
        `$ref resolution depth exceeded maximum of ${maxDepth} for module '${moduleId}'.`,
      );
    }

    if (visited.has(refPath)) {
      throw new CircularRefError(
        `Circular $ref detected in schema for module '${moduleId}' at path '${refPath}'.`,
      );
    }

    // Parse ref target: extract key from "#/$defs/Address" → "Address"
    const parts = refPath.split("/");
    const key = parts[parts.length - 1];

    if (!(key in defs)) {
      throw new UnresolvableRefError(
        `Unresolvable $ref '${refPath}' in schema for module '${moduleId}'.`,
      );
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
    // Seed parent node's own properties/required BEFORE merging branches,
    // so sibling fields are not silently dropped when a parent mixes
    // top-level `properties` with `allOf` branches.
    if (typeof obj.properties === "object" && obj.properties !== null) {
      Object.assign(merged.properties as Record<string, unknown>, obj.properties);
    }
    if (Array.isArray(obj.required)) {
      (merged.required as string[]).push(...(obj.required as string[]));
    }
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
      // Seed parent node's own properties first so sibling fields under a
      // parent that mixes top-level `properties` with `anyOf`/`oneOf` are
      // preserved (parity with allOf below). Audit D11-NEW-001 (2026-05-08).
      if (typeof obj.properties === "object" && obj.properties !== null) {
        Object.assign(merged.properties as Record<string, unknown>, obj.properties);
      }
      // Capture parent's sibling `required` BEFORE the branch loop. Per
      // JSON Schema semantics, a parent's required applies in addition to
      // the anyOf/oneOf branch intersection. Cross-SDK parity with Python
      // ref_resolver.py:102. Audit D11-NEW-001 (2026-05-08).
      const siblingRequired: string[] = Array.isArray(obj.required)
        ? (obj.required as string[]).slice()
        : [];
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
      // Required = parent's sibling required ∪ intersection of all branches
      // (deduplicated, preserving sibling-first order). Audit D11-NEW-001.
      let branchRequired: string[] = [];
      if (allRequiredSets.length > 0) {
        let intersection = allRequiredSets[0];
        for (let i = 1; i < allRequiredSets.length; i++) {
          intersection = new Set(
            [...intersection].filter((x) => allRequiredSets[i].has(x)),
          );
        }
        branchRequired = [...intersection];
      }
      const seen = new Set<string>();
      const combinedRequired: string[] = [];
      for (const r of [...siblingRequired, ...branchRequired]) {
        if (!seen.has(r)) {
          seen.add(r);
          combinedRequired.push(r);
        }
      }
      merged.required = combinedRequired;
      // Copy non-composition keys
      for (const [k, v] of Object.entries(obj)) {
        if (k !== keyword && !(k in merged)) {
          merged[k] = v;
        }
      }
      return merged;
    }
  }

  // Recursively process all keyword sub-schemas.
  // Walk every key whose value is an object (or array of objects) that may contain
  // $ref — this includes `properties`, `items`, `additionalProperties`,
  // `patternProperties`, `prefixItems`, `not`, `if`/`then`/`else`, etc.
  // max_depth counts $ref hops only — plain recursion does NOT increment `depth`.
  // Aligned with Rust ref_resolver.rs which iterates all keys (more correct for
  // arbitrary JSON Schema than properties-only walking).
  for (const [k, v] of Object.entries(obj)) {
    if (k === "allOf" || k === "anyOf" || k === "oneOf" || k === "$ref") {
      continue; // already handled above
    }
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      obj[k] = resolveNode(v, defs, visited, depth, maxDepth, moduleId);
    }
  }

  return obj;
}
