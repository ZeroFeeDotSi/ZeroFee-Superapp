// AgentZero's own browser (BR1–BR3) with a fake cloud browser: the task check, Take over / Hand back, the lines, Stop,
// and the flag that keeps all of it hidden until the operator's Browser Use key exists. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AGENT_BROWSER, LIVE_ORIGINS, NEVER_HERE, liveFrameUrl, liveLine, liveSession, liveStep, readTask, touchable, type CloudBrowser, type CloudEvent, type Live, type NeedsYou } from "./live.ts";

function fakeCloud(o: { failStart?: boolean } = {}) {
  const calls: string[] = [];
  let emit: ((e: CloudEvent) => void) | null = null;
  const cloud: CloudBrowser = {
    async start(task, url) {
      calls.push(`start ${task} ${url ?? "-"}`);
      if (o.failStart) throw new Error("down");
      return { id: "s1", liveUrl: "https://live.example/secret-token" };
    },
    async setInteractive(id, on) {
      calls.push(`interactive ${id} ${on}`);
    },
    async stop(id) {
      calls.push(`stop ${id}`);
    },
    events(_id, on) {
      emit = on;
      return () => {
        emit = null;
        calls.push("unsubscribed");
      };
    },
  };
  return { cloud, calls, emit: (e: CloudEvent) => emit?.(e) };
}

