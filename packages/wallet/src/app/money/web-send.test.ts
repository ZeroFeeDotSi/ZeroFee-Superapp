// The web wallet's Send (product decision, 4 Nov), private (the HARD RULE; QA's real path, 5 Nov): ONE
// confidential 1Click quote from the wallet straight to the payee, the core's own (subwallet.sendPrivate), never a plain
// public transfer and never through a pocket.
import { test } from "node:test";
import assert from "node:assert/strict";
import { WEB_SEND_FROM, WEB_SEND_WORDS as W, webSendAsk, webSendGo, webSendLine, webSendUsd } from "./web-send.ts";
import { createTaskStore } from "@zerofee/shell-api/tasks.ts";
import { earlierOf } from "@zerofee/shell-api/task-earlier.ts";

const SOL = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const ETH = "0x7D06e272b5305a4b9D40e872C7950D3437547e3D";

test("web Send's ask: the wallet's own coin to an address on its network; a typo keeps Hold off", () => {
  assert.deepEqual(webSendAsk("sol", ` ${SOL} `, "0.25"), { ok: { chain: "sol", to: SOL, amount: "0.25" } });
  assert.deepEqual(webSendAsk("hood", ETH, "0.001"), { ok: { chain: "hood", to: ETH, amount: "0.001" } });
  assert.deepEqual(webSendAsk("sol", ETH, "1"), { why: W.badTo("Solana") }, "an EVM address on Solana");
  assert.deepEqual(webSendAsk("hood", SOL, "1"), { why: W.badTo("Robinhood Chain") });
  for (const bad of ["", "0", "0.000", "-1", "1e3", "abc", "0.0000000001"]) assert.ok("why" in webSendAsk("sol", SOL, bad), bad);
});

test("web Send's answer: done says sent; declined says so (QA: never a silent no); a problem says the core's own words", () => {
  assert.deepEqual(webSendLine({ ok: { status: "done", txHash: "x", explorerUrl: "u" } }, "0.25", "SOL", "Solana"), { went: true, line: "0.25 SOL left your wallet.", txHash: "x" });
  assert.deepEqual(webSendLine({ ok: { status: "declined" } }, "1", "SOL", "Solana"), { went: false, line: "You said no. Nothing was sent." });
  assert.deepEqual(webSendLine({ problem: { whatHappened: "Your SOL wallet has too little SOL." } }, "1", "SOL", "Solana"), { went: false, line: "Your SOL wallet has too little SOL." });
  assert.deepEqual(webSendLine({ problem: {} }, "1", "SOL", "Solana"), { went: false, line: W.failed });
});

const SIG = "mYVcsFiu4vJ2QUTV8mGwT8iyWPGGm6aq9BnkdwEDBfgwNyJ7h4V3cQkuGkV8b6aSE6cN3U5pvWkn5U7z4yW5Hkz";

