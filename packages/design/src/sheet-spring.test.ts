// Feel (product decision, 5 Nov): every D135 sheet rises 24 px
// on ease-out in 240 ms while it fades in (spring.ts runTween; toned down, product decision, 5 Nov), with the page behind in sight
// until it lands; under Reduce Motion nothing moves, the sheet is simply there. Its size never changes (D135).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { riseSheet } from "./sheet-rise.ts";

const css = readFileSync(new URL("./sheet.css", import.meta.url), "utf8");
const src = readFileSync(new URL("./sheet-rise.ts", import.meta.url), "utf8");
const sheet = readFileSync(new URL("./Sheet.tsx", import.meta.url), "utf8");

type Box = { offsetHeight: number; style: { transform: string; opacity: string } };
const box = (h = 800): Box => ({ offsetHeight: h, style: { transform: "", opacity: "" } });
/** A .zf-sheet as the DOM has it: its backdrop, then its body. */
const sheetOf = (scrim: Box, body: Box) => ({ children: [scrim, body] }) as never;
const yOf = (b: Box) => Number(/translate3d\(0,(-?\d+)px,0\)/.exec(b.style.transform)?.[1] ?? 0);

/** requestAnimationFrame by hand: 60 frames a second, run one at a time. */
function frames() {
  const g = globalThis as Record<string, unknown>;
  const was = { raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };
  let queue: ((t: number) => void)[] = [];
  let now = 0;
  let asked = 0;
  g.requestAnimationFrame = (cb: (t: number) => void) => (asked++, queue.push(cb), queue.length);
  g.cancelAnimationFrame = () => void (queue = []);
  return {
    get asked() { return asked; },
    step() { const q = queue; queue = []; now += 1000 / 60; q.forEach((cb) => cb(now)); return q.length; },
    restore() { g.requestAnimationFrame = was.raf; g.cancelAnimationFrame = was.caf; },
  };
}

test("a sheet opens 24 px low and faded and eases up in 240 ms, no overshoot, the page behind in sight until it lands", () => {
  const f = frames();
  try {
    const body = box(800), scrim = box(800);
    const stop = riseSheet(sheetOf(scrim, body), false);
    assert.equal(body.style.transform, "translate3d(0,24px,0)", "first painted frame: 24 px low, before any frame runs (not the screen's height)");
    assert.equal(body.style.opacity, "0", "and faded out");
    assert.equal(scrim.style.opacity, "0", "the page behind is in sight, never covered at once");
    const seen: number[] = [];
    let frame = 0;
    while (f.step() && frame < 100) {
      frame++;
      seen.push(yOf(body));
      if (body.style.transform === "") break;
    }
    assert.ok(frame >= 10 && frame <= 15, `240 ms is about 14 frames at 60 a second: ${frame}`);
    assert.ok(seen.every((y, i) => i === 0 || y <= seen[i - 1]!), "it rises and never bounces back down");
    assert.ok(Math.max(...seen) <= 24 && Math.min(...seen) >= 0, "never past 24 px, never above the top");
    assert.equal(body.style.transform, "", "at rest: no transform left");
    assert.equal(body.style.opacity, "", "at rest: whole");
    assert.equal(scrim.style.opacity, "", "at rest: the backdrop is whole");
    stop();
    assert.equal(body.style.transform, "", "stopped after it landed: nothing changes");
  } finally {
    f.restore();
  }
});

test("Reduce Motion: no movement, the sheet is just there (control: the same call with motion moves)", () => {
  const f = frames();
  try {
    const body = box(), scrim = box();
    riseSheet(sheetOf(scrim, body), true);
    assert.equal(body.style.transform, "");
    assert.equal(scrim.style.opacity, "");
    assert.equal(f.asked, 0, "no frame asked for");
    const stop = riseSheet(sheetOf(scrim, body), false);
    assert.ok(f.asked > 0 && body.style.transform !== "", "control: with motion it moves");
    f.step();
    stop();
    assert.equal(body.style.transform, "", "a close mid-rise lets the tween go and leaves the sheet whole for its fall");
    assert.equal(scrim.style.opacity, "");
    assert.equal(f.step(), 0, "no frame runs after it is stopped");
  } finally {
    f.restore();
  }
});

test("the rise is the tween's alone: no CSS rise or fade on the body, none under Reduce Motion; the size stays locked", () => {
  assert.doesNotMatch(css, /zf-sheet-(rise|fade)/, "no keyframe rise or fade left in sheet.css");
  const body = /\.zf-sheet__body \{([^}]*)\}/.exec(css)![1]!;
  assert.doesNotMatch(body, /animation/, "the body's rise is never a CSS animation");
  assert.match(body, /position: absolute; inset: 0; height: 100%;/, "D135: the whole screen from the first frame");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.zf-sheet__body \{ animation: none; \}/, "Reduce Motion: no fade either");
  assert.match(src, /import \{ runTween \} from "\.\/spring\.ts";/);
  assert.match(src, /const stop = runTween\(\{ from: RISE_PX, to: 0, ms: RISE_MS, frame: paint \}\);/);
  assert.match(src, /RISE_PX = 24;/);
  assert.match(src, /RISE_MS = 240;/);
  assert.match(sheet, /useLayoutEffect\(\(\) => \{\n\s*rising\.current = riseSheet\(el\.current, stillMotion\(\)\);/, "it rises before the first paint, still under Reduce Motion");
  assert.match(sheet, /<div className="zf-sheet__scrim" onClick=\{(?:close|onScrim)\} \/>\n\s*\{\/\*[^*]*\*\/\}\n\s*<div className="zf-sheet__body">/, "the backdrop, then the body, as riseSheet reads them");
  assert.match(sheet, /rising\.current\?\.\(\);\n\s*setClosing\(true\);/, "a close stops the rise first");
  // control: the old rule fails the check
  assert.match(".zf-sheet__body { animation: zf-sheet-rise .42s ease both; }", /zf-sheet-(rise|fade)/);
});
