// The second device's pairing code, "ZFL1:" and its ML-DSA-65 public key in base32 (second-device.ts laptopCode). Pure
// and dependency-free, so the screen checks a pasted code before any sheet opens, as the core does (finding 54: a made-up
// "ZFL1:hello123" went straight to the approval sheet on the sample page). The code is the key itself: it carries no
// checksum or expiry, so a whole, well-formed key is the check; the core then decodes the key (keyFromLaptopCode).

export const PAIRING_PREFIX = "ZFL1:";
export const PAIRING_B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
/** An ML-DSA-65 public key: 1,952 bytes. */
export const PAIRING_KEY_BYTES = 1952;
/** 1,952 bytes in base32, 5 bits a letter, the last one padded: 3,124 letters. */
export const PAIRING_CODE_LETTERS = Math.ceil((PAIRING_KEY_BYTES * 8) / 5);

/** The code's key bytes, or null when it isn't a whole pairing code (prefix, alphabet, exact length, zero padding). */
export function pairingCodeBytes(text: string): Uint8Array | null {
  const t = text.trim();
  if (!t.toUpperCase().startsWith(PAIRING_PREFIX)) return null;
  const body = t.slice(PAIRING_PREFIX.length).toUpperCase().replace(/\s+/g, "");
  if (body.length !== PAIRING_CODE_LETTERS) return null;
  const out = new Uint8Array(PAIRING_KEY_BYTES);
  let bits = 0, acc = 0, n = 0;
  for (const ch of body) {
    const v = PAIRING_B32.indexOf(ch);
    if (v < 0) return null;
    acc = ((acc << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  // the last letter's spare bits are zero in a code laptopCode made; anything else was typed or damaged
  if (n !== PAIRING_KEY_BYTES || (acc & ((1 << bits) - 1)) !== 0) return null;
  return out;
}

export const isPairingCode = (text: string): boolean => pairingCodeBytes(text) !== null;
