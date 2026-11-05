// Settings' web-wallet secrets, the pure part (product decision, 4 Nov): ask the core for the words or a wallet's key
// with the typed password, and say why not in the person's words. WebWalletRows.tsx draws the sheet.
import type { Bridge } from "@zerofee/core/bridge";
import { WEB_WORDS as W, type WebWalletId } from "@zerofee/shell-api/web-wallet-words.ts";
import { holdCopied } from "./copied-secret.ts";

/** What Settings asks for: the 24 words, or one wallet's key. */
export type Ask = { k: "words" } | { k: "key"; wallet: WebWalletId; name: string };

/** What the core answered: the words, a key, or why not. */
export type Secret = { words: string[] } | { key: string } | { why: string };

/** Ask the core for the words or one wallet's key with the password typed. Pure on the bridge, so a test drives it. */
export async function readSecret(bridge: Bridge, ask: Ask, password: string): Promise<Secret> {
  try {
    const r = ask.k === "words"
      ? await bridge.call<{ words: string[] }>("account.web.showWords", { password })
      : await bridge.call<{ key: string }>("account.web.exportKey", { wallet: ask.wallet, password });
    if ("ok" in r && r.ok) {
      if (ask.k === "words" && "words" in r.ok && Array.isArray(r.ok.words) && r.ok.words.length === 24) return { words: r.ok.words };
      if (ask.k === "key" && "key" in r.ok && typeof r.ok.key === "string" && r.ok.key) return { key: r.ok.key };
      return { why: W.failed };
    }
    // a wait after wrong tries (security.web.wait): the core's own line says how long ("Too many tries. Try again in 30 seconds.")
    return { why: whyNot("problem" in r ? r.problem : undefined) };
  } catch {
    return { why: W.failed };
  }
}

/** What the words check answered: the password was right (no words sent yet), the words match or not, or why not. */
export type Checked = { ready: true } | { matches: boolean } | { why: string };

/**
 * The backup-words practice (account.web.checkWords): the password alone first (`words` left out: { ready }), then the
 * password with the 24 typed words. The core compares them inside and says only yes or no; the words never come back,
 * and nothing here keeps, logs or copies them. A refusal is said as readSecret says it (wrong password, the wait's line).
 */
export async function checkBackupWords(bridge: Bridge, password: string, words?: string[]): Promise<Checked> {
  try {
    const r = await bridge.call<{ ready?: true; matches?: boolean }>("account.web.checkWords", words ? { password, words } : { password });
    if ("ok" in r && r.ok) {
      if (!words && r.ok.ready === true) return { ready: true };
      if (words && typeof r.ok.matches === "boolean") return { matches: r.ok.matches };
      return { why: W.failed };
    }
    return { why: whyNot("problem" in r ? r.problem : undefined) };
  } catch {
    return { why: W.failed };
  }
}

const whyNot = (problem: unknown): string => {
  const p = problem as { code?: string; whatHappened?: string } | undefined;
  if (p?.code === "security.web.wait") return p.whatHappened || W.failed;
  return p?.code === "security.web.password" ? W.wrongPassword : W.failed;
};

/** How long a copied key stays on the clipboard (QA): then it is wiped, so it isn't pasted by mistake later. */
export const CLIPBOARD_FORGET_MS = 30_000;
/** How long the words or a key stay on screen before they hide by themselves (QA). */
export const SECRET_SHOWN_MS = 60_000;

/**
 * After a key's Copy: CLIPBOARD_FORGET_MS later the clipboard is wiped, but only if it still holds the key (QA):
 * never something the person copied since. `stillOurs`: nothing was copied in the app since (copyStamp); `read`: the
 * clipboard as it is now, or null where the browser won't say without asking (no prompt is ever raised for this).
 * Timers, the clipboard and the stamp are passed in, so a test drives them. The wipe is held (copied-secret.ts), so Lock,
 * the idle lock and the page going run it sooner, with the same check; it runs once.
 */
export function forgetCopied(text: string, later: (run: () => Promise<void>, ms: number) => void, write: (text: string) => Promise<void>, read: () => Promise<string | null>, stillOurs: () => boolean, hold = holdCopied): void {
  const wipe = hold(async () => {
    if (!stillOurs()) return;
    const now = await read().catch(() => null);
    if (now !== null && now !== text) return;
    await write("").catch(() => {});
  });
  later(wipe, CLIPBOARD_FORGET_MS);
}

/** Every copy in the app moves this on (WebWalletRows listens for the page's copy events), so a later copy is seen. */
let copies = 0;
export const copyStamp = { next: (): number => ++copies, now: (): number => copies };

/** The clipboard's text only where reading it raises no prompt (the permission already granted); else null. */
export async function readIfAllowed(): Promise<string | null> {
  try {
    const nav = globalThis.navigator as Navigator | undefined;
    const p = await nav?.permissions?.query({ name: "clipboard-read" as PermissionName });
    return p?.state === "granted" ? await nav!.clipboard.readText() : null;
  } catch {
    return null;
  }
}
