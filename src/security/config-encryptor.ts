/**
 * ConfigEncryptor — Keyring + AES-256-GCM fallback.
 *
 * Protocol spec: Security — config encryption
 */

import * as crypto from "node:crypto";
import * as os from "node:os";
import { ConfigDecryptionError } from "../errors.js";

// ---------------------------------------------------------------------------
// Keytar dynamic import helper
// ---------------------------------------------------------------------------

let keytarModule: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
async function getKeytar(): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (keytarModule) return keytarModule;
  try {
    keytarModule = await import("keytar");
    return keytarModule;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ConfigEncryptor
// ---------------------------------------------------------------------------

/**
 * Encrypts and decrypts configuration values. Prefers OS keyring for key
 * storage, falling back to AES-256-GCM with a derived key.
 */
export class ConfigEncryptor {
  static readonly SERVICE_NAME = "apcore-cli";

  /**
   * Encrypt and store a configuration value.
   */
  async store(key: string, value: string): Promise<string> {
    const keytar = await getKeytar();
    if (keytar) {
      try {
        await keytar.setPassword(ConfigEncryptor.SERVICE_NAME, key, value);
        return `keyring:${key}`;
      } catch {
        // Fall through to file-based encryption
      }
    }
    console.warn("OS keyring unavailable. Using file-based encryption.");
    const ciphertext = this.aesEncrypt(value);
    return `enc:${Buffer.from(ciphertext).toString("base64")}`;
  }

  /**
   * Retrieve and decrypt a configuration value.
   */
  async retrieve(configValue: string, key: string): Promise<string> {
    if (configValue.startsWith("keyring:")) {
      const keytar = await getKeytar();
      if (!keytar) {
        throw new ConfigDecryptionError(
          `Keyring module not available to retrieve '${key}'.`,
        );
      }
      try {
        const refKey = configValue.slice("keyring:".length);
        const result = await keytar.getPassword(
          ConfigEncryptor.SERVICE_NAME,
          refKey,
        );
        if (result === null || result === undefined) {
          throw new ConfigDecryptionError(
            `Keyring entry not found for '${refKey}'.`,
          );
        }
        return result;
      } catch (err) {
        if (err instanceof ConfigDecryptionError) throw err;
        throw new ConfigDecryptionError(
          `Failed to retrieve from keyring: ${err}`,
        );
      }
    }

    if (configValue.startsWith("enc:")) {
      const ciphertext = Buffer.from(
        configValue.slice("enc:".length),
        "base64",
      );
      try {
        return this.aesDecrypt(ciphertext);
      } catch {
        throw new ConfigDecryptionError(
          `Failed to decrypt configuration value '${key}'. Re-configure with 'apcore-cli config set ${key}'.`,
        );
      }
    }

    // Unrecognized prefix — return as-is
    return configValue;
  }

  // NOTE: Best-effort fallback when OS keyring is unavailable.
  // The key is derived from hostname + username (non-secret inputs).
  // For production security, ensure the OS keyring is accessible.
  private deriveKey(): Buffer {
    const hostname = os.hostname();
    const username =
      process.env.USER ?? process.env.USERNAME ?? "unknown";
    const salt = Buffer.from("apcore-cli-config-v1");
    const material = `${hostname}:${username}`;
    return crypto.pbkdf2Sync(material, salt, 100_000, 32, "sha256");
  }

  private aesEncrypt(plaintext: string): Buffer {
    const key = this.deriveKey();
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
    const ct = Buffer.concat([
      cipher.update(plaintext, "utf-8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    // Wire format: nonce(12) + tag(16) + ciphertext
    return Buffer.concat([nonce, tag, ct]);
  }

  private aesDecrypt(data: Buffer): string {
    const key = this.deriveKey();
    const nonce = data.subarray(0, 12);
    const tag = data.subarray(12, 28);
    const ct = data.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
    return plaintext.toString("utf-8");
  }
}
