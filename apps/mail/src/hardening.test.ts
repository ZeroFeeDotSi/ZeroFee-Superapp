// Round 2 review of the receiver (2 Nov): memory, lock-out, per-mail memory, code blocking, id order, proof variants,
// bare LF, IPv6 /64 keys, and the protocol edges (STARTTLS injection, a split ".", pipelining, a long line). On
// 127.0.0.1 only. These use only the receiver's public seams (startMail, smtp.handle, the store), so the same file runs
// against the code before the fixes, where each of the first eight fails.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { mailKeys, openMail, signRegister, signRequest } from "@zerofee/agent/mail/keys";
import { startMail, type Running, type StartOptions } from "./start.ts";
import { makeTestTls } from "./testing-tls.ts";

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;

const A = mailKeys(new Uint8Array(64).fill(5));
const HOST = "mail.zerofee.si";

const withMail = async (o: Partial<StartOptions>, fn: (m: Running, base: string) => Promise<void>) => {
  const d = mkdtempSync(join(tmpdir(), "zf-mail-h-"));
  const m = await startMail({ dataDir: d, domain: "zerofee.si", smtpPort: 0, httpPort: 0, dkim: "off", ...o });
  try {
    const base = `http://127.0.0.1:${m.httpPort}/v0/mail`;
    const reg = signRegister(A, "lena.river");
    m.store.register("lena.river", { publicKey: reg.publicKey, signingKey: reg.proof.signingKey, at: 1 });
    await fn(m, base);
  } finally {
    await m.close();
    rmSync(d, { recursive: true, force: true });
  }
};

/** A local door: each connection is handed to the receiver as if from `remote`; `last` is the newest server-side socket. */
async function door(m: Running, remote: string) {
  const state: { last: net.Socket | null; count: number } = { last: null, count: 0 };
  const all = new Set<net.Socket>();
  const d = net.createServer((s) => {
    state.last = s;
    state.count++;
    all.add(s);
    m.smtp.handle(s, remote);
  });
  await new Promise<void>((r) => d.listen(0, "127.0.0.1", () => r()));
  const close = () =>
    new Promise<void>((r) => {
      for (const s of all) s.destroy();
      d.close(() => r());
    });
  return { port: (d.address() as net.AddressInfo).port, state, close };
}

/** A small SMTP client over any duplex socket. */
function client(sock: net.Socket | tls.TLSSocket) {
  let buf = "";
  const waiting: ((reply: string) => void)[] = [];
  const closed = new Promise<void>((r) => sock.once("close", () => r()));
  sock.on("error", () => {});
  sock.on("data", (d: Buffer) => {
    buf += d.toString("latin1");
    for (;;) {
      const m = /^(?:\d{3}-[^\n]*\n)*\d{3} [^\n]*\n/.exec(buf);
      if (!m) break;
      buf = buf.slice(m[0].length);
      waiting.shift()?.(m[0]);
    }
  });
  const next = () => new Promise<string>((r) => waiting.push(r));
  return {
    sock,
    closed,
    next,
    cmd(line: string) {
      const p = next();
      sock.write(`${line}\r\n`);
      return p;
    },
    raw(bytes: string) {
      sock.write(bytes);
    },
  };
}

const connect = async (port: number) => {
  const sock = net.connect(port, "127.0.0.1");
  const c = client(sock);
  const greeting = await c.next();
  return { ...c, greeting };
};

const opened = async (base: string) => {
  const r = await fetch(`${base}/lena.river`, { headers: { "x-mail-proof": signRequest(A, { method: "read", host: HOST, mailbox: "lena.river" }) } });
  const { messages } = (await r.json()) as { messages: { id: string; sealed: string }[] };
  return messages.map((m) => openMail(A.boxSecret, m.sealed));
};

test("1. a client that sends 50k EHLOs and never reads: the server's buffers for it stay bounded and it is closed", async () => {
  await withMail({ smtpLimits: { idleMs: 400 } }, async (m) => {
    const d = await door(m, "198.51.100.1");
    try {
      const sock = net.connect(d.port, "127.0.0.1");
      sock.on("error", () => {});
      sock.pause(); // never reads a reply
      await new Promise<void>((r) => sock.once("connect", () => r()));
      while (!d.state.last) await new Promise((r) => setTimeout(r, 5));
      const server = d.state.last;
      const closed = new Promise<void>((r) => (server.destroyed ? r() : server.once("close", () => r())));
      const burst = "EHLO a\r\n".repeat(50_000);
      sock.write(burst);
      let peak = 0;
      const t = setInterval(() => {
        const s = d.state.last;
        if (s) peak = Math.max(peak, s.writableLength);
      }, 5);
      await closed;
      clearInterval(t);
      sock.destroy();
      assert.ok(peak < 512 * 1024, `the server held ${peak} bytes of unread replies`);
    } finally {
      await d.close();
    }
  });
});

