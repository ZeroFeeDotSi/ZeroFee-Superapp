// Item 4 (FLOW-V5 §5): a receipt's check says "sealed" only when this device checked the stored proof and the signature
// again; anything less, tampered or unreadable, falls back to "Checked on this device." and never claims the enclave.
import { test } from "node:test";
import assert from "node:assert/strict";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, concatBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { MODEL } from "../nearai.ts";
import { ON_DEVICE, SEALED, VERIFY_URL, checkedLine, signerOf } from "./attest-line.ts";
import type { Receipt } from "./receipts.ts";

const sk = secp256k1.utils.randomSecretKey();
const ADDR = `0x${bytesToHex(keccak_256(secp256k1.getPublicKey(sk, false).slice(1)).slice(-20))}`;
const NONCE = "ab".repeat(32);
const TEXT = "req-hash:resp-hash";

function sign(text: string, key = sk): string {
  const body = utf8ToBytes(text);
  const h = keccak_256(concatBytes(utf8ToBytes(`\x19Ethereum Signed Message:\n${body.length}`), body));
  const rec = secp256k1.sign(h, key, { prehash: false, format: "recovered" });
  return `0x${bytesToHex(concatBytes(rec.slice(1), Uint8Array.of(rec[0]! + 27)))}`;
}
/** A report nearai.ts's checkReport accepts: the quote's report data = the signing address … our nonce. */
function report(addr = ADDR, nonce = NONCE) {
  const data = addr.slice(2) + "0".repeat(128 - 40 - 64) + nonce;
  const quote = "00".repeat(48 + 520) + data + "00".repeat(16);
  const att = { signing_address: addr, request_nonce: nonce, intel_quote: quote };
  return { gateway_attestation: att, model_attestations: [{ ...att, model_name: MODEL, nvidia_payload: JSON.stringify({ nonce }) }] };
}
const enclave = (over: Partial<NonNullable<Receipt["check"]>> = {}): Receipt["check"] => ({ verdict: "allow", line: "You've paid kim.near before.", by: "enclave", signed: { model: MODEL, signature: sign(TEXT), text: TEXT }, attestation: { report: report(), nonce: NONCE }, ...over });

test("the check ran here: Checked on this device.", () => {
  assert.deepEqual(checkedLine({ verdict: "allow", line: "x", by: "phone" }), { line: ON_DEVICE });
  assert.equal(checkedLine(undefined), null);
});

test("a proof that holds: the sealed line, and the proof one tap down (NEAR AI's checker, the signature)", () => {
  assert.equal(signerOf(TEXT, sign(TEXT)), ADDR, "the signature recovers to the enclave's key");
  const r = checkedLine(enclave());
  assert.equal(r?.line, SEALED);
  assert.deepEqual(r?.proof, { url: VERIFY_URL, signature: sign(TEXT), model: MODEL });
});

test("tampered or missing: never sealed, always 'Checked on this device.'", () => {
  const other = secp256k1.utils.randomSecretKey();
  const cases: [string, Receipt["check"]][] = [
    ["the signed text changed", enclave({ signed: { model: MODEL, signature: sign(TEXT), text: TEXT + "!" } })],
    ["signed by another key", enclave({ signed: { model: MODEL, signature: sign(TEXT, other), text: TEXT } })],
    ["a report for another nonce", enclave({ attestation: { report: report(ADDR, "cd".repeat(32)), nonce: NONCE } })],
    ["a report binding another key", enclave({ attestation: { report: report(`0x${"11".repeat(20)}`), nonce: NONCE } })],
    ["another model", enclave({ signed: { model: "other/model", signature: sign(TEXT), text: TEXT } })],
    ["no report", enclave({ attestation: undefined })],
    ["junk report", enclave({ attestation: { report: "junk", nonce: NONCE } })],
    ["junk signature", enclave({ signed: { model: MODEL, signature: "0x1234", text: TEXT } })],
    ["no signed text", enclave({ signed: { model: MODEL, signature: sign(TEXT) } })],
  ];
  for (const [name, c] of cases) {
    const r = checkedLine(c);
    assert.deepEqual(r, { line: ON_DEVICE }, name);
  }
});
