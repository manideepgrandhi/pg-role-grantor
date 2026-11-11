// Login passwords are generated in the browser and kept only in memory.
export const PASSWORD_LENGTH = 16;
export const PASSWORD_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*_-";
// Largest multiple of the alphabet size that fits in one byte. Bytes at or
// above it are discarded, so every character is equally likely.
const LIMIT = 256 - (256 % PASSWORD_ALPHABET.length);
const browserBytes = (bytes) => globalThis.crypto.getRandomValues(bytes);
export function generatePassword(fill = browserBytes) {
  const bytes = new Uint8Array(32);
  let out = "";
  for (let round = 0; out.length < PASSWORD_LENGTH; round++) {
    if (round === 64) throw new Error("Random source returned unusable bytes.");
    fill(bytes);
    for (const byte of bytes)
      if (byte < LIMIT && out.length < PASSWORD_LENGTH)
        out += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
  }
  return out;
}
