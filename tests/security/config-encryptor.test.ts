/**
 * Tests for ConfigEncryptor.
 */

import { describe, it, expect } from "vitest";
import { ConfigEncryptor } from "../../src/security/config-encryptor.js";
import { ConfigDecryptionError } from "../../src/errors.js";

describe("ConfigEncryptor", () => {
  const enc = new ConfigEncryptor();

  describe("AES round-trip", () => {
    it("encrypts and decrypts successfully", () => {
      const stored = enc.store("test.key", "my-secret-value");
      expect(stored.startsWith("enc:") || stored.startsWith("keyring:")).toBe(true);
      if (stored.startsWith("enc:")) {
        const result = enc.retrieve(stored, "test.key");
        expect(result).toBe("my-secret-value");
      }
    });

    it("produces different ciphertext for same input (random nonce)", () => {
      const a = enc.store("k", "same-value");
      const b = enc.store("k", "same-value");
      if (a.startsWith("enc:") && b.startsWith("enc:")) {
        expect(a).not.toBe(b);
      }
    });
  });

  describe("retrieve()", () => {
    it("throws ConfigDecryptionError on corrupted ciphertext", () => {
      expect(() => enc.retrieve("enc:AAAAAA==", "test")).toThrow(ConfigDecryptionError);
    });

    it("returns raw value for unrecognized prefix", () => {
      expect(enc.retrieve("plain-value", "key")).toBe("plain-value");
    });
  });
});
