// C-4 Tips (master plan row 7): a Tip shows only under a message whose author can be paid, it goes only where the
// author's own signed words say, on any chain (D111), and it only ever opens Wallet's Send on Hidden (D85).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sha256 } from "@noble/hashes/sha2.js";
import { GEOHASH_MESSAGE, signChat } from "@zerofee/core/nostr";
import { requestText, shown, type PayRequest } from "./messages.ts";
import { chatCanSendOn } from "./chain-send.ts";
import { detect, evmChoices } from "./detect.ts";
import { markPaid, readPaid } from "./paid.ts";
import { tipKey, tipTarget } from "./tip.ts";

const SOL = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";
const EVM = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const BTC = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const key = (s: string) => sha256(new TextEncoder().encode(s));
const said = (who: string, content: string, mine = false) => shown(signChat(key(who), { geohash: "u0qj", kind: GEOHASH_MESSAGE, content, nickname: who }, { mine: { targetBits: 0 } }), mine ? new Set([pub(who)]) : new Set());
const pub = (who: string) => signChat(key(who), { geohash: "u0qj", kind: GEOHASH_MESSAGE, content: "x", nickname: who }, { mine: { targetBits: 0 } }).pubkey;
const ask = (r: PayRequest) => requestText(r);

test("proof row (out): a Tip pays the author's own address on SOL, ETH on Robinhood, BNB and NEAR; BTC gets no Tip", () => {
  const cells: [PayRequest, string][] = [
    [{ amount: "5", coin: "SOL", chain: "sol", address: SOL }, "sol"],
    [{ amount: "0.002", coin: "ETH", chain: "hood", address: EVM }, "hood"],
    [{ amount: "0.01", coin: "BNB", chain: "bsc", address: EVM }, "bsc"],
    [{ amount: "1", coin: "NEAR", chain: "near", address: "alice.near" }, "near"],
    [{ amount: "0.0001", coin: "BTC", chain: "btc", address: BTC }, "btc"],
  ];
  for (const [r, chain] of cells) {
    const request = said("ava", ask(r));
    assert.ok(request.request, `${chain}: the request reads (${request.text})`);
    const hello = said("ava", "great photo");
    const t = tipTarget(hello, null, [request, hello]);
    // BTC: Send can't pay out there yet, so no Tip; the request's own Pay chip says "ZeroFee can't send to Bitcoin
    // addresses yet." (the walk reads it): the cell is never silent
    assert.deepEqual(t, chatCanSendOn(chain) ? { address: r.address, chain } : null, chain);
    assert.equal(chatCanSendOn(chain), chain !== "btc", chain);
  }
});

test("D111: a payee given as a Solana address is taken; a NEAR name is one case, never the only one", () => {
  const sol = said("ava", ask({ amount: "1", coin: "USDC", chain: "sol", address: SOL }));
  const hi = said("ava", "hi");
  assert.equal(tipTarget(hi, null, [sol, hi])?.chain, "sol");
  // control: the same author with no request of theirs is not payable
  assert.equal(tipTarget(hi, null, [hi]), null);
});

test("a checked NEAR name is paid as itself, on NEAR, whatever request sits on screen", () => {
  const sol = said("ava", ask({ amount: "1", coin: "USDC", chain: "sol", address: SOL }));
  const hi = said("ava", "hi");
  assert.deepEqual(tipTarget(hi, "ava.near", [sol, hi]), { address: "ava.near", chain: "near" });
});

test("only the author's OWN words point a Tip: never another key's request, never my own message, never a request", () => {
  const theirs = said("mallory", ask({ amount: "1", coin: "SOL", chain: "sol", address: SOL }));
  const hi = said("ava", "hi");
  assert.equal(tipTarget(hi, null, [theirs, hi]), null, "mallory's request can't make ava payable");
  // a nickname that looks like a NEAR name is not a checked name: the author is not payable by it
  const lookAlike = said("ava.near", "hi");
  assert.match(lookAlike.who, /not checked/);
  assert.equal(tipTarget(lookAlike, null, [lookAlike]), null);
  const mine = said("me", "hello", true);
  const myAsk = said("me", ask({ amount: "1", coin: "SOL", chain: "sol", address: SOL }), true);
  assert.equal(mine.mine, true);
  assert.equal(tipTarget(mine, "me.near", [myAsk, mine]), null, "never a Tip on my own message");
  const req = said("ava", ask({ amount: "1", coin: "SOL", chain: "sol", address: SOL }));
  assert.equal(tipTarget(req, null, [req]), null, "a request has its own Pay chip");
  // the newest of the author's requests wins
  const older = said("ava", ask({ amount: "1", coin: "BNB", chain: "bsc", address: EVM }));
  assert.equal(tipTarget(hi, null, [older, req, hi])?.chain, "sol");
  assert.equal(tipTarget(hi, null, [req, older, hi])?.chain, "bsc");
});

test("a request whose address isn't on the chain it names makes no Tip", () => {
  const bad = said("ava", `Request: 1 SOL on Solana to ${EVM} · ZeroFee Chat`);
  assert.equal(bad.request, undefined);
  const hi = said("ava", "hi");
  assert.equal(tipTarget(hi, null, [bad, hi]), null);
  // control: the right address on that chain does
  const good = said("ava", `Request: 1 SOL on Solana to ${SOL} · ZeroFee Chat`);
  assert.ok(tipTarget(hi, null, [good, hi]));
});

