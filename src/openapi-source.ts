/**
 * OpenAPI source loading and proxy-hazard detection (FE-15a §4.1 / §4.3).
 *
 * Neither function registers a module, builds an executor, or issues a request
 * to the described API. `loadOpenapiSource` of a local file performs no
 * network I/O at all; of an `http(s)://` source it fetches exactly one
 * document — the one named on the command line.
 */

import { loadSpec, type ScannedModule } from "apcore-toolkit";

/** Default request timeout, in SECONDS (the CLI's unit — see below). */
export const DEFAULT_OPENAPI_TIMEOUT_SECONDS = 30;

/**
 * A source that could not be read, fetched or parsed.
 *
 * Carries `code: "CONFIG_INVALID"` so `exitCodeForError` maps it to 47 without
 * a special case.
 */
export class OpenapiSourceError extends Error {
  readonly code = "CONFIG_INVALID";
  constructor(message: string) {
    super(message);
    this.name = "OpenapiSourceError";
  }
}

/**
 * A malformed `--header` value (no `:` separator).
 *
 * This is a CLI usage mistake, not a source-loading failure — the source was
 * never even reached — so it is a distinct class from `OpenapiSourceError`
 * and carries `code: "INVALID_CLI_INPUT"` (exit 2) rather than
 * `OpenapiSourceError`'s `CONFIG_INVALID` (exit 47). Python and Rust both
 * exit 2 for the identical input.
 */
export class InvalidHeaderError extends Error {
  readonly code = "INVALID_CLI_INPUT";
  constructor(message: string) {
    super(message);
    this.name = "InvalidHeaderError";
  }
}

/**
 * Parse repeated `--header "Key: Value"` values into a header map.
 *
 * @throws {InvalidHeaderError} when an entry carries no `:` separator.
 */
export function parseHeaders(headers: readonly string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of headers) {
    const idx = raw.indexOf(":");
    if (idx <= 0) {
      throw new InvalidHeaderError(
        `Invalid --header value '${raw}' (expected "Key: Value").`,
      );
    }
    out[raw.slice(0, idx).trim()] = raw.slice(idx + 1).trim();
  }
  return out;
}

/**
 * Load and parse an OpenAPI document from a local path or `http(s)://` URL.
 *
 * The source is taken VERBATIM — no candidate paths (`/openapi.json`,
 * `/v3/api-docs`, …) are probed, so a wrong URL produces an honest 404 rather
 * than a surprising success against a different document. Format detection is
 * content sniffing, not file extension. All of that is `loadSpec`'s behaviour
 * and this function delegates to it.
 *
 * ## Timeout units
 *
 * `timeoutSeconds` is in SECONDS, which is the CLI's unit in all three SDKs.
 * `loadSpec`'s own `timeout` option is **milliseconds in TypeScript** and
 * seconds in Python and Rust, so the conversion happens here, at the call
 * boundary — a user must not have to know which SDK they are running
 * (FE-15a §4.1).
 *
 * @param source - Local filesystem path or `http(s)://` URL, verbatim.
 * @param headers - Repeated `--header "K: V"` values. Ignored for local files,
 *   and never copied into any generated artifact (FE-15a §4.4, §7.3).
 * @param timeoutSeconds - Request timeout in seconds. Default 30.
 * @throws {InvalidHeaderError} a `headers` entry carries no `:` separator —
 *   a CLI usage mistake caught before the source is ever read. Exits 2.
 * @throws {OpenapiSourceError} unreadable / unfetchable source, or malformed
 *   JSON / YAML. Both exit 47.
 */
