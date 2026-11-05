// Every Activity item shows proof (product decision, 3 Nov): the transaction that set it off and the one that landed it, each step
// its own, a private step one honest line and never a link; links only to explorers people know, opened in ZeroFee's
// Browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SpendingActivity } from "@zerofee/core/spending";
import { PROOF_HOSTS, moveProof, proofUrlOk, shortTx, txProof, txUrl } from "@zerofee/core/tx-proof";
import { moveAnswer } from "../../../trade/src/float-core.ts";
import type { Movement } from "../types.ts";
import { PROOF_WORDS, addPage, movementPage, spendingPage, txFromUrl, type ProofPage } from "./proof.ts";

const here = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const SOL_TX = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
const NEAR_TX = "6Xr4cP2Wb3a5mFqGhKxZ9tR1uYvN8sD7eL2kJ4hG3fAq";
const EVM_TX = "0x" + "ab12".repeat(16);
const DEPOSIT = "818473a0072ed5084b4ec9f665b47d7c244546ca9a0ebc76d71fe1e6274ef8ba";
const links = (p: ProofPage): string[] => [...[p.started, p.finished], ...p.steps.flatMap((s) => [s.start, s.end])].flatMap((e) => (e && "tx" in e && e.tx.url ? [e.tx.url] : [])).concat(p.swaps);

test("explorers: SOL, NEAR (nearblocks), ETH, Base, Arbitrum and BNB link to their own; Robinhood Chain has none confirmed: its id and Copy only (controls: a made-up host, http, a bad id)", () => {
  assert.equal(txUrl("sol", SOL_TX), `https://solscan.io/tx/${SOL_TX}`);
  assert.equal(txUrl("near", NEAR_TX), `https://nearblocks.io/txns/${NEAR_TX}`);
  assert.equal(txUrl("eth", EVM_TX), `https://etherscan.io/tx/${EVM_TX}`);
  assert.equal(txUrl("base", EVM_TX), `https://basescan.org/tx/${EVM_TX}`);
  assert.equal(txUrl("arb", EVM_TX), `https://arbiscan.io/tx/${EVM_TX}`);
  assert.equal(txUrl("bsc", EVM_TX), `https://bscscan.com/tx/${EVM_TX}`);
  assert.equal(txUrl("hood", EVM_TX), undefined, "Robinhood Chain: no explorer confirmed");
  assert.deepEqual(txProof("hood", EVM_TX, "https://explorer.robinhood.example/tx/x"), { chain: "hood", hash: EVM_TX }, "its id only, never 1Click's link for it");
  assert.ok(proofUrlOk(`https://solscan.io/tx/${SOL_TX}`));
  for (const bad of [`http://solscan.io/tx/${SOL_TX}`, `https://solscan.io.evil.example/tx/${SOL_TX}`, `https://user@solscan.io/tx/${SOL_TX}`, "javascript:alert(1)", "https://evil.example/tx/1", 7]) assert.equal(proofUrlOk(bad), false, String(bad));
  assert.equal(txProof("sol", "not an id"), undefined, "control: no id, no proof");
  assert.equal(shortTx(SOL_TX), `${SOL_TX.slice(0, 6)}…${SOL_TX.slice(-4)}`);
});

test("1Click's status gives each leg its transactions: the chain end its own, the private balance none (controls: no hashes, never a link made up; 1Click's link to another host is dropped)", () => {
  const status = { status: "SUCCESS", swapDetails: { originChainTxHashes: [], destinationChainTxHashes: [{ hash: SOL_TX, explorerUrl: "https://evil.example/tx" }] } };
  assert.deepEqual(moveProof(status, { from: "private", to: "sol", deposit: DEPOSIT }), { end: { chain: "sol", hash: SOL_TX, url: `https://solscan.io/tx/${SOL_TX}` }, deposit: DEPOSIT, privateStart: true }, "NEAR wallet → SOL wallet");
  const back = { status: "SUCCESS", swapDetails: { originChainTxHashes: [{ hash: EVM_TX, explorerUrl: "https://basescan.org/tx/" + EVM_TX }] } };
  assert.deepEqual(moveProof(back, { from: "hood", to: "private", paid: EVM_TX }), { start: { chain: "hood", hash: EVM_TX }, privateEnd: true }, "ETH (RH) wallet → NEAR wallet: the core's own transfer, its id only");
  assert.deepEqual(moveProof({ status: "PROCESSING" }, { from: "private", to: "sol" }), { privateStart: true }, "control: no hash yet: nothing made up");
  const kept = moveProof(status, { from: "private", to: "sol" });
  assert.deepEqual(moveProof({ status: "SUCCESS" }, { from: "private", to: "sol", was: kept }).end, kept.end, "an id once seen stays");
  // the trade engine hands it on from the core's answer (float-core moveAnswer)
  assert.deepEqual(moveAnswer({ id: "m1", status: "done", proof: kept }).proof, kept);
  assert.equal(moveAnswer({ id: "m1", status: "done" }).proof, undefined, "control: none given, none made");
});

