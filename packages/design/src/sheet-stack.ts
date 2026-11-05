// One sheet at a time, and a sheet blocks the page behind it (J3 C6: Chat's first-time "Anyone can post here" sheet
// stayed open under the Request sheet, and posting worked behind it). Each screen keeps its open sheets in the order
// they opened: only the newest is shown; the others wait hidden under it and come back when it closes. While any is
// open, everything on the screen but the newest sheet is inert (no tap, no key, no focus, nothing read aloud).
//
// The order and what to block are plain logic here (tested in node, no DOM): Sheet.tsx applies them to the page.

/** The parts of a DOM node this needs (an Element, or a stand-in in tests). */
export interface Node_ {
  parentElement: Node_ | null;
  children: ArrayLike<Node_>;
}

export class SheetStack<T> {
  private list: T[] = [];
  open(x: T): void {
    if (!this.list.includes(x)) this.list.push(x);
  }
  close(x: T): void {
    const i = this.list.indexOf(x);
    if (i >= 0) this.list.splice(i, 1);
  }
  /** The sheet on screen: the newest still open. */
  top(): T | undefined {
    return this.list[this.list.length - 1];
  }
  /** Sheets opened before the top one: hidden under it until it closes. */
  under(): T[] {
    return this.list.slice(0, -1);
  }
  get size(): number {
    return this.list.length;
  }
}

/** What to make inert while `sheet` is on top of `screen`: every sibling of the sheet, and of each of its ancestors up
 *  to (not including) the screen. The sheet itself and the path to it stay live. */
export function behind<N extends Node_>(sheet: N, screen: N): N[] {
  const out: N[] = [];
  let at: N = sheet;
  while (at !== screen && at.parentElement) {
    const parent = at.parentElement as N;
    for (const c of Array.from(parent.children) as N[]) if (c !== at) out.push(c);
    if (parent === screen) break;
    at = parent;
  }
  return out;
}

/**
 * Tab inside an open sheet stays in it (the shell audit, 5 Nov: Tab from Activity's last control reached the app bar's
 * grab behind the sheet, which sits outside the screen the sheet makes inert). Given the sheet's focusable parts in
 * order and where focus is, the one Tab (or Shift+Tab) should land on when it would leave the sheet; null when the
 * browser's own next stop is still inside it.
 */
export function wrapTab<T>(inSheet: readonly T[], at: T | null, back: boolean): T | null {
  if (inSheet.length === 0) return null;
  const i = at === null ? -1 : inSheet.indexOf(at);
  if (i < 0) return back ? inSheet[inSheet.length - 1]! : inSheet[0]!;
  if (back && i === 0) return inSheet[inSheet.length - 1]!;
  if (!back && i === inSheet.length - 1) return inSheet[0]!;
  return null;
}
