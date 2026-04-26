/**
 * Tests for AuthProvider.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AuthProvider } from "../../src/security/auth.js";
import { AuthenticationError } from "../../src/errors.js";
import { ConfigResolver } from "../../src/config.js";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => {
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  }),
}));

describe("AuthProvider", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.APCORE_AUTH_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getApiKey()", () => {
    it("returns API key from env var", async () => {
      process.env.APCORE_AUTH_API_KEY = "test-key-123";
      const config = new ConfigResolver();
      const auth = new AuthProvider(config);
      expect(await auth.getApiKey()).toBe("test-key-123");
    });

    it("returns null when no key configured", async () => {
      const config = new ConfigResolver();
      const auth = new AuthProvider(config);
      expect(await auth.getApiKey()).toBeNull();
    });

    it("returns API key from CLI flags", async () => {
      const config = new ConfigResolver({ "--api-key": "cli-key" });
      const auth = new AuthProvider(config);
      expect(await auth.getApiKey()).toBe("cli-key");
    });
  });

  describe("authenticateRequest()", () => {
    it("adds Authorization: Bearer header", async () => {
      process.env.APCORE_AUTH_API_KEY = "my-key";
      const config = new ConfigResolver();
      const auth = new AuthProvider(config);
      const headers = await auth.authenticateRequest({ "Content-Type": "application/json" });
      expect(headers.Authorization).toBe("Bearer my-key");
      expect(headers["Content-Type"]).toBe("application/json");
    });

    it("throws AuthenticationError when no key available", async () => {
      const config = new ConfigResolver();
      const auth = new AuthProvider(config);
      await expect(auth.authenticateRequest({})).rejects.toThrow(AuthenticationError);
    });

    it("D10-002: mutates the input headers object in place", async () => {
      // Cross-SDK contract: callers that share the headers reference must
      // see Authorization on the original object after the call. Python
      // and Rust mutate-and-return; TS must too.
      process.env.APCORE_AUTH_API_KEY = "my-key";
      const config = new ConfigResolver();
      const auth = new AuthProvider(config);
      const input: Record<string, string> = { "Content-Type": "application/json" };
      const returned = await auth.authenticateRequest(input);
      // Same reference.
      expect(returned).toBe(input);
      // Mutation visible on the original.
      expect(input.Authorization).toBe("Bearer my-key");
    });
  });

  describe("decryption error wrapping (A-D-009)", () => {
    it("wraps ConfigDecryptionError as AuthenticationError from getApiKey()", async () => {
      const { ConfigDecryptionError } = await import("../../src/errors.js");
      const { ConfigEncryptor } = await import("../../src/security/config-encryptor.js");
      const config = new ConfigResolver(undefined, undefined);
      // Inject enc:v2: value so the encryptor path is reached
      vi.spyOn(config, "resolve").mockReturnValue("enc:v2:invalid_payload");
      const mockEnc = {
        retrieve: vi.fn().mockRejectedValue(new ConfigDecryptionError("bad")),
        store: vi.fn(),
      } as unknown as ConfigEncryptor;
      const auth = new AuthProvider(config, mockEnc);
      await expect(auth.getApiKey()).rejects.toThrow(AuthenticationError);
      await expect(auth.getApiKey()).rejects.not.toThrow(ConfigDecryptionError);
    });
  });

  describe("handleResponse()", () => {
    it("throws AuthenticationError on 401", () => {
      const config = new ConfigResolver();
      const auth = new AuthProvider(config);
      expect(() => auth.handleResponse(401)).toThrow(AuthenticationError);
    });

    it("throws AuthenticationError on 403", () => {
      const config = new ConfigResolver();
      const auth = new AuthProvider(config);
      expect(() => auth.handleResponse(403)).toThrow(AuthenticationError);
    });

    it("does nothing for 200", () => {
      const config = new ConfigResolver();
      const auth = new AuthProvider(config);
      expect(() => auth.handleResponse(200)).not.toThrow();
    });
  });
});
