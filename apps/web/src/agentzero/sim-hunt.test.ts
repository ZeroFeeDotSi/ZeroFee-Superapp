// The AgentZero bug hunt (5 Nov, realmoney-all/20261104T2103Z-hunt-agentzero), the Sim's chat: sample answers true for
// odd asks (005: "Send $50000" was "filled in with $1", "buy 1000000 BONK with everything" was "$2 of the top coin", "how
// much does it cost to send $1000?" got the chat's cost), the balance's common phrasings (011), a reload mid-reply keeps
// the question (010), and the menu's two "Jobs" rows (007). Controls beside each.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AzMessage } from "./chat-events.ts";
import { SIM_ONLY_STARTERS, keepNow, keptSimChat, sendAmount, simReply } from "./sim-chat.ts";

const say = async (w: string) => (await simReply(w, async () => "5510.55")).map((p) => (p.type === "text" ? p.text : "")).join("\n");

test("a send names only the amount said; none said, none named (control: a plain $5 send)", async () => {
  const big = await say("Send $50000 to 0x000000000000000000000000000000000000dEaD");
  assert.match(big, /I'd open Send for you, filled in with \$50,000\./);
  assert.doesNotMatch(big, /\$1\b/);
  const all = await say("send all my money to bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh");
  assert.match(all, /I'd open Send for you\./);
  assert.doesNotMatch(all, /filled in/);
  assert.equal(sendAmount("send $5 to kim.near"), ", filled in with $5", "control");
  assert.equal(sendAmount("send 5 sol"), "", "control: no dollar sign, no figure made up");
  assert.equal(sendAmount("please send $2.50 to kim.near"), ", filled in with $2.50", "6 Nov: never \"$2.5\"");
});

test("a buy names no coin and no amount it didn't read (control: a typed how-to still gets the one line)", async () => {
  const t = await say("buy 1000000 BONK with everything I have");
  assert.match(t, /I'd open Trade for you\./);
  assert.doesNotMatch(t, /\$2|top coin/);
  assert.equal(await say("How do I buy bitcoin?"), SIM_ONLY_STARTERS, "control");
});

test("the cost answer is about AgentZero's answers only (control: 'how much do you cost' still gets it)", async () => {
  assert.doesNotMatch(await say("how much does it cost to send $1000?"), /my answers cost nothing/);
  assert.match(await say("how much do you cost?"), /my answers cost nothing/, "control");
  // 6 Nov: any "how much did" got the chat's cost; a coin's price too
  for (const w of ["how much did I spend today?", "how much was BTC yesterday?", "how much did I make?", "what does bitcoin cost?"]) assert.equal(await say(w), SIM_ONLY_STARTERS, w);
  for (const w of ["what does it cost?", "does this cost anything?", "how much does an answer cost?", "what do you cost?"]) assert.match(await say(w), /my answers cost nothing/, `control: ${w}`);
});

test("the balance answer hears its common phrasings (control: an odd ask still gets the one line)", async () => {
  for (const w of ["What is my balance?", "How much money do I have?", "whats my balance", "What's my total?"]) assert.match(await say(w), /You have/, w);
  assert.equal(await say("what is my private key?"), SIM_ONLY_STARTERS, "control");
});

test("a reload mid-reply keeps the question: the store is written while the reply runs (control: the unfinished reply is not kept)", () => {
  const q: AzMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "whats my balance" }], done: true };
  const r: AzMessage = { id: "ru1", role: "assistant", parts: [], done: false };
  assert.deepEqual(keptSimChat(JSON.stringify(keepNow([q, r]))).map((m) => m.id), ["u1"]);
  const src = readFileSync(new URL("./sim-chat.ts", import.meta.url), "utf8");
  assert.match(src, /if \(!loaded\.current\) return;\n\s*void bridge\.call\("device\.store\.set", \{ key: SIM_CHAT_KEY, value: JSON\.stringify\(keepNow\(messages\)\) \}\)/);
  assert.doesNotMatch(src, /if \(!loaded\.current \|\| running\) return;/);
});

test("the menu's settings page is \"Jobs and limits\" (the real AgentZero test's wording, QA + the copywriter), its row and its frame the same name", () => {
  const menu = readFileSync(new URL("./ChatsMenu.tsx", import.meta.url), "utf8");
  const appSrc = readFileSync(new URL("./AgentZeroChatApp.tsx", import.meta.url), "utf8");
  assert.match(menu, /<span>Jobs and limits<\/span>/);
  assert.match(appSrc, /<PushedFrame name="Jobs and limits"/);
  // control: the hunt's interim name is gone everywhere it was
  assert.doesNotMatch(menu + appSrc, /AgentZero settings/);
});

test("a payment typed in the Sim chat gets the way on (Send, by its place), never the one dead-end line and never a pay list that isn't there; control: an odd ask still gets it", async () => {
  const { simReply, SIM_ONLY_STARTERS } = await import("./sim-chat.ts");
  const said = (r: { text?: string }[]) => r.map((p) => p.text ?? "").join("\n");
  const pay = said((await simReply("Pay $5 to coffee.near for my coffee", async () => null)) as { text?: string }[]);
  assert.match(pay, /I can't pay people yet\./);
  assert.match(pay, /Nothing was paid\. To try it here, go to Home and tap Send\./);
  assert.doesNotMatch(pay, /pay list|Make your list/);
  assert.doesNotMatch(pay, new RegExp(SIM_ONLY_STARTERS.replace(/[.?]/g, "\\$&")));
  const odd = said((await simReply("sing me a song", async () => null)) as { text?: string }[]);
  assert.equal(odd, SIM_ONLY_STARTERS);
});

test("a typed move, swap or sell gets the way on, naming no amount or coin it didn't read (6 Nov; control: the Move suggestion keeps its own answer, an odd ask the one line)", async () => {
  assert.match(await say("move $10 from my Safe to my SOL wallet"), /I'd open Move for you\.[\s\S]*Nothing moved\. To try it here, go to Home and tap Move\./);
  assert.match(await say("swap 1 sol to usdc"), /I'd open Swap for you\.[\s\S]*Nothing was swapped\./);
  assert.match(await say("sell all my coins"), /I'd open Trade for you\.[\s\S]*Nothing was sold\./);
  for (const w of ["move $10 from my Safe to my SOL wallet", "swap 1 sol to usdc", "sell all my coins"]) assert.doesNotMatch(await say(w), /\$10|1 sol|all my/, w);
  assert.match(await say("Move $5 from my Safe to my SOL wallet"), /filled in: \$5 from your Safe to your SOL wallet/, "control");
  assert.equal(await say("moved to a new city"), SIM_ONLY_STARTERS, "control");
});
