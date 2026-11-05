// The receiver end to end on this machine only (127.0.0.1, which tools/test/no-network.ts allows): SMTP in, the inbox
// API out. No mail leaves this machine; nothing here reaches DNS or any other host.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { b64url, mailKeys, openMail, signRegister, signRequest, type MailKeys } from "@zerofee/agent/mail/keys";
import { codeFrom } from "@zerofee/agent/mail/code";
import { callerAddress } from "./http.ts";
import { Limiter, ipKey } from "./limits.ts";
import { startMail, type Running, type StartOptions } from "./start.ts";

const A = mailKeys(new Uint8Array(64).fill(1));
const B = mailKeys(new Uint8Array(64).fill(2));
const HOST = "mail.zerofee.si";
let dir: string;
let mail: Running;
let api: string;

const loose = { perIpConnections: 100, perIpMailbox: 1000, perMailbox: 1000, perIp: 1000, unknownPerIp: 1000 };

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "zf-mail-srv-"));
  // DKIM is off here: these test the SMTP and inbox mechanics with plain fixtures (dkim.test.ts and core/site-mail.test.ts
  // run it on).
  mail = await startMail({ dataDir: dir, domain: "zerofee.si", smtpPort: 0, httpPort: 0, size: 64 * 1024, http: { perMailbox: 1000, perIp: 1000 }, smtpLimits: loose, dkim: "off" });
  api = `http://127.0.0.1:${mail.httpPort}/v0/mail`;
});
after(async () => {
  await mail.close();
  rmSync(dir, { recursive: true, force: true });
});

const post = (body: unknown, base = api) => fetch(`${base}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const readProof = (k: MailKeys, mailbox: string, ts?: number, host = HOST) => signRequest(k, { method: "read", host, mailbox }, ts);
const delProof = (k: MailKeys, mailbox: string, id: string) => signRequest(k, { method: "delete", host: HOST, mailbox, id });
const get = (mailbox: string, proof?: string, q = "", base = api) => fetch(`${base}/${mailbox}${q}`, { headers: proof ? { "x-mail-proof": proof } : {} });
const del = (mailbox: string, id: string, proof?: string) => fetch(`${api}/${mailbox}/${id}`, { method: "DELETE", headers: proof ? { "x-mail-proof": proof } : {} });

/** A tiny SMTP client: each command's full reply (multi-line joined); `closed` resolves when the server hangs up. */
async function smtp(port: number) {
  const sock = net.connect(port, "127.0.0.1");
  let buf = "";
  const waiting: ((reply: string) => void)[] = [];
  const closed = new Promise<void>((r) => sock.once("close", () => r()));
  sock.on("error", () => {});
  sock.setEncoding("utf8");
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
  const greeting = await next();
  return {
    greeting,
    closed,
    async cmd(line: string): Promise<string> {
      const p = next();
      sock.write(`${line}\r\n`);
      return p;
    },
    async data(body: string): Promise<string> {
      const p = next();
      sock.write(`${body.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..")}\r\n.\r\n`);
      return p;
    },
    close: () => sock.destroy(),
  };
}

/** Sends one whole mail; the last reply (250 when stored). */
async function send(port: number, to: string, body: string): Promise<string> {
  const c = await smtp(port);
  try {
    await c.cmd("EHLO tester.local");
    await c.cmd("MAIL FROM:<sender@example.com>");
    const r = await c.cmd(`RCPT TO:<${to}>`);
    if (!r.startsWith("250")) return r;
    await c.cmd("DATA");
    return await c.data(body);
  } finally {
    c.close();
  }
}

/** A local door that hands each connection to the receiver as if it came from `remote` (another sender's address). */
async function doorFrom(m: Running, remote: string): Promise<{ port: number; close: () => Promise<void> }> {
  const door = net.createServer((s) => m.smtp.handle(s, remote));
  await new Promise<void>((r) => door.listen(0, "127.0.0.1", () => r()));
  return { port: (door.address() as net.AddressInfo).port, close: () => new Promise<void>((r) => door.close(() => r())) };
}

