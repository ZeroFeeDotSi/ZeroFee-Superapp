// W7 (audit): a Send AgentZero filled in says so, from the shell's own stamp of who opened the sheet (MoneyHost's
// filledNote) AND AgentZero's flag on the prefill (send-ask.ts agentFilled); never from the model's words, and never on
// an address the person typed or pasted. Review, 5 Nov: the line sits under To in the network line's slot ("Public
// on <network>."), in its place while the address is still AgentZero's; the network line comes back once To is edited;
// the approval sheet keeps "Public on <network>." unchanged. Real web app and Sim alike (both open Home's Send).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AGENT_FILLED, AGENT_FILLED_ADDRESS, filledAddressLine, filledNote, toSlotLine, type MoneyAsk } from "@zerofee/shell-api/money.ts";
import { sendMoneyAsk } from "@zerofee/agent/chat/send-ask";
import { routeLines } from "../../send-reach.ts";

/** A made-up Solana address (a generated fake, no one's). */
const SOL = "MASi45ub7Qe4ZE36UT5G6cU4ud8Fhhe4deS4F3cw9KTA";
const NETWORK = routeLines("sol")[0]!;

/** What the slot under To says, as SendForm and WebSendSheet work it out: the asker the shell stamped, the ask, and To as
 *  it stands now. */
const slot = (ask: MoneyAsk, asker: string | undefined, shown: string): string | null => {
  const s = ask as { to?: string; agentFilled?: true };
  return toSlotLine(filledAddressLine(filledNote(ask, asker), s.to, shown, s.agentFilled === true), NETWORK);
};

test("an AgentZero Send shows its line in the network line's slot; editing To brings the network line back", () => {
  assert.equal(AGENT_FILLED_ADDRESS, "AgentZero filled this in. Check the address.");
  assert.equal(NETWORK, "Public on Solana.");
  // AgentZero's own Send (send-ask.ts: the flag), opened by the agent app (the shell's stamp)
  const ask = sendMoneyAsk({ kind: "send", to: SOL, chain: "sol", usd: "5.00", coin: "SOL" }, true);
  assert.equal((ask as { agentFilled?: true }).agentFilled, true, "send-ask.ts flags its prefill");
  assert.equal(filledNote(ask, "agent"), AGENT_FILLED);
  assert.equal(slot(ask, "agent", SOL), AGENT_FILLED_ADDRESS, "in place of the network line");
  // the person edits To: the network line is back
  assert.equal(slot(ask, "agent", `${SOL.slice(0, -1)}B`), NETWORK);
  assert.equal(slot(ask, "agent", ""), NETWORK);
  // prefill off (today's fields only): no flag, no line
  assert.equal(slot(sendMoneyAsk({ kind: "send", to: SOL, chain: "sol", usd: "5.00" }, false), "agent", SOL), NETWORK);
});

test("controls: a person-typed or pasted Send never shows it; the flag alone, or the agent stamp alone, never does", () => {
  const flagged = sendMoneyAsk({ kind: "send", to: SOL, chain: "sol", usd: "5.00", coin: "SOL" }, true);
  // Home's own Send button (no asker), the same address typed or pasted
  assert.equal(slot({ kind: "send" }, undefined, SOL), NETWORK);
  // the flag without the shell's stamp (another app, or the person's own Send): the ask can't turn it on
  assert.equal(slot(flagged, undefined, SOL), NETWORK);
  assert.equal(slot(flagged, "wallet", SOL), NETWORK, "Wallet's own prefill (a coin page) isn't AgentZero's");
  assert.equal(filledNote({ ...flagged, ...({ asker: "agent" } as object) } as MoneyAsk, undefined), null);
  // the agent stamp without AgentZero's flag (an agent ask that didn't come from send-ask.ts): no line
  assert.equal(slot({ kind: "send", to: SOL, chain: "sol", usd: "5.00" } as MoneyAsk, "agent", SOL), NETWORK);
  // AgentZero filled the amount only (no payee): no line
  assert.equal(filledAddressLine(AGENT_FILLED, undefined, SOL, true), null);
});

test("both Sends draw it in the network line's slot (quiet, zf-small, never a box, below the amount), and the approval sheet keeps \"Public on …\"", () => {
  const phone = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  assert.match(phone, /filledAddressLine\(useContext\(SheetNote\), filled\?\.to, text, filled\?\.agentFilled === true\)/);
  // a16: the network line lives in the card under To (a span of send-where), so the slot is there too
  assert.match(phone, /i === 0 && agentLine \? <span key="agent" className="wl-send2__route" data-testid="send-agent-filled">\{toSlotLine\(agentLine, l\)\}<\/span>/);
  assert.ok(phone.indexOf('data-testid="send-agent-filled"') > phone.indexOf('aria-label="Who to send to"'), "under To, never above it");
  assert.ok(phone.indexOf('data-testid="send-agent-filled"') < phone.indexOf('data-testid="send-amount"'), "in the card, not under the keypad");
  assert.doesNotMatch(phone, /wl-send2__agent/, "no line above the address any more");
  const web = readFileSync(new URL("./WebSendSheet.tsx", import.meta.url), "utf8");
  assert.match(web, /filledAddressLine\(useContext\(SheetNote\), to, who, agentFilled === true\)/);
  // the web's line in that slot is its privacy line (the audit's P6), so AgentZero's line sits right above it and it stays
  assert.match(web, /\{agentLine && <p className="zf-small wl-websend__public" data-testid="web-send-agent-filled">\{agentLine\}<\/p>\}\n\s*<p className="zf-small wl-websend__public" data-testid="web-send-lands">\{WEB_SEND_WORDS\.lands\(from\.symbol, from\.network\)\}<\/p>/);
  assert.ok(web.indexOf("web-send-agent-filled") > web.indexOf('data-testid="web-send-amount"'), "never above the amount");
  // the flag travels from the ask to both Sends, and the note from MoneyHost's asker (the shell's), never the ask
  const host = readFileSync(new URL("./MoneyHost.tsx", import.meta.url), "utf8");
  assert.match(host, /const note = same \? filledNote\(taken, asker\) : null;/);
  assert.equal(host.match(/\.\.\.\(ask\.agentFilled \? \{ agentFilled: true \} : \{\}\)/g)?.length, 2);
  const sheet = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /\.\.\.\(agentFilled && to \? \{ agentFilled \} : \{\}\)/);
  // the approval sheet: its own network line, untouched by the form's slot
  const mock = readFileSync(new URL("../../../../shell-api/src/MockBridge.ts", import.meta.url), "utf8");
  assert.ok(mock.includes("`Public on ${lands.network}.`") && !/toSlotLine|AGENT_FILLED_ADDRESS/.test(mock));
});
