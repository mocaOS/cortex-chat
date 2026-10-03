import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  encryptSecret,
  decryptSecret,
} from "@/lib/auth/crypto";
import {
  hashPassword,
  verifyPassword,
} from "@/lib/auth/password";

const REAL_KEY = process.env.APP_ENCRYPTION_KEY;
const KEY_A = Buffer.alloc(32, 7).toString("base64");
const KEY_B = Buffer.alloc(32, 9).toString("base64");

beforeEach(() => {
  process.env.APP_ENCRYPTION_KEY = KEY_A;
});

afterEach(() => {
  if (REAL_KEY === undefined) delete process.env.APP_ENCRYPTION_KEY;
  else process.env.APP_ENCRYPTION_KEY = REAL_KEY;
});

test("AES-256-GCM round-trips arbitrary secrets (empty, unicode, long)", () => {
  for (const secret of ["", "sk- 🔑-key", "x".repeat(5000)]) {
    assert.equal(decryptSecret(encryptSecret(secret)), secret);
  }
});

test("envelope layout: base64(12-byte IV | ciphertext | 16-byte tag); random IV → distinct ciphertexts", () => {
  const secret = "backend-key-value";
  const e1 = Buffer.from(encryptSecret(secret), "base64");
  const e2 = Buffer.from(encryptSecret(secret), "base64");
  assert.equal(e1.length, 12 + Buffer.byteLength(secret, "utf8") + 16);
  assert.equal(e2.length, e1.length);
  assert.deepEqual(
    e1.subarray(0, 12).equals(e2.subarray(0, 12)),
    false,
    "IVs must be random per encryption"
  );
  assert.equal(decryptSecret(e1.toString("base64")), secret);
});

test("tampered ciphertext/tag or wrong key fails authentication (throws, never silent garbage)", () => {
  const envelope = Buffer.from(encryptSecret("secret"), "base64");
  const tampered = Buffer.from(envelope);
  tampered[13] ^= 0xff;
  assert.throws(() => decryptSecret(tampered.toString("base64")));

  process.env.APP_ENCRYPTION_KEY = KEY_B;
  assert.throws(() => decryptSecret(envelope.toString("base64")));
});

test("payloads shorter than the 28-byte minimum envelope are rejected", () => {
  assert.throws(() => decryptSecret(Buffer.alloc(27).toString("base64")));
});

test("key validation: missing key and non-32-byte decoded keys throw without fallback", () => {
  delete process.env.APP_ENCRYPTION_KEY;
  assert.throws(() => encryptSecret("x"), /APP_ENCRYPTION_KEY is required/);
  assert.throws(() => decryptSecret(encryptSecretKeyA()), /APP_ENCRYPTION_KEY is required/);

  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(16).toString("base64");
  assert.throws(() => encryptSecret("x"), /must decode to 32 bytes/);
  assert.throws(
    () => decryptSecret(encryptSecretKeyA()),
    /must decode to 32 bytes/
  );
});

// Helper: encrypted under KEY_A before the env is mutated by the test above.
function encryptSecretKeyA(): string {
  const real = process.env.APP_ENCRYPTION_KEY;
  process.env.APP_ENCRYPTION_KEY = KEY_A;
  try {
    return encryptSecret("secret");
  } finally {
    if (real === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = real;
  }
}

test("argon2id hash verifies for the correct password only", async () => {
  const digest = await hashPassword("correct horse battery staple");
  assert.match(digest, /^\$argon2id\$/, "hashes must be argon2id PHC strings");
  assert.equal(await verifyPassword(digest, "correct horse battery staple"), true);
  assert.equal(await verifyPassword(digest, "wrong"), false);
});

test("verifyPassword fails closed: empty sentinel and malformed digests return false without throwing", async () => {
  assert.equal(await verifyPassword("", "anything"), false, 'the "" OIDC sentinel must never verify');
  assert.equal(await verifyPassword("not-a-phc-digest", "anything"), false);
  assert.equal(await verifyPassword("$argon2id$v=19$m=19456,t=2,p=1$broken", "anything"), false);
});
