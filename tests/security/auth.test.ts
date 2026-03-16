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
    it("returns API key from env var", () => {
      process.env.APCORE_AUTH_API_KEY = "test-key-123";
      const config = new ConfigResolver();
      const auth = new AuthProvider(config);
      expect(auth.getApiKey()).toBe("test-key-123");
    });

    it("returns null when no key configured", () => {
      const config = new ConfigResolver();
      const auth = new AuthProvider(config);
      expect(auth.getApiKey()).toBeNull();
    });

    it("returns API key from CLI flags", () => {
      const config = new ConfigResolver({ "--api-key": "cli-key" });
      const auth = new AuthProvider(config);
      expect(auth.getApiKey()).toBe("cli-key");
    });
  });

  describe("authenticateRequest()", () => {
    it("adds Authorization: Bearer header", () => {
      process.env.APCORE_AUTH_API_KEY = "my-key";
      const config = new ConfigResolver();
      const auth = new AuthProvider(config);
      const headers = auth.authenticateRequest({ "Content-Type": "application/json" });
      expect(headers.Authorization).toBe("Bearer my-key");
      expect(headers["Content-Type"]).toBe("application/json");
    });

    it("throws AuthenticationError when no key available", () => {
      const config = new ConfigResolver();
      const auth = new AuthProvider(config);
      expect(() => auth.authenticateRequest({})).toThrow(AuthenticationError);
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
