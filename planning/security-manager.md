# FE-05: Security Manager

> **Priority:** P1-P2
> **Source:** `src/security/auth.ts`, `src/security/audit.ts`, `src/security/config-encryptor.ts`, `src/security/sandbox.ts`, `src/security/index.ts`
> **Tests:** `tests/security/auth.test.ts`, `tests/security/audit.test.ts`, `tests/security/config-encryptor.test.ts`, `tests/security/sandbox.test.ts`
> **Reference:** `../apcore-cli-python/src/apcore_cli/security/`
> **Dependencies:** FE-07 (Config Resolver)

## Overview

Security features: API key authentication, encrypted config storage, audit logging, and
subprocess sandboxing. Uses Node.js built-in `crypto` module for AES-256-GCM encryption
and SHA-256 hashing. Optional OS keychain via `keytar` package.

## Key Differences from Python

| Python | TypeScript |
|--------|-----------|
| `hashlib.sha256` | `crypto.createHash('sha256')` |
| `cryptography` AES-GCM | `crypto.createCipheriv('aes-256-gcm')` |
| `hashlib.pbkdf2_hmac` | `crypto.pbkdf2Sync()` |
| `keyring` | `keytar` (optional peer dep) |
| `secrets.token_bytes(16)` | `crypto.randomBytes(16)` |
| `subprocess.run()` | `child_process.execFileSync()` |
| `os.getlogin()` | `os.userInfo().username` |
| `pathlib.Path.home()` | `os.homedir()` |
| `pwd.getpwuid()` | N/A (os.userInfo covers this) |

## Tasks

### Task 1: AuthProvider — API key resolution (RED → GREEN → REFACTOR)

**Tests (auth.test.ts):**
```typescript
describe("AuthProvider", () => {
  describe("getApiKey()", () => {
    it("returns API key from config resolver");
    it("returns null when no key configured");
    it("resolves keyring: prefix via ConfigEncryptor");
    it("resolves enc: prefix via ConfigEncryptor");
  });
  describe("authenticateRequest()", () => {
    it("adds Authorization: Bearer header");
    it("throws AuthenticationError when no key available");
    it("preserves existing headers");
  });
  describe("handleResponse()", () => {
    it("throws AuthenticationError on 401");
    it("throws AuthenticationError on 403");
    it("does nothing for 200");
  });
});
```

**Implementation:**
- `getApiKey()`: resolve via `config.resolve("auth.api_key", "--api-key", "APCORE_AUTH_API_KEY")`
- Handle `keyring:` and `enc:` prefixes → delegate to `ConfigEncryptor.retrieve()`
- `authenticateRequest(headers)`: get key, throw if null, add `Authorization: Bearer`
- `handleResponse(statusCode)`: throw on 401/403

### Task 2: ConfigEncryptor — keyring + AES-256-GCM (RED → GREEN → REFACTOR)

**Tests (config-encryptor.test.ts):**
```typescript
describe("ConfigEncryptor", () => {
  describe("store()", () => {
    it("stores via keyring when available, returns keyring: prefix");
    it("falls back to AES-256-GCM, returns enc: prefix");
  });
  describe("retrieve()", () => {
    it("retrieves from keyring for keyring: prefix");
    it("decrypts AES-256-GCM for enc: prefix");
    it("throws ConfigDecryptionError on failed decryption");
    it("throws ConfigDecryptionError on missing keyring entry");
    it("returns raw value for unrecognized prefix");
  });
  describe("_deriveKey()", () => {
    it("derives 32-byte key via PBKDF2-HMAC-SHA256");
    it("uses hostname:username as material");
  });
  describe("AES round-trip", () => {
    it("encrypts and decrypts successfully");
    it("produces different ciphertext for same input (random nonce)");
  });
});
```

**Implementation:**
- `store(key, value)`: try keytar → fallback to AES-256-GCM encrypt
- `retrieve(configValue, key)`: detect prefix → keytar or AES decrypt
- `_deriveKey()`: `crypto.pbkdf2Sync(hostname:username, salt, 100000, 32, 'sha256')`
- `_aesEncrypt(plaintext)`: nonce(12) + tag(16) + ciphertext
- `_aesDecrypt(data)`: extract nonce/tag/ct, decrypt
- `_keytarAvailable()`: try `require('keytar')`, catch → false

### Task 3: AuditLogger — JSONL audit trail (RED → GREEN → REFACTOR)

**Tests (audit.test.ts):**
```typescript
describe("AuditLogger", () => {
  it("creates parent directory if missing");
  it("appends JSONL entry with correct fields");
  it("includes timestamp, user, module_id, input_hash, status, exit_code, duration_ms");
  it("hashes input with random salt (SHA-256)");
  it("produces different hashes for same input (per-invocation salt)");
  it("handles write errors gracefully (logs warning, no crash)");
  it("uses ~/.apcore-cli/audit.jsonl as default path");
  it("resolves username via os.userInfo()");
});
```

**Implementation:**
- Default path: `path.join(os.homedir(), '.apcore-cli', 'audit.jsonl')`
- `_ensureDirectory()`: `fs.mkdirSync(dir, { recursive: true })`
- `logExecution(moduleId, inputData, status, exitCode, durationMs)`:
  - Build entry object with ISO timestamp
  - `_hashInput(inputData)`: `crypto.randomBytes(16)` + SHA-256
  - `fs.appendFileSync(path, JSON.stringify(entry) + '\n')`
  - Catch `Error` → log warning
- `_getUser()`: `os.userInfo().username` → fallback `process.env.USER ?? 'unknown'`

### Task 4: Sandbox — subprocess isolation (RED → GREEN → REFACTOR)

**Tests (sandbox.test.ts):**
```typescript
describe("Sandbox", () => {
  describe("execute()", () => {
    it("delegates to executor when disabled");
    it("runs in subprocess when enabled");
    it("passes JSON via stdin to child process");
    it("parses JSON stdout from child process");
    it("throws ModuleExecutionError on non-zero exit code");
    it("throws ModuleExecutionError on timeout (300s)");
    it("restricts environment variables");
    it("sets isolated HOME and TMPDIR");
    it("passes APCORE_* env vars through");
  });
});
```

**Implementation:**
- `execute(moduleId, inputData, executor)`:
  - If disabled: `executor.execute(moduleId, inputData)`
  - If enabled: `_sandboxedExecute(moduleId, inputData)`
- `_sandboxedExecute()`:
  - Build restricted env: `PATH`, `NODE_PATH`, `LANG`, `LC_ALL`, `APCORE_*`
  - Create temp dir for `HOME` and `TMPDIR`
  - `child_process.execFileSync(process.execPath, [sandboxRunner, moduleId], { input: JSON.stringify(inputData), env, cwd: tmpDir, timeout: 300_000 })`
  - Parse stdout as JSON
  - Handle timeout → `ModuleExecutionError`
  - Clean up temp dir

### Task 5: Security index re-exports (RED → GREEN → REFACTOR)

**Tests:**
```typescript
describe("security/index.ts", () => {
  it("re-exports AuthProvider");
  it("re-exports AuditLogger");
  it("re-exports ConfigEncryptor");
  it("re-exports Sandbox");
});
```

**Implementation:**
- `export { AuthProvider } from './auth.js'`
- `export { AuditLogger } from './audit.js'`
- `export { ConfigEncryptor } from './config-encryptor.js'`
- `export { Sandbox } from './sandbox.js'`
