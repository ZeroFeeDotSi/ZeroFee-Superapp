// the copy review's words and the audit's MUSTs (7 Nov, B11): where the key is, said by platform from ONE table (key-place.ts), and the
// Sim's key, a sample key, never "secure-chip" on any build (Screens.tsx:86 and :226 and MockBridge's options.account
// said so on the public Sim). Each case failed on af059735d (key-place.ts did not exist; the Sim's key and its proof
// were the chip's; Details, the key row and the web sheet's footer had their own strings, with "the phone").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import type { AccountInfo } from "@zerofee/core/signer";
import type { KeyProof } from "@zerofee/core/demo-core";
import { KEY_PLACE_WORDS, SHEET_YES, SIM_KEY_KIND, keyPlaceWords, keyPlatform, sheetFoot } from "@zerofee/shell-api/key-place.ts";
import { solSheet } from "@zerofee/core/hot-sheets";
import type { PlainWords } from "@zerofee/core/signer";
import { isProblem, keyProofWords } from "./key-proof-words.ts";
import { quantumOf, quantumRowsShown } from "./quantum.ts";
import { deviceKeyWords } from "./device-key-words.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("one table keyed by platform: the web says this device, the iPhone keeps the phone", () => {
  const table: [boolean, string, string, string | null, string][] = [
    // phone, neverLeaves, isHere (the row's right side; its title names the device), neverLeavesWhy, sheetFoot
    [false, "This key never leaves this device.", "Key is here", null, "Approve is your yes. Your key never leaves this device."],
    [true, "This key never leaves the phone.", "Your key is here", "Its key never leaves this device, so there's nothing to export.", "Approve is your yes. Your key never leaves this phone."],
  ];
  for (const [phone, neverLeaves, isHere, neverLeavesWhy, sheetFoot] of table) {
    assert.deepEqual(keyPlaceWords(phone), { neverLeaves, isHere, neverLeavesWhy, sheetFoot }, String(phone));
    assert.equal(KEY_PLACE_WORDS[keyPlatform(phone)], keyPlaceWords(phone));
  }
  for (const line of Object.values(KEY_PLACE_WORDS.web)) if (line) assert.doesNotMatch(line, /phone|chip/i, line);
  // the copy review (7 Nov): the web says "never leaves this device" once on Details (the row), never again in its fold
  const web = KEY_PLACE_WORDS.web;
  assert.equal([web.neverLeaves, web.neverLeavesWhy].filter((l) => l && /never leaves/.test(l)).length, 1);
  // node has no iPhone host: the default is the web's
  assert.equal(keyPlaceWords(), KEY_PLACE_WORDS.web);
});