const row = (r: Partial<SpendingActivity>): SpendingActivity => ({ id: "x", kind: "move", usd: "10.00", status: "done", shown: true, atIso: "2026-11-03T10:00:00.000Z", words: "Moved $10.00", ...r });
const mv = (m: Partial<Movement>): Movement => ({ id: "m", kind: "transfer", status: "done", amount: "1", startedAtIso: "2026-11-03T10:00:00.000Z", updatedAtIso: "2026-11-03T10:01:00.000Z", explorerUrls: [], ...m });

test("a Move from the Safe to the SOL wallet: started by the Safe's transaction, finished by Solana's; each step its own; the NEAR wallet's private balance says it has no public record (control: still moving, nothing finished)", () => {
  const add = mv({ id: "add-1", kind: "trading", explorerUrls: [`https://nearblocks.io/txns/${NEAR_TX}`], depositAddress: DEPOSIT });
  const leg = row({ id: "leg-1", kind: "ready", network: "sol", of: "add-1", proof: { privateStart: true, end: { chain: "sol", hash: SOL_TX, url: `https://solscan.io/tx/${SOL_TX}` }, deposit: DEPOSIT.replace(/8/g, "9") } });
  const move = row({ id: "add-1", kind: "top-up", words: "Moved $10.00 to your SOL wallet", legs: [leg] });
  const p = spendingPage(move, [add]);
  assert.deepEqual(p.started, { tx: { chain: "near", hash: NEAR_TX, url: `https://nearblocks.io/txns/${NEAR_TX}` } }, "started: the Safe's own transaction");
  assert.deepEqual(p.finished, { tx: { chain: "sol", hash: SOL_TX, url: `https://solscan.io/tx/${SOL_TX}` } }, "finished: the one that landed it on Solana");
  assert.deepEqual(p.steps.map((s) => s.label), ["Safe → NEAR wallet", "NEAR wallet → SOL wallet"]);
  assert.deepEqual(p.steps[0]!.end, { private: true }, "into the private balance: no public record");
  assert.deepEqual(p.steps[1]!.start, { private: true }, "out of it: no public record");
  assert.equal(p.swaps.length, 2, "each 1Click swap's id");
  assert.equal(PROOF_WORDS.private, "This step is private. It has no public record.");
  const moving = spendingPage({ ...move, status: "on-its-way", legs: [{ ...leg, status: "on-its-way", proof: { privateStart: true } }] }, [add]);
  assert.equal(moving.finished, undefined, "control: not landed, nothing finished");
  assert.ok(moving.started, "control: what set it off shows at once");
});

test("a Send: from the private balance alone, one step that starts private and lands on the payee's chain; through the Safe, two steps; a plain NEAR transfer, its one transaction both (control: Robinhood Chain's landing has its id and no link)", () => {
  const pocket = movementPage(mv({ id: "pocket-send:abc", kind: "pay", private: true, toChain: "sol", proof: { privateStart: true, end: { chain: "sol", hash: SOL_TX, url: `https://solscan.io/tx/${SOL_TX}` }, deposit: DEPOSIT } }));
  assert.deepEqual(pocket.started, { private: true });
  assert.deepEqual(pocket.finished, { tx: { chain: "sol", hash: SOL_TX, url: `https://solscan.io/tx/${SOL_TX}` } });
  assert.equal(pocket.steps.length, 1);
  assert.deepEqual(pocket.swaps, [DEPOSIT], "the 1Click swap's id, Copy only (its explorer's host waits for the gate's review)");
  const safe = movementPage(mv({ id: "safe-send:abc", kind: "pay", private: true, toChain: "hood", explorerUrls: [`https://nearblocks.io/txns/${NEAR_TX}`], proof: { privateStart: true, end: { chain: "hood", hash: EVM_TX } } }));
  assert.deepEqual(safe.steps.map((s) => [s.label, s.start, s.end]), [
    ["Your wallet → NEAR wallet", { tx: { chain: "near", hash: NEAR_TX, url: `https://nearblocks.io/txns/${NEAR_TX}` } }, { private: true }],
    ["NEAR wallet → who you paid", { private: true }, { tx: { chain: "hood", hash: EVM_TX } }],
  ]);
  assert.deepEqual(safe.finished, { tx: { chain: "hood", hash: EVM_TX } }, "control: Robinhood Chain, its id and Copy only");
  const plain = movementPage(mv({ explorerUrls: [`https://nearblocks.io/txns/${NEAR_TX}`] }));
  assert.deepEqual([plain.started, plain.finished], [{ tx: { chain: "near", hash: NEAR_TX, url: `https://nearblocks.io/txns/${NEAR_TX}` } }, { tx: { chain: "near", hash: NEAR_TX, url: `https://nearblocks.io/txns/${NEAR_TX}` } }]);
  const sending = movementPage(mv({ status: "moving", explorerUrls: [`https://nearblocks.io/txns/${NEAR_TX}`] }));
  assert.equal(sending.finished, undefined, "control: still moving, nothing finished");
  assert.deepEqual(txFromUrl(`https://mempool.space/tx/${"a".repeat(64)}`), { chain: "", hash: "a".repeat(64) }, "an explorer the Browser won't open: its id, no link");
});

