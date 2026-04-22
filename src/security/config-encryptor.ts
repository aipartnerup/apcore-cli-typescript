/**
 * ConfigEncryptor — Keyring + AES-256-GCM fallback.
 *
 * Protocol spec: Security — config encryption
 */

import * as crypto from "node:crypto";
import * as os from "node:os";
import { ConfigDecryptionError } from "../errors.js";
import { warn as logWarn } from "../logger.js";

// ---------------------------------------------------------------------------
// Keytar dynamic import helper
// ---------------------------------------------------------------------------

let keytarModule: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
async function getKeytar(): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (keytarModule) return keytarModule;
  try {
    // @ts-expect-error — keytar is an optional peer dependency
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
 * storage, falling back to AES-256-GCM with a key derived from
 * APCORE_CLI_CONFIG_PASSPHRASE when set, or from hostname+username
 * (obfuscation-only) as a last resort.
 */
export class ConfigEncryptor {
  static readonly SERVICE_NAME = "apcore-cli";
  // One-shot flag so the "obfuscation only" warning fires exactly once
  // per process instead of once per encrypt/decrypt call.
  private static weakFallbackWarned = false;

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
    logWarn("OS keyring unavailable. Using file-based encryption.");
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

  // Derive an AES-256 key for the `enc:` fallback.
  //
  // Order of preference:
  //   1. APCORE_CLI_CONFIG_PASSPHRASE env var — a real secret supplied by
  //      the user; produces a key an attacker with filesystem read cannot
  //      reconstruct without also knowing the passphrase.
  //   2. hostname + username — obfuscation-only derivation for backward
  //      compatibility. Emits a loud stderr warning on first use so
  //      operators know the stored value is NOT protected against a
  //      filesystem-read attacker.
  //
  // For production security, set APCORE_CLI_CONFIG_PASSPHRASE or ensure
  // the OS keyring (keytar) is accessible so store() never reaches this path.
  private deriveKey(): Buffer {
    const salt = Buffer.from("apcore-cli-config-v1");
    const passphrase = process.env.APCORE_CLI_CONFIG_PASSPHRASE;
    if (passphrase && passphrase.length > 0) {
      return crypto.pbkdf2Sync(passphrase, salt, 100_000, 32, "sha256");
    }
    if (!ConfigEncryptor.weakFallbackWarned) {
      logWarn(
        "APCORE_CLI_CONFIG_PASSPHRASE is not set. The `enc:` fallback uses a key " +
          "derived from hostname+username (non-secret inputs) and is OBFUSCATION " +
          "ONLY — an attacker with filesystem read access can reconstruct the key. " +
          "Set APCORE_CLI_CONFIG_PASSPHRASE or ensure the OS keyring is available " +
          "for real encryption.",
      );
      ConfigEncryptor.weakFallbackWarned = true;
    }
    const hostname = os.hostname();
    const username = process.env.USER ?? process.env.USERNAME ?? "unknown";
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
