// Product decision, 4 Nov: "I really like YouTube's bottom bar, it's interactive, it changes animations subtly… a bit more reactive
// to what the user is doing, and just nice smooth feel overall." The capsule: floating, icons only, a lighter pill that
// slides with a slight stretch, an icon that pops to filled, a press that gives, a bar that steps aside on a scroll down,
// a quiet dot for live work; Reduce Motion is a crossfade, never a slide or a hide.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { barShown, followScroll, stretchAt, BAR_HIDE_AFTER_PX, BAR_STEP_PX, PILL_STRETCH } from "./bar-scroll.ts";
import { newsApps } from "../../shell-api/src/tasks.ts";

const css = readFileSync(new URL("./appbar.css", import.meta.url), "utf8");
const tokens = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const bar = readFileSync(new URL("./AppBar.tsx", import.meta.url), "utf8");
const icons = readFileSync(new URL("./icons.tsx", import.meta.url), "utf8");
const slide = readFileSync(new URL("../../../apps/web/src/shell/slide.ts", import.meta.url), "utf8");
/** The body of every rule whose selector list is exactly `sel` (outside @media). */
const rules = (s: string, sel: string) => [...s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1]!.trim() === sel).map((m) => m[2]!);
const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)].map((m) => m[1]!).join("\n");

test("scrolling down past the top hides the bar; scrolling up, or reaching the top, brings it back; a jitter does nothing", () => {
  assert.equal(barShown(true, 200, BAR_STEP_PX + 1), false, "down: out of the way");
  assert.equal(barShown(false, 180, -(BAR_STEP_PX + 1)), true, "up: back");
  assert.equal(barShown(true, BAR_HIDE_AFTER_PX - 1, 30), true, "near the top it stays");
  assert.equal(barShown(false, 0, 0), true, "at the top it shows");
  assert.equal(barShown(true, 300, 2), true, "a jitter down: no change");
  assert.equal(barShown(false, 300, -2), false, "a jitter up: no change");
  assert.equal(barShown(true, 300, 40, { still: true }), true, "Reduce Motion: never hides");
});

test("followScroll (look 4, 5 Nov): the bar never hides on scroll, and a stale hidden mark is cleared; a sheet's own scroll never moves it", () => {
  let on: ((e: Event) => void) | null = null;
  const root = { addEventListener: (_: string, f: (e: Event) => void) => { on = f; }, removeEventListener: () => { on = null; } } as unknown as HTMLElement;
  const attrs = new Set<string>();
  const bar = { hasAttribute: (a: string) => attrs.has(a), removeAttribute: (a: string) => void attrs.delete(a), toggleAttribute: (a: string, f: boolean) => (f ? attrs.add(a) : attrs.delete(a), f), contains: () => false } as unknown as HTMLElement;
  const scroller = (dialog: boolean) => ({ scrollTop: 0, closest: (sel: string) => (dialog && sel.includes("dialog") ? {} : null) });
  const page = scroller(false), sheet = scroller(true);
  const off = followScroll(root, () => bar);
  const scroll = (t: { scrollTop: number }, top: number) => { t.scrollTop = top; on!({ target: t } as unknown as Event); };
  scroll(page, 0);
  scroll(page, 200);
  assert.ok(!attrs.has("data-hidden"), "down: still shown");
  attrs.add("data-hidden");
  scroll(page, 250);
  assert.ok(!attrs.has("data-hidden"), "a stale hidden mark is cleared");
  scroll(page, 150);
  assert.ok(!attrs.has("data-hidden"), "up: back");
  scroll(sheet, 0);
  scroll(sheet, 400);
  assert.ok(!attrs.has("data-hidden"), "a sheet's scroll: the bar stays as it was");
  off();
  assert.equal(on, null, "off stops following");
});

test("the pill stretches most halfway between two tabs, never at rest", () => {
  assert.equal(stretchAt(2), 1);
  assert.equal(stretchAt(0), 1);
  assert.ok(Math.abs(stretchAt(1.5) - PILL_STRETCH) < 1e-9);
  assert.ok(PILL_STRETCH > 1 && PILL_STRETCH <= 1.02, "2 % at most (product decision, 5 Nov: subtle)");
  assert.ok(stretchAt(1.25) > 1 && stretchAt(1.25) < stretchAt(1.5));
});

