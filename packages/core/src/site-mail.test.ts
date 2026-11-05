// The person's own sign-in mailbox end to end on this machine only (127.0.0.1): the real receiver (apps/mail) takes
// pump.fun's code mail over SMTP and seals it; the core registers, reads and opens it with keys from the words, and
// answers the code. Controls: AgentZero is refused at every door and its keys open nothing; another account and a
// forged sender get no code; no key, root or secret ever leaves in a request; no mail host means hidden, nothing asked.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMail, type Running } from "../../../apps/mail/src/start.ts";
import { dkimSign, testDns, testSigner } from "../../../apps/mail/src/testing-dkim.ts";
import { appMayCall, forApps, type Bridge } from "./bridge.ts";
import { DemoCore } from "./demo-core.ts";
import { HOT_ROOT, hotRoot } from "./hot-keys.ts";
import { b64url, mailKeys, openMail, signRequest } from "./mail-keys.ts";
import { MAIL_NAME } from "./mailbox.ts";
import { SITE_MAIL_NAME, codeForSite, siteMailKeys } from "./site-mail.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { MemoryVault } from "./vault.ts";

const HOST = "mail.zerofee.si";
// privy.io signs its own mail; evil.example signs its own too (a real domain an attacker holds).
const privy = testSigner("privy.io");
const evil = testSigner("evil.example");
const lookalike = testSigner("pumpfun-login.example");
const PRIVY = readFileSync(new URL("../../../apps/mail/fixtures/privy-pumpfun.eml", import.meta.url), "utf8");
let dir: string;
let mail: Running;
const sent: string[] = [];
const elsewhere: string[] = [];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "zf-sitemail-"));
  const loose = { perIpConnections: 100, perIpMailbox: 1000, perMailbox: 1000, perIp: 1000, unknownPerIp: 1000 };
  mail = await startMail({ dataDir: dir, domain: HOST, smtpPort: 0, httpPort: 0, http: { perMailbox: 1000, perIp: 1000, apiHost: HOST }, smtpLimits: loose, dkim: { resolveTxt: testDns(privy, evil, lookalike) } });
  // The core speaks https to mail.zerofee.si; here that is the local receiver. Every request is kept to check what left.
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const headers = JSON.stringify(init?.headers ?? {});
    sent.push(`${init?.method ?? "GET"} ${u} ${headers} ${typeof init?.body === "string" ? init.body : ""}`);
    if (!u.startsWith(`https://${HOST}/`)) {
      elsewhere.push(u);
      throw new Error("no other host in this test");
    }
    return real(u.replace(`https://${HOST}`, `http://127.0.0.1:${mail.httpPort}`), init);
  }) as typeof fetch;
});
after(async () => {
  await mail.close();
  rmSync(dir, { recursive: true, force: true });
});

/** One whole mail over SMTP; the last reply (250 when stored). */
async function smtpSend(to: string, body: string): Promise<string> {
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
    await cmd("EHLO privy-mailer.test");
    await cmd("MAIL FROM:<bounce@privy.io>");
    const r = await cmd(`RCPT TO:<${to}>`);
    if (!r.startsWith("250")) return r;
    await cmd("DATA");
    const p = next();
    sock.write(`${body.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..")}\r\n.\r\n`);
    return await p;
  } finally {
    sock.destroy();
  }
}

const unsigned = (to: string, from: string, code: string) =>
  PRIVY.replace(/^From: .*$/m, `From: ${from}`).replace(/^To: .*$/m, `To: ${to}`).replaceAll("482913", code);
/** The mail as its From domain's own server sends it: signed by that domain. */
const mailTo = (to: string, from: string, code: string) => {
  const d = /@([^>\s]+)>?\s*$/.exec(from)![1]!;
  const s = d === "privy.io" ? privy : d.endsWith("evil.example") ? evil : lookalike;
  return dkimSign(unsigned(to, from, code), s);
};

function phone(root: Uint8Array, opts: { host?: boolean } = {}) {
  const vault = new MemoryVault();
  const core = new DemoCore({ chain: new FakeChain(), vault, prices: async () => ({ near: 4 }), ...(opts.host === false ? {} : { mail: { host: HOST, domain: HOST } }) });
  return { core, vault, ready: vault.put(HOT_ROOT, root.slice()) };
}
const ok = <T,>(r: unknown): T => {
  assert.ok(r && typeof r === "object" && "ok" in r, `expected an answer, got ${JSON.stringify(r)}`);
  return (r as { ok: T }).ok;
};
const refused = (r: unknown) => r !== null && typeof r === "object" && "problem" in r;

const rootA = hotRoot(new Uint8Array(randomBytes(32)));
const rootB = hotRoot(new Uint8Array(randomBytes(32)));

