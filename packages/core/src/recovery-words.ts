// Recovery words: the 24-word backup for an account's post-quantum recovery key.
//
// An ML-DSA-65 key is fully determined by a 32-byte seed (FIPS 204), and 32 bytes is exactly the entropy of a 24-word
// BIP-39 phrase. So the words ARE the recovery key's seed: writing them down backs the key up, and typing them back in
// rebuilds the identical key on any device or in any tool, with no ZeroFee server involved.
//
// These words are not the account's main key. The main key is created inside the phone's secure chip and can never be
// exported. In the Safe, the recovery key starts a move to a new device and nothing more: it waits, and the phone can stop it.
// But the words also make every hot wallet's key (hot-keys.ts: Trading, the chain wallets, Private, the Browser and
// card wallets), so whoever has the words opens all of those at once. Only the Safe waits.
import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

export const RECOVERY_SEED_BYTES = 32;
export const RECOVERY_WORD_COUNT = 24;

/** 32 seed bytes → 24 English BIP-39 words (the last word carries a checksum). */
export function seedToWords(seed: Uint8Array): string[] {
  if (seed.length !== RECOVERY_SEED_BYTES) throw new Error(`a recovery seed is ${RECOVERY_SEED_BYTES} bytes, got ${seed.length}`);
  return entropyToMnemonic(seed, wordlist).split(" ");
}

export type WordsProblem =
  | { kind: "count"; got: number }
  | { kind: "unknown-word"; position: number; word: string }
  | { kind: "checksum" };

/**
 * Check typed words before using them, so the screen can say exactly what is wrong ("word 7 isn't on the list")
 * instead of a generic failure. Null means the words are good.
 */
export function wordsProblem(words: readonly string[]): WordsProblem | null {
  const clean = normalise(words);
  if (clean.length !== RECOVERY_WORD_COUNT) return { kind: "count", got: clean.length };
  const known = new Set(wordlist);
  const bad = clean.findIndex((w) => !known.has(w));
  if (bad >= 0) return { kind: "unknown-word", position: bad + 1, word: clean[bad] };
  if (!validateMnemonic(clean.join(" "), wordlist)) return { kind: "checksum" };
  return null;
}

/** 24 words → the 32-byte seed. Throws on anything wordsProblem() would report. */
export function wordsToSeed(words: readonly string[]): Uint8Array {
  const problem = wordsProblem(words);
  if (problem) throw new Error(`recovery words rejected: ${problem.kind}`);
  return mnemonicToEntropy(normalise(words).join(" "), wordlist);
}

function normalise(words: readonly string[]): string[] {
  return words.flatMap((w) => w.trim().toLowerCase().split(/\s+/)).filter(Boolean);
}
