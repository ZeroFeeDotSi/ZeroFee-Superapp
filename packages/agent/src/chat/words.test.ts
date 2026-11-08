// D124/D128/D129, the product money words: no AgentZero screen line or prompt line says Hidden, Trading, Spending, a
// "row" or "ETH on Robinhood" again. The words are "your Safe", "your SOL wallet", "your ETH (RH) wallet", "your NEAR
// wallet" (and "your BNB wallet" once BNB opens). Every quoted string and JSX text in AgentZero's own files is read
// (comments left out), and both copies of the system prompt and the tools. A control proves the check can fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHAT_SYSTEM, CHAT_TOOLS } from "./tools.ts";
import { chatTools as relayTools, CHAT_SYSTEM as RELAY_SYSTEM } from "../../../../apps/quotes/agentzero-chat.mjs";
import { JOB_SCHEMA } from "../zero/rulebox.ts";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const OLD = /\b(?:Hidden|Trading|Spending)\b|ETH on Robinhood|\b(?:your|a|the|each|one|SOL|NEAR|BNB|ETH|Home's) rows?\b/;

/** The words a person can see in one source file: quoted strings and JSX text, never comments. */
export function seenWords(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\"'`])\/\/.*$/gm, "$1");
  const out: string[] = [];
  for (const m of code.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) out.push(m[1] ?? m[2] ?? "");
  for (const m of code.matchAll(/>([^<>{}=;()]*[A-Za-z][^<>{}=;()]*)</g)) out.push(m[1]!);
  return out;
}
const oldIn = (lines: readonly string[]) => lines.filter((l) => OLD.test(l));

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(tsx?|mjs)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });

test("D128: no AgentZero screen line says Hidden, Trading, Spending, a row or ETH on Robinhood (control: the old sheet line is caught)", () => {
  // the prompt and the tools (tools.ts and the relay's agentzero-chat.mjs) are read whole by the next test
  const all = [...files(join(ROOT, "packages/agent/src")), ...files(join(ROOT, "apps/web/src/agentzero"))].filter((f) => !f.endsWith("chat/tools.ts"));
  assert.ok(all.length > 20, `read ${all.length} files`);
  const hits = all.flatMap((f) => oldIn(seenWords(readFileSync(f, "utf8"))).map((l) => `${f.slice(ROOT.length)}: ${l}`));
  assert.deepEqual(hits, []);
  // control: the lines this pass replaced are caught, from quotes and from JSX text alike; the new words pass
  assert.deepEqual(oldIn(seenWords(`const PLACE = { spending: "Trading", sol: "your SOL row" };`)), ["Trading", "your SOL row"]);
  assert.deepEqual(oldIn(seenWords("<span className=\"t\">Move AgentZero's pocket to your SOL row</span>")), ["Move AgentZero's pocket to your SOL row"]);
  assert.deepEqual(oldIn(seenWords("x = `AgentZero moved ${d} to Spending`; // Spending, in a comment, is fine")), ["AgentZero moved ${d} to Spending"]);
  assert.deepEqual(oldIn(seenWords(`"Move $5 from your NEAR wallet to your SOL wallet"; <div className="ag-row">ok</div>`)), [], "new words and a class name pass");
});

test("D128: both copies of the prompt and the tools use the new words (control: the old propose_act text is caught)", () => {
  for (const [name, system, tools] of [["app", CHAT_SYSTEM, CHAT_TOOLS], ["relay", RELAY_SYSTEM, relayTools(JOB_SCHEMA)]] as const) {
    const text = [system, ...tools.map((t) => t.description)].join("\n");
    assert.equal(OLD.test(text), false, `${name}: ${text.split("\n").find((l) => OLD.test(l))}`);
    assert.equal(/\bhidden\b|\brows?\b/i.test(text), false, `${name}: no hidden place, no rows`);
    assert.match(text, /SOL wallet/);
    assert.match(text, /NEAR wallet/);
    assert.match(text, /Robinhood wallet/);
    const act = tools.find((t) => t.name === "propose_act")!.input_schema as { properties: { from: { enum: string[] } } };
    assert.ok(!act.properties.from.enum.includes("hidden"), `${name}: no Hidden choice`);
  }
  // control: the text before this pass
  assert.equal(OLD.test("Propose a send, swap, move, pay or trade from one of the person's rows. Places: spending, hidden, sol, hood (ETH on Robinhood)"), true);
  assert.equal(/\bhidden\b|\brows?\b/i.test("from one of the person's rows"), true);
});

