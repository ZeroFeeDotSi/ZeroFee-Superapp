// The motion system (ACTIVITY-MOTION, product decision, 4 Nov): eight named
// motions, transform and opacity only, each stilled under Reduce Motion, nothing that moves the app's frame, and time
// said in words ("13:35:01" read as a clock on the test phone where it meant 13 hours).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { ago, shortElapsed, tickEvery } from "./time.ts";
import { progressOf } from "./live-row.ts";

const dir = new URL("./", import.meta.url);
const css = (f: string) => readFileSync(new URL(f, dir), "utf8");
/** Every stylesheet of the app (apps/web/src and every package src), comments stripped. */
function allCss(): { file: string; text: string }[] {
  const root = new URL("../../../", import.meta.url);
  const out: { file: string; text: string }[] = [];
  const walk = (d: URL) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      const u = new URL(e.name + (e.isDirectory() ? "/" : ""), d);
      if (e.isDirectory()) walk(u);
      else if (e.name.endsWith(".css")) out.push({ file: u.pathname.replace(root.pathname, ""), text: readFileSync(u, "utf8").replace(/\/\*[\s\S]*?\*\//g, "") });
    }
  };
  walk(new URL("apps/web/src/", root));
  walk(new URL("packages/", root));
  return out.filter((f) => /^(apps\/web\/src|packages\/[^/]+\/src)\//.test(f.file));
}
const ms = (v: string) => (/^[\d.]+ms$/.test(v) ? parseFloat(v) : /^[\d.]+s$/.test(v) ? parseFloat(v) * 1000 : null);
const keyframes = (s: string) => [...s.matchAll(/@keyframes\s+([\w-]+)\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})/g)].map((m) => ({ name: m[1]!, props: new Set([...m[2]!.matchAll(/([a-z-]+)\s*:/g)].map((p) => p[1]!)) }));
const reduced = (s: string) => [...s.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)].map((m) => m[1]!).join("\n");

test("every keyframe in packages/design moves only transform and opacity (an SVG path's draw aside)", () => {
  const bad: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".css"))) {
    for (const k of keyframes(css(f))) for (const p of k.props) if (p !== "transform" && p !== "opacity" && p !== "stroke-dashoffset") bad.push(`${f} ${k.name} ${p}`);
  }
  assert.deepEqual(bad, []);
  // control: the check sees a layout property
  assert.deepEqual([...keyframes("@keyframes x { to { height: 0; } }")[0]!.props], ["height"]);
});

test("every file that animates has a Reduce Motion rule, and the named motions are stilled in it", () => {
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".css"))) {
    const s = css(f);
    if (/animation:\s*(?!none)[^;]*\b[\w-]+\s/.test(s) && keyframes(s).length) assert.match(s, /prefers-reduced-motion: reduce/, `${f} animates with no Reduce Motion rule`);
  }
  const motion = reduced(css("motion.css")), row = reduced(css("liverow.css")), sheet = reduced(css("sheet.css"));
  for (const sel of [".zf-live::after", ".zf-arrive", ".zf-rise", ".zf-pop", ".zf-settle", ".zf-filament::before", ".zf-sweep::after"]) assert.ok(motion.includes(sel), `motion.css: ${sel} under Reduce Motion`);
  for (const sel of [".zf-lrow__flow", ".zf-lrow__fill", ".zf-lrow__badge"]) assert.ok(row.includes(sel), `liverow.css: ${sel} under Reduce Motion`);
  assert.ok(reduced(css("ui.css")).includes(".zf-press"), "press lives in ui.css, stilled there");
  const presses = readdirSync(dir).filter((x) => x.endsWith(".css")).filter((f) => /^\.zf-press \{/m.test(css(f)));
  assert.deepEqual(presses, ["ui.css"], "one press, defined once");
  assert.match(sheet, /\.zf-sheet\[data-closing\] \.zf-sheet__body \{ animation: none; \}/, "a sheet's fall is stilled too");
});

test("nothing loops but the All-apps hint and the working spinners (product decision, 5 Nov: no breathing, no pulsing, no glow)", () => {
  const loops = new Set(allCss().flatMap(({ text }) => [...text.matchAll(/animation:\s*([\w-]+)[^;]*\binfinite\b/g)].map((m) => m[1]!)));
  // the hint (one 1 px nudge every 30 s); the ring that turns while AgentZero or the fund screen is working
  const allowed = new Set(["zf-hint", "fs-spin", "az-turn"]);
  assert.deepEqual([...loops].filter((n) => !allowed.has(n)), []);
  assert.ok(loops.has("zf-hint"), "control: the hint is found");
  assert.match(css("appbar.css"), /animation: zf-hint 30s 1s var\(--ease-out\) infinite;/, "every 30 s");
  assert.match(css("appbar.css"), /1% \{ transform: translateY\(-1px\); \}/, "a nudge of 1 px, once");
  // control: a breathing loop is caught
  assert.ok([..."animation: az-breathe 6s ease infinite;".matchAll(/animation:\s*([\w-]+)[^;]*\binfinite\b/g)].length === 1);
});

