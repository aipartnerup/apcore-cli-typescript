/**
 * AuthProvider — API key auth with keyring/encrypted storage.
 *
 * Protocol spec: Security — authentication
 */

import type { ConfigResolver } from "../config.js";
import { AuthenticationError, ConfigDecryptionError } from "../errors.js";
import { ConfigEncryptor } from "./config-encryptor.js";

// ---------------------------------------------------------------------------
// AuthProvider
// ---------------------------------------------------------------------------

/**
 * Manages API key retrieval and request authentication.
 */
export class AuthProvider {
  private readonly config: ConfigResolver;
  private readonly _encryptor?: ConfigEncryptor;

  constructor(config: ConfigResolver, encryptor?: ConfigEncryptor) {
    this.config = config;
    this._encryptor = encryptor;
  }

  /**
   * Resolve the active ConfigEncryptor instance.
   *
   * D11-005 (2026-05-12): three-tier fallback chain matching Python's
   * `_get_encryptor` (auth.py:33): explicit constructor arg > peer attribute
   * `config.encryptor` (set by embedders injecting forced-AES test fixtures
   * or shared instances) > fresh `new ConfigEncryptor()`. Previously TS
   * skipped the peer-attribute tier, silently giving embedders a different
   * encryptor than the one they wired on the config.
   */
  private getEncryptor(): ConfigEncryptor {
    if (this._encryptor) return this._encryptor;
    const fromConfig = (this.config as unknown as { encryptor?: ConfigEncryptor }).encryptor;
    if (fromConfig) return fromConfig;
    return new ConfigEncryptor();
  }

  /**
   * Retrieve the API key from the configured sources.
   * Handles keyring: and enc: prefixes via ConfigEncryptor.
   */
  async getApiKey(): Promise<string | null> {
    const result = this.config.resolve(
      "auth.api_key",
      "--api-key",
      "APCORE_AUTH_API_KEY",
    );
    if (result === null || result === undefined) {
      return null;
    }
    const strResult = String(result);
    if (strResult.startsWith("keyring:") || strResult.startsWith("enc:")) {
      try {
        return await this.getEncryptor().retrieve(strResult, "auth.api_key");
      } catch (err) {
        if (err instanceof ConfigDecryptionError) {
          throw new AuthenticationError(
            "Failed to decrypt stored API key. " +
              "Re-store with 'apcli config set auth.api_key'.",
          );
        }
        throw err;
      }
    }
    return strResult;
  }

  /**
   * Add authentication headers to an outgoing request.
   *
   * Cross-SDK contract (D10-002, 2026-04-26): the input `headers` object
   * is mutated **in place** and the same reference is returned. Callers
   * that share the headers reference (the documented pattern in
   * apcore-cli/docs/features/security.md §AuthProvider) can read
   * `headers.Authorization` after the call without re-binding the
   * return value. Python and Rust both mutate-and-return; TS previously
   * spread into a new object, which silently broke shared-reference
   * callers.
   */
  async authenticateRequest(
    headers: Record<string, string>,
  ): Promise<Record<string, string>> {
    const key = await this.getApiKey();
    if (!key) {
      throw new AuthenticationError(
        "Remote registry requires authentication. " +
          "Set --api-key, APCORE_AUTH_API_KEY, or auth.api_key in config.",
      );
    }
    // Reject keys with CR/LF — a stray clipboard newline produces a confusing
    // HTTP error; failing early with a clear message is safer.
    if (/[\r\n]/.test(key)) {
      throw new AuthenticationError(
        "Malformed API key: contains invalid characters (CR/LF). " +
          "Re-store with 'apcli config set auth.api_key'.",
      );
    }
    headers.Authorization = `Bearer ${key.trim()}`;
    return headers;
  }

  /**
   * Handle an HTTP response status code for auth-related errors.
   */
  handleResponse(statusCode: number): void {
    if (statusCode === 401 || statusCode === 403) {
      throw new AuthenticationError(
        "Authentication failed. Verify your API key.",
      );
    }
  }
}
