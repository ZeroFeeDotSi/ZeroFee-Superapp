// The attestation under a receipt's Why (FLOW-V5 §5 item 4). One line, one tap down from the receipt:
// - the check ran here (today: the counterparty check, zero/counterparty.ts): "Checked on this device.";
// - the check came from NEAR AI Cloud's sealed computer: "Checked in a sealed computer (NEAR AI). See the proof ›", shown
//   only after this device checked it again, now: the stored attestation report binds the enclave's signing key to a
//   sealed Intel TDX + NVIDIA computer running that model (nearai.ts checkReport), and the check's own signature recovers
//   to that same key (EIP-191, as NEAR AI signs). Anything less, tampered or unreadable, is never called sealed.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { checkReport } from "../nearai.ts";
import type { Receipt } from "./receipts.ts";

/** NEAR AI's own checker for a proof (nearai.ts: it checks Intel's and NVIDIA's seals this phone can't). */
// NEAR AI's own checker page: its host goes on the safety gate's list after review; until then the proof shows its
// signature here with no link (and today every check runs on the phone, so no receipt shows it yet).
export const VERIFY_URL: string | null = null;
export const ON_DEVICE = "Checked on this device.";
export const SEALED = "Checked in a sealed computer (NEAR AI).";

/** The Ethereum-style address that signed `text` (EIP-191 personal_sign, r‖s‖v hex), or null. */
export function signerOf(text: string, signatureHex: string): string | null {
  try {
    const sig = hexToBytes(signatureHex.replace(/^0x/, ""));
    if (sig.length !== 65) return null;
    const v = sig[64]! >= 27 ? sig[64]! - 27 : sig[64]!;
    if (v !== 0 && v !== 1) return null;
    const body = utf8ToBytes(text);
    const hash = keccak_256(concatBytes(utf8ToBytes(`\x19Ethereum Signed Message:\n${body.length}`), body));
    const point = secp256k1.recoverPublicKey(concatBytes(Uint8Array.of(v), sig.slice(0, 64)), hash, { prehash: false });
    const pub = secp256k1.Point.fromBytes(point).toBytes(false);
    return `0x${bytesToHex(keccak_256(pub.slice(1)).slice(-20))}`;
  } catch {
    return null;
  }
}

/** The line for a receipt's check, and the proof to show one tap down when (and only when) it holds. */
export function checkedLine(check: Receipt["check"]): { line: string; proof?: { url: string | null; signature: string; model: string } } | null {
  if (!check) return null;
  const s = check.signed, a = check.attestation;
  if (check.by !== "enclave" || !s?.text || !a) return { line: ON_DEVICE };
  try {
    const p = checkReport(a.report, a.nonce, s.model);
    if (!p.ok || !p.enclaveKey) return { line: ON_DEVICE };
    if (signerOf(s.text, s.signature) !== p.enclaveKey.toLowerCase()) return { line: ON_DEVICE };
    return { line: SEALED, proof: { url: VERIFY_URL, signature: s.signature, model: s.model } };
  } catch {
    return { line: ON_DEVICE };
  }
}
