// QA's deep crawl of the Sim's AgentZero (5 Nov, sd-agentzero on bebcec7d9): a copy job's "$5.00 of BONK"
// receipt with nothing moved; a reload that wiped the chat and turned AgentZero off beside a running job; a double Send
// with two bubbles and a reply "thinking…" forever; typed questions with only the fixed line. Controls beside each.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { CHAT_LINE } from "@zerofee/agent/chat/chat-lines";
import { keptSimChat, SIM_ONLY_STARTERS, SIM_SAMPLE_TAG, simAnswer, simReply } from "./sim-chat.ts";

const memory = () => {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};
const ok = async <T,>(r: Promise<{ ok: T } | { problem: unknown }>): Promise<T> => {
  const x = await r;
  if (!("ok" in x)) throw new Error(JSON.stringify(x.problem));
  return x.ok;
};
const coins = async (m: ReturnType<typeof createMockBridge>) => ok(m.call<{ symbol: string; usd: number | null; amount: string }[]>("subwallet.coins", { id: "sw-site-pump-sol" }));

test("the copy job's buy on sample money really trades: AgentZero's wallet down by the dollars, the coin up in the pump.fun wallet, that wallet's own SOL as it was, the money changed; control: more than its wallet holds refuses, no receipt, nothing counted", async () => {
  const m = createMockBridge({ latencyMs: 0, float: { priceUsd: () => 100, held: { "sw-site-pump-sol": String(250_000_000) } } }); // 0.25 SOL = $25
  let changed = 0;
  m.on("ledger.balancesChanged", () => changed++);
  await ok(m.call("account.agent.set", { limitUsd: 25, people: [] }));
  const heldNow = async () => (await ok(m.call<{ heldUsd: number }>("account.agent.view"))).heldUsd;
  assert.equal(await heldNow(), 25);
  const r = await ok(m.call<{ status: string }>("account.agent.spend", { kind: "buy", usd: 5, coin: "BONK", title: "AgentZero bought $5.00 of BONK" }));
  assert.equal(r.status, "done");
  assert.equal(await heldNow(), 20, "$5 left its wallet");
  const after = await coins(m);
  assert.equal(after.find((c) => c.symbol === "SOL")!.usd, 25, "the pump.fun wallet's own SOL stays");
  assert.ok(after.some((c) => c.symbol === "BONK" && c.usd !== null && Math.abs(c.usd - 5) < 0.01 && c.amount !== "0"), JSON.stringify(after));
  assert.ok(changed > 0, "Home reads the money again");
  const view = await ok(m.call<{ spentTodayUsd: string }>("account.agent.view"));
  assert.equal(view.spentTodayUsd, "5.00");
  // control: $30 more than the $20 left in its wallet: refused in words, nothing counted, no receipt
  const receipts = (await ok(m.call<unknown[]>("account.activity", { limit: 50 }))).length;
  const big = await m.call("account.agent.spend", { kind: "buy", usd: 30, coin: "BONK", title: "AgentZero bought $30.00 of BONK" });
  assert.ok("problem" in big && /more than is left in AgentZero's wallet\. Nothing was sent\./.test((big.problem as { whatHappened: string }).whatHappened), JSON.stringify(big));
  assert.equal((await ok(m.call<unknown[]>("account.activity", { limit: 50 }))).length, receipts, "no receipt for a trade that didn't happen");
  assert.equal((await ok(m.call<{ spentTodayUsd: string }>("account.agent.view"))).spentTodayUsd, "5.00", "nothing counted");
  assert.equal(await heldNow(), 20, "nothing moved");
  // control: a coin the Sim has no sample of: refused, nothing moved
  const odd = await m.call("account.agent.spend", { kind: "buy", usd: 1, coin: "ZZZ" });
  assert.ok("problem" in odd && /Nothing moved\./.test((odd.problem as { whatHappened: string }).whatHappened));
  assert.equal(await heldNow(), 20);
  // the sell brings it back into the pump.fun wallet, and needs no day's dollars
  const sold = await ok(m.call<{ status: string }>("account.agent.spend", { kind: "sell", usd: 0, coin: "BONK", title: "AgentZero sold its BONK" }));
  assert.equal(sold.status, "done");
  assert.ok(Math.abs((await coins(m)).find((c) => c.symbol === "SOL")!.usd! - 30) < 0.02);
});

test("a reload keeps AgentZero on (its pocket money, what it spent, its receipts) and the site wallet's coins; control: a fresh storage starts off", async () => {
  const storage = memory();
  const a = createMockBridge({ latencyMs: 0, float: { priceUsd: () => 100, held: { "sw-site-pump-sol": String(250_000_000) } }, persist: { storage } });
  await ok(a.call("account.agent.set", { limitUsd: 50, people: [] }));
  await ok(a.call("account.agent.spend", { kind: "buy", usd: 5, coin: "BONK", title: "AgentZero bought $5.00 of BONK" }));
  a.flush();
  const b = createMockBridge({ latencyMs: 0, float: { priceUsd: () => 100 }, persist: { storage } });
  const v = await ok(b.call<{ limitUsd: number; spentTodayUsd: string }>("account.agent.view"));
  assert.deepEqual([v.limitUsd, v.spentTodayUsd], [50, "5.00"], "still on, at $50, $5 spent");
  assert.ok((await coins(b)).some((c) => c.symbol === "BONK" && c.amount !== "0"), "the coin bought is still there");
  const fresh = createMockBridge({ latencyMs: 0, persist: { storage: memory() } });
  assert.equal((await ok(fresh.call<{ limitUsd: number }>("account.agent.view"))).limitUsd, 0, "control: a new sample starts off");
});

test("the Sim's chat: kept across a reload (finished messages only), one tap one bubble, a hung answer says so in 10 s with Try again (controls)", async () => {
  const msgs = [
    { id: "m1", role: "user", parts: [{ type: "text", text: "What can you do?" }], done: true },
    { id: "rm1", role: "assistant", parts: [{ type: "text", text: "Sample answer" }], done: true },
    { id: "rm2", role: "assistant", parts: [], done: false },
  ];
  assert.deepEqual(keptSimChat(JSON.stringify(msgs)).map((m) => m.id), ["m1", "rm1"], "a reply cut by the reload is dropped");
  assert.deepEqual(keptSimChat("not json"), [], "control: junk keeps nothing");
  assert.deepEqual(keptSimChat(null), []);
  // a hung read: the watchdog's line with Try again, never "thinking…" forever
  const hung = await simAnswer("What's my balance?", () => new Promise(() => {}), 20);
  assert.deepEqual(hung, [{ type: "fault", line: CHAT_LINE.silent, retry: true }]);
  const quick = await simAnswer("What can you do?", async () => null, 20);
  assert.ok(quick[0]!.type === "text", "control: an answer in time is the answer");
  const src = readFileSync(new URL("./sim-chat.ts", import.meta.url), "utf8");
  assert.match(src, /if \(!w\.trim\(\) \|\| busy\.current\) return;/, "a send while one answers is refused");
  assert.match(src, /if \(!live\.current \|\| gen\.current !== g\) return;/, "a reply lands unless the chat was stopped or started anew");
  assert.doesNotMatch(src, /seq\.current !== n/, "the old drop is gone");
  assert.match(src, /"device\.store\.set", \{ key: SIM_CHAT_KEY/);
  const screen = readFileSync(new URL("./AgentZeroChat.tsx", import.meta.url), "utf8");
  assert.match(screen, /const start = \(w: string\) => \{\s*\/\/[^\n]*\n\s*if \(running \|\| sending\.current\) return;/, "a suggestion's tap is locked too");
});

test("the four typed questions get sample answers; the balance one is Home's total; control: anything else gets the one line", async () => {
  const text = async (w: string) => {
    const p = (await simReply(w, async () => "5510.55"))[0]!;
    return p.type === "text" ? p : null;
  };
  for (const [w, has] of [["Buy $2 of the top coin", /open Trade/], ["Send $1 to my friend", /open Send/], ["What did that cost?", /cost nothing/], ["Show my money", /You have \{\{f1\}\} in all\./]] as const) {
    const p = await text(w);
    assert.ok(p && p.text.startsWith(`*${SIM_SAMPLE_TAG}*`) && has.test(p.text), `${w}: ${p?.text}`);
  }
  assert.equal((await text("Show my money"))!.facts?.f1?.shown, "$5,510.55");
  assert.equal((await text("Tell me a joke"))!.text, SIM_ONLY_STARTERS);
  assert.equal((await text("Who sent me money last week?"))!.text, SIM_ONLY_STARTERS, "control: not a send");
});

test("QA: the Sim's trade (MockBridge simTrade, its buy and sell for AgentZero) is never reachable from the real core: no core file imports MockBridge, and the core's account.agent.spend is its own agentSpend (controls: MockBridge holds it; the Sim imports MockBridge)", async () => {
  const { readdirSync, statSync } = await import("node:fs");
  const files = (dir: URL): URL[] => readdirSync(dir).flatMap((n) => {
    const u = new URL(n, dir);
    return statSync(u).isDirectory() ? files(new URL(`${n}/`, dir)) : /\.(ts|tsx|mjs)$/.test(n) && !/\.test\./.test(n) ? [u] : [];
  });
  const core = files(new URL("../../../../packages/core/src/", import.meta.url));
  assert.ok(core.length > 50, "control: the core's files were read");
  const importsMock = /from\s+["'][^"']*MockBridge[^"']*["']|import\(\s*["'][^"']*MockBridge/;
  for (const f of core) assert.doesNotMatch(readFileSync(f, "utf8"), importsMock, f.pathname);
  for (const f of core) assert.doesNotMatch(readFileSync(f, "utf8"), /simTrade|"sim\.site\.trade"/, f.pathname);
  const door = readFileSync(new URL("../../../../packages/core/src/agent-door.ts", import.meta.url), "utf8");
  assert.match(door, /case "account\.agent\.spend":\s*return agentSpend\(c, p\);/, "the real core spends through its own code");
  const ios = readFileSync(new URL("../host/ios.ts", import.meta.url), "utf8");
  assert.doesNotMatch(ios, importsMock, "the phone's host never loads the Sim's bridge");
  const mock = readFileSync(new URL("../../../../packages/shell-api/src/MockBridge.ts", import.meta.url), "utf8");
  assert.match(mock, /const r = simTrade\("pump", p\.kind, trade, usd\)/, "control: the Sim's bridge holds it");
  assert.match(readFileSync(new URL("../gallery/Screens.tsx", import.meta.url), "utf8"), importsMock, "control: the pattern finds the Sim's import");
});

test("test, 5 Nov (preview 2w6ijfoh6): after a reload a site wallet that bought kept its coin but got its SOL back ($32.47 from $27.47); a count below the seeded SOL is restored too (control: no reload, the same figure)", async () => {
  const storage = memory();
  const a = createMockBridge({ latencyMs: 0, float: { priceUsd: () => 100, held: { "sw-site-pump-sol": String(250_000_000) } }, persist: { storage } });
  await ok(a.call("sim.site.trade", { site: "pump", side: "buy", usd: 5, coin: { token: "sim-bonk", symbol: "BONK", name: "Bonk", priceUsd: 0.00002 } }));
  const sol = async (m: ReturnType<typeof createMockBridge>) => (await coins(m)).find((c) => c.symbol === "SOL")!.usd;
  assert.equal(await sol(a), 20, "control: before the reload");
  a.flush();
  const b = createMockBridge({ latencyMs: 0, float: { priceUsd: () => 100, held: { "sw-site-pump-sol": String(250_000_000) } }, persist: { storage } });
  assert.equal(await sol(b), 20, "after it: still $20, never the $25 back");
});

test("a reload keeps \"Ask me first\" with AgentZero's other settings (fork's note, 5 Nov: kept in memory only); control: a new sample has none", async () => {
  const storage = memory();
  const a = createMockBridge({ latencyMs: 0, persist: { storage } });
  await ok(a.call("account.agent.set", { limitUsd: 20, people: [] }));
  assert.deepEqual(await ok(a.call("account.agent.askAbove", { set: true, usd: 5 })), { askAboveUsd: 5 });
  a.flush();
  const b = createMockBridge({ latencyMs: 0, persist: { storage } });
  assert.deepEqual(await ok(b.call("account.agent.askAbove", {})), { askAboveUsd: 5 });
  const fresh = createMockBridge({ latencyMs: 0, persist: { storage: memory() } });
  assert.deepEqual(await ok(fresh.call("account.agent.askAbove", {})), { askAboveUsd: null });
});
