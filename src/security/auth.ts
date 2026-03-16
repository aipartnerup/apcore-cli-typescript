/**
 * AuthProvider — API key auth with keyring/encrypted storage.
 *
 * Protocol spec: Security — authentication
 */

import type { ConfigResolver } from "../config.js";
import { AuthenticationError } from "../errors.js";
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
  getApiKey(): string | null {
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
      return this.encryptor.retrieve(strResult, "auth.api_key");
    }
    return strResult;
  }

  /**
   * Add authentication headers to an outgoing request.
   */
  authenticateRequest(
    headers: Record<string, string>,
  ): Record<string, string> {
    const key = this.getApiKey();
    if (!key) {
      throw new AuthenticationError(
        "Remote registry requires authentication. " +
          "Set --api-key, APCORE_AUTH_API_KEY, or auth.api_key in config.",
      );
    }
    return { ...headers, Authorization: `Bearer ${key}` };
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
