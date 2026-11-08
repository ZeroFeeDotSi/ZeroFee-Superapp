// W7 whole path, on the web wallet (no Safe): the chat (chatTurn, a recorded model stream per tool, the relay faked, no
// network) → the tool call → the real handler (skills.ts, mailbox.ts) → the real web core (DemoCore with webWallet, its
// web door, its sheets with the password) → the sheet → the signature, or the refusal by name. AgentZero never signs.
// Mail: the real receiver (apps/mail) on 127.0.0.1. The one stand-in: Home's own spending.status read (apps/web's
// spending service, not the core), answered here in its real shape.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMail, type Running } from "../../../../apps/mail/src/start.ts";
import { DemoCore } from "../../../core/src/demo-core.ts";
import { MAIL_SERVICE } from "../../../core/src/mail-service.ts";
import { FakeChain } from "../../../core/src/testing/fake-chain.ts";
import { MemoryVault } from "../../../core/src/vault.ts";
import { PASSWORD, WORDS, TO_EVM, until } from "../../../core/src/testing/web-core.ts";
import type { EvmChain } from "../../../core/src/evm.ts";
import type { PlainWords } from "../../../core/src/signer.ts";
import type { Bridge } from "../../../core/src/bridge.ts";
import { chatTurn, NOT_OFFERED, WEB_BROWSE_LINE, type ChatEvent, type ChatHands } from "./turn.ts";
import { skillHands } from "./skills.ts";
import { webTools, CHAT_TOOLS } from "./tools.ts";
import { mailHands } from "./use-chat-turn.ts";

const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const start = () => ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } } });
const end = (stop: string) => ev("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 20 } }) + ev("message_stop", {});
const textSse = (t: string) => start() + ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) + ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: t } }) + ev("content_block_stop", { index: 0 }) + end("end_turn");
const toolSse = (id: string, name: string, input: object) => start() + ev("content_block_start", { index: 0, content_block: { type: "tool_use", id, name, input: {} } }) + ev("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } }) + ev("content_block_stop", { index: 0 }) + end("tool_use");

/** The relay, recorded: each chat call answers the next body (an SSE string, or {status, body}); `sent` keeps the requests. */
function relay(answers: (string | { status: number; body: object })[]) {
  const sent: any[] = [];
  const f = (async (u: string, init: any = {}) => {
    if (!String(u).endsWith("/v0/agentzero/chat")) throw new Error(`only the chat route here: ${u}`);
    sent.push(JSON.parse(init.body));
    const a = answers.shift() ?? textSse("");
    return typeof a === "string" ? new Response(a, { headers: { "content-type": "text/event-stream" } }) : new Response(JSON.stringify(a.body), { status: a.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, sent };
}

let dir: string;
let mail: Running;
let realFetch: typeof fetch;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), "zf-w7-path-"));
  const loose = { perIpConnections: 100, perIpMailbox: 1000, perMailbox: 1000, perIp: 1000, unknownPerIp: 1000 };
  mail = await startMail({ dataDir: dir, domain: MAIL_SERVICE.domain, smtpPort: 0, httpPort: 0, http: { perMailbox: 1000, perIp: 1000, apiHost: MAIL_SERVICE.host }, smtpLimits: loose, dkim: "off" });
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (!u.startsWith(`https://${MAIL_SERVICE.host}/`)) throw new Error(`no other host in this test: ${u}`);
    return realFetch(u.replace(`https://${MAIL_SERVICE.host}`, `http://127.0.0.1:${mail.httpPort}`), init);
  }) as typeof fetch;
});
after(async () => {
  globalThis.fetch = realFetch;
  await mail.close();
  rmSync(dir, { recursive: true, force: true });
});