test("a sent SOL goes privately (subwallet.sendPrivate, landing as SOL), is a receipt (what left, what they get, its transaction) and an Activity row whose second step follows 1Click to its end; control: a no publishes nothing", async () => {
  const store = createTaskStore({ now: () => 1_000 });
  const tasks = store.forApp("wallet");
  const asked: unknown[] = [];
  let status = "PROCESSING";
  const call = async (m: string, p: Record<string, unknown>) => {
    asked.push([m, p]);
    if (m === "subwallet.sendPrivate.status") return { ok: { status } };
    return { ok: { sent: { status: "done", txHash: SIG, explorerUrl: "https://solscan.io/tx/" + SIG }, depositAddress: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", amountOut: "9000000", amountOutUsd: "1.41", amountInUsd: "1.50" } };
  };
  const r = await webSendGo({ call, ask: { chain: "sol", to: SOL, amount: "0.01" }, from: WEB_SEND_FROM[0], usd: "About $1.50", tasks, now: () => 1_000, everyMs: 1, forMs: 200 });
  assert.deepEqual(asked[0], ["subwallet.sendPrivate", { chain: "sol", to: SOL, amount: "0.01", toTokenId: "nep141:sol.omft.near" }], "the core's own private quote, never subwallet.send, no password from this sheet");
  assert.deepEqual(r, { sent: { line: "0.01 SOL left your wallet.", usd: "They get about $1.41.", tx: { chain: "sol", hash: SIG } } }, "the sheet stays as its receipt");
  const [t] = store.list();
  assert.equal(t!.title, "Sent 0.01 SOL");
  assert.equal(t!.state, "pending", "on its way until 1Click says");
  assert.deepEqual(t!.steps.map((x) => [x.label, x.state]), [["Left your SOL wallet", "done"], ["They got it.", "doing"]]);
  assert.equal(t!.usd, "$1.50");
  assert.deepEqual(t!.proof, [{ chain: "sol", hash: SIG }], "its proof: Copy and View under the card");
  status = "SUCCESS";
  for (let i = 0; i < 100 && store.list()[0]!.state === "pending"; i++) await new Promise((res) => setTimeout(res, 2));
  assert.equal(store.list()[0]!.state, "done");
  assert.equal(store.list()[0]!.steps[1]!.state, "done");
  assert.deepEqual(earlierOf(store.list(), true).map((x) => x.id), [`web-send:${SIG}`], "once ended, shown under Earlier even while Home's history is drawn");
  const no = createTaskStore({ now: () => 1_000 });
  const declined = await webSendGo({ call: async () => ({ ok: { sent: { status: "declined" }, depositAddress: "x", amountOut: "1", amountInUsd: "1" } }), ask: { chain: "sol", to: SOL, amount: "0.01" }, from: WEB_SEND_FROM[0], usd: null, tasks: no.forApp("wallet") });
  assert.deepEqual(declined, { line: W.declined });
  assert.equal(no.list().length, 0, "control: nothing sent, no card");
  const thrown = await webSendGo({ call: async () => { throw new Error("gone"); }, ask: { chain: "sol", to: SOL, amount: "0.01" }, from: WEB_SEND_FROM[0], usd: null });
  assert.deepEqual(thrown, { line: W.unknown("Solana") });
});

test("1Click's end, said on the row: done, sent back to the wallet, or not paid; still going is no end (control)", async () => {
  const { webSendEnd } = await import("./web-send.ts");
  assert.deepEqual(webSendEnd("SUCCESS", "SOL"), { state: "done" });
  assert.deepEqual(webSendEnd("REFUNDED", "SOL"), { state: "failed", detail: "NEAR Confidential sent it back to your SOL wallet." });
  assert.deepEqual(webSendEnd("FAILED", "ETH (RH)"), { state: "failed", detail: "NEAR Confidential didn't pay them. Check your ETH (RH) wallet." });
  for (const going of ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "UNKNOWN", ""]) assert.equal(webSendEnd(going, "SOL"), null, going);
});

test("QA: the amount's dollars at the wallet's own price; none with no price or nothing typed (control)", () => {
  const sol = { cashUsd: "7.50", nativeAmount: "0.05" };
  assert.equal(webSendUsd("0.01", sol), "About $1.50");
  assert.equal(webSendUsd("10", { cashUsd: "1500.00", nativeAmount: "10" }), "About $1,500.00");
  assert.equal(webSendUsd("", sol), null);
  assert.equal(webSendUsd("0.01", undefined), null, "no price read: no figure, never $0.00");
  assert.equal(webSendUsd("0.01", { cashUsd: "0.00", nativeAmount: "0" }), null);
});

test("a web test (4 Nov): letters never stay in the amount; a comma is a point; one point only (control: a number stays as typed)", async () => {
  const { amountTyped } = await import("./web-send.ts");
  assert.equal(amountTyped("abc"), "");
  assert.equal(amountTyped("a1b.c2"), "1.2");
  assert.equal(amountTyped("1,5"), "1.5");
  assert.equal(amountTyped("1.2.3"), "1.23");
  assert.equal(amountTyped("0.05"), "0.05", "control");
});

test("a web test (4 Nov): Hold off says why: an empty wallet (with Add), more than it holds; nothing while unread (control: a good send has no line)", async () => {
  const { webSendWhy, WEB_SEND_FROM: F } = await import("./web-send.ts");
  const sol = F[0];
  assert.deepEqual(webSendWhy({ from: sol, has: "0", who: "", amount: "", ask: webSendAsk("sol", "", "") }), { line: "Your SOL wallet is empty.", empty: true });
  assert.deepEqual(webSendWhy({ from: sol, has: "0.05", who: SOL, amount: "0.5", ask: webSendAsk("sol", SOL, "0.5") }), { line: "This wallet has 0.05 SOL." });
  assert.equal(webSendWhy({ from: sol, has: "0.05", who: SOL, amount: "0.01", ask: webSendAsk("sol", SOL, "0.01") }), null, "control: a send it can make");
  assert.equal(webSendWhy({ from: sol, has: undefined, who: SOL, amount: "0.5", ask: webSendAsk("sol", SOL, "0.5") }), null, "unread: never called empty");
  const sheet = (await import("node:fs")).readFileSync(new URL("./WebSendSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /const ready = "ok" in ask && !why;/);
  assert.match(sheet, /disabled=\{!ready \|\| busy\}/);
  assert.match(sheet, /shell\.openMoney\(\{ kind: "receive", wallet: from\.chain \}\)/, "the empty wallet's Add opens its own address");
  assert.match(sheet, /onChange=\{\(e\) => \{ const v = amountTyped\(e\.currentTarget\.value\);/);
});

test("webd-money2 crawl (4 Nov): Max is the whole wallet less its fee, exact; nothing when that leaves nothing (control: an unread wallet has no Max)", async () => {
  const { webSendMax } = await import("./web-send.ts");
  assert.equal(webSendMax("sol", "0.007481062"), "0.007476062", "the crawl's own emptying send, to the lamport");
  assert.equal(webSendMax("sol", "1"), "0.999995");
  assert.equal(webSendMax("hood", "0.0105862"), "0.0105762");
  assert.equal(webSendMax("sol", "0.000005"), null, "only the fee: no Max");
  assert.equal(webSendMax("sol", undefined), null, "control: unread");
  const sheet = (await import("node:fs")).readFileSync(new URL("./WebSendSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /\{max && <button type="button" className="wl-websend__max" onClick=\{\(\) => edit\(\(\) => setAmount\(max\)\)\}/);
  // each From chip (a wallet's coin or a token it holds: W4) shows what it holds, cut, never rounded up
  assert.match(sheet, /\$\{amountOf\(has, f\.symbol\)\} \$\{f\.symbol\}/, "the From row is cut, never rounded up");
  assert.doesNotMatch(sheet, /Number\((n\.nativeAmount|has)\)\.toLocaleString/, "control: the old rounding");
  // a token's Max is all of it: the wallet's own coin pays its fee (W4)
  const { webSendCoins } = await import("./web-send.ts");
  const usdc = webSendCoins([{ chain: "sol", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amount: "25.5" }])[0]!;
  assert.equal(webSendMax("sol", "25.5", usdc), "25.5");
  const { amountOf } = await import("../format.ts");
  assert.equal(amountOf("0.007481062", "SOL"), "0.007481", "0.007481, never 0.0075");
});

test("decision A on the private Send: the core's own sheet asks the password (the web's approval sheet, its 700 ms arm), so this sheet has no password field and sends none: never a second ask (control: webSendOwn still reads own addresses)", async () => {
  const { webSendOwn } = await import("./web-send.ts");
  assert.equal(webSendOwn([SOL, ETH], ETH.toLowerCase()), true, "control: own, lower-cased");
  assert.equal(webSendOwn(null, SOL), false);
  const sheet = (await import("node:fs")).readFileSync(new URL("./WebSendSheet.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(sheet, /type="password"|setPassword|HoldButton/, "no field, no hold: one tap, then the core's sheet");
  assert.match(sheet, /webSendGo\(\{ call: \(m, p\) => bridge\.call\(m, p\), ask: ask\.ok, from, usd, \.\.\.\(shell\.tasks \? \{ tasks: shell\.tasks \} : \{\}\) \}\);/);
  assert.match(sheet, /data-testid="web-send-go">\{WEB_SEND_WORDS\.send\}<\/button>/);
  assert.match(sheet, /\{WEB_SEND_WORDS\.lands\(from\.symbol, from\.network\)\}/, "the line says it goes hidden and what they get");
  assert.equal(W.lands("SOL", "Solana"), "They get SOL on Solana. They won't see your wallet. Someone watching Solana could still match the amount and time to you.");
  assert.doesNotMatch(W.lands("SOL", "Solana"), /^Hidden/, "the audit's P6: never claims the payment is hidden: a watcher can match amount and time");
});