test("all rows: every kind of Spending row and ledger item gives a page with at least one step, and no link outside the known explorers", () => {
  const kinds: SpendingActivity["kind"][] = ["top-up", "put-away", "ready", "refill", "rebalance", "gas", "over-cap", "older", "move"];
  const statuses: SpendingActivity["status"][] = ["waiting-for-you", "waiting", "on-its-way", "done", "refused", "refunded", "failed"];
  for (const kind of kinds) for (const status of statuses) {
    const p = spendingPage(row({ kind, status, network: "sol", proof: { start: { chain: "sol", hash: SOL_TX, url: "https://evil.example/x" }, privateEnd: true } }));
    assert.ok(p.steps.length >= 1, `${kind} ${status}`);
    for (const u of links(p)) assert.ok(PROOF_HOSTS.has(new URL(u).host), `${kind} ${status}: ${u}`);
  }
  const mKinds: Movement["kind"][] = ["deposit", "convert", "withdraw", "transfer", "pay", "private", "trading", "account"];
  for (const kind of mKinds) for (const status of ["waiting", "moving", "done", "refunded", "problem"] as const) {
    const p = movementPage(mv({ kind, status, explorerUrls: [`https://nearblocks.io/txns/${NEAR_TX}`, "https://evil.example/tx/" + NEAR_TX] }));
    assert.ok(p.steps.length >= 1, `${kind} ${status}`);
    for (const u of links(p)) assert.ok(PROOF_HOSTS.has(new URL(u).host), `${kind} ${status}: ${u}`);
  }
});

test("the page: every row opens it (a hold its Waiting screen), it loads on the tap, links open in ZeroFee's Browser and the Browser opens only an explorer's page (controls: Safari's sheet is gone; another site is never opened)", () => {
  const act = here("./screens/Activity.tsx"), page = here("./screens/ActivityDetail.tsx"), browser = here("../../../browser/src/app/BrowserApp.tsx");
  assert.match(act, /void import\("\.\/ActivityDetail\.tsx"\)/, "the page's code loads on the first tap");
  assert.doesNotMatch(act, /import \{[^}]*\} from "\.\/ActivityDetail\.tsx"/, "never in Activity's first load");
  assert.doesNotMatch(act, /device\.openUrl/, "control: no Safari sheet from Activity any more");
  assert.equal((act.match(/<div className="wl-row" key=/g) ?? []).length, 0, "no row that a tap does nothing on");
  assert.match(act, /onClick=\{\(\) => \(s\.held \? onHeld\(s\.held\) : show\(spendingOf\(s\)\)\)\}/);
  assert.match(act, /m\.status === "waiting" && m\.held \? \(\) => onHeld\(m\.held!\) : \(\) => show\(ledgerPage\(m\)\)/);
  assert.match(page, /const view = \(url: string\) => openApp\("browser", undefined, url\);/, "View opens the Browser");
  assert.match(page, /<Sheet title=\{W\.bar\} onClose=\{onClose\} \{\.\.\.\(onBack \? \{ onBack \} : \{\}\)\}>/, "one full-screen page (D135), its bar \"Activity\" (R2)");
  assert.match(page, /<h2 className="wl-detail__title">\{title\}<\/h2>/, "R2: the row's whole title in the page, never cut in the bar");
  assert.match(page, /W\.private/, "a private step says so");
  assert.match(browser, /if \(link && proofUrlOk\(link\)\) void open\(link\);/, "the Browser opens a handed-over link only when it is an explorer's page");
  assert.equal(proofUrlOk("https://phish.example/connect"), false, "control: any other site handed over is never opened");
  const task = here("./money/live-steps.ts");
  assert.match(task, /open: \{ route: `activity:\$\{t\.id\}` \}/, "the Activity centre's task opens its page");
  assert.match(here("./WalletApp.tsx"), /t\?\.startsWith\("activity:"\)\) return \{ kind: "activity", open: t\.slice\("activity:"\.length\) \}/);
});