const withMail = async (o: Partial<StartOptions>, fn: (m: Running, base: string) => Promise<void>) => {
  const d = mkdtempSync(join(tmpdir(), "zf-mail-x-"));
  const m = await startMail({ dataDir: d, domain: "zerofee.si", smtpPort: 0, httpPort: 0, dkim: "off", ...o });
  try {
    await fn(m, `http://127.0.0.1:${m.httpPort}/v0/mail`);
  } finally {
    await m.close();
    rmSync(d, { recursive: true, force: true });
  }
};

test("health", async () => {
  const r = await fetch(`${api}/health`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

test("register: good passes; same key again passes; bad and reserved names, a small-order key refused", async () => {
  const r = await post(signRegister(A, "lena.river"));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, mailbox: "lena.river", address: "lena.river@zerofee.si" });
  assert.equal((await post(signRegister(A, "lena.river"))).status, 200);
  assert.equal((await post(signRegister(A, "lena"))).status, 400);
  assert.equal((await post(signRegister(A, "lena.river9"))).status, 400);
  const reserved = await post(signRegister(A, "admin.desk"));
  assert.equal(reserved.status, 403);
  assert.deepEqual(await reserved.json(), { error: "reserved" });
  assert.equal((await post(signRegister(A, "postmaster.team"))).status, 403);
  // A zero box key with a good signature over it.
  const zero = b64url(new Uint8Array(32));
  const zeroKeys = { ...A, boxPublic: new Uint8Array(32) };
  const zr = await post(signRegister(zeroKeys, "zero.key"));
  assert.equal(zr.status, 400);
  assert.deepEqual(await zr.json(), { error: "bad-key" });
  assert.equal(mail.store.get("zero.key"), undefined, zero);
  assert.equal((await fetch(`${api}/register`, { method: "POST", body: "not json" })).status, 400);
});

test("register: a taken name answers exactly like a bad or stale proof (nothing tells it is taken)", async () => {
  const taken = await post(signRegister(B, "lena.river"));
  const stale = await post(signRegister(B, "omar.stone", Date.now() - 6 * 60 * 1000));
  const otherBox = await post({ ...signRegister(A, "lena.river"), mailbox: "omar.stone" });
  const forged = await post({ ...signRegister(A, "omar.stone"), publicKey: b64url(B.boxPublic) });
  const answers = await Promise.all([taken, stale, otherBox, forged].map(async (r) => [r.status, await r.text()]));
  for (const a of answers) assert.deepEqual(a, [401, JSON.stringify({ error: "refused" })]);
  assert.equal(mail.store.get("lena.river")!.signingKey, b64url(A.signPublic));
  assert.equal(mail.store.get("omar.stone"), undefined);
});

test("smtp: unknown mailbox 550 at RCPT; another domain 550 (no relay); no AUTH; over-size refused", async () => {
  const c = await smtp(mail.smtpPort);
  try {
    assert.match(c.greeting, /^220 /);
    const ehlo = await c.cmd("EHLO tester.local");
    assert.match(ehlo, /^250/);
    assert.ok(!/AUTH/.test(ehlo), "AUTH must not be offered");
    assert.ok(!/STARTTLS/.test(ehlo), "no STARTTLS without a key and certificate");
    assert.match(ehlo, /SIZE 65536/);
    assert.match(await c.cmd("AUTH PLAIN AGxlbmEAcGFzcw=="), /^502/);
    assert.match(await c.cmd("MAIL FROM:<sender@example.com>"), /^250/);
    assert.match(await c.cmd("RCPT TO:<nobody.here@zerofee.si>"), /^550/);
    assert.match(await c.cmd("RCPT TO:<lena.river@example.com>"), /^550/);
    assert.match(await c.cmd("RCPT TO:<postmaster@zerofee.si>"), /^550/);
    assert.match(await c.cmd("RCPT TO:<lena.river@zerofee.si>"), /^250/);
    assert.match(await c.cmd("DATA"), /^354/);
    assert.match(await c.data(`Subject: big\n\n${"x".repeat(70 * 1024)}`), /^552/);
    assert.match(await c.cmd("RSET"), /^250/);
    assert.match(await c.cmd(`MAIL FROM:<sender@example.com> SIZE=${10 * 1024 * 1024}`), /^552/);
    assert.match(await c.cmd("QUIT"), /^221/);
  } finally {
    c.close();
  }
  assert.equal(mail.store.list("lena.river").messages.length, 0);
});

test("smtp → inbox: sealed on arrival; read proofs bound to method, host and mailbox; used once; delete bound to its id", async () => {
  const fixture = readFileSync(new URL("../fixtures/privy-pumpfun.eml", import.meta.url), "utf8");
  assert.match(await send(mail.smtpPort, "lena.river@zerofee.si", fixture), /^250/);
  assert.match(await send(mail.smtpPort, "lena.river@zerofee.si", fixture), /^250/);

  const boxDir = join(dir, "box", "lena.river");
  assert.equal(readdirSync(boxDir).length, 2);
  const disk = readdirSync(boxDir).map((f) => readFileSync(join(boxDir, f), "utf8")).join() + readFileSync(join(dir, "mailboxes.json"), "utf8");
  for (const s of ["Your login code for pump.fun", "482913", "privy.io", "Welcome back", "pump.fun"]) assert.ok(!disk.includes(s), `store holds ${s}`);

  assert.equal((await get("lena.river")).status, 401);
  assert.equal((await get("lena.river", readProof(A, "lena.river", Date.now() - 31_000))).status, 401);
  assert.equal((await get("lena.river", readProof(A, "omar.stone"))).status, 401);
  assert.equal((await get("lena.river", readProof(B, "lena.river"))).status, 401);
  assert.equal((await get("lena.river", readProof(A, "lena.river", undefined, "mail.other.example"))).status, 401, "a proof for another server");
  assert.equal((await get("omar.stone", readProof(B, "omar.stone"))).status, 401, "an unknown mailbox answers like a bad proof");
  assert.equal((await get("lena.river", "junk")).status, 401);

  const proof = readProof(A, "lena.river");
  const ok = await get("lena.river", proof);
  assert.equal(ok.status, 200);
  assert.equal((await get("lena.river", proof)).status, 401, "a read proof works once");
  const { messages, more } = (await ok.json()) as { messages: { id: string; at: number; sealed: string }[]; more: boolean };
  assert.equal(messages.length, 2);
  assert.equal(more, false);
  assert.ok(messages[0]!.id < messages[1]!.id, "oldest first");
  const opened = openMail(A.boxSecret, messages[0]!.sealed);
  assert.equal(opened.subject, "Your login code for pump.fun");
  assert.equal(codeFrom(opened), "482913");
  assert.throws(() => openMail(B.boxSecret, messages[0]!.sealed));

  const since = await get("lena.river", readProof(A, "lena.river"), `?since=${messages[0]!.id}`);
  assert.deepEqual(((await since.json()) as { messages: { id: string }[] }).messages.map((m) => m.id), [messages[1]!.id]);
  assert.equal((await get("lena.river", readProof(A, "lena.river"), "?since=../x")).status, 400);

  const [m1, m2] = [messages[0]!.id, messages[1]!.id];
  assert.equal((await del("lena.river", m1)).status, 401);
  assert.equal((await del("lena.river", m1, readProof(A, "lena.river"))).status, 401, "a read proof can't delete");
  assert.equal((await del("lena.river", m2, delProof(A, "lena.river", m1))).status, 401, "a delete proof can't delete another mail");
  assert.equal((await del("lena.river", m1, delProof(B, "lena.river", m1))).status, 401);
  assert.equal(readdirSync(boxDir).length, 2);
  const once = delProof(A, "lena.river", m1);
  assert.equal((await del("lena.river", m1, once)).status, 200);
  assert.equal((await del("lena.river", m1, once)).status, 401, "a replayed delete proof is refused");
  assert.equal((await del("lena.river", m1, delProof(A, "lena.river", m1))).status, 404);
  assert.equal((await del("lena.river", m2, delProof(A, "lena.river", m2))).status, 200);
  assert.equal(readdirSync(boxDir).length, 0);
});

test("a hostile mail over SMTP changes nothing: one sealed file, the mailbox list untouched, no code", async () => {
  const before = readFileSync(join(dir, "mailboxes.json"), "utf8");
  const fixture = readFileSync(new URL("../fixtures/hostile.eml", import.meta.url), "utf8");
  assert.match(await send(mail.smtpPort, "lena.river@zerofee.si", fixture), /^250/);
  assert.equal(readFileSync(join(dir, "mailboxes.json"), "utf8"), before);
  const r = await get("lena.river", readProof(A, "lena.river"));
  const { messages } = (await r.json()) as { messages: { sealed: string }[] };
  assert.equal(messages.length, 1);
  assert.equal(codeFrom(openMail(A.boxSecret, messages[0]!.sealed)), null);
});

test("http rate limits: per mailbox and per IP answer 429; health is never limited", async () => {
  await withMail({ http: { perMailbox: 2, perIp: 6 } }, async (_m, base) => {
    assert.equal((await post(signRegister(A, "lena.river"), base)).status, 200);
    const read = () => get("lena.river", readProof(A, "lena.river"), "", base).then((r) => r.status);
    assert.deepEqual([await read(), await read(), await read()], [200, 200, 429]);
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push(await fetch(`${base}/omar.stone`).then((r) => r.status));
    assert.deepEqual(statuses, [401, 401, 429, 429]);
    assert.equal((await fetch(`${base}/health`)).status, 200);
  });
});

test("trustProxy: the rightmost x-forwarded-for entry is the caller; a spoofed leftmost entry doesn't get past the limit", async () => {
  assert.equal(callerAddress("10.0.0.2", "6.6.6.6, 203.0.113.9", 1), "203.0.113.9");
  assert.equal(callerAddress("10.0.0.2", "6.6.6.6, 203.0.113.9, 10.0.0.1", 2), "203.0.113.9");
  assert.equal(callerAddress("10.0.0.2", undefined, 1), "10.0.0.2");
  assert.equal(callerAddress("10.0.0.2", "6.6.6.6", 0), "10.0.0.2");
  await withMail({ http: { perIp: 3, trustProxy: 1 } }, async (_m, base) => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push(await fetch(`${base}/omar.stone`, { headers: { "x-forwarded-for": `198.51.100.${i}, 203.0.113.9` } }).then((r) => r.status));
    assert.deepEqual(statuses, [401, 401, 401, 429, 429]);
    // Another real caller still gets through.
    assert.equal(await fetch(`${base}/omar.stone`, { headers: { "x-forwarded-for": "203.0.113.10" } }).then((r) => r.status), 401);
  });
});