test("the flag is off: nothing of AgentZero's browser shows until the operator's Browser Use key exists; the Browser tab loads it only behind the flag", () => {
  assert.equal(AGENT_BROWSER, false);
  const app = readFileSync(new URL("../app/BrowserApp.tsx", import.meta.url), "utf8");
  // BrowserApp's own copy of the flag (folded away by the bundler) equals agent/flag.ts's
  // both read the same build switch (VITE_AGENT_BROWSER=1), off when unset (node: no import.meta.env)
  const expr = '(import.meta.env?.VITE_AGENT_BROWSER === "1")';
  assert.ok(app.includes(`const AGENT_BROWSER = ${expr} as boolean;`), "BrowserApp reads the same switch");
  // E2 (audit 14): the one flag lives in shell-api, read by the chat (its "browse" tool) and re-exported here
  assert.ok(readFileSync(new URL("../../../shell-api/src/agent-browser.ts", import.meta.url), "utf8").includes(`export const AGENT_BROWSER: boolean = import.meta.env?.VITE_AGENT_BROWSER === "1";`), "shell-api's one flag reads the same switch");
  assert.match(readFileSync(new URL("./flag.ts", import.meta.url), "utf8"), /export \{ AGENT_BROWSER \} from "@zerofee\/shell-api\/agent-browser\.ts";/, "flag.ts is that flag");
  assert.match(readFileSync(new URL("../../../agent/src/chat/use-chat-turn.ts", import.meta.url), "utf8"), /import \{ AGENT_BROWSER \} from "@zerofee\/shell-api\/agent-browser\.ts";/, "the chat reads that flag");
  // the live view is a lazy import, and the only way in is guarded by the flag
  assert.match(app, /AGENT_BROWSER && \(/);
  assert.match(app, /lazy\(\(\) => import\("\.\/LiveView\.tsx"\)\)/);
  assert.doesNotMatch(app, /^import .*LiveView/m, "never in the Browser tab's first load");
});

test("BR1, the task: a site's https address with its host shown plainly; http, junk, money, sign-ups and secrets refused by name", () => {
  assert.deepEqual(readTask("Sign in to axiom.trade"), { ok: true, task: "Sign in to axiom.trade", url: "https://axiom.trade/", host: "axiom.trade" });
  assert.deepEqual(readTask("  check https://gmgn.ai/sol my trades "), { ok: true, task: "check https://gmgn.ai/sol my trades", url: "https://gmgn.ai/sol", host: "gmgn.ai" });
  assert.deepEqual(readTask("Read my newest email"), { ok: true, task: "Read my newest email", url: null, host: null }, "control: no site named");
  assert.deepEqual(readTask("open http://pump.fun"), { ok: false, line: "AgentZero opens https sites only." });
  assert.deepEqual(readTask(""), { ok: false, line: "Say what AgentZero should do." });
  assert.deepEqual(readTask(42), { ok: false, line: "Say what AgentZero should do." });
  for (const t of ["Buy BONK on pump.fun", "pay the invoice on stripe.com", "swap my SOL", "send $5 to kim"]) assert.deepEqual(readTask(t), { ok: false, line: NEVER_HERE }, t);
  for (const t of ["Sign up for Axiom", "create an account on gmgn.ai", "register me on x.com"]) assert.equal((readTask(t) as { line: string }).line, "You make the account yourself. Send AgentZero once it's made.", t);
  for (const t of ["log in with password hunter2", "pay with 4242 4242 4242 4242", "my pin is 1234"]) assert.match((readTask(t) as { line: string }).line, /Don't type a password or card number here/, t);
});

test("BR2/BR3, the live view: AgentZero acts read-only; Take over gives the person the wheel and AgentZero waits (its events wait too); Hand back returns it", () => {
  let s: Live = { phase: "idle" };
  s = liveStep(s, { type: "start", host: "axiom.trade" });
  assert.equal(liveLine(s), "AgentZero is opening axiom.trade.");
  s = liveStep(s, { type: "event", e: { kind: "at", host: "axiom.trade" } });
  assert.equal(liveLine(s), "AgentZero is on axiom.trade.");
  assert.equal(touchable(s), false, "read-only while AgentZero acts");
  s = liveStep(s, { type: "take-over" });
  assert.equal(liveLine(s), "You have the wheel. AgentZero waits.");
  assert.equal(touchable(s), true);
  const paused = liveStep(s, { type: "event", e: { kind: "at", host: "evil.example" } });
  assert.equal(paused, s, "AgentZero is paused on the person's turn");
  s = liveStep(s, { type: "hand-back" });
  assert.deepEqual(s, { phase: "agent", host: "axiom.trade" });
  assert.equal(liveStep(s, { type: "hand-back" }), s, "control: Hand back only on the person's turn");
});

test("BR3, the hand-over lines: each need names the site and the one thing to do; a money step is never AgentZero's", () => {
  const you = (why: NeedsYou) => liveLine(liveStep({ phase: "agent", host: "axiom.trade" }, { type: "event", e: { kind: "needs-you", why, host: "axiom.trade" } }));
  assert.equal(you("sign-in"), "AgentZero can't sign in for you here. Sign in, then tap Hand back.");
  assert.equal(you("person-check"), "axiom.trade wants to check you're a person. Tap the box.");
  assert.equal(you("code"), "axiom.trade sent a code. Type it.");
  assert.equal(you("terms"), "axiom.trade wants you to agree to its rules. Read, then tap Agree.");
  assert.equal(you("create-account"), "Make an account on axiom.trade? Tap Create. AgentZero waits.");
  // audit 17's H9: what to tap next (no figure on the page: "there")
  assert.equal(you("money"), "axiom.trade asks for money. AgentZero never pays. Tap Watch to pay there yourself, or Stop.");
  assert.equal(liveLine(liveStep({ phase: "agent", host: "axiom.trade" }, { type: "event", e: { kind: "done", host: "axiom.trade" } })), "AgentZero is done on axiom.trade.");
  // audit 17's H7: a Stop says what was and wasn't done
  assert.equal(liveLine(liveStep({ phase: "agent", host: "axiom.trade" }, { type: "stop" })), "Stopped. AgentZero read the page. It did nothing else.");
  assert.equal(liveLine(liveStep({ phase: "starting", host: null }, { type: "event", e: { kind: "failed", host: null } })), "The page didn't open. Nothing was sent.");
});

test("a session over the cloud browser: touchable exactly on the person's turn; Stop ends it and stops the cloud browser; the live URL goes only to the view", async () => {
  const f = fakeCloud();
  const states: Live[] = [];
  const urls: string[] = [];
  const s = liveSession(f.cloud, (x) => states.push(x), (u) => urls.push(u));
  await s.start("Sign in to axiom.trade", "https://axiom.trade/", "axiom.trade");
  assert.deepEqual(urls, ["https://live.example/secret-token"]);
  f.emit({ kind: "at", host: "axiom.trade" });
  s.takeOver();
  f.emit({ kind: "needs-you", why: "code", host: "axiom.trade" });
  assert.equal(liveLine(s.state()), "You have the wheel. AgentZero waits.", "its events wait on the person's turn");
  s.handBack();
  s.stop();
  assert.equal(liveLine(s.state()), "Stopped. AgentZero read the page. It did nothing else.");
  assert.deepEqual(f.calls, ["start Sign in to axiom.trade https://axiom.trade/", "interactive s1 true", "interactive s1 false", "unsubscribed", "stop s1"]);
  assert.ok(!states.some((x) => JSON.stringify(x).includes("secret-token")), "the live URL is never in a state");
  // the browser didn't start: said by name, nothing else
  const down = fakeCloud({ failStart: true });
  const d = liveSession(down.cloud, () => undefined, () => assert.fail("no live URL"));
  await d.start("Sign in to axiom.trade", "https://axiom.trade/", "axiom.trade");
  assert.equal(liveLine(d.state()), "axiom.trade didn't open. Nothing was sent.");
});

test("M15: the strip keeps AgentZero's last five steps while it acts; M17's reasons each have their line", async () => {
  const { liveStep: step, liveLine: line } = await import("./live.ts");
  let s: import("./live.ts").Live = { phase: "agent", host: "shop.example.com" };
  for (let i = 1; i <= 7; i++) s = step(s, { type: "event", e: { kind: "step", line: `step ${i}`, host: "shop.example.com" } });
  assert.deepEqual(s.phase === "agent" && s.steps, ["step 3", "step 4", "step 5", "step 6", "step 7"]);
  s = step(s, { type: "event", e: { kind: "at", host: "shop.example.com" } });
  assert.equal(s.phase === "agent" && s.steps?.length, 5, "the same site keeps its steps");
  assert.equal(line({ phase: "you", host: "shop.example.com", why: "stuck" }), "The page didn't change after 3 tries. It's yours.");
  assert.equal(line({ phase: "you", host: "shop.example.com", why: "refused" }), "shop.example.com refused AgentZero. It's yours.");
  assert.equal(line({ phase: "you", host: "shop.example.com", why: "limit" }), "AgentZero stopped at its step limit. It's yours.");
});

test("audit L30: the live view's frame shows only an https address on the cloud browser's own origins, in a sandbox without same-origin", () => {
  const allowed = ["https://live.example"];
  assert.equal(liveFrameUrl("https://live.example/secret-token", allowed), "https://live.example/secret-token");
  for (const bad of ["http://live.example/secret-token", "https://evil.example/x", "https://live.example.evil.example/x", "https://user:pw@live.example/x", "javascript:alert(1)", "data:text/html,hi", "//live.example/x", "", null, undefined]) {
    assert.equal(liveFrameUrl(bad, allowed), null, String(bad));
  }
  assert.equal(liveFrameUrl("https://live.example:8443/x", allowed), null, "another port is another origin");
  // none allowed (no build sets the cloud's origins today): nothing is shown
  assert.deepEqual(LIVE_ORIGINS, []);
  assert.equal(liveFrameUrl("https://live.example/secret-token", LIVE_ORIGINS), null);
  const view = readFileSync(new URL("../app/LiveView.tsx", import.meta.url), "utf8");
  assert.match(view, /const liveUrl = liveFrameUrl\(live\.liveUrl, LIVE_ORIGINS\);/);
  assert.match(view, /sandbox="allow-scripts allow-forms"/);
  assert.doesNotMatch(view, /allow-same-origin/);
});