export async function loadOpenapiSource(
  source: string,
  headers: readonly string[] = [],
  timeoutSeconds: number = DEFAULT_OPENAPI_TIMEOUT_SECONDS,
): Promise<Record<string, unknown>> {
  const headerMap = parseHeaders(headers);
  const seconds =
    Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
      ? timeoutSeconds
      : DEFAULT_OPENAPI_TIMEOUT_SECONDS;

  try {
    return await loadSpec(source, {
      headers: Object.keys(headerMap).length > 0 ? headerMap : undefined,
      // seconds → milliseconds. See the units note above.
      timeout: Math.round(seconds * 1000),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // `loadSpec` normalises every malformed-document failure to SyntaxError,
    // which is the one case that is a *parse* fault rather than a read fault.
    if (err instanceof SyntaxError) {
      throw new OpenapiSourceError(
        `Cannot parse OpenAPI source '${source}': ${detail}`,
      );
    }
    throw new OpenapiSourceError(
      `Cannot read OpenAPI source '${source}': ${detail}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Proxy-hazard detection (FE-15a §4.3)
// ---------------------------------------------------------------------------

/**
 * One operation that `HTTPProxyRegistryWriter` would encode incorrectly.
 *
 * The proxy writer decides body-versus-query by HTTP method alone: POST / PUT
 * / PATCH send every non-path input as a JSON body. A query parameter declared
 * on one of those methods would therefore be sent in the request body, and the
 * failure is silent — the server ignores the value or rejects the request, and
 * nothing reports a fault. FE-15a cannot fix that (the fix is upstream, in
 * apcore-toolkit) but it can and must make it visible.
 */
export interface ProxyHazard {
  /** The scanned module the affected operation produced. */
  moduleId: string;
  /** Uppercase HTTP method. */
  httpMethod: string;
  /** The OpenAPI path template, braces retained. */
  urlPath: string;
  /** Names of the offending `in: query` parameters, in document order. */
  parameters: string[];
}

/** Methods whose non-path inputs the proxy writer sends as a JSON body. */
const BODY_METHODS: ReadonlySet<string> = new Set(["post", "put", "patch"]);

/**
 * Identify operations FE-15b will be unable to proxy correctly.
 *
 * A pure diagnostic, not a routing decision: it reads the RAW parsed document
 * (which still carries `parameters[].in`, information `ScannedModule`
 * deliberately does not record) and correlates by the toolkit's own
 * `http_method` / `url_path` metadata, so no toolkit routing logic is
 * duplicated and `--prefix` / `--include` / `--exclude` are all honoured for
 * free.
 *
 * Never throws: a malformed `parameters` entry yields no hazard rather than an
 * exception.
 */
export function detectProxyHazards(
  spec: Record<string, unknown>,
  modules: readonly ScannedModule[],
): ProxyHazard[] {
  // Correlate on the metadata the scanner wrote rather than on a re-derived
  // module ID: the ID may carry a `--prefix`, and filtered-out operations must
  // produce no hazard because they produce no module.
  const byRoute = new Map<string, ScannedModule>();
  for (const mod of modules) {
    const meta = (mod.metadata ?? {}) as Record<string, unknown>;
    const method = meta.http_method;
    const urlPath = meta.url_path;
    if (typeof method === "string" && typeof urlPath === "string") {
      byRoute.set(`${method.toUpperCase()} ${urlPath}`, mod);
    }
  }

  const hazards: ProxyHazard[] = [];
  const paths = spec?.paths;
  if (paths == null || typeof paths !== "object" || Array.isArray(paths)) {
    return hazards;
  }

  for (const [urlPath, rawItem] of Object.entries(paths as Record<string, unknown>)) {
    if (rawItem == null || typeof rawItem !== "object" || Array.isArray(rawItem)) continue;
    const pathItem = rawItem as Record<string, unknown>;

    for (const method of BODY_METHODS) {
      const rawOp = pathItem[method];
      if (rawOp == null || typeof rawOp !== "object" || Array.isArray(rawOp)) continue;

      // Operation-level `parameters` only — that is exactly the set
      // `extractInputSchema` merges into `input_schema`, so the diagnostic and
      // the schema it warns about read the same source.
      const rawParams = (rawOp as Record<string, unknown>).parameters;
      if (!Array.isArray(rawParams)) continue;

      const offending: string[] = [];
      for (const rawParam of rawParams) {
        if (rawParam == null || typeof rawParam !== "object" || Array.isArray(rawParam)) continue;
        const param = rawParam as Record<string, unknown>;
        if (param.in !== "query") continue;
        if (typeof param.name !== "string" || param.name === "") continue;
        offending.push(param.name);
      }
      if (offending.length === 0) continue;

      const mod = byRoute.get(`${method.toUpperCase()} ${urlPath}`);
      if (!mod) continue; // filtered out — no module, no hazard

      hazards.push({
        moduleId: mod.moduleId,
        httpMethod: method.toUpperCase(),
        urlPath,
        parameters: offending,
      });
    }
  }
  return hazards;
}

/** Wire (snake_case) view of a hazard for the machine output formats. */
export function hazardToWire(h: ProxyHazard): Record<string, unknown> {
  return {
    module_id: h.moduleId,
    http_method: h.httpMethod,
    url_path: h.urlPath,
    parameters: [...h.parameters],
  };
}