test("nothing that frames overshoots: sheets, the pop and the press never use the overshooting springs", () => {
  const s = css("sheet.css") + css("motion.css") + css("liverow.css");
  assert.doesNotMatch(s, /\.zf-(sheet|pop|press|settle|lrow)[^{]*\{[^}]*var\(--ease-(pop|spring)\)/);
  assert.doesNotMatch(css("motion.css"), /@keyframes zf-burst/, "the burst is retired");
});

test("the motion tokens sit apart from colour, and a sheet's fall in JS matches its token", () => {
  const tokens = css("tokens.css");
  for (const t of ["--ease-out: cubic-bezier(0.2, 0, 0, 1);", "--dur-fast: 160ms;", "--dur-base: 200ms;", "--dur-sheet: 240ms;", "--m-hold-ms: 2500ms"]) assert.ok(tokens.includes(t), t);
  for (const gone of ["--ease-spring", "--ease-snap", "--ease-glide", "--ease-pop", "--ease-draw", "--ease-in:", "--snap-ms", "--glide-ms", "--m-fall-ms"]) assert.ok(!tokens.includes(gone), `${gone} is retired`);
  const sheet = readFileSync(new URL("./Sheet.tsx", dir), "utf8");
  assert.match(sheet, /export const FALL_MS = 200;/);
  assert.match(sheet, /setClosing\(true\);\n\s*release\.current\?\.\(\);/, "the page behind is given back on the fall's first frame (finding 11)");
  assert.match(css("sheet.css"), /\.zf-sheet\[data-closing\] \{ pointer-events: none; \}/, "a falling sheet takes no tap");
});

test("time in words: never a clock", () => {
  assert.equal(shortElapsed(2_000), "now");
  assert.equal(shortElapsed(12_000), "12 s");
  assert.equal(shortElapsed(4 * 60_000 + 59_000), "4 min");
  assert.equal(shortElapsed((13 * 3600 + 35 * 60 + 1) * 1000), "13 h", "the test's 13:35:01");
  assert.equal(shortElapsed(26 * 3600_000), "1 day");
  assert.equal(shortElapsed(50 * 3600_000), "2 days");
  assert.equal(shortElapsed(-5), "now");
  const now = Date.parse("2026-11-04T12:00:00Z");
  assert.equal(ago("2026-11-04T11:58:00Z", now), "2 min");
  assert.equal(ago("2026-11-03T10:00:00Z", now), "Yesterday");
  assert.equal(tickEvery(30_000), 1000);
  assert.equal(tickEvery(120_000), 15_000);
});

test("a row's progress: steps done plus half of one under way, never under .08 while it runs, 1 once it ended", () => {
  assert.equal(progressOf([{ state: "done" }, { state: "doing" }, { state: "waiting" }]), 0.5);
  assert.equal(progressOf([{ state: "waiting" }, { state: "waiting" }]), 0.08);
  assert.equal(progressOf([{ state: "done" }, { state: "doing" }], true), 1);
  assert.equal(progressOf([]), 0.08);
});

// ── Toned down (decided 5 Nov: no swoosh, it felt too showy and a little anxious; keep things subtle).
// The numbers every stylesheet of the app must keep to. ──────────────────────────────────────

test("no easing leaves 0..1: no bezier with a control point outside it, no spring-shaped linear() list", () => {
  const bad: string[] = [];
  let seen = 0;
  for (const { file, text } of allCss()) {
    for (const m of text.matchAll(/cubic-bezier\(([^)]*)\)/g)) {
      seen++;
      const n = m[1]!.split(",").map((x) => parseFloat(x));
      if (n.length !== 4 || n.some((x) => !(x >= 0 && x <= 1))) bad.push(`${file} ${m[0]}`);
    }
    for (const m of text.matchAll(/linear\(([^)]*,[^)]*)\)/g)) bad.push(`${file} ${m[0].slice(0, 40)}`);
  }
  assert.deepEqual(bad, []);
  assert.ok(seen >= 1, "control: the token's own bezier is read");
  // control: an overshooting curve is caught by the same test
  assert.ok("cubic-bezier(.2, 1.4, .3, 1)".match(/cubic-bezier\(([^)]*)\)/)![1]!.split(",").some((x) => parseFloat(x) > 1));
});

