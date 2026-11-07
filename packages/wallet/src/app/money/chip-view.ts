// J3-2 (the copy review's walk, 8 Nov: "Base" chosen, still half under the strip's right-edge fade): the chosen chip in a strip that
// scrolls sideways is always whole, clear of the fade, by the strip's own numbers (never left to scrollIntoView's
// scroll-padding alone, which the walk showed missing it). Pure: a table test.

/** The strip's scrollLeft that shows the chip `[left, left + width)` (in the strip's content, px) whole: clear of the
 *  `fade` px at the strip's right edge and of its left edge; already whole, the scrollLeft as it is. */
export function chipScroll(scrollLeft: number, stripWidth: number, left: number, width: number, fade = 24): number {
  const right = left + width;
  if (right > scrollLeft + stripWidth - fade) return Math.max(0, Math.min(left, right - stripWidth + fade));
  if (left < scrollLeft) return Math.max(0, left);
  return scrollLeft;
}

/** The chosen chip (aria-checked) of `strip` scrolled whole into view (chipScroll). */
export function showChosen(strip: HTMLElement | null | undefined, fade = 24): void {
  const el = strip?.querySelector<HTMLElement>('[aria-checked="true"]');
  if (!strip || !el) return;
  const s = strip.getBoundingClientRect(), c = el.getBoundingClientRect();
  const left = c.left - s.left + strip.scrollLeft;
  const to = chipScroll(strip.scrollLeft, strip.clientWidth, left, c.width, fade);
  if (to !== strip.scrollLeft) strip.scrollLeft = to;
}
