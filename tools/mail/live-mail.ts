// The app's mail host, live (opt-in, never in the gate): the same whole path as core/mail-live-path.test.ts against the
// real mail.zerofee.si. A fresh throwaway key makes ONE mailbox; ONE mail goes to it over SMTP (port 25, STARTTLS, the
// host's A record: there is no MX); the core reads it back over https, opens it on this machine and codeFrom reads the
// code. No money, no account, no other mailbox. Run: ZF_MAIL_LIVE=1 node tools/mail/live-mail.ts
import { randomBytes, randomInt } from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import { DemoCore } from "../../packages/core/src/demo-core.ts";
import { HOT_ROOT, hotRoot } from "../../packages/core/src/hot-keys.ts";
import { codeFrom } from "../../packages/core/src/mail-code.ts";
import { MAIL_SERVICE } from "../../packages/core/src/mail-service.ts";
import { FakeChain } from "../../packages/core/src/testing/fake-chain.ts";
import { MemoryVault } from "../../packages/core/src/vault.ts";

if (process.env.ZF_MAIL_LIVE !== "1") {
  console.log("Opt-in: ZF_MAIL_LIVE=1 node tools/mail/live-mail.ts (one mailbox, one mail, on mail.zerofee.si)");
  process.exit(0);
}
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)} s`;
const log = (s: string) => console.log(`[${at()}] ${s}`);

/** One SMTP session to the host's port 25: EHLO, STARTTLS, EHLO again, then the mail. The last reply. */
async function smtp(host: string, to: string, body: string): Promise<string> {
  let sock: net.Socket | tls.TLSSocket = net.connect(25, host);
  let buf = "";
  let waiting: ((s: string) => void)[] = [];
  const listen = (s: net.Socket | tls.TLSSocket) => {
    s.setEncoding("utf8");
    s.on("data", (d: string) => {
      buf += d;
      for (;;) {
        const m = /^(?:\d{3}-[^\n]*\n)*\d{3} [^\n]*\n/.exec(buf);
        if (!m) break;
        buf = buf.slice(m[0].length);
        waiting.shift()?.(m[0]);
      }
    });
  };
  const next = () => new Promise<string>((r, j) => { waiting.push(r); sock.once("error", j); });
  const cmd = async (line: string) => { const p = next(); sock.write(`${line}\r\n`); const r = await p; log(`C: ${line.replace(/\S+@\S+/g, "<addr>")} → S: ${r.trim().split("\n").pop()}`); return r; };
  listen(sock);
  await new Promise<void>((r, j) => { sock.once("connect", () => r()); sock.once("error", j); });
  log(`S: ${(await next()).trim()}`);
  const ehlo = await cmd("EHLO live-check.zerofee.test");
  log(`EHLO offers: ${ehlo.trim().split("\n").map((l) => l.slice(4).trim()).join(" | ")}`);
  if (/STARTTLS/i.test(ehlo)) {
    await cmd("STARTTLS");
    sock.removeAllListeners("data");
    waiting = [];
    sock = tls.connect({ socket: sock as net.Socket, servername: host });
    await new Promise<void>((r, j) => { (sock as tls.TLSSocket).once("secureConnect", () => r()); sock.once("error", j); });
    log(`TLS: ${(sock as tls.TLSSocket).getProtocol()}, certificate ok: ${(sock as tls.TLSSocket).authorized}`);
    listen(sock);
    await cmd("EHLO live-check.zerofee.test");
  } else log("FINDING: the server offers no STARTTLS; the mail goes in plain (as a sender without TLS would)");
  await cmd("MAIL FROM:<>");
  const rcpt = await cmd(`RCPT TO:<${to}>`);
  if (!rcpt.startsWith("250")) return rcpt;
  await cmd("DATA");
  const p = next();
  sock.write(`${body.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..")}\r\n.\r\n`);
  const r = await p;
  log(`DATA → S: ${r.trim()}`);
  await cmd("QUIT").catch(() => "");
  sock.destroy();
  return r;
}

const vault = new MemoryVault();
const core = new DemoCore({ chain: new FakeChain(), vault, prices: async () => ({ near: 4 }), mail: MAIL_SERVICE });
await vault.put(HOT_ROOT, hotRoot(new Uint8Array(randomBytes(32))));
const ok = <T,>(r: unknown, what: string): T => {
  if (!r || typeof r !== "object" || !("ok" in r)) throw new Error(`${what}: ${JSON.stringify(r)}`);
  return (r as { ok: T }).ok;
};

log(`mail host ${MAIL_SERVICE.host}, domain ${MAIL_SERVICE.domain}`);
const { address } = ok<{ address: string }>(await core.call("sitemail.setUp", {}), "register");
log(`registered a throwaway mailbox: ${address.replace(/^[^@]+/, "<name>")}`);
const code = String(randomInt(100000, 999999));
const body = `From: ZeroFee live check <check@live-check.zerofee.test>\nTo: ${address}\nSubject: Your code is ${code}\nDate: ${new Date().toUTCString()}\nMessage-ID: <${randomBytes(8).toString("hex")}@live-check.zerofee.test>\nContent-Type: text/plain; charset=utf-8\n\nUse ${code} to sign in.\n`;
const reply = await smtp(MAIL_SERVICE.host, address, body);
if (!reply.startsWith("250")) { log(`FAIL: the server refused the mail: ${reply.trim()}`); process.exit(1); }
for (let i = 0; i < 20; i++) {
  const { mails } = ok<{ mails: { subject?: string; text?: string; broken?: true }[] }>(await core.call("sitemail.list", {}), "read");
  const got = mails.map((m) => (m.broken ? "broken" : codeFrom({ subject: m.subject ?? "", text: m.text ?? "" })));
  if (got.length) {
    log(`read ${mails.length} mail(s) over https, opened on this machine; codeFrom: ${JSON.stringify(got)}`);
    if (got.includes(code)) { log(`PASS: the code that was sent (${code}) came back`); process.exit(0); }
    log(`FAIL: expected ${code}`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 1500));
}
log("FAIL: no mail arrived in 30 s");
process.exit(1);
