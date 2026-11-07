// The ZeroFee Keychain from the shell's side (D29; Security's rules §E): Settings → Passwords. Only the shell calls
// these, straight to the iPhone host (never through an app's bridge, so no app id is stamped and Swift lets them in).
// The page never sees or sends a password: Reveal shows it on a native sheet, Copy puts it on this phone's clipboard
// for 30 seconds, Add opens a native sheet with a secure field. In a browser there is no Keychain.
import type { BridgeResult } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import type { IosHost } from "./ios.ts";

export interface Login {
  id: string;
  host: string;
  username: string;
  createdIso: string;
  lastUsedIso: string | null;
  by: "robot" | "you";
}

export const LOGINS_UNAVAILABLE: Problem = {
  code: "logins.unavailable",
  whatHappened: "Passwords are kept in the phone's secure chip.",
  money: { state: "not-involved" },
  next: { kind: "nothing", label: "Go back" },
};

/** A plain website name, as the host also checks: labels of a-z 0-9 -, at least one dot. */
export const isSiteName = (h: string) => /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(h);

/** "https://App.Example.com/login" or "app.example.com" → "app.example.com"; "" when it isn't a site. */
export function siteName(input: string): string {
  const t = input.trim().toLowerCase();
  if (!t) return "";
  try {
    const h = new URL(t.includes("://") ? t : `https://${t}`).hostname;
    return isSiteName(h) ? h : "";
  } catch {
    return "";
  }
}

export interface LoginsClient {
  list(): Promise<BridgeResult<Login[]>>;
  reveal(id: string): Promise<BridgeResult<{ shown: boolean }>>;
  copy(id: string): Promise<BridgeResult<{ copied: boolean; expiresAtIso: string }>>;
  add(host: string): Promise<BridgeResult<{ id: string | null }>>;
  remove(id: string): Promise<BridgeResult<{ removed: boolean }>>;
}

/** The phone's Keychain, or null in a browser (Settings then says "On the phone only."). */
export function loginsClient(host: IosHost | null): LoginsClient | null {
  if (!host) return null;
  return {
    list: () => host.call<Login[]>("logins.list", {}),
    reveal: (id) => host.call("logins.reveal", { id }),
    copy: (id) => host.call("logins.copy", { id }),
    add: (h) => (isSiteName(h) ? host.call("logins.add", { host: h }) : Promise.resolve({ problem: { ...LOGINS_UNAVAILABLE, code: "logins.refused", whatHappened: "That isn't a website's name. Type it like app.example.com." } })),
    remove: (id) => host.call("logins.remove", { id }),
  };
}

/** "Used 3 days ago" / "Never used", for the list. */
export function lastUsedWords(l: Pick<Login, "lastUsedIso">, now = Date.now()): string {
  if (!l.lastUsedIso) return "Never used";
  const days = Math.floor((now - Date.parse(l.lastUsedIso)) / 86_400_000);
  if (!Number.isFinite(days) || days <= 0) return "Used today";
  if (days === 1) return "Used yesterday";
  if (days < 60) return `Used ${days} days ago`;
  return `Used ${Math.floor(days / 30)} months ago`;
}
