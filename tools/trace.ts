// The test flight recorder's reader (tools/trace.sh runs this; the app's side is apps/web/src/shell/flight.ts, the
// relay's apps/quotes/trace.mjs). The reader's secret key never leaves $ZEROFEE_HOME/trace-key and is never printed;
// the relay only ever holds what the app sealed to it.
//   init      once: the reader's X25519 key pair (reader.key, mode 600), the relay's read token (read-token, mode 600; it
//             goes to the quotes project as TRACE_READ_TOKEN), a fresh trace id, and build.env for the test builds
//             (VITE_TEST_TRACE=1, VITE_TEST_TRACE_KEY=<public key>, VITE_TEST_TRACE_ID=<id>)
//   tail      every second: what arrived since, one line per event
//   last [n]  the last n events (200 if not said)
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fromB64u, openBatch, readerKeys, b64u, TRACE_ID } from "../apps/web/src/shell/flight-seal.ts";

const DIR = process.env.TRACE_KEY_DIR ?? join(process.env.ZEROFEE_HOME ?? join(homedir(), ".config", "zerofee"), "trace-key");
const files = { key: join(DIR, "reader.key"), token: join(DIR, "read-token"), env: join(DIR, "build.env") };

type Event = { t: number; k: string; [f: string]: unknown };

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const clock = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};
const q = (s: unknown) => JSON.stringify(String(s ?? ""));

/** One event's line: `04:31:02.120 phone tap "Fund $5"`. */
export function lineOf(e: Event, src: string): string {
  const head = `${clock(Number(e.t))} ${src}`;
  switch (e.k) {
    case "tap":
      return `${head} tap ${q(e.l)}${e.dis ? " (disabled)" : ""}`;
    case "call": {
      const how = e.threw !== undefined ? `threw ${q(e.threw)}` : e.code !== undefined ? `problem ${e.code} ${q(e.what)}` : "ok";
      return `${head} call ${e.m} ${e.ms}ms ${how}`;
    }
    case "screen":
      return `${head} screen ${e.app}${e.view ? ` view ${q(e.view)}` : ""}${e.sheet ? ` sheet ${q(e.sheet)}` : ""}`;
    case "error":
      return `${head} error ${q(e.msg)}${e.at ? ` at ${e.at}` : ""}`;
    case "long":
      return `${head} long task ${e.ms}ms`;
    case "vis":
      return `${head} ${e.s}`;
    case "drop":
      return `${head} dropped ${e.n} events (the queue was full)`;
    case "start":
      return `${head} start`;
    default:
      return `${head} ${String(e.k)}`;
  }
}

/** A sealed batch's lines; one line saying so when it won't open. */
export function linesOf(box: string, secret: Uint8Array, id: string): string[] {
  const plain = openBatch(box, secret, id);
  if (plain === null) return ["?? a batch that won't open (another key or another trace)"];
  try {
    const b = JSON.parse(plain) as { src?: unknown; ev?: unknown };
    const src = b.src === "phone" || b.src === "laptop" ? b.src : "?";
    return (Array.isArray(b.ev) ? (b.ev as Event[]) : []).map((e) => lineOf(e, src));
  } catch {
    return ["?? a batch that isn't the recorder's"];
  }
}

function readEnv(): { id: string } {
  const env = readFileSync(files.env, "utf8");
  const id = env.match(/^VITE_TEST_TRACE_ID=([0-9a-f]{32})$/m)?.[1];
  if (!id) throw new Error(`no trace id in ${files.env}: run trace.sh init`);
  return { id };
}

function relay(): string {
  const raw = process.env.TRACE_RELAY ?? readFileSync(fileURLToPath(new URL("../apps/ios/relay-url.txt", import.meta.url)), "utf8");
  const base = raw.trim().replace(/\/$/, "");
  if (!/^https:\/\/[^/?#\s]+$/.test(base)) throw new Error("the relay must be an https origin (apps/ios/relay-url.txt or TRACE_RELAY)");
  return base;
}

function init(): void {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  chmodSync(DIR, 0o700);
  if (existsSync(files.key)) {
    console.log(`the reader key is already made: ${files.key} (kept; its build.env is ${files.env})`);
    return;
  }
  const { secret, publicKey } = readerKeys();
  writeFileSync(files.key, `${b64u(secret)}\n`, { mode: 0o600, flag: "wx" });
  secret.fill(0);
  if (!existsSync(files.token)) writeFileSync(files.token, randomBytes(32).toString("base64url"), { mode: 0o600, flag: "wx" });
  const id = randomBytes(16).toString("hex");
  writeFileSync(files.env, `VITE_TEST_TRACE=1\nVITE_TEST_TRACE_KEY=${publicKey}\nVITE_TEST_TRACE_ID=${id}\n`, { mode: 0o600 });
  for (const f of Object.values(files)) chmodSync(f, 0o600);
  console.log(`made: ${files.key} (secret, mode 600), ${files.token} (mode 600), ${files.env}`);
}

function secretKey(): Uint8Array {
  const k = fromB64u(readFileSync(files.key, "utf8").trim());
  if (!k || k.length !== 32) throw new Error(`${files.key} isn't a reader key`);
  return k;
}

async function page(base: string, id: string, token: string, from: number): Promise<{ from: number; next: number; items: string[] }> {
  const r = await fetch(`${base}/v0/trace/${id}?from=${from}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8_000) });
  if (r.status === 404) throw new Error("404: the relay has no trace route, or the read token isn't its TRACE_READ_TOKEN");
  if (!r.ok) throw new Error(`the relay answered ${r.status}`);
  const b = (await r.json()) as { from: number; next: number; items: string[] };
  if (!Number.isSafeInteger(b.next) || !Array.isArray(b.items)) throw new Error("the relay's answer isn't a trace page");
  return b;
}

const END = 999_999_999_999_999;

async function main(argv: string[]): Promise<void> {
  const [cmd = "", arg] = argv;
  if (cmd === "init") return init();
  if (cmd !== "tail" && cmd !== "last") {
    console.error("usage: trace.sh init | tail | last [n]");
    process.exit(2);
  }
  const { id } = readEnv();
  if (!TRACE_ID.test(id)) throw new Error("bad trace id");
  const secret = secretKey();
  const token = readFileSync(files.token, "utf8").trim();
  const base = relay();
  let at = (await page(base, id, token, END)).next;
  if (cmd === "last") {
    const want = Math.max(1, Math.min(5_000, Number(arg ?? 200) || 200));
    const lines: string[] = [];
    let from = Math.max(0, at - want);
    while (from < at) {
      const p = await page(base, id, token, from);
      for (const box of p.items) lines.push(...linesOf(box, secret, id));
      if (p.items.length === 0) break;
      from = p.next;
    }
    for (const l of lines.slice(-want)) console.log(l);
    return;
  }
  console.error(`tailing trace ${id.slice(0, 6)}… on ${base} (Ctrl-C to stop)`);
  for (;;) {
    try {
      for (;;) {
        const p = await page(base, id, token, at);
        for (const box of p.items) for (const l of linesOf(box, secret, id)) console.log(l);
        at = p.next;
        if (p.items.length < 200) break;
      }
    } catch (e) {
      console.error(`(${e instanceof Error ? e.message : String(e)})`);
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

if (import.meta.main) main(process.argv.slice(2)).catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