test("no animation or transition runs longer than 240 ms (a loop, and the hold and arming lines of a payment, aside)", () => {
  const bad: string[] = [];
  const holds: string[] = [];
  let seen = 0;
  const tokens = css("tokens.css");
  for (const t of ["--dur-fast", "--dur-base", "--dur-sheet"]) assert.ok((ms(new RegExp(`${t}:\\s*([\\d.]+m?s)`).exec(tokens)![1]!) ?? 999) <= 240, t);
  for (const { file, text } of allCss()) {
    for (const m of text.matchAll(/(?:^|[;{\s])((?:animation|transition)(?:-duration)?)\s*:\s*([^;}]+)/g)) {
      if (/\binfinite\b/.test(m[2]!) || /--arm-ms|--m-hold-ms/.test(m[2]!)) continue;
      if (/^(animation|transition)\s*:\s*none\s*$/.test(`${m[1]}: ${m[2]!.trim()}`)) continue;
      // each comma-separated item's FIRST time is its duration (the second is a delay)
      const items = m[2]!.replace(/\([^)]*\)/g, (x) => x.replace(/,/g, "\u0000")).split(",");
      for (const item of items) {
        const t = item.trim().split(/\s+/).find((x) => ms(x) !== null || /^var\(--dur-/.test(x));
        if (!t || m[1]!.endsWith("-duration") && !t) continue;
        // a Hold button's fill runs as long as the hold itself (a guard's feedback, not a motion): the only linear ones
        if (/\blinear\b/.test(item)) { holds.push(`${file}: ${item.trim()}`); continue; }
        seen++;
        const v = /^var\(--dur-/.test(t) ? 0 : ms(t)!;
        if (v > 240) bad.push(`${file} ${m[1]}: ${item.trim()}`);
        if (!/^var\(--dur-/.test(t)) bad.push(`${file} uses a literal duration instead of a --dur- token: ${item.trim()}`);
      }
    }
  }
  assert.deepEqual(bad, []);
  assert.equal(holds.length, 3, `only the Hold fills are linear: ${holds.join(" | ")}`);
  assert.ok(holds.every((h) => /wallet\/src\/app\/money\/(send|move-swap)\.css/.test(h) && /600ms|\.6s/.test(h)));
  assert.ok(seen > 100, `control: the scan reads the app's durations (${seen})`);
});

test("no transform moves more than 24 px, no scale beyond 2 %, no keyframe overshoots", () => {
  const bad: string[] = [];
  let px = 0;
  for (const { file, text } of allCss()) {
    for (const m of text.matchAll(/translate(?:[XY]|3d)?\(([^)]*)\)/g)) {
      for (const v of m[1]!.split(",")) {
        const n = /^\s*(-?[\d.]+)px\s*$/.exec(v);
        if (n) { px++; if (Math.abs(parseFloat(n[1]!)) > 24) bad.push(`${file} ${m[0]}`); }
      }
    }
    for (const m of text.matchAll(/(?<![\w-])scale\(([\d.]+)\)/g)) {
      const n = parseFloat(m[1]!);
      if (n !== 0 && (n < 0.98 || n > 1.02) && !/--fit/.test(m[0])) bad.push(`${file} ${m[0]}`);
    }
    for (const m of text.matchAll(/--press-[a-z]+:\s*([\d.]+)/g)) if (parseFloat(m[1]!) < 0.98) bad.push(`${file} ${m[0]}`);
  }
  assert.deepEqual(bad, []);
  assert.ok(px >= 10, `control: the scan reads the px moves (${px})`);
  // control: a 100 % slide is not a px value and the sheet's own rise is checked on its 24 px
  assert.match(css("sheet.css"), /to \{ transform: translateY\(24px\); opacity: 0; \}/, "a sheet falls 24 px and fades");
  assert.doesNotMatch(css("sheet.css") + readFileSync(new URL("../../../apps/web/src/shell/approval.css", import.meta.url), "utf8") + readFileSync(new URL("../../../apps/web/src/shell/settings.css", import.meta.url), "utf8"), /translateY\(100%\)/, "no sheet slides its whole height");
});

test("the motion tokens and the tween: ease-out only, three durations, 24 px for a sheet", async () => {
  const { bezierAt, runTween, EASE_OUT } = await import("./spring.ts");
  assert.deepEqual([...EASE_OUT], [0.2, 0, 0, 1]);
  assert.ok(EASE_OUT.every((x) => x >= 0 && x <= 1));
  let prev = 0;
  for (let i = 1; i <= 100; i++) {
    const y = bezierAt(i / 100);
    assert.ok(y >= prev - 1e-9 && y <= 1, `ease-out never overshoots or turns back (${i})`);
    prev = y;
  }
  assert.ok(bezierAt(0.3) > 0.5, "ease-out: most of the travel early");
  const seen: number[] = [];
  runTween({ from: 0, to: 24, ms: 9999, frame: (x) => seen.push(x) });
  assert.equal(seen[seen.length - 1], 24, "without a frame clock it lands at once");
  assert.match(readFileSync(new URL("./spring.ts", import.meta.url), "utf8"), /Math\.min\(o\.ms \?\? 200, 240\)/, "a tween is capped at 240 ms");
});
