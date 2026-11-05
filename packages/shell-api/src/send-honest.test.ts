// QA's F4 and the linkability hunt (5 Nov): the Sim's Send approval sheet never says "privately". It names
// NEAR Confidential and says what it hides and what can still be matched (the copywriter's words).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SEND_MATCHED, SEND_UNNAMED, createMockBridge } from "./MockBridge.ts";
import { bannedIn } from "../../../tools/copy/voice.ts";

const src = readFileSync(new URL("./MockBridge.ts", import.meta.url), "utf8");
const sendTitles = (s: string) => [...s.matchAll(/titled\(\(m\) => `(Send \$\{m\}[^`]*)`/g)].map((m) => m[1]!);

test("the Send sheets name NEAR Confidential, never 'privately', and say what can be matched", () => {
  const titles = sendTitles(src);
  assert.ok(titles.includes("Send ${m} through NEAR Confidential"), titles.join(" | "));
  // from a wallet: the core's outside sheet's own title (subwallets.ts OUTSIDE_WORDS, QA's ruling), never "privately"
  assert.match(src, /case "ledger\.hiddenFromRow"[\s\S]{0,2000}title: `Send from your \$\{row\}`/);
  for (const t of titles) assert.doesNotMatch(t, /privately/i, t);
  // control: the old title is caught
  assert.match(sendTitles("titled((m) => `Send ${m} privately`, x)")[0]!, /privately/);
  assert.match(src, /case "ledger\.sendFromSafe"[\s\S]{0,1100}Public on \$\{lands\.network\}\.`, SEND_UNNAMED,/, "one-step: the house line (copy review, 5 Nov: \"Public on <network>.\")");
  assert.match(src, /case "ledger\.hiddenFromRow"[\s\S]{0,2400}soon after the first\.`, SEND_MATCHED\]/, "from a wallet: only the matched half (its first step is public)");
  for (const l of [SEND_UNNAMED, SEND_MATCHED]) {
    assert.match(l, /The amount and time can still be matched\.$/);
    assert.deepEqual(bannedIn("packages/shell-api/src/MockBridge.ts", l), [], l);
  }
});

// QA's Sim walk (5 Nov): "Send $5.00 (1.128673627 NEAR) …" and "It goes as wNEAR to …" on the Safe's Send sheet
test("the Safe's Send sheet: its coin figure at most 4 decimals, its payee line the address and network, never the coin's machine form (control: a whole figure as it is)", async () => {
  const sheetOf = async (amount: string, to: object) => {
    const mock = createMockBridge({ latencyMs: 0, hiddenStart: { usdc: "25", near: "20" }, freshHistory: true });
    let sheet: { title: string; lines: string[] } | null = null;
    mock.on<{ id: string; words: { title: string; lines: string[] } }>("approval.needed", (p) => { sheet = p.words; void mock.call("approval.answer", { id: p.id, approve: false }); });
    await mock.call("account.create", { recoveryDelaySeconds: 172_800 });
    await mock.call("ledger.sendFromSafe", { app: "wallet", tokenId: "nep141:wrap.near", amount, to });
    assert.ok(sheet, "an approval sheet was shown");
    return sheet as unknown as { title: string; lines: string[] };
  };
  const near = await sheetOf("1.128673627", { kind: "ledger", accountId: "sam.near" });
  assert.match((await sheetOf("1.1000", { kind: "ledger", accountId: "sam.near" })).title, /\(1\.1 NEAR\)/, "53: never trailing zeros");
  assert.match(near.title, /^Send \$[\d,]+\.\d{2} \(1\.1286 NEAR\) through NEAR Confidential$/, near.title);
  assert.doesNotMatch(near.title, /\d\.\d{5,}|privately/i, near.title);
  assert.equal(near.lines[0], "To sam.near on NEAR. Public on NEAR.");
  assert.equal((near as { details?: unknown }).details, undefined, "control: a short name needs no full address");
  for (const l of [near.title, ...near.lines]) assert.doesNotMatch(l, /goes as|wNEAR/, l);
  const sol = await sheetOf("2", { kind: "chain", chain: "sol", address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" });
  assert.match(sol.title, /\(2 NEAR\)/, "control: a whole figure as it is");
  assert.equal(sol.lines[0], "To 7xKXtg…osgAsU on Solana. Public on Solana.");
  // the copy review's line, with the core's short form (six letters each end past "0x": audit, core integrity 1), the whole address one tap away
  const evm = "0x5290aBcDeF0123456789aBcDeF012345679EE7";
  const eth = await sheetOf("2", { kind: "chain", chain: "eth", address: evm });
  assert.equal(eth.lines[0], "To 0x5290aB…679EE7 on Ethereum. Public on Ethereum.");
  assert.deepEqual((eth as { details?: unknown }).details, [{ label: "The address in full", lines: [evm] }]);
});
