// Does BitChat's OWN code read the private messages ZeroFee Chat sends? (D55 slice 2) Our core seals envelopes exactly
// as the app does (bitchat-dm.ts sealChatDm, from a place's key to another person's), and BitChat's decoder, compiled
// from its iOS source by tools/chat/bitchat-swift, opens each: decryptPrivateMessage, then BinaryProtocol.decode,
// NoisePayload and PrivateMessagePacket. Every field must come back as we sent it. Local only: nothing is posted.
//
//   node tools/chat/dm-interop.ts [harness binary]     default: builds and runs tools/chat/bitchat-swift/run.sh
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "@noble/hashes/sha2.js";
import { sealChatDm } from "../../packages/core/src/bitchat-dm.ts";
import { placeKey, publicKeyHex } from "../../packages/core/src/nostr.ts";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const seedOf = (who: string) => sha256(new TextEncoder().encode(`dm-interop ${who}`));
const PLACE = "u0qj";
const alice = seedOf("alice");
const bob = seedOf("bob");
const bobKey = placeKey(bob, PLACE);
const aliceKey = placeKey(alice, PLACE);

const texts = [
  "hi bob",
  "Request: 5 USDC on Base to 0x000000000000000000000000000000000000dEaD · ZeroFee Chat",
  "Grüße aus Zürich 👋🏽 — ça va?",
  "la ".repeat(85), // 255 bytes: BitChat would deflate this one; ours goes plain
  "x".repeat(255),
  "é".repeat(127), // 254 bytes of two-byte UTF-8
];
interface Case { name: string; recipientPrivateKeyHex: string; event: unknown; want: Record<string, unknown> }
const cases: Case[] = [];
texts.forEach((text, i) => {
  const { event, messageId } = sealChatDm(alice, { geohash: PLACE, to: publicKeyHex(bobKey), kind: "message", text });
  cases.push({ name: `message ${i}`, recipientPrivateKeyHex: hex(bobKey), event, want: { senderPubkey: publicKeyHex(aliceKey), payloadType: "privateMessage", messageID: messageId, text } });
});
for (const kind of ["delivered", "read"] as const) {
  const { event } = sealChatDm(bob, { geohash: PLACE, to: publicKeyHex(aliceKey), kind, messageId: "6B1F0D2E-4C1A-4E8B-9A57-3F2D7C9E1A01" });
  cases.push({ name: kind, recipientPrivateKeyHex: hex(aliceKey), event, want: { senderPubkey: publicKeyHex(bobKey), payloadType: kind === "read" ? "readReceipt" : "delivered", messageID: "6B1F0D2E-4C1A-4E8B-9A57-3F2D7C9E1A01" } });
}

const dir = mkdtempSync(join(tmpdir(), "zf-dm-interop-"));
const file = join(dir, "ours.json");
writeFileSync(file, JSON.stringify(cases.map((c) => ({ name: c.name, recipientPrivateKeyHex: c.recipientPrivateKeyHex, event: c.event }))));
const bin = process.argv[2];
const out = bin
  ? execFileSync(bin, ["open", file], { encoding: "utf8" })
  : execFileSync("bash", [fileURLToPath(new URL("./bitchat-swift/run.sh", import.meta.url)), "open", file], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const parsed = JSON.parse(out) as unknown;
const results = (Array.isArray(parsed) ? parsed : (parsed as { results: unknown[] }).results) as Record<string, unknown>[];
let bad = 0;
for (const [i, c] of cases.entries()) {
  const r = results[i]!;
  const wrong = Object.entries(c.want).filter(([k, v]) => r[k] !== v).map(([k]) => k);
  if (r.ok !== true || wrong.length) bad++;
  console.log(`${r.ok === true && !wrong.length ? "ok  " : "FAIL"} ${c.name.padEnd(10)} ${r.ok === true ? `BitChat read: ${String(r.payloadType)} ${JSON.stringify(String(r.text ?? r.messageID)).slice(0, 48)} (packet ${(r.packet as { wireBytes?: number })?.wireBytes} bytes, compressed ${(r.packet as { compressed?: boolean })?.compressed})` : JSON.stringify(r)}${wrong.length ? ` wrong: ${wrong.join(", ")}` : ""}`);
}
console.log(`${cases.length - bad}/${cases.length} of ZeroFee's envelopes read by BitChat's own code as sent`);
process.exit(bad ? 1 : 0);
