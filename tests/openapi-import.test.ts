/**
 * FE-15a OpenAPI Import — verification matrix T-OAPI-01..27.
 *
 * FE-15b (§8) is out of scope for this release: no `--openapi` startup flag,
 * no `--binding` proxy dispatch, no `HTTPProxyRegistryWriter`. T-OAPI-30..40
 * are deliberately absent.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Command } from "commander";
import yaml from "js-yaml";
import { BindingLoader, deriveModuleId } from "apcore-toolkit";

import { registerOpenapiCommand } from "../src/openapi-cmd.js";
import {
  DEFAULT_OPENAPI_TIMEOUT_SECONDS,
  OpenapiSourceError,
  detectProxyHazards,
  loadOpenapiSource,
  parseHeaders,
} from "../src/openapi-source.js";
import { createCli } from "../src/main.js";
import type { Registry, Executor } from "../src/cli.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PETSTORE_YAML = `
openapi: "3.1.0"
info:
  title: Petstore
  version: "1.0.0"
paths:
  /pets:
    get:
      operationId: listPets
      summary: List all pets
      tags: [pets]
      parameters:
        - name: limit
          in: query
          schema: { type: integer }
      responses:
        "200":
          description: ok
    post:
      operationId: createPets
      summary: Create a pet
      tags: [pets]
      parameters:
        - name: dryRun
          in: query
          schema: { type: boolean }
        - name: tenant
          in: query
          schema: { type: string }
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                name: { type: string }
      responses:
        "201":
          description: created
  /pets/{petId}:
    delete:
      tags: [pets]
      parameters:
        - name: petId
          in: path
          required: true
          schema: { type: string }
      responses:
        "204":
          description: gone
`;

/** Same document as JSON, for the content-sniffing case. */
const PETSTORE_JSON = JSON.stringify(yaml.load(PETSTORE_YAML), null, 2);

const SWAGGER2 = `
swagger: "2.0"
info:
  title: Legacy
  version: "1.0.0"
paths: {}
`;

const NO_SUCCESS_RESPONSE = `
openapi: "3.0.3"
info: { title: Odd, version: "1.0.0" }
paths:
  /things:
    get:
      operationId: listThings
      responses:
        "500":
          description: boom
`;

const EXTERNAL_REF = `
openapi: "3.0.3"
info: { title: Refs, version: "1.0.0" }
paths:
  /things:
    get:
      operationId: listThings
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                $ref: "./common.yaml#/components/schemas/Error"
`;

const DEPRECATED_DOC = `
openapi: "3.0.3"
info: { title: Dep, version: "1.0.0" }
paths:
  /old:
    get:
      operationId: oldOne
      deprecated: true
      responses: { "200": { description: ok } }
  /stringy:
    get:
      operationId: stringyOne
      deprecated: "false"
      responses: { "200": { description: ok } }
  /new:
    get:
      operationId: newOne
      responses: { "200": { description: ok } }
`;

const SECURITY_SCHEMES = `
openapi: "3.0.3"
info: { title: Secure, version: "1.0.0" }
components:
  securitySchemes:
    apiKey:
      type: apiKey
      name: X-Super-Secret-Key
      in: header
security:
  - apiKey: []
paths:
  /things:
    get:
      operationId: listThings
      responses: { "200": { description: ok } }
`;

let FIXTURES: string;

beforeAll(() => {
  FIXTURES = fs.mkdtempSync(path.join(os.tmpdir(), "oapi-fixtures-"));
  const write = (name: string, body: string): void =>
    fs.writeFileSync(path.join(FIXTURES, name), body, "utf8");
  write("petstore.yaml", PETSTORE_YAML);
  write("petstore.json", PETSTORE_JSON);
  write("swagger2.yaml", SWAGGER2);
  write("no-success.yaml", NO_SUCCESS_RESPONSE);
  write("external-ref.yaml", EXTERNAL_REF);
  write("deprecated.yaml", DEPRECATED_DOC);
  write("security.yaml", SECURITY_SCHEMES);
  write("malformed.json", "{ not: valid json ");
});

const tempDirs: string[] = [];
function scratch(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "oapi-out-"));
  tempDirs.push(d);
  return d;
}

