import test from "node:test";
import assert from "node:assert/strict";
import {
  generatePassword,
  PASSWORD_ALPHABET,
  PASSWORD_LENGTH,
} from "../src/password.js";
const allowed = /^[A-Za-z0-9!@#$%^&*_-]{16}$/;
test("alphabet is letters, digits, and !@#$%^&*_-", () => {
  assert.equal(PASSWORD_LENGTH, 16);
  assert.equal(PASSWORD_ALPHABET.length, 72);
  assert.equal(new Set(PASSWORD_ALPHABET).size, 72);
  assert.match(PASSWORD_ALPHABET, /^[A-Za-z0-9!@#$%^&*_-]+$/);
});
test("passwords are 16 allowed characters and differ across draws", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const value = generatePassword();
    assert.ok(allowed.test(value), "password outside the allowed charset");
    seen.add(value);
  }
  assert.equal(seen.size, 500);
});
test("rejection sampling drops biased bytes instead of taking a modulo", () => {
  // 216 is the first rejected byte (3 × 72). Bytes 0..71 map one-to-one.
  let calls = 0;
  const fill = (bytes) => {
    calls++;
    bytes.fill(calls === 1 ? 216 : 0);
    if (calls === 2) for (let i = 0; i < 16; i++) bytes[i * 2] = 255;
    if (calls === 2) for (let i = 0; i < 16; i++) bytes[i * 2 + 1] = i;
  };
  assert.equal(generatePassword(fill), PASSWORD_ALPHABET.slice(0, 16));
  assert.equal(calls, 2);
  // 215 is the last accepted byte and maps to the last character.
  assert.equal(
    generatePassword((b) => b.fill(215)),
    PASSWORD_ALPHABET.at(-1).repeat(16),
  );
  assert.throws(() => generatePassword((b) => b.fill(255)), /unusable/);
});
test("every character is reachable with equal weight over all byte values", () => {
  const counts = new Map();
  for (let byte = 0; byte < 256; byte++) {
    try {
      const c = generatePassword((b) => b.fill(byte))[0];
      counts.set(c, (counts.get(c) ?? 0) + 1);
    } catch {}
  }
  assert.equal(counts.size, 72);
  assert.deepEqual(new Set(counts.values()), new Set([3]));
});
