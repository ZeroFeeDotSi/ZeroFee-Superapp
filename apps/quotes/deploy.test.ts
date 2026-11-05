// The relay's deploy (deploy.sh) reads the project's environment by NAME only: run with --check against a stand-in
// `vercel` (it lists names; anything else it prints stands in for what must never be repeated), nothing is deployed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createRelay } from "./relay.mjs";
import { memoryCounter, privateCounter } from "./guards.mjs";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./deploy.sh", import.meta.url));
const SENTINEL = "value-that-must-never-be-printed";

function check(names: string[]): { status: number | null; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "zf-deploy-"));
  try {
    mkdirSync(join(dir, "quotes", ".vercel"), { recursive: true });
    writeFileSync(join(dir, "quotes", ".vercel", "project.json"), "{}");
    mkdirSync(join(dir, "bin"));
    const rows = names.map((n) => `  ${n}    Encrypted ${SENTINEL}    Production    1d ago`).join("\\n");
    writeFileSync(join(dir, "bin", "vercel"), `#!/bin/sh\n[ "$1 $2 $3" = "env ls production" ] && printf '${rows}\\n' && exit 0\necho "stand-in vercel: $*" >&2; exit 9\n`);
    chmodSync(join(dir, "bin", "vercel"), 0o755);
    const r = spawnSync("bash", [script, "--check"], { env: { ...process.env, QUOTES: join(dir, "quotes"), PATH: `${join(dir, "bin")}:${process.env.PATH}` }, encoding: "utf8" });
    return { status: r.status, out: r.stdout + r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const RELAY = ["ONECLICK_JWT", "STATUS_TAG_SECRET", "HELIUS_API_KEY_RELAY"];
const MARKET = ["GECKOTERMINAL_API_KEY", "COINGECKO_API_KEY"];
const ALERTS = ["ALERTS_PUBLIC_URL", "CRON_SECRET", "RESEND_API_KEY", "ALERTS_FROM", "ALERTS_REDIS_URL", "ALERTS_REDIS_TOKEN"];

test("deploy.sh stops without the relay's own keys, with one add line each, and never prints a value", () => {
  const r = check(["ONECLICK_JWT"]);
  assert.equal(r.status, 1);
  assert.match(r.out, /STOP: the relay's own keys missing on the quotes project: STATUS_TAG_SECRET\./);
  assert.match(r.out, /vercel env add STATUS_TAG_SECRET production/);
  assert.ok(!r.out.includes(SENTINEL));
});

test("deploy.sh goes on without the relay's own Helius key: the Solana send stays off (503), with the add line for later", () => {
  const r = check(["ONECLICK_JWT", "STATUS_TAG_SECRET", ...MARKET]);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /No HELIUS_API_KEY_RELAY: the relay's Solana send stays off \(503\)/);
  assert.match(r.out, /vercel env add HELIUS_API_KEY_RELAY production/);
  assert.ok(!r.out.includes(SENTINEL));
});

test("deploy.sh --check: alerts off with exactly what's missing; on with all of them (Vercel KV counts as the Redis); the swap's key flagged", () => {
  const off = check([...RELAY, ...MARKET, "ALERTS_PUBLIC_URL", "HELIUS_API_KEY"]);
  assert.equal(off.status, 0, off.out);
  assert.match(off.out, /alerts: OFF \(the app says so\); missing: RESEND_API_KEY ALERTS_FROM ALERTS_REDIS_URL ALERTS_REDIS_TOKEN CRON_SECRET/);
  assert.match(off.out, /vercel env add RESEND_API_KEY production/);
  assert.match(off.out, /REMOVE: the quotes project still has HELIUS_API_KEY/);
  assert.match(off.out, /check only: nothing deployed, nothing changed/);
  const on = check([...RELAY, ...MARKET, ...ALERTS.filter((n) => !n.startsWith("ALERTS_REDIS")), "KV_REST_API_URL", "KV_REST_API_TOKEN"]);
  assert.equal(on.status, 0, on.out);
  // QA (3 Nov): with everything set, alerts still stay off on the shared Redis
  assert.match(on.out, /alerts: OFF on the shared Redis/);
  assert.match(on.out, /503 alerts\.store-shared/);
  assert.doesNotMatch(on.out, /REMOVE/);
  const noMarket = check([...RELAY]);
  assert.match(noMarket.out, /market: GECKOTERMINAL_API_KEY isn't set, so the market routes will answer 503/);
  for (const r of [off, on, noMarket]) assert.ok(!r.out.includes(SENTINEL), "a value was printed");
});

const AZ_READING = ["ANTHROPIC_API_KEY", "AGENTZERO_TOKEN_SECRET", "KV_REST_API_URL", "KV_REST_API_TOKEN"];

test("deploy.sh --check: AgentZero's names (D152): reading and per-reply payment each say on or off, with the line that adds what's missing; the retired credit's admin secret is flagged to remove", () => {
  const none = check([...RELAY, ...MARKET]);
  assert.equal(none.status, 0, none.out);
  assert.match(none.out, /agentzero: reading and per-reply payment OFF; missing: ANTHROPIC_API_KEY AGENTZERO_TOKEN_SECRET a Redis/);
  assert.match(none.out, /openssl rand -base64 32 \| \(cd .* && vercel env add AGENTZERO_TOKEN_SECRET production\)/);
  assert.match(none.out, /vercel env add ANTHROPIC_API_KEY production/);
  const reading = check([...RELAY, ...MARKET, ...AZ_READING]);
  assert.match(reading.out, /agentzero: per-reply payment OFF \(no AGENTZERO_RECEIVE_ACCOUNT\)/);
  assert.match(reading.out, /vercel env add AGENTZERO_RECEIVE_ACCOUNT production/);
  // QA (3 Nov): no AGENTZERO_STORE_KEY, no paid mode, and the line that makes it
  const noKey = check([...RELAY, ...MARKET, ...AZ_READING, "AGENTZERO_RECEIVE_ACCOUNT"]);
  assert.match(noKey.out, /agentzero: per-reply payment OFF \(no AGENTZERO_STORE_KEY/);
  assert.match(noKey.out, /openssl rand -base64 32 \| \(cd .* && vercel env add AGENTZERO_STORE_KEY production\)/);
  const pay = check([...RELAY, ...MARKET, ...AZ_READING, "AGENTZERO_RECEIVE_ACCOUNT", "AGENTZERO_STORE_KEY"]);
  assert.match(pay.out, /agentzero: per-reply payment ON/);
  assert.match(pay.out, /paid replies' daily ceiling \$200 \(AGENTZERO_PAID_DAILY_USD unset\)/);
  assert.doesNotMatch(pay.out, /AGENTZERO_ADMIN_SECRET/, "no admin secret is asked for any more");
  const all = check([...RELAY, ...MARKET, ...AZ_READING, "AGENTZERO_RECEIVE_ACCOUNT", "AGENTZERO_STORE_KEY", "AGENTZERO_ADMIN_SECRET", "AGENTZERO_PAID_DAILY_USD"]);
  assert.match(all.out, /REMOVE AGENTZERO_ADMIN_SECRET/);
  assert.match(all.out, /daily ceiling from AGENTZERO_PAID_DAILY_USD/);
  for (const r of [none, reading, noKey, pay, all]) assert.ok(!r.out.includes(SENTINEL), "a value was printed");
});

/** A relay on this machine's loopback (the no-network guard leaves it open), with or without per-reply payment; `paths`: each
 *  path it was asked, so a test can see the check never signs up. */
async function liveRelay(o: { pay: boolean; receive?: string }) {
  const relay = createRelay({
    key: "k", secret: "s", origins: ["zerofee-app://app"], anthropicKey: "sk-ant-deploy-check-0000", agentZeroSecret: "token-secret",
    counter: privateCounter({ ...memoryCounter(), shared: true }, "deploy-check-store-key-0123456789abcdef"),
    ...(o.pay ? { agentZeroReceive: o.receive ?? "37764cf3c4418f8b0a963768bcaa1ddddc201cad32c040db2dfc919936465822" } : {}),
  });
  const paths: string[] = [];
  const server = createServer(async (req, res) => {
    paths.push(String(req.url));
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const r = await relay(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }), "127.0.0.1");
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  return { base: `http://127.0.0.1:${(server.address() as { port: number }).port}`, paths, close: () => new Promise<void>((ok) => server.close(() => ok())) };
}
const liveCheck = (base: string, pay: string, token = "") =>
  new Promise<{ code: number; out: string }>((ok) =>
    execFile("bash", [fileURLToPath(new URL("./deploy-check-agentzero.sh", import.meta.url)), base, pay], { env: { ...process.env, TRIES: "1", WAIT: "0", AGENTZERO_CHECK_TOKEN: token } }, (e, stdout, stderr) => ok({ code: e ? Number((e as { code?: number }).code ?? 1) : 0, out: stdout + stderr })),
  );

test("deploy-check-agentzero.sh (D152): pay on, a pay with no sign-up is 401 (and a junk pay with the check's token 400); off, it is the 404 it was; a relay that doesn't match the names fails the deploy; it never signs up", async () => {
  const on = await liveRelay({ pay: true });
  const off = await liveRelay({ pay: false });
  const mismatch = await liveRelay({ pay: true, receive: "00".repeat(32) });
  try {
    const a = await liveCheck(on.base, "on");
    assert.equal(a.code, 0, a.out);
    assert.match(a.out, /ok {2}pay without a sign-up: 401 agentzero\.signup\.needed/);
    assert.match(a.out, /skip pay with a junk body: no AGENTZERO_CHECK_TOKEN/);
    assert.match(a.out, /agentzero: per-reply payment on/);
    // an existing sign-up's token (made here, once, outside the check): the junk pay is 400, the token never printed
    const r = await fetch(`${on.base}/v0/agentzero/signup`, { method: "POST", headers: { origin: "zerofee-app://app", "content-type": "application/json" }, body: "{}" });
    const token = String(((await r.json()) as { token?: string }).token ?? "");
    assert.match(token, /^az1\./);
    on.paths.length = 0;
    const t = await liveCheck(on.base, "on", token);
    assert.equal(t.code, 0, t.out);
    assert.match(t.out, /ok {2}pay without a sign-up: 401 agentzero\.signup\.needed/);
    assert.match(t.out, /ok {2}pay with a junk body: 400 quotes\.request\.refused/);
    assert.ok(!t.out.includes(token) && !/az1\./.test(t.out), "the check's token is never printed");
    // a token this relay's secret didn't sign (another relay's, or a changed AGENTZERO_TOKEN_SECRET) fails the deploy
    const forged = await liveCheck(on.base, "on", `${token.slice(0, -2)}xx`);
    assert.equal(forged.code, 1, forged.out);
    assert.match(forged.out, /FAIL pay with a junk body: 401 agentzero\.signup\.needed/);
    assert.ok(!/az1\./.test(forged.out), "a refused token is never printed either");
    const b = await liveCheck(off.base, "off");
    assert.equal(b.code, 0, b.out);
    assert.match(b.out, /ok {2}pay, payment off: 404 quotes\.route\.unknown/);
    const wrong = await liveCheck(off.base, "on");
    assert.equal(wrong.code, 1, "payment named on but the live relay has it off");
    assert.match(wrong.out, /FAIL pay without a sign-up: 404 quotes\.route\.unknown/);
    const wrong2 = await liveCheck(on.base, "off");
    assert.equal(wrong2.code, 1, "payment named off but live");
    assert.match(wrong2.out, /FAIL pay, payment off/);
    // SR3 L13: a receiving account that isn't the pinned one
    const m = await liveCheck(mismatch.base, "on", token);
    assert.equal(m.code, 1, m.out);
    assert.match(m.out, /FAIL pay without a sign-up: 503 agentzero\.pay\.receive-mismatch/);
    // 5 Nov: the check spends none of the address's sign-ups
    for (const s of [on, off, mismatch]) assert.ok(!s.paths.some((p) => p.includes("signup")), `the check signed up: ${s.paths.join(" ")}`);
    assert.ok(on.paths.every((p) => p === "/v0/agentzero/pay"), on.paths.join(" "));
  } finally {
    await on.close();
    await off.close();
    await mismatch.close();
  }
});

test("deploy.sh --check says whether the Sim's AgentZero (D157, D158) is on: it needs Anthropic's key, a Redis and AGENTZERO_STORE_KEY; its days are AGENTZERO_SIM_PER_IP_USD and AGENTZERO_SIM_DAILY_USD", () => {
  const off = check([...RELAY, ...MARKET, ...AZ_READING]);
  assert.match(off.out, /agentzero sim: OFF \(needs ANTHROPIC_API_KEY, a Redis and AGENTZERO_STORE_KEY\)/);
  const on = check([...RELAY, ...MARKET, ...AZ_READING, "AGENTZERO_STORE_KEY"]);
  assert.match(on.out, /agentzero sim: ON \(Sonnet 5\.5; \$0\.90 a visitor a day, AGENTZERO_SIM_PER_IP_USD unset; relay-wide day \$2, AGENTZERO_SIM_DAILY_USD unset\)/);
  const set = check([...RELAY, ...MARKET, ...AZ_READING, "AGENTZERO_STORE_KEY", "AGENTZERO_SIM_DAILY_USD", "AGENTZERO_SIM_PER_IP_USD"]);
  assert.match(set.out, /agentzero sim: ON \(Sonnet 5\.5; a visitor's day from AGENTZERO_SIM_PER_IP_USD, under \$1; relay-wide day from AGENTZERO_SIM_DAILY_USD\)/);
  assert.ok(!set.out.includes(SENTINEL));
  // the relay entry passes both days on
  const entry = readFileSync(new URL("./api/relay.mjs", import.meta.url), "utf8");
  assert.match(entry, /agentZeroSimDailyUsd: env\.AGENTZERO_SIM_DAILY_USD,/);
  assert.match(entry, /agentZeroSimPerIpUsd: env\.AGENTZERO_SIM_PER_IP_USD,/);
});