function fixture(name: string): string {
  return path.join(FIXTURES, name);
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const d of tempDirs.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

// ---------------------------------------------------------------------------
// Command harness
// ---------------------------------------------------------------------------

interface RunResult {
  code: number | undefined;
  stdout: string;
  stderr: string;
}

async function runOpenapi(argv: string[]): Promise<RunResult> {
  const out: string[] = [];
  const err: string[] = [];
  const stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
  const stderrSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: unknown) => {
      err.push(String(chunk));
      return true;
    });
  let code: number | undefined;
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((c?: number) => {
    code = c;
    throw new Error("__EXIT__");
  }) as never);

  const group = new Command("apcli").exitOverride();
  registerOpenapiCommand(group);
  try {
    await group.parseAsync(argv, { from: "user" });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== "__EXIT__") throw e;
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  }
  return { code, stdout: out.join(""), stderr: err.join("") };
}

// ---------------------------------------------------------------------------
// §4.1 source loading — T-OAPI-01, 02, 12, and the error rows of §6
// ---------------------------------------------------------------------------

describe("loadOpenapiSource (FE-15a §4.1)", () => {
  it("T-OAPI-01/02: parses YAML and JSON identically via content sniffing", async () => {
    const fromYaml = await loadOpenapiSource(fixture("petstore.yaml"));
    const fromJson = await loadOpenapiSource(fixture("petstore.json"));
    expect(fromJson).toEqual(fromYaml);
  });

  it("a missing source is reported as unreadable, not as a parse failure", async () => {
    await expect(loadOpenapiSource(fixture("nope.yaml"))).rejects.toThrow(
      /Cannot read OpenAPI source .*nope\.yaml/,
    );
  });

  it("malformed JSON is reported as a parse failure", async () => {
    await expect(loadOpenapiSource(fixture("malformed.json"))).rejects.toThrow(
      /Cannot parse OpenAPI source/,
    );
  });

  it("source errors carry CONFIG_INVALID so they map to exit 47", async () => {
    const err = await loadOpenapiSource(fixture("nope.yaml")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpenapiSourceError);
    expect((err as OpenapiSourceError).code).toBe("CONFIG_INVALID");
  });

  it("parses repeated --header values and rejects one without a colon", () => {
    expect(parseHeaders(["X-Key: abc", "Accept:application/json"])).toEqual({
      "X-Key": "abc",
      Accept: "application/json",
    });
    expect(() => parseHeaders(["oops"])).toThrow(/Invalid --header value/);
  });

  it("§4.1 units: the CLI takes SECONDS and hands loadSpec MILLISECONDS", async () => {
    // The trap this guards: `loadSpec`'s timeout is MILLISECONDS in TypeScript
    // and SECONDS in Python and Rust, while `--openapi-timeout` is seconds in
    // all three. A user must not have to know which SDK they are running, so
    // the conversion happens at the call boundary and is asserted here.
    const calls: Array<{ source: string; options?: { timeout?: number } }> = [];
    vi.resetModules();
    vi.doMock("apcore-toolkit", async () => {
      const actual =
        await vi.importActual<typeof import("apcore-toolkit")>("apcore-toolkit");
      return {
        ...actual,
        loadSpec: async (source: string, options?: { timeout?: number }) => {
          calls.push({ source, options });
          return { openapi: "3.1.0", paths: {} };
        },
      };
    });
    try {
      const { loadOpenapiSource: fresh, DEFAULT_OPENAPI_TIMEOUT_SECONDS: dflt } =
        await import("../src/openapi-source.js");
      await fresh("http://example.test/openapi.json", [], 7);
      expect(calls[0].options?.timeout).toBe(7000);
      await fresh("http://example.test/openapi.json");
      expect(calls[1].options?.timeout).toBe(dflt * 1000);
      expect(dflt).toBe(DEFAULT_OPENAPI_TIMEOUT_SECONDS);
    } finally {
      vi.doUnmock("apcore-toolkit");
      vi.resetModules();
    }
  });
});

// ---------------------------------------------------------------------------
// §4.2 openapi scan — T-OAPI-01..14
// ---------------------------------------------------------------------------

