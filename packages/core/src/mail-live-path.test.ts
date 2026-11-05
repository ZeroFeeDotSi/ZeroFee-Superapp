// The app's mail setting, whole path, on this machine only (gate test; no network, no timing): the core built with the
// app's own MAIL_SERVICE (mail.zerofee.si) registers a mailbox on the real receiver (apps/mail, on 127.0.0.1), a mail
// arrives over SMTP and is sealed, the device opens it with keys from the words, and codeFrom reads its code. Controls:
// a mail with no code reads none, and another mailbox's code never reaches this one.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMail, type Running } from "../../../apps/mail/src/start.ts";
import { DemoCore } from "./demo-core.ts";
import { HOT_ROOT, hotRoot } from "./hot-keys.ts";
import { codeFrom } from "./mail-code.ts";
import { MAIL_SERVICE } from "./mail-service.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { MemoryVault } from "./vault.ts";
import { seedToWords } from "./recovery-words.ts";

let dir: string;
let mail: Running;
let realFetch: typeof fetch;
const asked: string[] = [];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "zf-mail-live-path-"));
  const loose = { perIpConnections: 100, perIpMailbox: 1000, perMailbox: 1000, perIp: 1000, unknownPerIp: 1000 };
  mail = await startMail({ dataDir: dir, domain: MAIL_SERVICE.domain, smtpPort: 0, httpPort: 0, http: { perMailbox: 1000, perIp: 1000, apiHost: MAIL_SERVICE.host }, smtpLimits: loose, dkim: "off" });
  // The core speaks https to the app's mail host; here that is the local receiver. Nothing else may be asked.
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    asked.push(u);
    if (!u.startsWith(`https://${MAIL_SERVICE.host}/`)) throw new Error(`no other host in this test: ${u}`);
    return realFetch(u.replace(`https://${MAIL_SERVICE.host}`, `http://127.0.0.1:${mail.httpPort}`), init);
  }) as typeof fetch;
});
after(async () => {
  globalThis.fetch = realFetch;
  await mail.close();
  rmSync(dir, { recursive: true, force: true });
});

/** One whole mail over SMTP to the local receiver; the last reply (250 when stored). */
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

function phone(seed: number) {
  const vault = new MemoryVault();
  const core = new DemoCore({ chain: new FakeChain(), vault, prices: async () => ({ near: 4 }), mail: MAIL_SERVICE });
  return { core, ready: vault.put(HOT_ROOT, hotRoot(new Uint8Array(32).fill(seed))) };
}
const ok = <T,>(r: unknown): T => {
  assert.ok(r && typeof r === "object" && "ok" in r, `expected an answer, got ${JSON.stringify(r)}`);
  return (r as { ok: T }).ok;
};
type Listed = { mails: { subject?: string; text?: string; broken?: true }[] };
const codes = (l: Listed) => l.mails.map((m) => (m.broken ? null : codeFrom({ subject: m.subject ?? "", text: m.text ?? "" })));

test("the app's mail host, whole path: register → SMTP in → sealed → opened on the device → codeFrom reads the code (controls: no code, another mailbox's)", async () => {
  assert.deepEqual({ ...MAIL_SERVICE }, { host: "mail.zerofee.si", domain: "mail.zerofee.si" }, "the app's setting: never the apex");
  const a = phone(7), b = phone(9);
  await a.ready;
  await b.ready;
  const { address } = ok<{ address: string }>(await a.core.call("sitemail.setUp", {}));
  const other = ok<{ address: string }>(await b.core.call("sitemail.setUp", {})).address;
  assert.match(address, /@mail\.zerofee\.si$/);
  assert.notEqual(address, other);

  assert.match(await smtpSend(address, "Your code is 739204", "Use 739204 to sign in. It works for 10 minutes."), /^250/);
  assert.match(await smtpSend(other, "Your code is 111222", "Use 111222 to sign in."), /^250/);
  const mineA = ok<Listed>(await a.core.call("sitemail.list", {}));
  assert.deepEqual(codes(mineA), ["739204"], "A's mailbox: its own mail, opened, its code read");

  // control: a mail with no code in it reads none
  assert.match(await smtpSend(address, "Welcome", "Thanks for signing up. Nothing to type."), /^250/);
  assert.deepEqual(codes(ok<Listed>(await a.core.call("sitemail.list", {}))), ["739204", null], "a wrong mail: no code");
  // control: another mailbox's code never reaches this one, and its own reads only its own
  assert.deepEqual(codes(ok<Listed>(await b.core.call("sitemail.list", {}))), ["111222"]);
  assert.ok(!codes(ok<Listed>(await a.core.call("sitemail.list", {}))).includes("111222"), "B's code is never A's");
  assert.ok(asked.length > 0 && asked.every((u) => u.startsWith("https://mail.zerofee.si/v0/mail/")), "only the app's mail host was asked");
});

test("W7: AgentZero's own mailbox, whole path: mailSetUp at its first open → SMTP in → mailList opens it on the device → the code read on the web wallet (controls: a second open asks no one, another mailbox's code never arrives)", async () => {
  // the web wallet (W7): 24 words in this browser, no Safe; AgentZero's calls come as the agent app (forApps' stamp)
  const core = new DemoCore({ chain: new FakeChain(), vault: new MemoryVault(), prices: async () => ({ near: 4 }), mail: MAIL_SERVICE, secretsInMemory: true, webWallet: { passwordOk: async () => true } });
  ok(await core.call("account.web.import", { words: seedToWords(new Uint8Array(32).fill(11)) }));
  const AZ = { app: "agent" };
  const a = { core: { call: (m: string, p: Record<string, unknown>) => core.call(m, m.startsWith("account.agent.") ? { ...p, ...AZ } : p) } };
  const before = (await a.core.call("account.agent.mailAddress", {})) as { ok?: { address: string | null } };
  assert.equal(before.ok?.address, null, "fail-before: nothing registered AgentZero's mailbox");
  const { address } = ok<{ address: string }>(await a.core.call("account.agent.mailSetUp", {}));
  assert.match(address, /^[a-z]+\.[a-z]+@mail\.zerofee\.si$/);
  const n = asked.length;
  assert.equal(ok<{ address: string }>(await a.core.call("account.agent.mailSetUp", {})).address, address);
  assert.equal(asked.length, n, "a second open asks no one: the name is kept");
  const other = phone(12);
  await other.ready;
  const otherBox = ok<{ address: string }>(await other.core.call("sitemail.setUp", {})).address;
  assert.notEqual(otherBox, address);
  assert.match(await smtpSend(address, "Your code is 482913", "Use 482913 to sign in."), /^250/);
  const mails = ok<Listed>(await a.core.call("account.agent.mailList", {}));
  assert.deepEqual(codes(mails), ["482913"], "opened on the device, its code read");
  assert.match(await smtpSend(otherBox, "Your code is 555000", "Use 555000."), /^250/);
  assert.deepEqual(codes(ok<Listed>(await a.core.call("account.agent.mailList", {}))), ["482913"], "control: another mailbox's code never reaches AgentZero's");
});