test("pump.fun's code arrives: set up, Privy's mail over SMTP, sealed on arrival, opened on the device, the code answered", async () => {
  const a = phone(rootA);
  await a.ready;
  assert.deepEqual(ok(await a.core.call("sitemail.address", {})), { address: null }, "not set up yet");
  const { address } = ok<{ address: string }>(await a.core.call("sitemail.setUp", {}));
  assert.match(address, /^[a-z]+\.[a-z]+@mail\.zerofee\.si$/, "a word.word address on mail.zerofee.si (K3), never the apex");
  assert.deepEqual(ok(await a.core.call("sitemail.setUp", {})), { address }, "set up twice: the same address");

  const startedAt = Date.now();
  assert.match(await smtpSend(address, mailTo(address, `"pump.fun" <no-reply@privy.io>`, "482913")), /^250/);
  // a forged sender a moment later: a look-alike domain, and another site altogether
  assert.match(await smtpSend(address, mailTo(address, `"pump.fun" <no-reply@privy.io.evil.example>`, "111111")), /^250/);
  assert.match(await smtpSend(address, mailTo(address, `"pump.fun" <login@pumpfun-login.example>`, "222222")), /^250/);
  // DKIM on arrival: privy.io's name with no signature, or with another domain's, is refused and never sealed.
  assert.match(await smtpSend(address, unsigned(address, `"pump.fun" <no-reply@privy.io>`, "333333")), /^550 5\.7\.20/);
  assert.match(await smtpSend(address, dkimSign(unsigned(address, `"pump.fun" <no-reply@privy.io>`, "444444"), evil)), /^550 5\.7\.20/);

  // The server keeps only sealed bytes: no code, no sender, no subject on disk.
  const onDisk = (readdirSync(dir, { recursive: true }) as string[]).map((f) => join(dir, f)).filter((f) => statSync(f).isFile()).map((f) => readFileSync(f, "utf8")).join("\n");
  assert.ok(onDisk.length > 0);
  for (const word of ["482913", "privy", "login code"]) assert.ok(!onDisk.toLowerCase().includes(word), `"${word}" is on the server's disk`);

  assert.deepEqual(ok(await a.core.call("sitemail.code", { site: "pump.fun", startedAt })), { code: "482913" }, "only the real sender's code");
  const late = ok(await a.core.call("sitemail.code", { site: "pump.fun", startedAt: startedAt - 30 * 60_000 }));
  assert.deepEqual(late, { code: null }, "a mail 30 min after the sign-in started is not its code");
  const early = ok(await a.core.call("sitemail.code", { site: "pump.fun", startedAt: startedAt + 5 * 60_000 }));
  assert.deepEqual(early, { code: null }, "a mail from before this sign-in started is not its code");
  assert.ok(refused(await a.core.call("sitemail.code", { site: "gmgn", startedAt })), "only sites that sign in by email");
  const { mails } = ok<{ mails: { from?: string; text?: string }[] }>(await a.core.call("sitemail.list", {}));
  assert.equal(mails.length, 3, "the person reads every mail themselves");
  assert.ok(mails.every((m) => typeof m.text === "string" && !/<[a-z]/i.test(m.text)), "plain text only, HTML never rendered");

  // A new phone with the same words: the same address, the same mail.
  const again = phone(rootA);
  await again.ready;
  assert.deepEqual(ok(await again.core.call("sitemail.setUp", {})), { address }, "the words find the same mailbox");
  assert.deepEqual(ok(await again.core.call("sitemail.code", { site: "pump.fun", startedAt })), { code: "482913" });

  // Another account: its own mailbox, and nothing of A's.
  const b = phone(rootB);
  await b.ready;
  const other = ok<{ address: string }>(await b.core.call("sitemail.setUp", {}));
  assert.notEqual(other.address, address);
  assert.deepEqual(ok(await b.core.call("sitemail.code", { site: "pump.fun", startedAt })), { code: null }, "B's box has no mail");
  const bKeys = siteMailKeys(rootB);
  const res = await fetch(`https://${HOST}/v0/mail/${address.split("@")[0]}`, { headers: { "x-mail-proof": signRequest(bKeys, { method: "read", host: HOST, mailbox: address.split("@")[0]! }) } });
  assert.equal(res.status, 401, "B's keys can't read A's box");
});