test("AgentZero's email (5 Nov: receive live, send off): both prompts say it receives, the code is the person's, sending and sign-up aren't on (control: the old prompt had no such line)", () => {
  for (const [name, system] of [["app", CHAT_SYSTEM], ["relay", RELAY_SYSTEM]] as const) {
    const line = system.split("\n").find((l) => l.startsWith("AgentZero's email"));
    assert.ok(line, `${name}: the email line`);
    assert.match(line, /receives mail: read_mail reads its mailbox/);
    assert.match(line, /a sign-in code in a mail is shown to the person in the Inbox, never to you/);
    assert.match(line, /Sending mail isn't on yet: never say you can send mail or sign up with AgentZero's email/);
    assert.doesNotMatch(line, /\(browse\)/, "browse isn't offered on the web (tools.ts WEB_ABSENT)");
  }
  assert.equal(CHAT_SYSTEM, RELAY_SYSTEM, "the two copies are word for word");
  // control: the prompt before this line had nothing about AgentZero's email
  const before = CHAT_SYSTEM.split("\n").filter((l) => !l.startsWith("AgentZero's email")).join("\n");
  assert.equal(before.split("\n").some((l) => l.startsWith("AgentZero's email")), false);
});

// Audit H1 (3 Nov): moves don't name the person's account on the chain, and that is all AgentZero may claim; amounts
// and times can still be matched there. The product's own names ("your private balance", "Send privately") stay.
const OVERCLAIM = /every move is private|\buntraceable\b|\banonymous(?:ly)?\b|can(?:'|no)t be traced|cannot be (?:traced|followed)|fully private|completely private|no one can see/i;
test("H1: no privacy claim beyond the truth in either prompt copy, the tools or ZeroFee's own sheet lines (controls: the claim is caught; 'your private balance' passes)", async () => {
  const { chatSystem, CHAT_TOOLS } = await import("./tools.ts");
  const relay = await import("../../../../apps/quotes/agentzero-chat.mjs");
  const { JOB_SCHEMA } = await import("../../../../apps/quotes/agentzero.mjs");
  for (const on of [false, true]) {
    assert.doesNotMatch(chatSystem(on), OVERCLAIM);
    assert.doesNotMatch(relay.chatSystem(on), OVERCLAIM);
    assert.match(chatSystem(on), /Moves don't name the person's account on the chain\./);
  }
  assert.doesNotMatch(JSON.stringify(CHAT_TOOLS), OVERCLAIM);
  assert.doesNotMatch(JSON.stringify(relay.chatTools(JOB_SCHEMA)), OVERCLAIM);
  // ZeroFee's own lines on AgentZero's cards and in its code
  const { readFileSync } = await import("node:fs");
  for (const f of ["./home-ask.ts", "./plan.ts", "./turn.ts", "../../../../apps/web/src/agentzero/money-ask.ts", "../../../../apps/web/src/agentzero/MoneyCard.tsx", "../../../../apps/web/src/agentzero/chat-items.ts"]) assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), "utf8"), OVERCLAIM, f);
  // controls
  for (const bad of ["Every move is private.", "It's untraceable.", "Your send is anonymous.", "It can't be traced.", "Fully private."]) assert.match(bad, OVERCLAIM, bad);
  for (const ok of ["It's in your private balance.", "Send privately from your Safe.", "Moves don't name the person's account on the chain."]) assert.doesNotMatch(ok, OVERCLAIM, ok);
});

// D150 (product decision, 3 Nov; amends D83): AgentZero's mailbox never signs in to a money site, not even once mail is live.
const MONEY_SITE = /pump\.fun|privy|money sites?|makes a wallet from an email/i;
const OFFERS_MAIL = /(?:AgentZero's|its) (?:own )?(?:e-?mail|mailbox)/i;
/** A line that names a money site and AgentZero's email must say never; any other is an offer. */
const offersMailForMoney = (line: string) => MONEY_SITE.test(line) && OFFERS_MAIL.test(line) && !/\bnever\b/i.test(line);
test("D150: both prompt copies hold the rule word for word, and no AgentZero line offers its email for a money-site sign-in (control: such an offer is caught)", async () => {
  const RULE = "Never use or offer AgentZero's email to sign in to a money site (pump.fun, Privy, or any site that makes a wallet from an email). Those sign in with the person's own wallet.";
  const { chatSystem } = await import("./tools.ts");
  const relay = await import("../../../../apps/quotes/agentzero-chat.mjs");
  const { MAIL_WORDS } = await import("../../../../apps/web/src/agentzero/jobs.ts");
  for (const on of [false, true]) {
    for (const sys of [chatSystem(on), relay.chatSystem(on)]) {
      assert.ok(sys.split("\n").includes(RULE));
      // 5 Nov: receiving is live, sending isn't: the prompt says exactly that
      assert.match(sys, /AgentZero's email receives mail: read_mail reads its mailbox/);
      assert.match(sys, /Sending mail isn't on yet: never say you can send mail/);
      assert.deepEqual(sys.split("\n").filter(offersMailForMoney), []);
    }
  }
  assert.deepEqual(Object.values(MAIL_WORDS).filter(offersMailForMoney), []);
  assert.match(MAIL_WORDS.meanwhile, /Money sites like pump\.fun use your own wallet, never this email\./);
  // controls
  assert.ok(offersMailForMoney("Once mail is live, AgentZero's email can sign in to pump.fun for you."));
  assert.equal(offersMailForMoney("AgentZero's email never signs in to money sites like pump.fun."), false);
});