describe("apcli openapi scan (FE-15a §4.2)", () => {
  it("T-OAPI-01: one module per operation", async () => {
    const res = await runOpenapi(["openapi", "scan", fixture("petstore.yaml"), "--format", "json"]);
    const payload = JSON.parse(res.stdout);
    expect(payload.modules).toHaveLength(3);
    expect(res.code).toBeUndefined();
  });

  it("T-OAPI-02: a .json document yields the same modules as the .yaml one", async () => {
    const fromYaml = JSON.parse(
      (await runOpenapi(["openapi", "scan", fixture("petstore.yaml"), "--format", "json"])).stdout,
    );
    const fromJson = JSON.parse(
      (await runOpenapi(["openapi", "scan", fixture("petstore.json"), "--format", "json"])).stdout,
    );
    expect(fromJson.modules.map((m: { module_id: string }) => m.module_id)).toEqual(
      fromYaml.modules.map((m: { module_id: string }) => m.module_id),
    );
  });

  it("T-OAPI-03: IDs equal the toolkit's derive_module_id output, case preserved", async () => {
    const res = await runOpenapi(["openapi", "scan", fixture("petstore.yaml"), "--format", "json"]);
    const ids = JSON.parse(res.stdout).modules.map((m: { module_id: string }) => m.module_id);
    // The CLI must NOT re-derive, normalize or kebab-case what the toolkit
    // returns — that guarantee is conformance-pinned across three SDKs.
    expect(ids).toContain(deriveModuleId("/pets", "get", { operationId: "listPets" }));
    expect(ids).toContain("listPets");
    expect(ids).toContain("createPets");
  });

  it("T-OAPI-04: without operationId the path-and-method algorithm applies", async () => {
    const res = await runOpenapi(["openapi", "scan", fixture("petstore.yaml"), "--format", "json"]);
    const ids = JSON.parse(res.stdout).modules.map((m: { module_id: string }) => m.module_id);
    expect(ids).toContain("pets.petid.delete");
  });

  it("T-OAPI-05: --prefix prefixes every ID", async () => {
    const res = await runOpenapi([
      "openapi", "scan", fixture("petstore.yaml"), "--prefix", "api", "--format", "json",
    ]);
    const ids: string[] = JSON.parse(res.stdout).modules.map(
      (m: { module_id: string }) => m.module_id,
    );
    expect(ids).toHaveLength(3);
    expect(ids.every((id) => id.startsWith("api."))).toBe(true);
  });

  it("T-OAPI-05/06: --prefix is applied before filtering, so --include matches the prefixed ID", async () => {
    const res = await runOpenapi([
      "openapi", "scan", fixture("petstore.yaml"),
      "--prefix", "api", "--include", "^api\\.list", "--format", "json",
    ]);
    const ids = JSON.parse(res.stdout).modules.map((m: { module_id: string }) => m.module_id);
    expect(ids).toEqual(["api.listPets"]);
  });

  it("T-OAPI-06: --include keeps only matching IDs", async () => {
    const res = await runOpenapi([
      "openapi", "scan", fixture("petstore.yaml"), "--include", "^pets", "--format", "json",
    ]);
    const ids = JSON.parse(res.stdout).modules.map((m: { module_id: string }) => m.module_id);
    expect(ids).toEqual(["pets.petid.delete"]);
  });

  it("--exclude drops matching IDs", async () => {
    const res = await runOpenapi([
      "openapi", "scan", fixture("petstore.yaml"), "--exclude", "^pets", "--format", "json",
    ]);
    const ids = JSON.parse(res.stdout).modules.map((m: { module_id: string }) => m.module_id);
    expect(ids).toEqual(["listPets", "createPets"]);
  });

  it("T-OAPI-07: an invalid --exclude regex exits 2 and names the flag", async () => {
    const res = await runOpenapi([
      "openapi", "scan", fixture("petstore.yaml"), "--exclude", "([",
    ]);
    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(/Invalid regex for --exclude/);
  });

  it("T-OAPI-07: an invalid --include regex exits 2 and names the flag", async () => {
    const res = await runOpenapi([
      "openapi", "scan", fixture("petstore.yaml"), "--include", "([",
    ]);
    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(/Invalid regex for --include/);
  });

  it("T-OAPI-08: --no-deprecated omits operations marked deprecated: true", async () => {
    const withAll = await runOpenapi([
      "openapi", "scan", fixture("deprecated.yaml"), "--format", "json",
    ]);
    expect(
      JSON.parse(withAll.stdout).modules.map((m: { module_id: string }) => m.module_id),
    ).toContain("oldOne");

    const res = await runOpenapi([
      "openapi", "scan", fixture("deprecated.yaml"), "--no-deprecated", "--format", "json",
    ]);
    const ids = JSON.parse(res.stdout).modules.map((m: { module_id: string }) => m.module_id);
    expect(ids).not.toContain("oldOne");
    expect(ids).toContain("newOne");
  });

  it("T-OAPI-09: deprecated: \"false\" (a string) is not treated as deprecated", async () => {
    const res = await runOpenapi([
      "openapi", "scan", fixture("deprecated.yaml"), "--no-deprecated", "--format", "json",
    ]);
    const ids = JSON.parse(res.stdout).modules.map((m: { module_id: string }) => m.module_id);
    expect(ids).toContain("stringyOne");
  });

  it("T-OAPI-10: an operation with no 2xx response warns, keeps the module, exits 0", async () => {
    const res = await runOpenapi([
      "openapi", "scan", fixture("no-success.yaml"), "--format", "json",
    ]);
    const payload = JSON.parse(res.stdout);
    expect(payload.modules).toHaveLength(1);
    expect(payload.modules[0].warnings.join(" ")).toMatch(/no 2xx response defined/);
    expect(res.code).toBeUndefined();

    const table = await runOpenapi([
      "openapi", "scan", fixture("no-success.yaml"), "--format", "table",
    ]);
    // Warnings MUST be rendered, not dropped.
    expect(table.stdout).toMatch(/1 warning:/);
    expect(table.stdout).toMatch(/no 2xx response defined/);
  });

  it("T-OAPI-11: an external $ref is named in a warning and never fetched", async () => {
    const res = await runOpenapi([
      "openapi", "scan", fixture("external-ref.yaml"), "--format", "json",
    ]);
    const warnings = JSON.parse(res.stdout).modules[0].warnings.join(" ");
    expect(warnings).toMatch(/external \$ref not fetched/);
    expect(warnings).toContain("./common.yaml#/components/schemas/Error");
  });

  it("T-OAPI-12: a Swagger 2.0 document exits 47, naming `swagger` and 3.0/3.1", async () => {
    const res = await runOpenapi(["openapi", "scan", fixture("swagger2.yaml")]);
    expect(res.code).toBe(47);
    expect(res.stderr).toMatch(/swagger/i);
    expect(res.stderr).toMatch(/3\.0|3\.1/);
  });

  it("a missing source exits 47 with the documented message", async () => {
    const res = await runOpenapi(["openapi", "scan", fixture("nope.yaml")]);
    expect(res.code).toBe(47);
    expect(res.stderr).toMatch(/Cannot read OpenAPI source/);
  });

  it("a malformed --header value is a CLI usage error and exits 2, not 47", async () => {
    const res = await runOpenapi([
      "openapi", "scan", fixture("petstore.yaml"), "--header", "badvalue",
    ]);
    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(/Invalid --header value/);
  });

  it("T-OAPI-13: --format json is valid JSON, modules carry warnings, hazards are top-level", async () => {
    const res = await runOpenapi([
      "openapi", "scan", fixture("petstore.yaml"), "--format", "json",
    ]);
    const payload = JSON.parse(res.stdout);
    expect(payload.source).toBe(fixture("petstore.yaml"));
    expect(payload.openapi_version).toBe("3.1.0");
    for (const mod of payload.modules) {
      expect(Array.isArray(mod.warnings)).toBe(true);
    }
    expect(Array.isArray(payload.hazards)).toBe(true);
    expect(payload.hazards).toHaveLength(1);
    expect(payload.hazards[0].module_id).toBe("createPets");
    // Hazards are NOT inside a module's warnings array — they describe a
    // future execution path, not the scan that just ran.
    const created = payload.modules.find(
      (m: { module_id: string }) => m.module_id === "createPets",
    );
    expect(created.warnings).toEqual([]);
  });

  it("T-OAPI-14: --format markdown / skill render through toolkit formatModules", async () => {
    for (const style of ["markdown", "skill"]) {
      const res = await runOpenapi([
        "openapi", "scan", fixture("petstore.yaml"), "--format", style,
      ]);
      expect(res.stdout).toContain("listPets");
      expect(res.code).toBeUndefined();
    }
  });

  it("--format csv / jsonl emit one row per module", async () => {
    const csv = await runOpenapi([
      "openapi", "scan", fixture("petstore.yaml"), "--format", "csv",
    ]);
    expect(csv.stdout.split("\n").filter(Boolean)).toHaveLength(4); // header + 3
    const jsonl = await runOpenapi([
      "openapi", "scan", fixture("petstore.yaml"), "--format", "jsonl",
    ]);
    const rows = jsonl.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(rows).toHaveLength(3);
    expect(rows[0].route).toBe("GET /pets");
  });

  it("table output headlines the count, the source and the document identity", async () => {
    const res = await runOpenapi([
      "openapi", "scan", fixture("petstore.yaml"), "--format", "table",
    ]);
    expect(res.stdout).toContain(
      `3 operations from ${fixture("petstore.yaml")} (OpenAPI 3.1.0, Petstore 1.0.0)`,
    );
    expect(res.stdout).toContain("Module ID");
    expect(res.stdout).toContain("GET /pets");
  });
});