test("K1: AgentZero can't read it: refused at the bridge and the core, its keys sign no read and open no mail", async () => {
  const a = phone(rootA);
  await a.ready;
  const { address } = ok<{ address: string }>(await a.core.call("sitemail.setUp", {}));
  const box = address.split("@")[0]!;
  for (const app of ["agent", "browser", "trade", "wallet", "chat", "pay", "social", "extension"] as const) {
    for (const m of ["sitemail.address", "sitemail.setUp", "sitemail.list", "sitemail.code"]) assert.equal(appMayCall(app, m), false, `${app} may call ${m}`);
  }
  const agent = forApps(a.core as unknown as Bridge, "agent");
  const viaBridge = await agent.call("sitemail.list", {});
  assert.ok("problem" in viaBridge && viaBridge.problem.code === "security.bridge.not-allowed", "AgentZero's bridge refuses it");
  for (const who of [{ app: "agent" }, { caller: "agent" }, { app: "browser" }]) {
    assert.ok(refused(await a.core.call("sitemail.code", { site: "pump.fun", startedAt: Date.now(), ...who })), `${JSON.stringify(who)} was answered`);
  }
  // AgentZero's own mailbox is another name and other keys: its door finds none here, and its keys get nothing.
  assert.equal(await a.vault.get(MAIL_NAME), null, "the site mailbox never fills AgentZero's mailbox name");
  assert.notEqual(await a.vault.get(SITE_MAIL_NAME), null);
  const agentKeys = mailKeys(rootA);
  const site = siteMailKeys(rootA);
  assert.notEqual(b64url(agentKeys.boxPublic), b64url(site.boxPublic), "other keys from the same words");
  const asAgent = await fetch(`https://${HOST}/v0/mail/${box}`, { headers: { "x-mail-proof": signRequest(agentKeys, { method: "read", host: HOST, mailbox: box }) } });
  assert.equal(asAgent.status, 401, "AgentZero's sign key reads nothing of the site mailbox");
  const asPerson = await fetch(`https://${HOST}/v0/mail/${box}`, { headers: { "x-mail-proof": signRequest(site, { method: "read", host: HOST, mailbox: box }) } });
  const { messages } = (await asPerson.json()) as { messages: { sealed: string }[] };
  assert.ok(messages.length > 0);
  for (const m of messages) {
    assert.throws(() => openMail(agentKeys.boxSecret, m.sealed), "AgentZero's box key opens none of it");
    assert.doesNotThrow(() => openMail(site.boxSecret, m.sealed));
  }
});

test("keys never leave the device: no secret, root or words-derived secret in any request; only mail.zerofee.si is asked", () => {
  assert.ok(sent.length > 0);
  for (const root of [rootA, rootB]) {
    const k = siteMailKeys(root);
    const ag = mailKeys(root);
    const secrets = [root, k.boxSecret, k.signSecret, ag.boxSecret, ag.signSecret].flatMap((s) => [b64url(s), Buffer.from(s).toString("hex"), Buffer.from(s).toString("base64")]);
    for (const line of sent) for (const s of secrets) assert.ok(!line.includes(s), "a secret left in a request");
  }
  assert.deepEqual(elsewhere, [], "no other host was asked");
});

test("hidden until a mail host is set; a dead host says the mailbox didn't answer and nothing is kept", async () => {
  const before = sent.length;
  const off = phone(rootA, { host: false });
  await off.ready;
  assert.deepEqual(ok(await off.core.call("sitemail.address", {})), { address: null });
  for (const m of ["sitemail.setUp", "sitemail.list", "sitemail.code"]) assert.ok(refused(await off.core.call(m, { site: "pump.fun", startedAt: Date.now() })), `${m} answered with no host`);
  assert.equal(sent.length, before, "no host: nothing asked");

  const noWords = new DemoCore({ chain: new FakeChain(), vault: new MemoryVault(), prices: async () => ({ near: 4 }), mail: { host: HOST, domain: HOST } });
  const r = await noWords.call("sitemail.setUp", {});
  assert.ok("problem" in r && /isn't set up/.test(r.problem.whatHappened + (r.problem.more ?? "")), "no words here: said so");

  const real = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("down");
  }) as typeof fetch;
  try {
    const dead = phone(rootB);
    await dead.ready;
    const d = await dead.core.call("sitemail.setUp", {});
    assert.ok("problem" in d && /sign-in mailbox/.test(JSON.stringify(d.problem)), "the mailbox is named");
    assert.equal(await dead.vault.get(SITE_MAIL_NAME), null, "nothing kept after a failure, so a retry registers again");
  } finally {
    globalThis.fetch = real;
  }
});

test("the audit's SHOULD: two privy.io mails in the window with different codes answer no code; the same code twice is that code", () => {
  const t = Date.UTC(2026, 10, 5, 7, 0, 0);
  const m = (id: string, at: number, code: string, from = `"pump.fun" <no-reply@privy.io>`) => ({ id, at, from, subject: "Your login code for pump.fun", text: `Enter this code to log in:\n\n${code}\n` });
  assert.equal(codeForSite([m("1", t + 1_000, "482913")], "pump.fun", t), "482913");
  assert.equal(codeForSite([m("1", t + 1_000, "482913"), m("2", t + 2_000, "771204")], "pump.fun", t), null, "they disagree: the person reads them");
  assert.equal(codeForSite([m("1", t + 1_000, "482913"), m("2", t + 2_000, "482913")], "pump.fun", t), "482913", "control: they agree");
  assert.equal(codeForSite([m("1", t - 20 * 60_000, "771204"), m("2", t + 2_000, "482913")], "pump.fun", t), "482913", "control: an old one outside the window doesn't count");
  assert.equal(codeForSite([m("1", t + 1_000, "771204", "x <a@evil.example>"), m("2", t + 2_000, "482913")], "pump.fun", t), "482913", "control: another sender's doesn't count");
});