async function smtpSend(to: string, subject: string, text: string): Promise<string> {
  const sock = net.connect(mail.smtpPort, "127.0.0.1");
  sock.setEncoding("utf8");
  let buf = "";
  const waiting: ((s: string) => void)[] = [];
  sock.on("data", (d: string) => {
    buf += d;
    for (;;) {
      const m = /^(?:\d{3}-[^\n]*\n)*\d{3} [^\n]*\n/.exec(buf);
      if (!m) break;
      buf = buf.slice(m[0].length);
      waiting.shift()?.(m[0]);
    }
  });
  const next = () => new Promise<string>((r) => waiting.push(r));
  const cmd = (line: string) => (sock.write(`${line}\r\n`), next());
  try {
    await next();
    await cmd("EHLO sender.test");
    await cmd("MAIL FROM:<codes@sender.test>");
    const r = await cmd(`RCPT TO:<${to}>`);
    if (!r.startsWith("250")) return r;
    await cmd("DATA");
    const p = next();
    const body = `From: Sender <codes@sender.test>\nTo: ${to}\nSubject: ${subject}\nDate: Thu, 05 Nov 2026 12:00:00 +0000\nMessage-ID: <${subject.replace(/\W/g, "")}@sender.test>\nContent-Type: text/plain; charset=utf-8\n\n${text}\n`;
    sock.write(`${body.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..")}\r\n.\r\n`);
    return await p;
  } finally {
    sock.destroy();
  }
}

