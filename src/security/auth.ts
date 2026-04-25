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
  private readonly encryptor: ConfigEncryptor;

  constructor(config: ConfigResolver, encryptor?: ConfigEncryptor) {
    this.config = config;
    this.encryptor = encryptor ?? new ConfigEncryptor();
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
        return await this.encryptor.retrieve(strResult, "auth.api_key");
      } catch (err) {
        if (err instanceof ConfigDecryptionError) {
          throw new AuthenticationError(
            "Failed to decrypt stored API key. " +
              "Re-configure with 'apcore-cli config set auth.api_key'.",
          );
        }
        throw err;
      }
    }
    return strResult;
  }

  /**
   * Add authentication headers to an outgoing request.
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
          "Re-configure with 'apcore-cli config set auth.api_key'.",
      );
    }
    return { ...headers, Authorization: `Bearer ${key.trim()}` };
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
