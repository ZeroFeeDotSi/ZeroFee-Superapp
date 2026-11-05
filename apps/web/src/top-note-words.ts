// The web app's top note (product decision, 5 Nov): every word it says, in one place (the UI lead's words, 5 Nov).
// Product decision, 5 Nov late: the first words "called us a demo and normal"; "we are still a dope app they should try. Write
// something professional." Shown on every screen of the public web build, Sim and Real (top-note.tsx topNoteOn), never in
// the extension or the phone app.

export const TOP_NOTE_TITLE = "ZeroFee on the web";
export const TOP_NOTE_LINE_1 = "Trade fast, send in private, one account for every chain. Fees go to the network, not to ZeroFee.";
export const TOP_NOTE_LINE_2 = "On iPhone, your account is a smart contract on NEAR, with a second approval from your laptop.";
export const TOP_NOTE_LINE_3 = "The iPhone app is coming to the App Store. Run the beta today from the open source code.";
export const TOP_NOTE_LAPTOP_LABEL = "Laptop approval";
export const TOP_NOTE_SELFHOST_LABEL = "Get the code";
/** The close button's words; its accessible name is the same words (what the person reads is what a reader says). */
export const TOP_NOTE_CLOSE_LABEL = "Got it";
export const TOP_NOTE_CLOSE_NAME = TOP_NOTE_CLOSE_LABEL;

/** The laptop's own site (mode.ts SECOND_DEVICE_SITE): zerofee.si/laptop is not a page. */
export const TOP_NOTE_LAPTOP_URL = "https://laptop.zerofee.si";
/** Where "Get the code" goes while the build names no code address (VITE_CODE_URL unset): the self-host guide. The same
 *  address as Settings → Open source (open-source.ts CODE_FALLBACK, pinned equal in top-note.test.ts). */
export const TOP_NOTE_SELFHOST_FALLBACK = "https://zerofee.si/docs/self-host";

/** The laptop link: a self-hosted build's VITE_SECOND_DEVICE_SITE (a bare host, as mode.ts reads it), else ours. */
export function laptopHref(site: string | undefined): string {
  const v = (site ?? "").trim().toLowerCase();
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v) ? `https://${v}` : TOP_NOTE_LAPTOP_URL;
}

/** The code link: the build's VITE_CODE_URL when it is an https address, else the fallback (never empty or dead). */
export function selfHostHref(codeUrl: string | undefined): string {
  const url = (codeUrl ?? "").trim();
  return /^https:\/\/[^\s/]+/.test(url) ? url : TOP_NOTE_SELFHOST_FALLBACK;
}