test("2. 300 rapid connections from one address don't lock out another address", async () => {
  await withMail({}, async (m) => {
    const flood = await door(m, "198.51.100.2");
    const other = await door(m, "203.0.113.2");
    const socks: net.Socket[] = [];
    try {
      // In waves of 50, each handed to the receiver before the next (the listen backlog would drop a single burst).
      // allowHalfOpen: the flooder never closes its side when the server hangs up, as an attacker wouldn't.
      for (let wave = 0; wave < 6; wave++) {
        for (let i = 0; i < 50; i++) {
          const s = net.connect({ port: flood.port, host: "127.0.0.1", allowHalfOpen: true });
          s.on("error", () => {});
          socks.push(s);
        }
        while (flood.state.count < socks.length) await new Promise((r) => setTimeout(r, 2));
      }
      const c = await connect(other.port);
      assert.match(c.greeting, /^220 /);
      c.sock.destroy();
    } finally {
      for (const s of socks) s.destroy();
      await flood.close();
      await other.close();
    }
  });
});

test("3. 256 KB of empty lines in DATA stays under 2 MB of heap growth", async () => {
  await withMail({}, async (m) => {
    const d = await door(m, "198.51.100.3");
    try {
      const c = await connect(d.port);
      await c.cmd("EHLO a");
      await c.cmd("MAIL FROM:<x@example.com>");
      assert.match(await c.cmd("RCPT TO:<lena.river@zerofee.si>"), /^250/);
      assert.match(await c.cmd("DATA"), /^354/);
      gc();
      const before = process.memoryUsage().heapUsed;
      const payload = "\r\n".repeat(128 * 1024 - 8);
      const want = d.state.last!.bytesRead;
      c.raw(payload);
      while (d.state.last!.bytesRead < want + payload.length) await new Promise((r) => setTimeout(r, 5));
      await new Promise((r) => setTimeout(r, 20));
      gc();
      const growth = process.memoryUsage().heapUsed - before;
      assert.ok(growth < 2 * 1024 * 1024, `heap grew ${growth} bytes`);
      assert.match(await (async () => (c.raw(".\r\n"), c.next()))(), /^250/);
      c.sock.destroy();
    } finally {
      await d.close();
    }
  });
});

/** RCPT for lena.river and then RSET, `n` times: no mail is ever sent. */
async function rcptOnly(port: number, n: number) {
  const c = await connect(port);
  await c.cmd("EHLO a");
  for (let i = 0; i < n; i++) {
    await c.cmd("MAIL FROM:<x@example.com>");
    await c.cmd("RCPT TO:<lena.river@zerofee.si>");
    await c.cmd("RSET");
  }
  c.sock.destroy();
}

test("4. three addresses sending RCPT-only for lena.river don't stop a real mail from a fourth", async () => {
  await withMail({}, async (m, base) => {
    const doors = await Promise.all(["198.51.100.41", "198.51.100.42", "198.51.100.43", "203.0.113.44"].map((a) => door(m, a)));
    try {
      for (const d of doors.slice(0, 3)) await rcptOnly(d.port, 40);
      const c = await connect(doors[3]!.port);
      await c.cmd("EHLO real.sender");
      await c.cmd("MAIL FROM:<no-reply@privy.io>");
      assert.match(await c.cmd("RCPT TO:<lena.river@zerofee.si>"), /^250/);
      await c.cmd("DATA");
      c.raw("Subject: Your code\r\n\r\nYour login code is 482913\r\n.\r\n");
      assert.match(await c.next(), /^250/);
      c.sock.destroy();
      assert.equal((await opened(base)).length, 1);
    } finally {
      for (const d of doors) await d.close();
    }
  });
});

test("5. a mail that started first but is stored last is still listed after a read that saw the other", async () => {
  await withMail({}, async (m) => {
    const y = m.store.put("lena.river", "sealed-y", 2_000);
    const seen = m.store.list("lena.river").messages.map((x) => x.id);
    assert.deepEqual(seen, [y]);
    const x = m.store.put("lena.river", "sealed-x", 1_000); // arrived (and was stamped) earlier, written later
    assert.deepEqual(m.store.list("lena.river", y).messages.map((s) => s.id), [x]);
  });
});

