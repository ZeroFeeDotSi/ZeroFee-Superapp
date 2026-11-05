// Who is ever asked for a Claude key (D152, product decision, 3 Nov: "no Claude key for normal people; people only use a funded
// wallet for compute"). Nobody, unless the developer setting is on (own-key.ts, VITE_AGENTZERO_OWN_KEY=1: keys.own).
// With no key of the person's own, AgentZero's wallet stands where the key chip and card were, from the first frame
// (the key's read is not waited for: with the setting off there is no key to read), whatever the relay said of the free
// reading (full, used up, off, or nothing yet). A key already saved keeps its chip.
import type { KeysSource } from "./AgentZeroChat.tsx";

export type KeyGate = {
  /** AgentZero's wallet stands (its chip, its first-run card, its line above the box). */
  wallet: boolean;
  /** The "Paste an AI key to start" card: the developer setting only. */
  card: boolean;
  /** Top right: the wallet's chip, the Keys chip ("Add key" or "Opus ✓"), or nothing. */
  chip: "wallet" | "keys" | "none";
};

export function keyGate(o: { keys?: Pick<KeysSource, "saved" | "needed" | "own"> | undefined; wallet: boolean; running: boolean }): KeyGate {
  const { keys } = o;
  const own = !!keys?.saved;
  const dev = !!keys?.own;
  // the developer setting on: the saved key is still being read, so neither path shows yet (no flash of either)
  const wallet = o.wallet && !own && (!dev || keys?.saved !== undefined);
  const card = !wallet && dev && !own && !!keys?.needed && !o.running;
  const chip = wallet ? "wallet" : keys && (dev || own) ? "keys" : "none";
  return { wallet, card, chip };
}