test("ipKey: IPv4 as is (mapped too); IPv6 by its /64", () => {
  assert.equal(ipKey("203.0.113.9"), "203.0.113.9");
  assert.equal(ipKey("::ffff:203.0.113.9"), "203.0.113.9");
  assert.equal(ipKey("2001:db8:1:2::1"), "2001:db8:1:2::/64");
  assert.equal(ipKey("2001:0db8:0001:0002:ffff:ffff:ffff:fffe"), "2001:db8:1:2::/64");
  assert.equal(ipKey("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(ipKey("fe80::1%en0"), "fe80:0:0:0::/64");
  assert.notEqual(ipKey("2001:db8:1:3::1"), ipKey("2001:db8:1:2::1"));
});

test("Limiter: 60k distinct keys stay bounded (least recently used dropped first), and a busy key keeps its count", () => {
  const l = new Limiter(2, 60_000, () => 0, 1000);
  assert.equal(l.take("hot"), true);
  for (let i = 0; i < 60_000; i++) {
    l.take(`k${i}`);
    if (i % 100 === 0) l.take("hot");
  }
  assert.ok(l.size <= 1000, `size ${l.size}`);
  assert.equal(l.take("hot"), false, "the busy key was kept, at its limit");
  assert.equal(l.take("k0"), true, "an old key was dropped, so it starts again");
});

test("smtp floods: one sender address flooding a mailbox gets 451 while another address's mail still lands", async () => {
  await withMail({ smtpLimits: { ...loose, perIpMailbox: 3, perMailbox: 10 } }, async (m, base) => {
    assert.equal((await post(signRegister(A, "lena.river"), base)).status, 200);
    const flood = await doorFrom(m, "198.51.100.66");
    const other = await doorFrom(m, "203.0.113.9");
    try {
      const body = "Subject: hi\n\nhello";
      const replies: string[] = [];
      for (let i = 0; i < 5; i++) replies.push((await send(flood.port, "lena.river@zerofee.si", body)).slice(0, 3));
      assert.deepEqual(replies, ["250", "250", "250", "451", "451"]);
      assert.match(await send(other.port, "lena.river@zerofee.si", body), /^250/);
      assert.equal(m.store.list("lena.river").messages.length, 4);
    } finally {
      await flood.close();
      await other.close();
    }
  });
});

test("smtp probing: after the unknown-name budget, a real mailbox answers 450 like any other name", async () => {
  await withMail({ smtpLimits: { ...loose, unknownPerIp: 3 } }, async (m, base) => {
    assert.equal((await post(signRegister(A, "lena.river"), base)).status, 200);
    const c = await smtp(m.smtpPort);
    try {
      await c.cmd("EHLO prober.local");
      await c.cmd("MAIL FROM:<p@example.com>");
      assert.match(await c.cmd("RCPT TO:<lena.river@zerofee.si>"), /^250/);
      for (const n of ["a.b", "c.d", "e.f"]) assert.match(await c.cmd(`RCPT TO:<${n}@zerofee.si>`), /^550/);
      assert.match(await c.cmd("RCPT TO:<lena.river@zerofee.si>"), /^450/);
      assert.match(await c.cmd("RCPT TO:<g.h@zerofee.si>"), /^450/);
    } finally {
      c.close();
    }
  });
});

test("smtp connections: a cap per address (421), and a whole-session limit that closes even a busy connection", async () => {
  await withMail({ smtpLimits: { ...loose, perIpConnections: 2, maxSessionMs: 400 } }, async (m) => {
    const a = await smtp(m.smtpPort);
    const b = await smtp(m.smtpPort);
    const c = await smtp(m.smtpPort);
    assert.match(c.greeting, /^421 /);
    await c.closed;
    // a keeps talking (never idle) and is still closed by the session limit.
    let talking = true;
    const chatter = (async () => {
      while (talking) {
        const r = await Promise.race([a.cmd("NOOP"), a.closed.then(() => "closed")]);
        if (r === "closed") break;
        await new Promise((res) => setTimeout(res, 50));
      }
    })();
    await a.closed;
    talking = false;
    await chatter;
    b.close();
  });
});

test("start: refuses to listen beyond this machine without a TLS key and certificate", async () => {
  const d = mkdtempSync(join(tmpdir(), "zf-mail-tls-"));
  try {
    await assert.rejects(startMail({ dataDir: d, domain: "zerofee.si", smtpPort: 0, httpPort: 0, host: "0.0.0.0" }), /needs --tls-key/);
    await assert.rejects(startMail({ dataDir: d, domain: "zerofee.si", smtpPort: 0, httpPort: 0, httpHost: "0.0.0.0" }), /needs --tls-key/);
    await assert.rejects(startMail({ dataDir: d, domain: "zerofee.si", smtpPort: 0, httpPort: 0, host: "0.0.0.0", key: "k", cert: "c", dkim: "off" }), /DKIM can't be off/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
