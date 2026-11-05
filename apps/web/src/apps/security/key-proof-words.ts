// The "Your key" proof card's words (L6, the product chip question; Z21: a verified fact, with how it is known). Pure, so
// it is tested without a browser. The card shows a tick only when account.keyProof says `matches`; anything else is a
// plain Problem (what happened, where the money is, one next step), never a tick.
import type { KeyProof } from "@zerofee/core/demo-core";
import type { Problem } from "@zerofee/core/problem";
import { securityProblems } from "@zerofee/core/security-problems";

/** A node's operator, as a person would name it: "rpc.mainnet.fastnear.com" → "FastNear". */
export function nodeName(host: string): string {
  if (/fastnear/i.test(host)) return "FastNear";
  if (/drpc/i.test(host)) return "dRPC";
  if (/near\.org$/i.test(host)) return "NEAR";
  if (/intea\.rs$/i.test(host)) return "Intear";
  return host;
}

/** "2026-11-01T10:38:00Z" → "1 Nov 2026" (the person's own calendar day). */
export const madeOn = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export interface KeyProofWords {
  /** The one line on screen (Job 1, criterion 7): "Your key is in this phone", with its tick once checked. */
  line: string;
  /** Where the key is: "Your key was made inside this iPhone's chip on 1 Nov 2026." */
  where: string;
  /** The tick line: "It matches the key on your account." */
  match: string;
  /** "How we know", one line each. */
  how: string[];
}

/**
 * The card's words for an answer that matches, or the Problem to show instead. On the phone the key is the chip's; in a
 * browser it is "encrypted in this browser" (never "chip" there); the web demo's key is a sample key and says so.
 */
export function keyProofWords(p: KeyProof): KeyProofWords | Problem {
  if (!p.matches) return p.kind === "secure-chip" && p.chipHeld === false ? securityProblems.chipUnread() : securityProblems.keyNotOnAccount();
  const match = "It matches the key on your account.";
  const reads = p.nodes.map((n) => `Your account's key, read from ${nodeName(n.node)}: ${p.fingerprint} ✓`);
  if (p.sample) {
    return {
      line: "The demo's key is a sample key",
      where: "This is the demo: its key is a sample key, not a real one.",
      // One short line in view (round 3, UI-SIMPLICITY-RULES 10); what the card does on a real phone, one tap down.
      match: "The demo's key is a sample key.",
      how: ["On your own phone, this card checks your real key.", "The demo reads no chip and no network. In the app, this card shows your key next to your account's key. That one is read from two separate network servers."],
    };
  }
  if (p.kind === "secure-chip") {
    return {
      line: "Your key is in this phone",
      where: p.madeAtIso ? `Your key was made inside this iPhone's chip on ${madeOn(p.madeAtIso)}.` : "Your key was made inside this iPhone's chip.",
      match,
      how: [
        `This iPhone's chip holds your key. Its key: ${p.chipFingerprint ?? p.fingerprint}`,
        ...reads,
        "They match. No one can copy the key out of the chip, not even ZeroFee. It approves only with your face.",
        "If someone adds a face to this iPhone, or resets Face ID, this key stops for good. Your 24 words bring your account back.",
      ],
    };
  }
  return {
    line: "Your key is in this browser",
    where: p.madeAtIso ? `Your key was made in this browser on ${madeOn(p.madeAtIso)}. It's kept here, encrypted.` : "Your key is kept in this browser, encrypted.",
    match,
    how: [
      `This browser holds your key, encrypted, on this device only. Its key: ${p.fingerprint}`,
      ...reads,
      "They match. Your key is never sent to ZeroFee.",
    ],
  };
}

export const isProblem = (w: KeyProofWords | Problem): w is Problem => "code" in w;
