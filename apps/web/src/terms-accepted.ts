// Whether this device agreed to the current terms (terms.ts has their text): once per device, asked again whenever
// TERMS_VERSION changes. On its own so Home's first load reads the mark without the terms' text (speed budget, 5 Nov).
// 2026-11-05: the Beta section first: every install agrees once more
export const TERMS_VERSION = "2026-11-05";
const KEY = "zerofee.app.terms";

let thisTab = false; // storage blocked (private mode): acceptance still holds for this tab

export function termsAccepted(): boolean {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as { version?: string } | null;
    if (v?.version === TERMS_VERSION) return true;
  } catch {
    // unreadable or blocked storage
  }
  return thisTab;
}

export function acceptTerms(): void {
  thisTab = true;
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: TERMS_VERSION, acceptedAt: new Date().toISOString() }));
  } catch {
    // blocked storage: this tab only
  }
}
