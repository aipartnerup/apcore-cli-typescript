/**
 * Tests for ConfigEncryptor.
 */

import { describe, it, expect } from "vitest";
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
});
