// ProblemView's next-step pill: it reads the step's label, and an `open` step goes to onOpen(screen) when a host gives
// one, else to onNext. The component is TSX, which node --test can't load, so vite's own loader does (the same one the
// app is built with). ProblemView has no hooks, so calling it returns its element tree to read the button from.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { ReactElement } from "react";
import { createServer, type ViteDevServer } from "vite";
import type { Problem } from "@zerofee/core/problem";
import { endedWords } from "@zerofee/shell-api/waiting-outcome.ts";

type View = (props: { problem: Problem; onNext: () => void; onOpen?: (screen: string) => void }) => ReactElement;
type Node = { type?: unknown; props?: { children?: unknown; onClick?: () => void; className?: string } };

let server: ViteDevServer;
let ProblemView: View;
before(async () => {
  server = await createServer({ configFile: false, root: import.meta.dirname, logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  ProblemView = (await server.ssrLoadModule("@zerofee/shell-api/ProblemView.tsx")).ProblemView;
});
after(async () => server?.close());

/** The step pill: the `zf-btn` button anywhere in the tree. */
function pill(el: unknown): Node | null {
  const n = el as Node | null;
  if (!n || typeof n !== "object" || !n.props) return null;
  if (n.type === "button" && n.props.className === "zf-btn") return n;
  const kids = Array.isArray(n.props.children) ? n.props.children : [n.props.children];
  for (const k of kids) {
    const found = pill(k);
    if (found) return found;
  }
  return null;
}
const text = (n: Node) => String(n.props?.children);

const stepProblem = (next: Problem["next"]): Problem => ({ code: "test.step", whatHappened: "Something.", money: { state: "not-involved" }, next });

test("an open step reads its label and tapping it calls onOpen with the screen", () => {
  const calls: string[] = [];
  const el = ProblemView({ problem: endedWords({ state: "unknown" }), onNext: () => calls.push("next"), onOpen: (s) => calls.push(`open:${s}`) });
  const b = pill(el)!;
  assert.equal(text(b), "See Activity");
  b.props!.onClick!();
  assert.deepEqual(calls, ["open:security/activity"]);
});

test("without onOpen an open step falls back to onNext", () => {
  const calls: string[] = [];
  const b = pill(ProblemView({ problem: endedWords({ state: "unknown" }), onNext: () => calls.push("next") }))!;
  assert.equal(text(b), "See Activity");
  b.props!.onClick!();
  assert.deepEqual(calls, ["next"]);
});

test("a step that isn't open always calls onNext, even when onOpen is given", () => {
  for (const next of [{ kind: "retry", label: "Try again" }, { kind: "wait", label: "Wait" }, { kind: "fix-input", label: "Fix it", field: "x" }, { kind: "nothing", label: "Done" }] as const) {
    const calls: string[] = [];
    const b = pill(ProblemView({ problem: stepProblem(next), onNext: () => calls.push("next"), onOpen: (s) => calls.push(`open:${s}`) }))!;
    assert.equal(text(b), next.label);
    b.props!.onClick!();
    assert.deepEqual(calls, ["next"], next.kind);
  }
});

test("a wait step with disabledUntil renders the timed pill (off until then); a plain wait step keeps its live pill", () => {
  const until = new Date(Date.now() + 9 * 3_600_000).toISOString();
  const el = ProblemView({ problem: stepProblem({ kind: "wait", label: "Try again after 4:14 AM", untilIso: until, disabledUntil: until }), onNext: () => {} }) as unknown as Node;
  const find = (n: unknown): Node | null => {
    const x = n as Node | null;
    if (!x || typeof x !== "object" || !x.props) return null;
    if (typeof x.type === "function" && (x.type as { name?: string }).name === "WaitPill") return x;
    for (const k of Array.isArray(x.props.children) ? x.props.children : [x.props.children]) {
      const f = find(k);
      if (f) return f;
    }
    return null;
  };
  const timed = find(el) as unknown as { props: { label: string; until: string } };
  assert.ok(timed, "the timed pill");
  assert.deepEqual([timed.props.label, timed.props.until], ["Try again after 4:14 AM", until]);
  // "It's still waiting" (a wait step without disabledUntil) keeps its live OK.
  const b = pill(ProblemView({ problem: stepProblem({ kind: "wait", label: "OK", untilIso: until }), onNext: () => {} }))!;
  assert.equal(text(b), "OK");
});

// next2: a quiet second link under the one pill. Only "open" (to onNext2) and a same-app relative url (page navigation).
const link = (el: unknown): Node | null => {
  const n = el as Node | null;
  if (!n || typeof n !== "object" || !n.props) return null;
  if (n.type === "button" && n.props.className === "zf-link") return n;
  for (const k of Array.isArray(n.props.children) ? n.props.children : [n.props.children]) {
    const f = link(k);
    if (f) return f;
  }
  return null;
};
const withNext2 = (next2: Problem["next2"]): Problem => ({ ...stepProblem({ kind: "retry", label: "Try again" }), next2 });

test("a Problem with next2 shows a quiet link with its label beside the one pill; without it nothing extra", () => {
  const el = ProblemView({ problem: withNext2({ label: "See the sample", kind: "url", url: "/?demo" }), onNext: () => {} });
  assert.equal(text(link(el)!), "See the sample");
  assert.equal(text(pill(el)!), "Try again", "still exactly the one pill");
  assert.equal(link(ProblemView({ problem: stepProblem({ kind: "retry", label: "Try again" }), onNext: () => {} })), null);
});

test("a next2 of kind open calls onNext2, and is not shown when the host gives none", () => {
  const calls: string[] = [];
  const p = withNext2({ label: "Other way", kind: "open" });
  link(ProblemView({ problem: p, onNext: () => calls.push("next"), onNext2: () => calls.push("next2") }))!.props!.onClick!();
  assert.deepEqual(calls, ["next2"]);
  assert.equal(link(ProblemView({ problem: p, onNext: () => {} })), null);
});

test("a next2 url navigates the page for a same-app path only; every other address is refused and the link is not shown", () => {
  const visited: string[] = [];
  const g = globalThis as { window?: unknown };
  const had = g.window;
  g.window = { location: { assign: (u: string) => visited.push(u) } };
  try {
    link(ProblemView({ problem: withNext2({ label: "Demo", kind: "url", url: "/?demo" }), onNext: () => {} }))!.props!.onClick!();
    assert.deepEqual(visited, ["/?demo"]);
    for (const url of ["https://evil.example", "//evil.example", "javascript:alert(1)", "http://evil.example/", "/\\evil.example", "/\t/evil.example", "evil.example", "", undefined]) {
      assert.equal(link(ProblemView({ problem: withNext2({ label: "Bad", kind: "url", url }), onNext: () => {} })), null, String(url));
    }
    assert.deepEqual(visited, ["/?demo"]);
  } finally {
    g.window = had;
  }
});

/** Every string in the tree, joined. */
function allText(el: unknown): string {
  if (el == null || typeof el === "boolean") return "";
  if (typeof el === "string" || typeof el === "number") return String(el);
  if (Array.isArray(el)) return el.map(allText).join(" ");
  return allText((el as Node).props?.children);
}

test("the ended screens show the chain's record as 'See the record of it', never the raw address", () => {
  for (const state of ["ran", "cancelled", "confirming"] as const) {
    const el = ProblemView({ problem: endedWords({ state, explorerUrl: "https://testnet.nearblocks.io/" }), onNext: () => {} });
    const t = allText(el);
    assert.ok(t.includes("See the record of it") && !t.includes("explorer"), state);
    assert.ok(!t.includes("https://"), state);
  }
});

test("onBack gives a Problem screen its way out (the arrow, Escape, browser Back); without it, none (grade 01d, Q8)", () => {
  const find = (el: unknown, name: string): Node | null => {
    const n = el as Node | null;
    if (!n || typeof n !== "object" || !n.props) return null;
    if (typeof n.type === "function" && n.type.name === name) return n;
    for (const k of Array.isArray(n.props.children) ? n.props.children : [n.props.children]) {
      const f = find(k, name);
      if (f) return f;
    }
    return null;
  };
  const busy = stepProblem({ kind: "wait", label: "Try again after 6:25 AM", disabledUntil: new Date(Date.now() + 60_000).toISOString() });
  const View = ProblemView as unknown as (p: Record<string, unknown>) => ReactElement;
  let backs = 0;
  const arrow = find(View({ problem: busy, onNext: () => {}, onBack: () => backs++ }), "BackArrow");
  assert.ok(arrow, "the arrow is there");
  (arrow!.props as { onBack: () => void }).onBack();
  assert.equal(backs, 1);
  assert.equal(find(View({ problem: busy, onNext: () => {} }), "BackArrow"), null);
});

/** Every element in the tree, depth first. */
function all(el: unknown, out: Node[] = []): Node[] {
  const n = el as Node | null;
  if (!n || typeof n !== "object") return out;
  if (Array.isArray(n)) {
    for (const k of n) all(k, out);
    return out;
  }
  if (!n.props) return out;
  out.push(n);
  const kids = Array.isArray(n.props.children) ? n.props.children : [n.props.children];
  for (const k of kids) all(k, out);
  return out;
}

test("J3 C1: a Problem's extra line with an id in it is never on the screen itself, only behind 'Details for ZeroFee'", () => {
  const withMore = (more: string): Problem => ({ ...stepProblem({ kind: "nothing", label: "Go back" }), more });
  const onScreen = (p: Problem) => all(ProblemView({ problem: p, onNext: () => {} })).filter((n) => n.type === "p").map(text);
  const folded = (p: Problem) => all(ProblemView({ problem: p, onNext: () => {} })).filter((n) => (n.props as { label?: string }).label === "Details for ZeroFee");
  for (const raw of ["nep141:wrap.near on near", "4906542056074766355140186 units of nep141:wrap.near", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near"]) {
    assert.ok(!onScreen(withMore(raw)).some((t) => t.includes(raw)), raw);
    assert.equal(folded(withMore(raw)).length, 1, `${raw} is one tap down`);
  }
  // Control: plain words stay on the screen, with no disclosure.
  assert.ok(onScreen(withMore("SOL on Solana")).includes("SOL on Solana"));
  assert.equal(folded(withMore("SOL on Solana")).length, 0);
});
