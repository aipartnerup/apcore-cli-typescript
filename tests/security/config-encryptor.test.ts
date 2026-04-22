/**
 * Tests for ConfigEncryptor.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConfigEncryptor } from "../../src/security/config-encryptor.js";
import { ConfigDecryptionError } from "../../src/errors.js";

describe("ConfigEncryptor", () => {
  const enc = new ConfigEncryptor();

  describe("AES round-trip", () => {
    it("encrypts and decrypts successfully", async () => {
      const stored = await enc.store("test.key", "my-secret-value");
      expect(stored.startsWith("enc:") || stored.startsWith("keyring:")).toBe(true);
      if (stored.startsWith("enc:")) {
        const result = await enc.retrieve(stored, "test.key");
        expect(result).toBe("my-secret-value");
      }
    });

    it("produces different ciphertext for same input (random nonce)", async () => {
      const a = await enc.store("k", "same-value");
      const b = await enc.store("k", "same-value");
      if (a.startsWith("enc:") && b.startsWith("enc:")) {
        expect(a).not.toBe(b);
      }
    });
  });

  describe("retrieve()", () => {
    it("throws ConfigDecryptionError on corrupted ciphertext", async () => {
      await expect(enc.retrieve("enc:AAAAAA==", "test")).rejects.toThrow(ConfigDecryptionError);
    });

    it("returns raw value for unrecognized prefix", async () => {
      expect(await enc.retrieve("plain-value", "key")).toBe("plain-value");
    });
  });

  // Review fix #2: APCORE_CLI_CONFIG_PASSPHRASE participates in KDF, and
  // a loud stderr warning fires once when the obfuscation-only fallback path
  // is used (i.e. when no passphrase is provided).
  describe("KDF hardening (APCORE_CLI_CONFIG_PASSPHRASE)", () => {
    let origPassphrase: string | undefined;
    let stderrSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      origPassphrase = process.env.APCORE_CLI_CONFIG_PASSPHRASE;
      // Reset the one-shot warning flag between tests via module reload.
      // (Each ConfigEncryptor shares a static flag; we read stderr regardless.)
      stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    });

    afterEach(() => {
      if (origPassphrase === undefined) delete process.env.APCORE_CLI_CONFIG_PASSPHRASE;
      else process.env.APCORE_CLI_CONFIG_PASSPHRASE = origPassphrase;
      stderrSpy.mockRestore();
    });

    it("ciphertext with passphrase set differs from ciphertext without", async () => {
      // Fresh encryptor instances so the weakFallbackWarned flag's side-effects
      // are isolated. We compare two enc blobs produced over the same plaintext
      // but different KDF inputs. Only the `enc:` path is probed — keyring
      // results short-circuit before hitting deriveKey at all.
      const { ConfigEncryptor: Fresh } = await import(
        "../../src/security/config-encryptor.js?kdf-test-1=" + Date.now()
      );
      delete process.env.APCORE_CLI_CONFIG_PASSPHRASE;
      const encWithout = new Fresh();
      const a = await encWithout.store("k", "payload");
      process.env.APCORE_CLI_CONFIG_PASSPHRASE = "my-secret-passphrase";
      const encWith = new Fresh();
      const b = await encWith.store("k", "payload");
      // If both fell through to `enc:` (no keyring), the derived keys differ
      // so even after stripping nonces the structure differs. We simply
      // assert round-trip works under each derivation and the two stored
      // strings are not identical byte-for-byte.
      if (a.startsWith("enc:") && b.startsWith("enc:")) {
        expect(a).not.toBe(b);
        delete process.env.APCORE_CLI_CONFIG_PASSPHRASE;
        // `b` was encrypted with passphrase; decrypting without should fail.
        await expect(encWithout.retrieve(b, "k")).rejects.toThrow(ConfigDecryptionError);
      }
    });

    it("emits obfuscation-only warning when falling back without passphrase", async () => {
      const { ConfigEncryptor: Fresh } = await import(
        "../../src/security/config-encryptor.js?kdf-test-2=" + Date.now()
      );
      delete process.env.APCORE_CLI_CONFIG_PASSPHRASE;
      const freshEnc = new Fresh();
      const stored = await freshEnc.store("k", "v");
      if (stored.startsWith("enc:")) {
        const out = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
        expect(out).toMatch(/APCORE_CLI_CONFIG_PASSPHRASE is not set/);
        expect(out).toMatch(/OBFUSCATION ONLY/);
      }
    });

    it("does NOT emit obfuscation warning when passphrase is set", async () => {
      const { ConfigEncryptor: Fresh } = await import(
        "../../src/security/config-encryptor.js?kdf-test-3=" + Date.now()
      );
      process.env.APCORE_CLI_CONFIG_PASSPHRASE = "my-secret";
      const freshEnc = new Fresh();
      await freshEnc.store("k", "v");
      const out = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(out).not.toMatch(/OBFUSCATION ONLY/);
    });
  });
});
