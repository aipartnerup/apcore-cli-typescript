/**
 * Tests for JSON Schema $ref resolver.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveRefs } from "../src/ref-resolver.js";

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

  it("exits 48 on circular $ref", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

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

    expect(() => resolveRefs(schema)).toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(48);
  });

  it("exits 48 when depth exceeds maxDepth", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

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

    expect(() => resolveRefs(schema, 2, "test")).toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(48);
  });

  it("exits 45 on unresolvable $ref", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const schema = {
      type: "object",
      properties: {
        thing: { $ref: "#/$defs/Missing" },
      },
      $defs: {},
    };

    expect(() => resolveRefs(schema)).toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(45);
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
});
