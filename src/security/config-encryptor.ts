/**
 * ConfigEncryptor — Keyring + AES-256-GCM fallback.
 *
 * Protocol spec: Security — config encryption
 */

import * as crypto from "node:crypto";
import * as os from "node:os";
import { ConfigDecryptionError } from "../errors.js";
import { warn as logWarn } from "../logger.js";

// PBKDF2-HMAC-SHA256 iteration count — follows OWASP 2024+ minimum for SHA-256.
const PBKDF2_ITERATIONS = 600_000;

// Static salt used only for backward-compatible reads of legacy enc: (v1) values.
const V1_STATIC_SALT = Buffer.from("apcore-cli-config-v1");

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

/**
 * Test-only seam: inject a stand-in `keytar` module so unit tests can
 * exercise reachable-but-failing keyring paths (D10-003 regression
 * coverage). Pass `null` to clear and fall back to real-keytar discovery
 * on the next call. Production code MUST NOT call this.
 */
export function _setKeytarForTesting(mod: unknown): void { // eslint-disable-line @typescript-eslint/no-explicit-any
  keytarModule = mod;
}

// ---------------------------------------------------------------------------
// ConfigEncryptor
// ---------------------------------------------------------------------------

/**
 * Encrypts and decrypts configuration values. Prefers OS keyring for key
 * storage, falling back to AES-256-GCM with a key derived from
 * APCORE_CLI_CONFIG_PASSPHRASE when set, or from hostname+username
 * (obfuscation-only) as a last resort.
 *
 * Wire format v2: enc:v2:<base64(salt(16)+nonce(12)+tag(16)+ciphertext)>
 * Legacy format:  enc:<base64(nonce(12)+tag(16)+ciphertext)>  (read-only)
 */
export class ConfigEncryptor {
  static readonly SERVICE_NAME = "apcore-cli";
  // One-shot flag so the "obfuscation only" warning fires exactly once
  // per process instead of once per encrypt/decrypt call.
  private static weakFallbackWarned = false;

  /**
   * Encrypt and store a configuration value.
   *
   * Cross-SDK contract (D10-003, 2026-04-26): when the OS keyring is
   * detected as available but `setPassword` then throws (locked keyring,
   * transient backend failure, permission revoked, etc.), the error is
   * propagated wrapped in a `ConfigDecryptionError`. Previously TS
   * caught the exception and silently fell through to AES file encryption
   * — a quiet downgrade that surprised users who expected a hard failure.
   * Python lets the keyring exception propagate raw; Rust returns
   * `ConfigDecryptionError::KeyringError`. The fall-through to AES is
   * still reached when `getKeytar()` returns `null` (keyring
   * genuinely unavailable on this platform / install).
   */
  async store(key: string, value: string): Promise<string> {
    const keytar = await getKeytar();
    if (keytar) {
      try {
        await keytar.setPassword(ConfigEncryptor.SERVICE_NAME, key, value);
        return `keyring:${key}`;
      } catch (err) {
        // Reachable but rejected the write — surface the error rather
        // than downgrading to file encryption. Use the existing
        // ConfigDecryptionError class so callers handling either store
        // or retrieve failures can keep a single catch.
        const detail = err instanceof Error ? err.message : String(err);
        throw new ConfigDecryptionError(
          `Failed to store '${key}' in OS keyring: ${detail}. ` +
            `Unset APCORE_CLI_CONFIG_PASSPHRASE-aware backends or unlock the keyring before retrying.`,
        );
      }
    }
    logWarn("OS keyring unavailable. Using file-based encryption.");
    const ciphertext = this.aesEncrypt(value);
    return `enc:v2:${ciphertext.toString("base64")}`;
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

    if (configValue.startsWith("enc:v2:")) {
      const data = Buffer.from(configValue.slice("enc:v2:".length), "base64");
      try {
        return this.aesDecrypt(data);
      } catch {
        throw new ConfigDecryptionError(
          `Failed to decrypt configuration value '${key}'. Re-configure with 'apcore-cli config set ${key}'.`,
        );
      }
    }

    if (configValue.startsWith("enc:")) {
      const data = Buffer.from(configValue.slice("enc:".length), "base64");
      try {
        return this.aesDecryptV1(data);
      } catch {
        throw new ConfigDecryptionError(
          `Failed to decrypt configuration value '${key}'. Re-configure with 'apcore-cli config set ${key}'.`,
        );
      }
    }

    // Unrecognized prefix — return as-is
    return configValue;
  }

  // Derive an AES-256 key with a provided salt (v2 format).
  //
  // Order of preference:
  //   1. APCORE_CLI_CONFIG_PASSPHRASE env var — a real secret supplied by
  //      the user; produces a key an attacker with filesystem read cannot
  //      reconstruct without also knowing the passphrase.
  //   2. hostname + username — obfuscation-only derivation for backward
  //      compatibility. Emits a loud stderr warning on first use so
  //      operators know the stored value is NOT protected against a
  //      filesystem-read attacker.
  private deriveKey(salt: Buffer): Buffer {
    const passphrase = process.env.APCORE_CLI_CONFIG_PASSPHRASE;
    if (passphrase && passphrase.length > 0) {
      return crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, 32, "sha256");
    }
    if (!ConfigEncryptor.weakFallbackWarned) {
      logWarn(
        "APCORE_CLI_CONFIG_PASSPHRASE is not set. The `enc:v2:` fallback uses a key " +
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
    return crypto.pbkdf2Sync(material, salt, PBKDF2_ITERATIONS, 32, "sha256");
  }

  private aesEncrypt(plaintext: string): Buffer {
    const salt = crypto.randomBytes(16);
    const key = this.deriveKey(salt);
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
    const ct = Buffer.concat([
      cipher.update(plaintext, "utf-8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    // Wire format v2: salt(16) + nonce(12) + tag(16) + ciphertext
    return Buffer.concat([salt, nonce, tag, ct]);
  }

  private aesDecrypt(data: Buffer): string {
    const salt = data.subarray(0, 16);
    const nonce = data.subarray(16, 28);
    const tag = data.subarray(28, 44);
    const ct = data.subarray(44);
    const key = this.deriveKey(salt);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf-8");
  }

  /** Decrypt legacy v1-format values: nonce(12)+tag(16)+ct, static salt. */
  private aesDecryptV1(data: Buffer): string {
    const nonce = data.subarray(0, 12);
    const tag = data.subarray(12, 28);
    const ct = data.subarray(28);
    const hostname = os.hostname();
    const username = process.env.USER ?? process.env.USERNAME ?? "unknown";
    const passphrase = process.env.APCORE_CLI_CONFIG_PASSPHRASE;
    const materials: string[] = passphrase
      ? [passphrase, `${hostname}:${username}`]
      : [`${hostname}:${username}`];

    for (const material of materials) {
      for (const iterations of [600_000, 100_000]) {
        try {
          const key = crypto.pbkdf2Sync(material, V1_STATIC_SALT, iterations, 32, "sha256");
          const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
          decipher.setAuthTag(tag);
          return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf-8");
        } catch {
          // try next combination
        }
      }
    }
    throw new Error("v1 decryption failed with all material+iteration combinations");
  }
}