test("6. a base64url variant of a used proof (same signature bytes) is a replay: 401", async () => {
  await withMail({}, async (_m, base) => {
    const proof = signRequest(A, { method: "read", host: HOST, mailbox: "lena.river" });
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const last = proof.at(-1)!;
    const variant = proof.slice(0, -1) + alphabet[alphabet.indexOf(last) ^ 1];
    assert.notEqual(variant, proof);
    const status = (p: string) => fetch(`${base}/lena.river`, { headers: { "x-mail-proof": p } }).then((r) => r.status);
    assert.equal(await status(proof), 200);
    assert.equal(await status(variant), 401);
  });
});

test("7. a bare LF never ends DATA: only CRLF.CRLF does", async () => {
  await withMail({}, async (m, base) => {
    const d = await door(m, "198.51.100.7");
    try {
      const c = await connect(d.port);
      await c.cmd("EHLO a");
      await c.cmd("MAIL FROM:<x@example.com>");
      await c.cmd("RCPT TO:<lena.river@zerofee.si>");
      await c.cmd("DATA");
      c.raw("Subject: lf\r\n\r\nfirst\n.\nsecond\r\n.\r\n");
      assert.match(await c.next(), /^250/);
      c.sock.destroy();
      const mails = await opened(base);
      assert.equal(mails.length, 1);
      assert.match(mails[0]!.text, /first/);
      assert.match(mails[0]!.text, /second/);
    } finally {
      await d.close();
    }
  });
});

test("8. IPv6 senders are limited by their /64: two addresses in one /64 share the connection cap", async () => {
  await withMail({ smtpLimits: { perIpConnections: 2 } }, async (m) => {
    const a = await door(m, "2001:db8:1:2::1");
    const b = await door(m, "2001:db8:1:2:ffff:ffff:ffff:fffe");
    const c = await door(m, "2001:db8:1:3::1");
    try {
      const one = await connect(a.port);
      const two = await connect(a.port);
      const three = await connect(b.port);
      assert.match(three.greeting, /^421 /);
      const four = await connect(c.port);
      assert.match(four.greeting, /^220 /, "another /64 is not affected");
      for (const x of [one, two, three, four]) x.sock.destroy();
    } finally {
      await a.close();
      await b.close();
      await c.close();
    }
  });
});

test("9a. STARTTLS injection: a MAIL sent in the same packet as STARTTLS is thrown away", async (t) => {
  const pair = makeTestTls();
  if ("skip" in pair) return t.skip(pair.skip);
  t.after(() => pair.remove());
  await withMail({ key: pair.key, cert: pair.cert }, async (m) => {
    const c = await connect(m.smtpPort);
    assert.match(await c.cmd("EHLO a"), /STARTTLS/);
    c.raw("STARTTLS\r\nMAIL FROM:<injected@example.com>\r\n");
    assert.match(await c.next(), /^220 /);
    c.sock.removeAllListeners("data");
    const t = tls.connect({ socket: c.sock, rejectUnauthorized: false });
    await new Promise<void>((r) => t.once("secureConnect", () => r()));
    const s = client(t);
    const ehlo = await s.cmd("EHLO a");
    assert.ok(!/STARTTLS/.test(ehlo));
    // Had the injected MAIL counted, this RCPT would pass (or MAIL would answer "sender already given").
    assert.match(await s.cmd("RCPT TO:<lena.river@zerofee.si>"), /^503 /);
    assert.match(await s.cmd("MAIL FROM:<real@example.com>"), /^250 /);
    t.destroy();
  });
});

test("9b. a '.' line split across packets, pipelined commands, and long command lines", async () => {
  await withMail({}, async (m, base) => {
    const c = await connect(m.smtpPort);
    // Pipelined: four commands in one write, four replies in order.
    const replies = [c.next(), c.next(), c.next(), c.next()];
    c.raw("EHLO a\r\nMAIL FROM:<x@example.com>\r\nRCPT TO:<lena.river@zerofee.si>\r\nDATA\r\n");
    const [r1, r2, r3, r4] = await Promise.all(replies);
    assert.match(r1!, /^250/);
    assert.match(r2!, /^250/);
    assert.match(r3!, /^250/);
    assert.match(r4!, /^354/);
    c.raw("Subject: split\r\n\r\nbody\r\n.");
    await new Promise((r) => setTimeout(r, 30));
    c.raw("\r\n");
    assert.match(await c.next(), /^250/);
    assert.equal((await opened(base)).length, 1);
    // A long command line, with or without its end: 500 and closed.
    c.raw(`NOOP ${"x".repeat(3000)}\r\n`);
    assert.match(await c.next(), /^500 /);
    await c.closed;
    const d = await connect(m.smtpPort);
    d.raw(`EHLO ${"y".repeat(10_000)}`);
    assert.match(await d.next(), /^500 /);
    await d.closed;
  });
});
