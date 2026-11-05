// A-6 local notifications: fixed words per kind, never an amount, address, coin or name; nothing while ZeroFee is on
// screen; one per event. Each rule with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JOB_DONE_EVENT, emitJobDone, type JobDoneKind } from "@zerofee/agent/zero/engine";
import { JOB_DONE, JOB_WORDS, jobAlert, watchJobs } from "./job-alerts.ts";

const NOW = Date.parse("2026-11-03T08:00:00.000Z");
/** What a lock screen must never show: dollars, coin amounts, coins, addresses, NEAR names, a person. */
const PRIVATE = /\$|\d|\b(USD[CT]?|SOL|ETH|NEAR|BNB|BTC|WIF|BONK)\b|0x[0-9a-f]{6,}|[1-9A-HJ-NP-Za-km-z]{32,44}|\.(near|testnet)\b/i;

test("the words per kind, as QA wrote them, and none carries money, a coin, an address or a name", () => {
  assert.deepEqual(JOB_WORDS, {
    "trade-done": "AgentZero finished a trade. Open ZeroFee to see it.",
    "needs-you": "AgentZero needs you to look at something. Open ZeroFee.",
    "job-stopped": "AgentZero stopped a job. Open ZeroFee to see why.",
  });
  for (const kind of Object.keys(JOB_WORDS) as JobDoneKind[]) {
    const n = jobAlert({ kind }, false, NOW)!;
    assert.doesNotMatch(`${n.title} ${n.body}`, PRIVATE, kind);
    assert.equal(n.app, "agent");
    assert.equal(n.id, `job.${kind}`, "the same kind replaces its last one");
    assert.equal(n.atIso, "2026-11-03T08:00:03.000Z");
  }
  // controls: the check catches what the catalogue's own example would have shown
  for (const planted of ["AgentZero bought $5 of SOL.", "Sent 12.5 USDC", "Paid kim.near", "To 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"]) assert.match(planted, PRIVATE, planted);
});

test("nothing while ZeroFee is on screen, and nothing for a kind the engine didn't name", () => {
  assert.equal(jobAlert({ kind: "trade-done" }, true, NOW), null);
  for (const bad of [null, {}, { kind: "toString" }, { kind: "trade-done; bought $5" }, { kind: 5 }, "trade-done"]) assert.equal(jobAlert(bad, false, NOW), null, JSON.stringify(bad));
  // control
  assert.ok(jobAlert({ kind: "needs-you" }, false, NOW));
});

test("one notification per event: the engine's own event, while away; none on screen; none after stop", () => {
  const page = new EventTarget();
  const calls: { method: string; p: Record<string, unknown> }[] = [];
  const host = { call: async <T>(method: string, p?: Record<string, unknown>) => (calls.push({ method, p: p! }), { ok: {} as T }) };
  let away = true;
  const doc = new EventTarget();
  const stop = watchJobs(host, page as unknown as Window, () => !away, () => NOW, doc as unknown as Document);
  const fire = (kind: string) => page.dispatchEvent(new CustomEvent(JOB_DONE_EVENT, { detail: { kind } }));
  fire("trade-done");
  fire("job-stopped");
  away = false;
  fire("needs-you");
  doc.dispatchEvent(new Event("visibilitychange"));
  away = true;
  doc.dispatchEvent(new Event("visibilitychange"));
  stop();
  fire("trade-done");
  doc.dispatchEvent(new Event("visibilitychange"));
  assert.deepEqual(calls.map((c) => [c.method, c.p.id]), [
    ["device.notify.schedule", "job.trade-done"], ["device.notify.schedule", "job.job-stopped"],
    // back on screen: the three lines leave the lock screen (review L2); going away again cancels nothing
    ["device.notify.cancel", "job.trade-done"], ["device.notify.cancel", "job.needs-you"], ["device.notify.cancel", "job.job-stopped"],
  ]);
  assert.ok(Object.isFrozen(JOB_WORDS), "review L3: the words can't be changed at run time");
});

test("the event's name is the engine's own (control: a renamed event would fail here)", () => {
  assert.equal(JOB_DONE, JOB_DONE_EVENT);
  assert.notEqual("agentzero:job-finished", JOB_DONE_EVENT);
  assert.doesNotMatch(readFileSync(new URL("./job-alerts.ts", import.meta.url), "utf8"), /^import \{[^}]*JOB_DONE_EVENT/m, "only the type is imported: the engine never loads with it");
});

test("the engine's real event reaches it (the agent package's emitJobDone), and the shell starts it after the paint", () => {
  const calls: string[] = [];
  const host = { call: async <T>(_m: string, p?: Record<string, unknown>) => (calls.push(String(p?.body)), { ok: {} as T }) };
  // the page's window, as a browser has it (Node has no window events): the engine dispatches on globalThis
  const g = globalThis as unknown as Record<string, unknown>;
  const t = new EventTarget();
  Object.assign(g, { addEventListener: t.addEventListener.bind(t), removeEventListener: t.removeEventListener.bind(t), dispatchEvent: t.dispatchEvent.bind(t) });
  try {
    const stop = watchJobs(host, globalThis as unknown as Window, () => false, () => NOW, new EventTarget() as unknown as Document);
    emitJobDone("trade-done");
    stop();
    emitJobDone("trade-done");
  } finally {
    for (const k of ["addEventListener", "removeEventListener", "dispatchEvent"]) delete g[k];
  }
  assert.deepEqual(calls, ["AgentZero finished a trade. Open ZeroFee to see it."]);
  const appHost = readFileSync(new URL("../shell/AppHost.tsx", import.meta.url), "utf8");
  assert.match(appHost, /import\("\.\.\/host\/job-alerts\.ts"\)\.then\(\(m\) => \{ stopJobs = m\.watchJobs\(host\); if \(gone\) stopJobs\(\); \}\)/, "a screen gone before the code came never listens (the walk heard two)");
  assert.doesNotMatch(appHost, /^import [^;]*job-alerts/m, "never in the first load");
});