test("a tip is marked under its own key (author + message), never as a paid request, and survives a reload", () => {
  const book = markPaid({}, tipKey("ab12", "m1"), { atIso: "2026-11-03T08:00:00.000Z", link: "https://solscan.io/tx/abc" });
  assert.ok(book["tip:ab12:m1"]);
  assert.equal(book["m1"], undefined, "the message's own request (if it were one) stays unpaid");
  assert.ok(readPaid(JSON.stringify(book))["tip:ab12:m1"]);
  // review L3: a private message's id is its sender's to pick; the same id from another key is another tip
  assert.equal(book[tipKey("cd34", "m1")], undefined);
});

test("review L4: many tips never push a paid request's mark out of the book", () => {
  let book = markPaid({}, "req-old", { atIso: "2026-11-01T00:00:00.000Z" });
  for (let i = 0; i < 400; i++) book = markPaid(book, tipKey("ab12", `m${i}`), { atIso: new Date(Date.UTC(2026, 10, 3, 0, i)).toISOString() });
  assert.ok(book["req-old"], "the old paid request is still marked");
  assert.equal(Object.keys(book).filter((k) => k.startsWith("tip:")).length, 100, "tips keep their own newest hundred");
  // control: 400 request marks do push the oldest request out (the book still has its ceiling)
  let reqs = markPaid({}, "req-old", { atIso: "2026-11-01T00:00:00.000Z" });
  for (let i = 0; i < 400; i++) reqs = markPaid(reqs, `r${i}`, { atIso: new Date(Date.UTC(2026, 10, 3, 0, i)).toISOString() });
  assert.equal(reqs["req-old"], undefined);
});

test("home/words (after review M1): a bare 0x address lists Robinhood Chain among its networks, offered and never picked unasked", () => {
  assert.deepEqual(detect(EVM, "Robinhood"), { ok: { kind: "one", chain: "hood", address: EVM } });
  assert.ok("problem" in detect(SOL, "Robinhood"), "a Solana address said to be on Robinhood");
  assert.ok("problem" in detect(EVM.replace("a", "A"), "Robinhood"), "a mistyped capital");
  const bare = detect(EVM);
  assert.ok("ok" in bare && bare.ok.kind === "evm" && bare.ok.chains.includes("hood"), JSON.stringify(bare));
  const candidates = "ok" in bare && bare.ok.kind === "evm" ? bare.ok.chains : [];
  // "send 0.01 ETH to 0x…" with no ETH in the Safe: Robinhood Chain is offered, not picked (review M1 stands)
  assert.deepEqual(evmChoices(candidates, [], "ETH"), { chains: ["hood"], picked: null });
  // ETH on Ethereum in the Safe: both offered, the person picks (never silently Ethereum when it could be Robinhood)
  assert.deepEqual(evmChoices(candidates, [{ chain: "eth", symbol: "ETH", amount: "0.5" }], "ETH"), { chains: ["eth", "hood"], picked: null });
  // a coin Robinhood's wallet doesn't hold (USDC): not offered there; one network that fits is picked as before (control)
  assert.deepEqual(evmChoices(candidates, [{ chain: "base", symbol: "USDC", amount: "5" }], "USDC"), { chains: ["base"], picked: "base" });
});

test("D85: a Tip only opens Wallet's Send through the same gate as a request; nothing pays by itself", () => {
  const app = readFileSync(new URL("./app/ChatApp.tsx", import.meta.url), "utf8");
  const tip = /const tip = async[\s\S]*?\n {2}\};/.exec(app)?.[0] ?? "";
  assert.match(tip, /gate\.current\.open\(key, mark\)/, "one payment at a time, never twice");
  assert.match(tip, /await pay\(\{ address: t\.address, chain: t\.chain, request: key \}\)/, "Send, filled in, no amount");
  assert.doesNotMatch(tip, /amount|subwallet|ledger\./, "the person types the dollars on Send");
  // the Tip button pays only on its click
  assert.match(app, /data-testid="chat-tip"[^>]*onClick=\{\(\) => void money\.tip\(target, key, mark\)\}/);
  assert.doesNotMatch(app, /useEffect\([^)]*money\.tip/);
  // control: the pattern would catch a tip that sends an amount
  assert.match("await pay({ address: t.address, amount: '5' })", /amount/);
});

test("C-1: a split line gets no Tip (its request's Pay chip is the way); a plain line from the same author does", () => {
  const split = said("kim", "Splitting a $50.00 bill 4 ways. Each pays $12.50.");
  const req = said("kim", ask({ amount: "12.50", coin: "USDC", chain: "sol", address: SOL }));
  const thanks = said("kim", "thanks all");
  assert.equal(tipTarget(split, null, [split, req, thanks]), null);
  assert.equal(tipTarget(split, "kim.near", [split]), null, "not even for a checked name");
  // control
  assert.ok(tipTarget(thanks, null, [split, req, thanks]));
});
