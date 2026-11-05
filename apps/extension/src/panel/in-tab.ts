// Is the panel's page a tab of its own, not Chrome's side panel? The worker answers the side panel only (background.ts
// senderKind: a tab's message has a sender.tab), so a tab would wait and then read "the extension stopped partway"
// (5 Nov walk). tabs.getCurrent() is undefined in the side panel and a Tab in a tab. Asked once per page.
type Tabs = { getCurrent(): Promise<unknown> };
let kept: Promise<boolean> | null = null;
const chromeTabs = (): Tabs | undefined => (globalThis as { chrome?: { tabs?: Tabs } }).chrome?.tabs;

export const pageIsTab = (tabs: Tabs | undefined = chromeTabs()): Promise<boolean> =>
  (kept ??= typeof tabs?.getCurrent === "function" ? tabs.getCurrent().then((t) => !!t, () => false) : Promise.resolve(false));

/** For tests: forget the kept answer. */
export const forgetPageIsTab = (): void => { kept = null; };