test("the engine keeps each leg's transactions: the core from 1Click's status at every read, the trade engine on its job and row, Spending on its row, Home's Send on its movement", () => {
  const core = here("../../../core/src/float-moves.ts"), jobs = here("../../../trade/src/float-jobs.ts"), rows = here("../../../trade/src/float-core.ts"), spend = here("../../../core/src/spending.ts"), send = here("../send-job.ts");
  assert.match(core, /const proof = moveProof\(raw, \{ from: chainOf\(from\), to: chainOf\(arrived\), deposit: k\.depositAddress/);
  assert.match(jobs, /return \{ \.\.\.settled\(a\), \.\.\.\(a\.proof \? \{ proof: a\.proof \} : \{\}\) \};/);
  assert.match(rows, /\.\.\.\(j\.proof \? \{ proof: j\.proof \} : \{\}\) \};/);
  assert.match(spend, /\.\.\.\(m\.proof \? \{ proof: m\.proof \} : \{\}\) \};/);
  assert.match(send, /const proof = moveProof\(s, \{ from: "private", to: m\.toChain \?\? "near", deposit: job\.outDeposit/);
});

test("an Add from another chain (product decision, 3 Nov): the deposit's own transaction, the private middle, the transaction that landed it, each step's time, its swap id (control: on its way, Finished isn't made up; a link to another host is dropped)", () => {
  const LABELS = ["Received", "Into NEAR Confidential", "In your SOL wallet"] as const;
  const T = Date.parse("2026-11-03T16:43:07Z");
  const sol = (hash: string, url = "https://solscan.io/tx/" + hash) => ({ chain: "sol", hash, url });
  const ADDR = "AZR29XkdQ47dwmgyiQgh8Q812vfpjKbeDGowNPR7PrVP";  // generated sample
  const landed = addPage({ stage: "landed", chain: "sol", to: "wallet", at: { received: T, private: T + 4_000, landed: T + 31_000 }, proof: { received: sol(SOL_TX), landed: sol(NEAR_TX), swap: ADDR } }, LABELS);
  assert.deepEqual(landed.started, { tx: sol(SOL_TX) });
  assert.deepEqual(landed.finished, { tx: sol(NEAR_TX) });
  assert.deepEqual(landed.steps.map((s) => [s.label, s.atIso]), [["Received", "2026-11-03T16:43:07.000Z"], ["Into NEAR Confidential", "2026-11-03T16:43:11.000Z"], ["In your SOL wallet", "2026-11-03T16:43:38.000Z"]]);
  assert.deepEqual(landed.steps[1]!.end, { private: true }, "the middle has no public record, and says so");
  assert.deepEqual(landed.swaps, [ADDR]);
  const going = addPage({ stage: "arriving", chain: "sol", to: "wallet", at: { received: T }, proof: { received: { chain: "sol", hash: SOL_TX, url: "https://evil.example/tx/" + SOL_TX } } }, LABELS);
  assert.equal(going.finished, undefined, "control: not landed, no Finished");
  assert.deepEqual(going.started, { tx: { chain: "sol", hash: SOL_TX } }, "control: another host's link is dropped, the id kept");
  assert.equal(going.steps[1]!.end, undefined, "control: not private yet");
  assert.ok(links(going).every((u) => proofUrlOk(u) || u === undefined));
});

test("Home reads its Adds without Hidden's pocket (the test account has none): the old gate kept every Add's line, card and task off (control: no relay, no reads)", () => {
  const home = here("./screens/Home.tsx");
  assert.match(home, /const addsReady = !!pocket\?\.available;/);
  assert.doesNotMatch(home, /addsReady = [^;]*pocket\.ready/);
  assert.match(home, /watchAddsOnWay\(bridge, setAdds, \{ push: true \}\)/);
  assert.match(home, /if \(!addsReady\) return void setAdds\(\[\]\);/, "control: a phone with no relay still reads none");
});

test("the swap step links to NEAR Intents' own explorer, by its deposit address, opened in ZeroFee's Browser (the product review of the host, 3 Nov); controls: a look-alike host or a bad id gets no link", async () => {
  const { INTENTS_EXPLORER, intentsUrl } = await import("@zerofee/core/tx-proof");
  assert.equal(INTENTS_EXPLORER, "https://explorer.near-intents.org/transactions/");
  assert.equal(intentsUrl(DEPOSIT), `https://explorer.near-intents.org/transactions/${DEPOSIT}`);
  assert.equal(intentsUrl("not a deposit"), undefined, "control: a bad id, no link");
  assert.ok(proofUrlOk(intentsUrl(DEPOSIT)), "the Browser opens it (core tx-proof.ts PROOF_HOSTS)");
  assert.equal(proofUrlOk(`https://explorer.near-intents.org.evil.example/transactions/${DEPOSIT}`), false, "control: a look-alike host");
  const page = here("./screens/ActivityDetail.tsx");
  assert.match(page, /const url = intentsUrl\(id\); return <TxLine key=\{id\} label=\{W\.swap\} tx=\{\{ chain: "intents", hash: id, \.\.\.\(url \? \{ url \} : \{\}\) \}\} copied=\{copied === id\} onCopy=\{\(\) => copy\(id\)\} onView=\{url \? \(\) => view\(url\) : undefined\} \/>/, "View on the swap step, through the in-app Browser");
});

// R2 (4 Nov): a Move that is Done but whose record kept no last transaction said "Finished · Not finished yet."
test("a page that ended says Done where its last link would be, never 'Not finished yet' (control: one on its way still does)", async () => {
  const { movementPage, spendingPage, PROOF_WORDS } = await import("./proof.ts");
  const base = { id: "withdraw:x", kind: "withdraw", from: "a", to: "b", amount: "1", startedAtIso: "2026-11-04T00:00:00.000Z", updatedAtIso: "2026-11-04T00:00:00.000Z", explorerUrls: [] } as const;
  const done = movementPage({ ...base, status: "done" } as never);
  assert.equal(done.finished, undefined);
  assert.equal(done.done, true);
  assert.equal(movementPage({ ...base, status: "moving" } as never).done, undefined, "control: on its way");
  const s = { id: "s", kind: "move", usd: "5.00", status: "done", shown: true, atIso: base.startedAtIso, words: "Move $5.00", network: "sol", to: "near" };
  assert.equal(spendingPage(s as never).done, true);
  assert.equal(spendingPage({ ...s, status: "on-its-way" } as never).done, undefined, "control");
  const detail = (await import("node:fs")).readFileSync(new URL("./screens/ActivityDetail.tsx", import.meta.url), "utf8");
  assert.match(detail, /\{page\.done \? W\.doneNoLink : W\.notYet\}/);
  assert.equal(PROOF_WORDS.doneNoLink, "Done.");
});

test("finding 57: a receipt that says Done ends every step: the last, \"NEAR wallet → who you paid\", says Done when its landing wasn't kept (control: on its way it says only Started; one that came back keeps its steps)", () => {
  const sent = { id: "safe-send:57", kind: "pay" as const, private: true, toChain: "sol", explorerUrls: [`https://nearblocks.io/txns/${NEAR_TX}`] };
  const done = movementPage(mv({ ...sent, status: "done" }));
  assert.equal(done.done, true);
  assert.equal(done.steps.at(-1)!.label, "NEAR wallet → who you paid");
  for (const s of done.steps) assert.ok(s.end || s.ended, `${s.label} is ended`);
  assert.equal(done.steps.at(-1)!.ended, true);
  const going = movementPage(mv({ ...sent, status: "moving" }));
  assert.equal(going.done, undefined);
  assert.equal(going.steps.at(-1)!.ended, undefined, "control: on its way, no step says Done");
  assert.equal(movementPage(mv({ ...sent, status: "refunded" })).steps.at(-1)!.ended, undefined, "control: came back, never Done to the payee");
  const legs = spendingPage(row({ kind: "move", network: "sol", to: "safe", status: "done", legs: [row({ id: "y", kind: "put-away" })] }));
  for (const s of legs.steps) assert.ok(s.end || s.ended, `${s.label} is ended`);
  assert.equal(spendingPage(row({ status: "on-its-way", legs: [row({ id: "y", status: "on-its-way" })] })).steps.some((s) => s.ended), false, "control: a Move on its way");
  const page = here("./screens/ActivityDetail.tsx");
  assert.match(page, /\{s\.end \? end\(W\.finished, s\.end, `f\$\{i\}`\) : s\.ended && <div className="wl-row wl-row-2" data-testid="proof-step-done"><div><div className="t">\{W\.finished\}<\/div><div className="d">\{W\.doneNoLink\}<\/div>/, "the step says Finished · Done.");
});