/** The web wallet's core (no Safe), ETH (RH) at $3,000 with 10 ETH and a node that takes what is sent, every sheet kept. */
async function webCore() {
  const sent: string[] = [];
  const evm = {
    simulate: async () => ({ ok: true, agreed: true, balance: 10n ** 19n }), nonce: async () => 0, tokenBalance: async () => 0n, token: async () => undefined, ponsCurve: async () => null,
    fees: async () => ({ tip: 1_000_000n, maxFee: 5_000_000n }), estimateGas: async () => 21_000n, send: async (_c: string, signed: string) => (sent.push(signed), true), receipt: async () => ["ok", "ok"],
    read: async (_c: string, method: string) => (method === "eth_getBalance" ? `0x${(10n ** 19n).toString(16)}` : "0x0"),
  } as unknown as EvmChain;
  const rulesWasm = new Uint8Array(readFileSync(new URL("../../../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));
  const core = new DemoCore({ chain: new FakeChain(), vault: new MemoryVault(), policyWasm: async () => rulesWasm, secretsInMemory: true, evm, mail: MAIL_SERVICE, nativeUsd: async (c) => (c === "hood" ? 3000 : c === "sol" ? 150 : null), webWallet: { passwordOk: async (p) => p === PASSWORD } });
  const sheets: { id: string; words: PlainWords; password?: boolean }[] = [];
  core.on<{ id: string; words: PlainWords; password?: boolean }>("approval.needed", (e) => sheets.push(e));
  const r = await core.call("account.web.import", { words: WORDS });
  assert.ok("ok" in r, JSON.stringify(r));
  const asked: { method: string; code?: string }[] = [];
  /** AgentZero's own bridge (forApps' stamp "agent"): core families to the web core; Home's spending read in its shape. */
  const agent: Bridge = {
    call: (async (method: string, p: Record<string, unknown> = {}) => {
      if (method === "spending.status") return { ok: { loaded: true, networks: [{ network: "sol", cashUsd: "15.00", nativeAmount: "0.1" }, { network: "hood", cashUsd: "30.00", nativeAmount: "0.01" }], reserveUsd: "20.00" } };
      if (!/^(account|subwallet|approval)\./.test(method)) return { problem: { code: "mock.unknown", whatHappened: "not here", money: { state: "not-involved" }, next: { kind: "nothing", label: "Go back" } } };
      const out = await core.call(method, { ...p, app: "agent" });
      asked.push({ method, ...("problem" in out ? { code: (out as { problem: { code: string } }).problem.code } : {}) });
      return out;
    }) as Bridge["call"],
  } as Bridge;
  return { core, agent, sheets, sent, asked };
}

const FIXED = Date.UTC(2026, 10, 5, 12, 0, 0);
async function webHands(agent: Bridge): Promise<ChatHands> {
  const mailRead = await mailHands(agent);
  return { receipts: async () => "No receipts yet.", meter: async () => "AgentZero's wallet: $0.00.", skills: skillHands({ bridge: agent, relay: null, web: true, now: () => FIXED, clock: () => "12:00 PM" }), ...(mailRead ? { mail: mailRead } : {}), offered: webTools(!!mailRead) };
}
async function turn(words: string, hands: ChatHands, answers: (string | { status: number; body: object })[]) {
  const r = relay(answers);
  const out: ChatEvent[] = [];
  for await (const e of chatTurn([], words, { relayBase: "https://relay.test", token: "az1.t", fetch: r.f, hands })) out.push(e);
  return { out, sent: r.sent };
}
const toolResult = (body: any): string => JSON.stringify(body.messages.at(-1).content);

test("read_mail on the web, whole path: registered at first open → a code mail over SMTP → the tool → the core opens it → Claude sees •••• and the Inbox the code (fail-before: no box, so read_mail wasn't offered)", async () => {
  const { agent } = await webCore();
  const before = await webHands(agent);
  assert.equal(before.offered!.includes("read_mail"), false, "fail-before: no mailbox, so read_mail is absent");
  const reg = await agent.call<{ address: string }>("account.agent.mailSetUp", {});
  assert.ok("ok" in reg, JSON.stringify(reg));
  const address = reg.ok.address;
  assert.match(await smtpSend(address, "Your code is 604217", "Use 604217 to sign in."), /^250/);
  const hands = await webHands(agent);
  assert.ok(hands.offered!.includes("read_mail"));
  const { out, sent } = await turn("check AgentZero's mail for a code", hands, [toolSse("m1", "read_mail", {}), textSse("A code came in. It's in the Inbox.")]);
  assert.deepEqual(sent[0].tools, hands.offered, "the relay is told the web's tools");
  const res = toolResult(sent[1]);
  assert.match(res, /Your code is ••••/, "Claude reads the mail with the code blanked");
  assert.doesNotMatch(res, /604217/, "the code never reaches the model");
  const listed = await agent.call<{ mails: { subject: string }[] }>("account.agent.mailList", {});
  assert.ok("ok" in listed && listed.ok.mails.some((m) => m.subject.includes("604217")), "the device holds the code for the Inbox");
  assert.ok(out.some((e) => e.kind === "step" && (e as { state: string }).state === "done"));
});

test("quote_dry on the web: the tool reaches the core's own dry price past the web door (fail-before: the door refused it by name); no quote server here, so it says no price, Nothing moved", async () => {
  const { agent, asked } = await webCore();
  const hands = await webHands(agent);
  const { sent } = await turn("what would $10 of USDC get in NEAR?", hands, [toolSse("q1", "quote_dry", { usd: 10, pay: "USDC", get: "NEAR" }), textSse("ok")]);
  const q = asked.find((a) => a.method === "subwallet.float.swapQuote");
  assert.ok(q, "the real handler asked the core");
  assert.notEqual(q!.code, "security.web.no-safe", "past the web door (before W7 it stopped here)");
  assert.equal(q!.code, "security.subwallet.refused", "the core's own answer: no quote server in this test");
  assert.match(toolResult(sent[1]), /gave no price for that swap right now\. Nothing moved\./);
});

test("read_holdings on the web: the web's own wallets from Home's read, never \"Your Safe\" (control: the phone still names the Safe)", async () => {
  const { agent } = await webCore();
  const { sent } = await turn("what do I have?", await webHands(agent), [toolSse("h1", "read_holdings", {}), textSse("ok")]);
  const res = toolResult(sent[1]);
  assert.doesNotMatch(res, /Your Safe/, "no Safe on the web");
  for (const w of ["Your SOL wallet", "Your Robinhood wallet", "Your NEAR wallet"]) assert.match(res, new RegExp(w));
  const phone = await skillHands({ bridge: agent, relay: null, now: () => FIXED, clock: () => "12:00 PM" }).holdings();
  assert.match(phone, /^Your Safe/, "control: the phone's answer starts with the Safe");
});

test("send on the web: the tool opens Home's Send filled in; AgentZero itself can't send or sign; the public transfer is shut even for Wallet with the right password (the private Send: wallet web-send-entry.test.ts)", async () => {
  const { core, agent, sheets, sent } = await webCore();
  const words = `can you get my brother $5 of ETH, his address is ${TO_EVM}`;
  const { out } = await turn(words, await webHands(agent), [toolSse("s1", "send", { to: TO_EVM, usd: 5, coin: "ETH" })]);
  const sheet = out.find((e) => e.kind === "needs-you") as { sheet: { kind: string; ask: { kind: string; to?: string; usd?: number } } } | undefined;
  assert.equal(sheet?.sheet.kind, "home", "Home's own sheet, never a payment");
  assert.deepEqual([sheet!.sheet.ask.kind, sheet!.sheet.ask.to, Number(sheet!.sheet.ask.usd)], ["send", TO_EVM, 5]);
  for (const m of ["subwallet.send", "subwallet.sendPrivate", "subwallet.signTx", "subwallet.sign"]) {
    const r = await agent.call(m, { chain: "hood", to: TO_EVM, amount: "0.001" });
    assert.ok("problem" in r, `${m}: AgentZero can't`);
  }
  const r = await core.call<{ status: string }>("subwallet.send", { app: "wallet", chain: "hood", to: TO_EVM, amount: (5 / 3000).toFixed(6), password: PASSWORD });
  assert.ok("problem" in r, JSON.stringify(r));
  assert.deepEqual([sent.length, sheets.length], [0, 0], "nothing signed, nothing asked");
});

test("trade on the web: the tool opens Trade's own Buy filled in; AgentZero can't sign a trade", async () => {
  const { agent } = await webCore();
  const mint = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
  const { out } = await turn(`buy $5 of ${mint} on solana`, await webHands(agent), [toolSse("t1", "trade", { side: "buy", coin: mint, chain: "sol", usd: 5 })]);
  const sheet = out.find((e) => e.kind === "needs-you") as { sheet: { kind: string; ask: { kind: string } } } | undefined;
  assert.equal(sheet?.sheet.kind, "home");
  assert.equal(sheet!.sheet.ask.kind, "trade", "Trade's own page, where the person approves");
  for (const m of ["subwallet.signTx", "subwallet.sign", "subwallet.session.start"]) assert.ok("problem" in (await agent.call(m, { tx: "x" })), `${m}: AgentZero can't`);
});

test("the higher-limit ask on the web: one sheet, the password; a no keeps the limit (fail-before: the web door refused AgentZero's wallet)", async () => {
  const { core, agent, sheets } = await webCore();
  const month = await agent.call<{ capUsd: number }>("account.agent.wallet", { do: "pay", op: "month" });
  assert.ok("ok" in month, `the web door lets AgentZero's own wallet through: ${JSON.stringify(month)}`);
  const higher = month.ok.capUsd + 5;
  const no = agent.call("account.agent.wallet", { do: "pay", op: "cap", usd: higher });
  await until(() => sheets.length === 1);
  assert.equal(sheets[0]!.password, true, "the web's sheet takes the password");
  assert.match(sheets[0]!.words.title, /Raise AgentZero's monthly limit/);
  await core.call("approval.answer", { id: sheets[0]!.id, approve: false });
  assert.deepEqual((await no as { ok: unknown }).ok, { declined: true });
  const yes = agent.call<{ capUsd: number }>("account.agent.wallet", { do: "pay", op: "cap", usd: higher });
  await until(() => sheets.length === 2);
  assert.ok("problem" in (await core.call("approval.answer", { id: sheets[1]!.id, approve: true, password: "wrong" })), "a wrong password is no yes");
  await core.call("approval.answer", { id: sheets[1]!.id, approve: true, password: PASSWORD });
  assert.deepEqual((await yes as { ok: unknown }).ok, { capUsd: higher });
  assert.equal(sheets.length, 2, "one sheet per ask, never a second check");
});

test("browse on the web: an ask to open a site is one line from our own code, no model call, no tool (control: the phone still offers browse)", async () => {
  const { agent } = await webCore();
  const { out, sent } = await turn("open pump.fun and look at the top coins", await webHands(agent), []);
  assert.equal(sent.length, 0, "no model call");
  assert.equal(out.filter((e) => e.kind === "text").map((e) => (e as { delta: string }).delta).join(""), WEB_BROWSE_LINE);
  assert.equal(WEB_BROWSE_LINE, "Opening sites works in the phone app, not here yet.");
  assert.ok(CHAT_TOOLS.some((t) => t.name === "browse"), "control: the phone's tools keep browse");
});

test("deploy order: a relay from before `tools` refuses the shape; the chat asks once more in the old shape and goes on; an absent tool called anyway is refused (control: a new relay takes `tools` at once)", async () => {
  const { agent } = await webCore();
  const hands = await webHands(agent);
  const old = { status: 400, body: { code: "quotes.request.refused", whatHappened: "That conversation couldn't be read." } };
  const a = await turn("hello", hands, [old, toolSse("j1", "propose_job", { job: "copy" }), textSse("ok")]);
  assert.deepEqual(a.sent.map((b) => !!b.tools), [true, false, ...a.sent.slice(2).map(() => false)], "named first; the old shape after the refusal, for the rest of the turn");
  const step = a.out.find((e) => e.kind === "step" && (e as { state: string }).state === "refused") as { why?: string } | undefined;
  assert.equal(step?.why, NOT_OFFERED, "an absent tool is refused by name, nothing done");
  assert.ok(!a.out.some((e) => e.kind === "needs-you"), "no job sheet");
  const b = await turn("hello", hands, [textSse("hi")]);
  assert.equal(b.sent.length, 1, "control: one request");
  assert.deepEqual(b.sent[0].tools, hands.offered);
});

test("covered_coins on the web names the web's wallets and the password, never the Safe or Face ID (control: the phone's answer still names both)", async () => {
  const { agent } = await webCore();
  const { sent } = await turn("which coins can you move?", await webHands(agent), [toolSse("c1", "covered_coins", {}), textSse("ok")]);
  const res = toolResult(sent[1]);
  assert.doesNotMatch(res, /Safe|Face ID/);
  assert.match(res, /You approve each one with your password\./);
  assert.match(res, /Each wallet holds its own chain's coins\./);
  const phone = await skillHands({ bridge: agent, relay: null, now: () => FIXED, clock: () => "12:00 PM" }).coins();
  assert.match(phone, /your Safe/);
  assert.match(phone, /Face ID/);
});

test("the plain-words pay path on the web says the password; the phone's says Face ID (control)", async () => {
  const { agent } = await webCore();
  const words = "send $5 to bob.near";
  const web = await turn(words, await webHands(agent), []);
  assert.equal(web.sent.length, 0, "read by our own code, no model call");
  assert.ok(web.out.some((e) => e.kind === "needs-you"), "Home's Send, filled in");
  const said = (o: ChatEvent[]) => JSON.stringify((o.at(-1) as { history: unknown[] }).history.at(-1));
  assert.match(said(web.out), /Home's Send is filled in\. Approve it with your password\./);
  assert.doesNotMatch(said(web.out), /Face ID/);
  const phoneHands: ChatHands = { receipts: async () => "", meter: async () => "" };
  const phone = await turn(words, phoneHands, []);
  assert.match(said(phone.out), /Home's Send is ready for your Face ID\./, "control: the phone");
});