test("a tab gets a quiet dot when its app has something going, never the tab on screen", () => {
  const tasks = [{ app: "home", state: "pending" }, { app: "trade", state: "done" }, { app: "browser", state: "pending" }] as { app: "home" | "trade" | "browser"; state: "pending" | "done" }[];
  assert.deepEqual([...newsApps(tasks, "trade")].sort(), ["browser", "pay", "social", "wallet"]);
  assert.deepEqual([...newsApps(tasks, "wallet")].sort(), ["browser", "pay", "social"], "the app on screen has no dot");
  assert.deepEqual([...newsApps([], "wallet")], []);
});

test("one .zf-appbar rule: a floating capsule 16 in from each edge, above the home indicator, blurred, a hairline edge; each theme's colour is a token, never a second rule", () => {
  const main = rules(css, ".zf-appbar");
  assert.equal(main.length, 1, "one .zf-appbar rule set");
  assert.match(main[0]!, /left: 16px; right: 16px; bottom: var\(--bar-gap\)/);
  assert.match(main[0]!, /border-radius: var\(--r-pill, 999px\)/);
  assert.match(main[0]!, /background: var\(--glass\)/);
  assert.match(main[0]!, /backdrop-filter: saturate\(1\.6\) blur\(22px\)/);
  assert.match(main[0]!, /box-shadow: var\(--glass-shadow\)/, "the glass token: highlight edge, hairline, lift");
  assert.match(main[0]!, /touch-action: none/);
  assert.doesNotMatch(css, /:root[^{]*\.zf-appbar \{/, "no theme override of the capsule");
  // both themes set every bar token (White needs its edge and a soft shadow, never a grey slab)
  const rebrand = tokens.slice(tokens.indexOf("══ Rebrand"));
  const at = rebrand.indexOf(':root[data-theme="dark"]');
  const [light, dark] = [rebrand.slice(0, at), rebrand.slice(at, rebrand.indexOf("}", at))];
  for (const t of ["--bar-bg:", "--bar-solid:", "--bar-edge:", "--bar-shadow:", "--bar-pill:"]) {
    assert.ok(light.includes(t), `White sets ${t}`);
    assert.ok(dark.includes(t), `Black sets ${t}`);
  }
  assert.match(tokens, /--bar-gap: max\(8px, calc\(env\(safe-area-inset-bottom, 0px\) - 4px\)\)/, "above the home indicator");
  assert.match(css, /\.ah\[data-moving\] \.zf-appbar \{ background: var\(--bar-solid\); -webkit-backdrop-filter: none; backdrop-filter: none; \}/, "solid while pages move, the same colour");
});

test("icons only, each tab keeps its name: aria-label, and the name in the button for screen readers", () => {
  assert.match(bar, /aria-label=\{name\}/);
  assert.match(bar, /<span className="zf-appbar__label">\{name\}<\/span>/);
  assert.match(css, /\.zf-appbar__label \{[^}]*clip: rect\(0 0 0 0\)/);
  assert.match(bar, /aria-label="All apps"/, "the tray's grab bar keeps its name");
});

test("the active tab: the outline icon swaps to a filled one by opacity, and settles in from .98 (200 ms, ease-out)", () => {
  for (const n of ["AppHomeOn", "AppTradeOn", "AppChatOn", "AppBrowserOn", "AppAgentOn", "AppSocialOn"]) assert.match(icons, new RegExp(`export const ${n} = `), n);
  assert.match(bar, /zf-appbar__glyph zf-appbar__glyph--on/);
  assert.match(css, /\.zf-appbar__glyph--on \{[^}]*opacity: 0;/);
  assert.match(css, /\.zf-appbar__item\[data-on\] \.zf-appbar__glyph--on \{ opacity: 1; \}/);
  assert.match(css, /\.zf-appbar__item\[data-on\] \.zf-appbar__glyph:has\(\+ \.zf-appbar__glyph--on\) \{ opacity: 0; \}/, "the outline goes where a filled one comes (a tab with no filled icon keeps its outline)");
  assert.match(css, /\.zf-appbar__item\[data-on\] \.zf-appbar__icon \{ animation: zf-tab-pop var\(--dur-base\) var\(--ease-out\) both; \}/);
  assert.match(css, /@keyframes zf-tab-pop \{ from \{ transform: scale\(\.98\); \} \}/);
});

test("press: the tab gives to .98 with the one press (ui.css .zf-press), and springs back; no press of its own", () => {
  assert.match(bar, /className="zf-appbar__item zf-press"/);
  assert.match(css, /\.zf-appbar__item \{[^}]*--press-scale: \.98;/);
  assert.doesNotMatch(rules(css, ".zf-appbar__item")[0]!, /transition/, "the press's own transition is never overridden");
  assert.doesNotMatch(css, /:active/, "the press lives in ui.css alone");
  assert.match(bar, /onPointerDown=\{onPress \? \(\) => onPress\(i\) : undefined\}/, "the phone's light tap on the press itself");
});

test("the pill eases to the tab in --dur-base on --ease-out, with no stretch mid-way (2 % under a finger at most): read from the tokens by the flight", () => {
  assert.match(tokens, /--dur-base: 200ms;/);
  assert.match(slide, /duration: num\(css, "--dur-base", 200\)/);
  assert.match(slide, /css\?\.getPropertyValue\("--ease-out"\)\.trim\(\) \|\| EASE_OUT/);
  assert.match(slide, /m\.animate\(\[\{ transform: `translateX\(\$\{o\.markFrom \* 100\}%\)` \}, \{ transform: `translateX\(\$\{o\.markTo \* 100\}%\)` \}\], \{ duration: num\(css, "--dur-base", 200\), easing: css\?\.getPropertyValue\("--ease-out"\)\.trim\(\) \|\| EASE_OUT, fill: "forwards" \}\)/);
  assert.doesNotMatch(slide, /pill\.animate/, "the pill no longer stretches mid-flight");
  assert.match(css, /\.zf-appbar__pill \{[^}]*background: var\(--bar-pill\);[^}]*transform: scaleX\(var\(--stretch, 1\)\)/, "under a finger the stretch follows --stretch");
});

test("reacting to the person: down and out on a scroll down, back on the way up or on a switch; under a sheet; a quiet dot", () => {
  assert.match(css, /\.zf-appbar\[data-hidden\] \{ transform: translateY\(16px\); opacity: 0; pointer-events: none; \}/);
  assert.match(css, /\.zf-appbar\[data-hidden\]:has\(:focus-visible\) \{ transform: none; opacity: 1; pointer-events: auto; \}/, "a screen reader's focus brings it back");
  assert.match(css, /\.zf-appbar \{[^}]*transition: transform var\(--dur-base\) var\(--ease-out\), opacity var\(--dur-fast\) var\(--ease-out\)/);
  // a full-screen sheet rises over it (sheet.css z 45 over the bar's 25)
  const sheet = readFileSync(new URL("./sheet.css", import.meta.url), "utf8");
  const z = (s: string, sel: string) => Number(new RegExp(`${sel.replace(/[.[\]]/g, "\\$&")} \\{[^}]*z-index: (\\d+)`).exec(s)?.[1]);
  assert.ok(z(sheet, ".zf-sheet") > z(css, ".zf-appbar"), "a sheet covers the bar");
  assert.match(css, /\.zf-appbar__news \{[^}]*background: var\(--up\)/);
  assert.doesNotMatch(css.slice(css.indexOf(".zf-appbar__news")).split("}")[0]!, /animation/, "quiet: no ping");
  assert.match(bar, /news\?\.has\(id\) && <span className="zf-appbar__news" aria-hidden="true" \/>/);
});

test("Reduce Motion: no slide and no hide, the pill and the icon crossfade in place; transform and opacity only", () => {
  assert.match(reduced, /\.zf-appbar__marker \{ opacity: 0; \}/, "the sliding pill goes");
  assert.match(reduced, /\.zf-appbar__item\[data-on\]::before \{ opacity: 1; \}/, "each tab's own pill fades in");
  assert.match(css, /\.zf-appbar__item::before \{[^}]*background: var\(--bar-pill\);[^}]*opacity: 0; transition: opacity var\(--dur-fast\) var\(--ease-out\);/);
  assert.match(reduced, /\.zf-appbar\[data-hidden\] \{ transform: none; opacity: 1; pointer-events: auto; \}/);
  assert.match(reduced, /\.zf-appbar__item\[data-on\] \.zf-appbar__icon \{ animation: none; \}/);
  // only transform and opacity move (the bar, the pill, the icon, the glyphs)
  /** A list split at its top-level commas (never inside var(…, var(…))). */
  const top = (v: string) => { const out = [""]; let d = 0; for (const c of v) { d += c === "(" ? 1 : c === ")" ? -1 : 0; if (c === "," && !d) out.push(""); else out[out.length - 1] += c; } return out; };
  for (const m of css.matchAll(/transition: ([^;]+);/g)) for (const part of top(m[1]!)) {
    const prop = part.trim().split(/\s+/)[0]!;
    assert.ok(["transform", "opacity", "none"].includes(prop), `animates ${prop}`);
  }
});