// ---------------------------------------------------------------------------
// §4.3 proxy hazards — T-OAPI-16, T-OAPI-17
// ---------------------------------------------------------------------------

describe("detectProxyHazards (FE-15a §4.3)", () => {
  it("T-OAPI-16: a POST carrying in: query parameters is a hazard, named with method + params", async () => {
    const res = await runOpenapi([
      "openapi", "scan", fixture("petstore.yaml"), "--format", "table",
    ]);
    expect(res.stdout).toMatch(/1 operation cannot be proxied/);
    expect(res.stdout).toContain("createPets");
    expect(res.stdout).toContain("POST with 2 `in: query` parameters");
    expect(res.stdout).toContain("dryRun, tenant");
    // Hazards never change the exit code in FE-15a.
    expect(res.code).toBeUndefined();
  });

  it("T-OAPI-17: a GET with query parameters is NOT a hazard", async () => {
    const spec = (await loadOpenapiSource(fixture("petstore.yaml"))) as Record<string, unknown>;
    const { OpenAPIScanner } = await import("apcore-toolkit");
    const modules = new OpenAPIScanner().scan(spec);
    const hazards = detectProxyHazards(spec, modules);
    expect(hazards.map((h) => h.moduleId)).toEqual(["createPets"]);
    expect(hazards.map((h) => h.moduleId)).not.toContain("listPets");
  });

  it("correlates by the toolkit's own metadata, so --prefix does not lose the hazard", async () => {
    const spec = (await loadOpenapiSource(fixture("petstore.yaml"))) as Record<string, unknown>;
    const { OpenAPIScanner } = await import("apcore-toolkit");
    const modules = new OpenAPIScanner().scan(spec, { basePathPrefix: "api" });
    expect(detectProxyHazards(spec, modules)[0].moduleId).toBe("api.createPets");
  });

  it("a filtered-out operation produces no hazard — no module, no hazard", async () => {
    const spec = (await loadOpenapiSource(fixture("petstore.yaml"))) as Record<string, unknown>;
    const { OpenAPIScanner } = await import("apcore-toolkit");
    const modules = new OpenAPIScanner().scan(spec, { exclude: "^createPets$" });
    expect(detectProxyHazards(spec, modules)).toEqual([]);
  });

  it("never throws on a malformed document — it is a diagnostic, not a parser", () => {
    expect(detectProxyHazards({}, [])).toEqual([]);
    expect(detectProxyHazards({ paths: null }, [])).toEqual([]);
    expect(detectProxyHazards({ paths: { "/x": { post: { parameters: "nope" } } } }, [])).toEqual([]);
    expect(
      detectProxyHazards({ paths: { "/x": { post: { parameters: [null, 42, {}] } } } }, []),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §4.4 openapi generate — T-OAPI-18..26
// ---------------------------------------------------------------------------

describe("apcli openapi generate (FE-15a §4.4)", () => {
  it("T-OAPI-18: writes one .binding.yaml per module", async () => {
    const out = scratch();
    const res = await runOpenapi([
      "openapi", "generate", fixture("petstore.yaml"), "-o", out,
    ]);
    const files = fs.readdirSync(out).sort();
    expect(files).toEqual([
      "createPets.binding.yaml",
      "listPets.binding.yaml",
      "pets.petid.delete.binding.yaml",
    ]);
    expect(res.code).toBeUndefined();
  });

  it("T-OAPI-19: --dry-run lists the paths and creates nothing", async () => {
    const out = scratch();
    const res = await runOpenapi([
      "openapi", "generate", fixture("petstore.yaml"), "-o", out, "--dry-run",
    ]);
    expect(fs.readdirSync(out)).toEqual([]);
    expect(res.stdout).toContain(path.join(out, "listPets.binding.yaml"));
    expect(res.stdout).toContain(path.join(out, "createPets.binding.yaml"));
  });

  it("T-OAPI-20: the artifact carries an intact routing contract", async () => {
    const out = scratch();
    await runOpenapi(["openapi", "generate", fixture("petstore.yaml"), "-o", out]);
    const doc = yaml.load(
      fs.readFileSync(path.join(out, "createPets.binding.yaml"), "utf8"),
    ) as { bindings: Array<Record<string, unknown>> };
    const binding = doc.bindings[0];
    // `target` is a ROUTE DESCRIPTOR, not an import path (§4.5).
    expect(binding.target).toBe("POST /pets");
    const metadata = binding.metadata as Record<string, unknown>;
    expect(metadata.http_method).toBe("POST");
    expect(String(metadata.http_method)).toBe(String(metadata.http_method).toUpperCase());
    expect(metadata.url_path).toBe("/pets");
  });

  it("T-OAPI-20: BindingLoader round-trips both routing keys, braces retained", async () => {
    const out = scratch();
    await runOpenapi(["openapi", "generate", fixture("petstore.yaml"), "-o", out]);
    const loaded = new BindingLoader().load(
      path.join(out, "pets.petid.delete.binding.yaml"),
    );
    expect(loaded).toHaveLength(1);
    const metadata = loaded[0].metadata as Record<string, unknown>;
    expect(metadata.http_method).toBe("DELETE");
    expect(metadata.url_path).toBe("/pets/{petId}");
  });

  it("T-OAPI-20: no base URL is written — nothing in this release consumes one", async () => {
    const out = scratch();
    await runOpenapi(["openapi", "generate", fixture("petstore.yaml"), "-o", out]);
    const raw = fs.readFileSync(path.join(out, "listPets.binding.yaml"), "utf8");
    expect(raw).not.toMatch(/base_url/);
  });

  it("T-OAPI-21: an existing file without --force is skipped, warned about, and exits 0", async () => {
    const out = scratch();
    const target = path.join(out, "listPets.binding.yaml");
    fs.writeFileSync(target, "PRE-EXISTING\n", "utf8");
    const res = await runOpenapi(["openapi", "generate", fixture("petstore.yaml"), "-o", out]);
    expect(fs.readFileSync(target, "utf8")).toBe("PRE-EXISTING\n");
    expect(res.stderr).toMatch(/already exists; skipped \(use --force to overwrite\)/);
    expect(res.code).toBeUndefined();
    // The other modules are still written.
    expect(fs.existsSync(path.join(out, "createPets.binding.yaml"))).toBe(true);
  });

  it("T-OAPI-22: --force overwrites the existing file", async () => {
    const out = scratch();
    const target = path.join(out, "listPets.binding.yaml");
    fs.writeFileSync(target, "PRE-EXISTING\n", "utf8");
    await runOpenapi(["openapi", "generate", fixture("petstore.yaml"), "-o", out, "--force"]);
    expect(fs.readFileSync(target, "utf8")).not.toBe("PRE-EXISTING\n");
    expect(fs.readFileSync(target, "utf8")).toContain("module_id: listPets");
  });

  it("T-OAPI-23 (withdrawn): there is no host-language source writer", async () => {
    // §4.4 note — an earlier draft offered `--writer native`. It cannot work:
    // every toolkit source writer resolves `target` as a `module.path:callable`
    // import path, while an OpenAPI-derived target is always a route
    // descriptor ("POST /pets"), so the flag could never succeed for any input
    // this command can produce. `generate` emits binding artifacts only.
    const group = new Command("apcli").exitOverride();
    group.configureOutput({ writeErr: () => undefined });
    registerOpenapiCommand(group);
    const generate = group.commands
      .find((c) => c.name() === "openapi")!
      .commands.find((c) => c.name() === "generate")!;
    expect(generate.options.map((o) => o.long)).not.toContain("--writer");

    generate.exitOverride().configureOutput({ writeErr: () => undefined });
    const out = scratch();
    await expect(
      group.parseAsync(
        ["openapi", "generate", fixture("petstore.yaml"), "-o", out, "--writer", "native"],
        { from: "user" },
      ),
    ).rejects.toThrow(/unknown option/);
  });

  it("T-OAPI-24: a --header value never reaches a generated file", async () => {
    const out = scratch();
    await runOpenapi([
      "openapi", "generate", fixture("petstore.yaml"), "-o", out,
      "--header", "X-Api-Key: super-secret-value",
    ]);
    for (const f of fs.readdirSync(out)) {
      const body = fs.readFileSync(path.join(out, f), "utf8");
      expect(body).not.toContain("super-secret-value");
      expect(body).not.toContain("X-Api-Key");
    }
  });

  it("T-OAPI-25: securitySchemes leave no credential material in any artifact", async () => {
    const out = scratch();
    await runOpenapi(["openapi", "generate", fixture("security.yaml"), "-o", out]);
    for (const f of fs.readdirSync(out)) {
      const body = fs.readFileSync(path.join(out, f), "utf8");
      expect(body).not.toContain("securitySchemes");
      expect(body).not.toContain("X-Super-Secret-Key");
    }
  });

  it("T-OAPI-26: generate reports the same hazard set as scan", async () => {
    const out = scratch();
    const generated = await runOpenapi([
      "openapi", "generate", fixture("petstore.yaml"), "-o", out,
    ]);
    const scanned = await runOpenapi([
      "openapi", "scan", fixture("petstore.yaml"), "--format", "table",
    ]);
    for (const text of [generated.stdout, scanned.stdout]) {
      expect(text).toMatch(/1 operation cannot be proxied/);
      expect(text).toContain("createPets");
      expect(text).toContain("dryRun, tenant");
    }
  });

  it("states plainly that generated bindings are not yet executable (§1.1)", async () => {
    const out = scratch();
    const res = await runOpenapi(["openapi", "generate", fixture("petstore.yaml"), "-o", out]);
    expect(res.stdout).toMatch(/not yet executable/);
  });

  it("-o is required", async () => {
    const group = new Command("apcli").exitOverride();
    group.configureOutput({ writeErr: () => undefined });
    registerOpenapiCommand(group);
    const generate = group.commands
      .find((c) => c.name() === "openapi")!
      .commands.find((c) => c.name() === "generate")!;
    generate.exitOverride().configureOutput({ writeErr: () => undefined });
    await expect(
      group.parseAsync(["openapi", "generate", fixture("petstore.yaml")], { from: "user" }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §4.7 registration — T-OAPI-27
// ---------------------------------------------------------------------------

describe("registration (FE-15a §4.7)", () => {
  it("openapi registers as a nested group with scan and generate", () => {
    const group = new Command("apcli");
    registerOpenapiCommand(group);
    const openapi = group.commands.find((c) => c.name() === "openapi")!;
    expect(openapi).toBeDefined();
    expect(openapi.commands.map((c) => c.name()).sort()).toEqual(["generate", "scan"]);
  });

  it("T-OAPI-27: registers in standalone mode, where no registry is wired", () => {
    const program = createCli({ progName: "t" });
    const group = program.commands.find((c) => c.name() === "apcli")!;
    expect(group.commands.map((c) => c.name())).toContain("openapi");
  });

  it("T-OAPI-27: scan succeeds with no registry — it never touches one", async () => {
    // The standalone fallback registry exits 47 the moment `list` or
    // `describe` reaches into it. `openapi scan` must not.
    const res = await runOpenapi([
      "openapi", "scan", fixture("petstore.yaml"), "--format", "json",
    ]);
    expect(JSON.parse(res.stdout).modules).toHaveLength(3);
    expect(res.code).toBeUndefined();
  });

  it("T-OAPI-27: generate succeeds with no registry", async () => {
    const out = scratch();
    const res = await runOpenapi(["openapi", "generate", fixture("petstore.yaml"), "-o", out]);
    expect(fs.readdirSync(out)).toHaveLength(3);
    expect(res.code).toBeUndefined();
  });

  it("there is no root-level openapi entry point", () => {
    const program = createCli({ progName: "t" });
    expect(program.commands.map((c) => c.name())).not.toContain("openapi");
  });

  it("openapi is not always-registered: mode:'include' without it leaves it out", () => {
    const program = createCli({
      progName: "t",
      registry: { list: () => [], getDefinition: () => null } as unknown as Registry,
      executor: { call: async () => ({}) } as unknown as Executor,
      apcli: { mode: "include", include: ["list"] },
    });
    const group = program.commands.find((c) => c.name() === "apcli")!;
    expect(group.commands.map((c) => c.name())).not.toContain("openapi");
  });
});
