// The design scanner every robot walk and design review runs on each frame: touch targets under 44 pt, text under 12 px,
// contrast under AA, unnamed controls. One copy, here, so a fix reaches every walk.
//
// Grade 02f (F4, E13): the review marked Security's Activity "Scan clean" while it showed nine 33×15 "See it" links. The
// old copy let any inline link through unless it was under 24×24 in BOTH directions (WCAG 2.5.8's inline exception), but
// ZeroFee's rule (JOURNEY-PRINCIPLES M6) is every interactive element at least 44×44, inline or not. `tooSmall` is that
// rule, pure, so a test holds it; SCAN is the in-page script built on it, for page.evaluate(SCAN).

export interface Target { width: number; height: number }

/** M6: every interactive element at least 44×44 CSS px (half a pixel of rounding allowed), inline links too. */
export function tooSmall(r: Target): boolean {
  return r.width < 43.5 || r.height < 43.5;
}

/** The in-page scan: `page.evaluate(SCAN)` → { size, small, contrast, names }, each a list of "what WxH" findings. */
export const SCAN = `(() => {
  const tooSmall = ${tooSmall.toString()};
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && !el.closest("[inert],[aria-hidden=true]") && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).opacity !== "0"; };
  const rgb = (s) => { const m = s.match(/[\\d.]+/g); return m ? m.map(Number) : [0,0,0,0]; };
  const lum = ([r,g,b]) => { const f = (c) => { c /= 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if ((c[3] ?? 1) > 0.5) return c; } return document.documentElement.dataset.theme === "dark" ? [0,0,0] : [255,255,255]; };
  const size = [], small = [], contrast = [], names = [];
  for (const el of document.querySelectorAll("button, a[href], input, select, textarea, [role=button], [role=tab], [role=radio], [role=link], [role=switch], summary")) {
    if (!vis(el) || el.disabled) continue;
    // An inline link wraps: each of its line boxes is a target of its own, and the smallest is what a thumb meets.
    const rects = [...el.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    const r = rects.length ? rects.reduce((a, b) => (a.width * a.height <= b.width * b.height ? a : b)) : el.getBoundingClientRect();
    if (tooSmall(r)) size.push((el.getAttribute("aria-label") || el.innerText || el.tagName).trim().slice(0, 30) + " " + Math.round(r.width) + "x" + Math.round(r.height));
    const nm = (el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || el.value || (el.labels && el.labels[0] && el.labels[0].innerText) || "").trim();
    if (!nm && !el.getAttribute("aria-labelledby")) names.push(el.tagName + "." + el.className);
  }
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement; if (!el || seen.has(el) || !vis(el)) continue; seen.add(el);
    const cs = getComputedStyle(el); const px = parseFloat(cs.fontSize);
    if (px < 12) small.push(n.textContent.trim().slice(0, 30) + " " + px + "px");
    const fg = rgb(cs.color); const a = fg[3] ?? 1; const bg = bgOf(el);
    const mix = fg.slice(0, 3).map((c, i) => c * a + bg[i] * (1 - a));
    const L1 = lum(mix), L2 = lum(bg); const ratio = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05);
    const large = px >= 24 || (px >= 18.66 && +cs.fontWeight >= 700);
    if (!el.closest("button:disabled") && ratio < (large ? 3 : 4.5)) contrast.push(n.textContent.trim().slice(0, 30) + " " + ratio.toFixed(2));
  }
  return { size, small, contrast, names };
})()`;