test("every screen that says where the key is reads the table, never its own string", () => {
  const details = read("../../../../../packages/wallet/src/app/screens/Details.tsx");
  assert.match(details, /const key = keyPlaceWords\(\);/);
  assert.match(details, /<More label=\{key\.neverLeaves\} className="wl-dt-more" lines=\{\[\.\.\.\(key\.neverLeavesWhy \? \[key\.neverLeavesWhy\] : \[\]\), "Your 24 backup words/);
  assert.doesNotMatch(details, /never leaves the phone/, "fails before: Details said \"the phone\" in a browser");
  const row = read("./KeyProof.tsx");
  assert.match(row, /\{ticked \? <>\{keyPlaceWords\(\)\.isHere\} <span/);
  assert.doesNotMatch(row, />Your key is here </, "fails before: the row's own string");
  // the web's own Check this sheet: drawn only off the phone, its footer by key (sheetFoot, the web's form)
  const sheet = read("../../shell/ApprovalSheetView.tsx");
  assert.match(sheet, /\{!phone && !simulated && !password && <p className="approval__demo">\{sheetFoot\(words\.protection !== undefined, false\)\}<\/p>\}/);
  assert.doesNotMatch(KEY_PLACE_WORDS.web.sheetFoot, /phone/i);
});

// the audit's MUST (7 Nov): a trading wallet's key can leave the device when the person asks (Details' Show this wallet's key;
// web-wallet.ts exportChecked), so its sheet never says "never leaves". The Safe's own sheet (its protection, set only
// by the Safe's signer, dev-signer.ts) keeps the line. Failed on 5d6e7925e (every web sheet said it).
test("the sheet's footer by key: a trading wallet's sheet says the yes alone; the Safe's keeps where its key is (control)", () => {
  const trading = solSheet({
    w: { label: "SOL wallet", kind: "trade", address: "F", chain: "sol" }, older: false, out: 1_005_000n, unread: false, priceUsd: 150,
    decoded: { feePayer: "F", signers: 1, programs: [], unknownPrograms: [], swaps: [], transfers: [{ to: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", lamports: "1000000" }], closes: [], closedTo: [], tokenMoves: [], stakeHandovers: [], unreadTokenSteps: 0, routeAccounts: [], unreadSteps: [], networkFeeLamports: "5000" } as never,
    sim: { ok: true, agreed: true, servers: 2, lamportsBefore: 10_000_000n, lamportsAfter: 8_995_000n, tokens: [] } as never,
  });
  const safe: PlainWords = { title: "Send 5.00 USDC", lines: ["To bob.near"], warnings: [], effect: [], protection: { level: "faceid", waitSeconds: 0, text: "Runs now." } };
  const table: [string, PlainWords, string][] = [
    ["a trading wallet's sheet (hot key, D143)", trading, SHEET_YES],
    ["the same sheet asking Face ID (subwallets faceIdIf drops tap)", (({ tap: _t, ...w }) => w)(trading), SHEET_YES],
    ["the Safe's sheet (control)", safe, "Approve is your yes. Your key never leaves this device."],
  ];
  for (const [what, w, foot] of table) {
    const said = sheetFoot(w.protection !== undefined, false);
    assert.equal(said, foot, what);
    if (w !== safe) assert.doesNotMatch(said, /never leaves/, what);
  }
  // the view draws exactly that: on 5d6e7925e it drew the place line on every web sheet
  assert.match(read("../../shell/ApprovalSheetView.tsx"), /<p className="approval__demo">\{sheetFoot\(words\.protection !== undefined, false\)\}<\/p>/);
  // the marker: only the Safe's signer sets a sheet's protection; no hot sheet does
  for (const f of ["hot-sheets.ts", "near-coin.ts", "subwallets.ts"]) assert.doesNotMatch(read(`../../../../../packages/core/src/${f}`), /protection[?]?:/, f);
  assert.match(read("../../../../../packages/core/src/dev-signer.ts"), /words\.protection = protectionOf\(/);
});

test("the Sim's key is a sample key on every build: nothing its data feeds says \"secure chip\" (control: the phone's real chip key keeps it)", async () => {
  assert.equal(SIM_KEY_KIND, "development");
  // the Sim's bridge, given an account as the public Sim gives it (options.account): its device key and its proof
  const bridge = createMockBridge({ latencyMs: 0, account: { accountId: "sample.near", network: "mainnet" } as unknown as AccountInfo });
  const state = await bridge.call<{ account?: AccountInfo }>("account.state");
  assert.ok("ok" in state);
  const keys = state.ok.account!.keys;
  const device = keys.find((k) => k.role === "device")!;
  assert.equal(device.kind, "development", "fails before: options.account made it \"secure-chip\"");
  const proof = await bridge.call<KeyProof>("account.keyProof");
  assert.ok("ok" in proof);
  const w = keyProofWords(proof.ok);
  assert.ok(!isProblem(w));
  const said = [
    deviceKeyWords(device.kind),
    w.line, w.where, w.match, ...w.how,
    ...quantumRowsShown(quantumOf(keys, "This device").rows, true).flatMap((r) => [r.label, r.line ?? "", r.value ?? ""]),
    ...quantumOf(keys, "This device").rows.map((r) => r.line ?? ""),
  ].join(" | ");
  // a chip claim ("secure chip", "this iPhone's chip", "the chip holds"); the sample card's own "reads no chip" denies one
  assert.doesNotMatch(said, /secure.chip|iPhone's chip|chip holds|in this phone/i, said);
  // the gallery's own data: no chip kind, no chip proof of its own (it answered one from two real nodes)
  const screens = read("../../gallery/Screens.tsx");
  assert.match(screens, /role: "device", kind: SIM_KEY_KIND, current: true/);
  assert.doesNotMatch(screens, /kind: "secure-chip"|"secure-chip"/, "fails before: Screens.tsx:86 and :226");
  assert.doesNotMatch(read("../../../../../packages/shell-api/src/MockBridge.ts"), /kind: "secure-chip" as const/, "fails before: MockBridge's options.account");

  // control: the phone's real chip key (host/vault.ts HostKey) still says so, on its own proof and rows
  const chip = keyProofWords({ kind: "secure-chip", fingerprint: "a", chipFingerprint: "a", chipHeld: true, nodes: [{ node: "rpc.mainnet.fastnear.com", found: true }], matches: true });
  assert.ok(!isProblem(chip));
  assert.match(chip.where, /chip/);
  assert.equal(quantumOf([{ ...device, kind: "secure-chip" }], "This phone").rows[0]!.line, "In its secure chip");
  assert.equal(deviceKeyWords("secure-chip"), "Phone key · in the secure chip");
});
