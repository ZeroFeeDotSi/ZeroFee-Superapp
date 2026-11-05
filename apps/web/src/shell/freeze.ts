// The Home banner while payments are frozen (account contract release 6, re-audit R1): a recovery started with the
// backup words, or stopped, makes every payment wait. Release 7: it says who can stop the move (this phone, or the second
// device, whose yes the move needs) and counts down to the earliest it could finish (recovery-words.ts).
import type { RecoveryPending } from "@zerofee/core/signer";
import { whenWords } from "../apps/security/rules.ts";
import { oldPhoneCount, phoneCanStop, whoCanStop } from "../screens/recovery-words.ts";
import type { ReactNode } from "react";
import { RANK, type NoticeItem } from "./notices.ts";

/** What `recovery.status` says (docs/interfaces.md). `frozenUntilIso` is absent before release 6. */
export interface RecoveryStatus {
  delaySeconds?: number;
  pending: null | RecoveryPending;
  frozenUntilIso?: string | null;
}

export interface FreezeNotice {
  /** A recovery waits: the banner offers to stop it (when this phone still can: `canStop`). */
  recovering: boolean;
  canStop?: boolean;
  text: string;
  also: string;
  /** While a move waits: who can stop it. */
  who?: string;
  /** While a move waits: a live countdown, said as `before` + the time left + `after`. */
  count?: { untilIso: string; before: string; after: string; atZero?: string };
}

/** The banner's words, or null when payments aren't frozen. */
/** `device`: what the account's second device is, when known ("your laptop" in the web demo). */
export function freezeNotice(status: RecoveryStatus | null, now = Date.now(), when: (iso: string) => string = (iso) => whenWords(iso), device = "your second device"): FreezeNotice | null {
  const until = status?.frozenUntilIso;
  if (!status || !until || !(Date.parse(until) > now)) return null;
  return status.pending
    ? {
        recovering: true,
        canStop: phoneCanStop(status.pending),
        text: "Someone started moving your account to a new device.",
        who: whoCanStop(status.pending, when, device),
        count: oldPhoneCount(status.pending, device, now),
        also: phoneCanStop(status.pending)
          ? `Payments wait until ${when(until)}. Not you? Stop it, then get new words.`
          : `Payments wait until ${when(until)}. Not you? Say no on ${device}, then get new words.`,
      }
    : { recovering: false, text: `A move to a new device has stopped. Payments wait until ${when(until)}.`, also: "Not you? Someone may know your words. Get new words." };
}

/** The apps the freeze is about: Home (the payments that wait) and Security (its Devices, where a move is stopped). */
export const FREEZE_APPS = ["wallet", "security"] as const;

/** The bar's line while a move is under way (the banner says the whole sentence when the line is tapped). */
export const MOVING_LINE = "Someone is moving your account.";

/**
 * The freeze as the shell's one line (NoticeBar.tsx), the same in the app and the sample page; `more` is what a tap on
 * the line opens (FreezeBanner, bare). Only over Home and Security, never over every app, one line that keeps the page's
 * end clear. A move under way (a possible takeover) stays until it is resolved: no ×. A move that stopped has its ×,
 * kept across reloads until the line changes; it leaves by itself when payments no longer wait.
 */
export function freezeNoticeItem(f: FreezeNotice, more: ReactNode): NoticeItem {
  return {
    key: `freeze:${f.recovering ? "move" : "stopped"}:${f.text}:${f.count?.untilIso ?? ""}`,
    rank: RANK.freeze,
    alert: true,
    // a move under way: the bar's one line fits one line (it ran off as the banner's whole sentence); a tap says the rest
    line: f.recovering ? MOVING_LINE : f.text,
    more,
    apps: FREEZE_APPS,
    ...(f.recovering ? { pinned: true as const } : { remember: true as const }),
  };
}
