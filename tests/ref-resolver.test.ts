/**
 * Tests for JSON Schema $ref resolver.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveRefs } from "../src/ref-resolver.js";
import { CircularRefError, MaxDepthExceededError, UnresolvableRefError } from "../src/errors.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveRefs", () => {
  it("returns schema unchanged when no $refs present", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" },
      },
    };
    const result = resolveRefs(schema);
    expect(result).toEqual(schema);
  });

  it("inlines a simple $ref from $defs", () => {
    const schema = {
      type: "object",
      properties: {
        address: { $ref: "#/$defs/Address" },
      },
      $defs: {
        Address: {
          type: "object",
          properties: {
            street: { type: "string" },
          },
        },
      },
    };
    const result = resolveRefs(schema);
    expect(result.properties).toEqual({
      address: {
        type: "object",
        properties: { street: { type: "string" } },
      },
    });
    expect(result.$defs).toBeUndefined();
  });

  it("inlines a simple $ref from definitions", () => {
    const schema = {
      type: "object",
      properties: {
        addr: { $ref: "#/definitions/Addr" },
      },
      definitions: {
        Addr: {
          type: "object",
          properties: {
            city: { type: "string" },
          },
        },
      },
    };
    const result = resolveRefs(schema);
    expect((result.properties as Record<string, Record<string, unknown>>).addr.type).toBe("object");
    expect(result.definitions).toBeUndefined();
  });

  it("removes $defs and definitions from result", () => {
    const schema = {
      type: "object",
      $defs: { Foo: { type: "string" } },
      definitions: { Bar: { type: "number" } },
    };
    const result = resolveRefs(schema);
    expect(result.$defs).toBeUndefined();
    expect(result.definitions).toBeUndefined();
  });

  it("resolves nested $refs recursively", () => {
    const schema = {
      type: "object",
      properties: {
        outer: { $ref: "#/$defs/Outer" },
      },
      $defs: {
        Outer: {
          type: "object",
          properties: {
            inner: { $ref: "#/$defs/Inner" },
          },
        },
        Inner: {
          type: "object",
          properties: {
            value: { type: "string" },
          },
        },
      },
    };
    const result = resolveRefs(schema);
    const outer = (result.properties as Record<string, Record<string, unknown>>).outer;
    const innerProps = (outer.properties as Record<string, Record<string, unknown>>).inner;
    expect((innerProps.properties as Record<string, Record<string, unknown>>).value.type).toBe("string");
  });

  it("throws CircularRefError on circular $ref", () => {
    const schema = {
      type: "object",
      properties: {
        node: { $ref: "#/$defs/Node" },
      },
      $defs: {
        Node: {
          type: "object",
          properties: {
            child: { $ref: "#/$defs/Node" },
          },
        },
      },
    };

    expect(() => resolveRefs(schema)).toThrow(CircularRefError);
  });

  it("throws MaxDepthExceededError when depth exceeds maxDepth", () => {
    const schema = {
      type: "object",
      properties: {
        a: { $ref: "#/$defs/A" },
      },
      $defs: {
        A: {
          type: "object",
          properties: { b: { $ref: "#/$defs/B" } },
        },
        B: {
          type: "object",
          properties: { c: { $ref: "#/$defs/C" } },
        },
        C: { type: "string" },
      },
    };

    expect(() => resolveRefs(schema, 2, "test")).toThrow(MaxDepthExceededError);
  });

  it("MaxDepthExceededError is distinct from CircularRefError", () => {
    const circularSchema = {
      properties: { x: { $ref: "#/$defs/X" } },
      $defs: { X: { properties: { x: { $ref: "#/$defs/X" } } } },
    };
    const deepSchema = {
      properties: { a: { $ref: "#/$defs/A" } },
      $defs: { A: { properties: { b: { $ref: "#/$defs/B" } } }, B: { type: "string" } },
    };
    expect(() => resolveRefs(circularSchema)).toThrow(CircularRefError);
    expect(() => resolveRefs(circularSchema)).not.toThrow(MaxDepthExceededError);
    expect(() => resolveRefs(deepSchema, 1, "mod")).toThrow(MaxDepthExceededError);
    expect(() => resolveRefs(deepSchema, 1, "mod")).not.toThrow(CircularRefError);
  });

  it("throws UnresolvableRefError on missing $ref target", () => {
    const schema = {
      type: "object",
      properties: {
        thing: { $ref: "#/$defs/Missing" },
      },
      $defs: {},
    };

    expect(() => resolveRefs(schema)).toThrow(UnresolvableRefError);
  });

  it("resolves $refs inside non-properties keywords (items, additionalProperties)", () => {
    const schema = {
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: { $ref: "#/$defs/Tag" },
        },
        extra: { $ref: "#/$defs/Tag" },
      },
      additionalProperties: { $ref: "#/$defs/Tag" },
      $defs: {
        Tag: { type: "string", description: "a tag" },
      },
    };
    const result = resolveRefs(schema);
    // $ref inside items should be resolved
    expect((result.properties as Record<string, unknown>)?.tags).toEqual({
      type: "array",
      items: { type: "string", description: "a tag" },
    });
    // $ref inside additionalProperties should be resolved
    expect(result.additionalProperties).toEqual({ type: "string", description: "a tag" });
    expect(result.$defs).toBeUndefined();
  });

  // Composition tests
  it("merges allOf: combines properties and required", () => {
    const schema = {
      type: "object",
      properties: {
        person: {
          allOf: [
            {
              type: "object",
              properties: { name: { type: "string" } },
              required: ["name"],
            },
            {
              type: "object",
              properties: { age: { type: "integer" } },
              required: ["age"],
            },
          ],
        },
      },
    };
    const result = resolveRefs(schema);
    const person = (result.properties as Record<string, Record<string, unknown>>).person;
    const props = person.properties as Record<string, Record<string, unknown>>;
    expect(props.name.type).toBe("string");
    expect(props.age.type).toBe("integer");
    expect(person.required).toEqual(["name", "age"]);
  });

  it("merges anyOf: combines properties, intersects required", () => {
    const schema = {
      type: "object",
      properties: {
        contact: {
          anyOf: [
            {
              type: "object",
              properties: { email: { type: "string" }, name: { type: "string" } },
              required: ["email", "name"],
            },
            {
              type: "object",
              properties: { phone: { type: "string" }, name: { type: "string" } },
              required: ["phone", "name"],
            },
          ],
        },
      },
    };
    const result = resolveRefs(schema);
    const contact = (result.properties as Record<string, Record<string, unknown>>).contact;
    // Required should be intersection: only "name"
    expect(contact.required).toEqual(["name"]);
    const props = contact.properties as Record<string, Record<string, unknown>>;
    expect(props.email).toBeDefined();
    expect(props.phone).toBeDefined();
    expect(props.name).toBeDefined();
  });

  it("merges oneOf: combines properties, intersects required", () => {
    const schema = {
      type: "object",
      properties: {
        payment: {
          oneOf: [
            {
              type: "object",
              properties: { card: { type: "string" }, amount: { type: "number" } },
              required: ["card", "amount"],
            },
            {
              type: "object",
              properties: { iban: { type: "string" }, amount: { type: "number" } },
              required: ["iban", "amount"],
            },
          ],
        },
      },
    };
    const result = resolveRefs(schema);
    const payment = (result.properties as Record<string, Record<string, unknown>>).payment;
    expect(payment.required).toEqual(["amount"]);
  });

  it("copies non-composition keys from parent node", () => {
    const schema = {
      type: "object",
      properties: {
        thing: {
          description: "A thing",
          allOf: [
            { properties: { a: { type: "string" } } },
          ],
        },
      },
    };
    const result = resolveRefs(schema);
    const thing = (result.properties as Record<string, Record<string, unknown>>).thing;
    expect(thing.description).toBe("A thing");
  });

  it("does not mutate the original schema", () => {
    const schema = {
      type: "object",
      properties: {
        addr: { $ref: "#/$defs/Addr" },
      },
      $defs: {
        Addr: { type: "string" },
      },
    };
    const original = structuredClone(schema);
    resolveRefs(schema);
    expect(schema).toEqual(original);
  });

  // Audit D11-NEW-001 (2026-05-08): a parent's `required` applies in
  // addition to anyOf/oneOf branch intersection — sibling required must
  // not be silently dropped. Cross-SDK parity with Python ref_resolver.py.
  it("preserves parent sibling required when merging anyOf branches", () => {
    const schema = {
      type: "object",
      required: ["x"],
      anyOf: [
        { properties: { a: { type: "string" } }, required: ["a"] },
        { properties: { a: { type: "integer" } }, required: ["a"] },
      ],
    };
    const result = resolveRefs(schema);
    expect(result.required).toEqual(["x", "a"]);
  });

  it("preserves parent sibling required when merging oneOf branches", () => {
    const schema = {
      type: "object",
      required: ["host", "port"],
      oneOf: [
        { properties: { mode: { const: "http" } }, required: ["scheme"] },
        { properties: { mode: { const: "tcp" } }, required: ["scheme"] },
      ],
    };
    const result = resolveRefs(schema);
    expect(result.required).toEqual(["host", "port", "scheme"]);
  });

  it("dedupes when sibling required overlaps with branch intersection", () => {
    const schema = {
      type: "object",
      required: ["a"],
      anyOf: [{ required: ["a", "b"] }, { required: ["a", "c"] }],
    };
    const result = resolveRefs(schema);
    expect(result.required).toEqual(["a"]);
  });

  // Audit D11-NEW-003 (2026-05-08): max_depth counts $ref hops only;
  // plain nested-properties recursion does NOT increment depth. A
  // deeply-nested non-ref schema must resolve cleanly.
  it("does not count plain nested-properties recursion against max_depth", () => {
    let nested: Record<string, unknown> = { type: "string" };
    for (let i = 0; i < 50; i++) {
      nested = { type: "object", properties: { inner: nested } };
    }
    const schema = {
      type: "object",
      properties: { root: nested },
      $defs: {},
    };
    // Pre-fix this would crash with depth-exceeded around the 32nd level.
    expect(() => resolveRefs(schema, 32)).not.toThrow();
  });
});
