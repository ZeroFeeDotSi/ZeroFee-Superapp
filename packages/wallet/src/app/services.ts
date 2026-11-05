// B28: never blocked by a dead service. Each money sheet names the outside services it needs (SHEET_NEEDS, pinned by a
// test); before the tap it says, in one quiet line, when one of them is down (R6, from ledger.services: the relay's
// minute check and what the ledger saw fail); a read that failed because a service did is read again by itself with
// backoff while the line shows (R4); a service failing on the tap is a line on the sheet, never the shell's Problem
// screen (R1). Nothing here moves money: a payment is still checked and quoted afresh by the core before its sheet.
import { useEffect, useState } from "react";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import { OFFLINE_LINE, SERVICE_EFFECTS, SERVICE_NAMES, problemLine, serviceOf, waitsLine, type Service, type ServiceStatus } from "@zerofee/core/services";

/** What each money sheet needs, and nothing else (R2). The fault-injection suite reads this same table. */
export const SHEET_NEEDS = {
  /** Add money to the Safe on NEAR: the account's own name, nothing to wait on. Another chain's address is the bridge's. */
  add: [],
  addOtherChain: ["bridge"],
  /** Home's Send (Chat's pay too): every Send goes privately through NEAR, on 1Click's quotes through ZeroFee's quote relay
   *  (D128), and settles on NEAR Intents, so NEAR is needed too (security review M3: without it, a real NEAR outage put no
   *  line on Send while the wallet's coin left for an address that waits on NEAR). The wallet's own chain is said when
   *  its tap fails, by name. */
  send: ["near", "oneclick", "relay"],
  sendOtherChain: ["near", "bridge"],
  /** Home's Swap and Move (Safe → Spending): NEAR, 1Click's private price through ZeroFee's quote relay. */
  swap: ["near", "oneclick", "relay"],
  move: ["near", "oneclick", "relay"],
  /** Spending → the Safe. */
  putaway: ["near", "oneclick", "relay"],
  /** Social trading's Add (Safe → Spending → the site's wallet on Solana) and Take out (the site's wallet → the Safe). */
  siteadd: ["near", "oneclick", "relay", "solana"],
  takeout: ["solana", "oneclick", "relay", "near"],
} as const satisfies Record<string, readonly Service[]>;
export type SheetKind = keyof typeof SHEET_NEEDS;

/** This phone has no connection (the browser's own word for it; a phone that can't tell counts as online). */
export const isOffline = (): boolean => typeof navigator !== "undefined" && (navigator as { onLine?: boolean }).onLine === false;

/**
 * The words before the tap for one sheet: null when every service it needs is up. `down`: the move would fail now, so
 * its button waits, and the line says so; the line says "waits" ONLY when the button waits (bug 8: "NEAR is
 * down. Send waits" over a Send that still went). Down is said only when two independent sources agree, this phone and
 * the relay's check ("both", MetaMask's 2026 rule); one source alone (either) is "didn't answer", button on. A
 * phone with no connection says "You're offline." and nothing else.
 */
export function servicesLine(rows: readonly ServiceStatus[], needs: readonly Service[], action: string, offline: boolean = isOffline()): { line: string | null; down: boolean } {
  if (offline) return { line: OFFLINE_LINE, down: true };
  const row = needs.map((n) => rows.find((r) => r.service === n && r.state !== "up")).find(Boolean);
  if (!row || row.state === "up") return { line: null, down: false };
  // rule 9a (product decision, 5 Nov): busy or slow is never said; a slow door is the failover's to cover, silently
  if (row.state !== "down") return { line: null, down: false };
  if (row.seen === "both") return { line: waitsLine(row.service, "down", action), down: true };
  return { line: `${SERVICE_NAMES[row.service]} didn't answer. ${action} may take longer.`, down: false };
}

/** How often an open sheet asks again which services are failing (the ledger asks the relay at most once a minute). */
export const SERVICES_EVERY_MS = 30_000;

/** R6: the quiet line before the tap for a sheet needing `needs`. */
export function useServices(bridge: Bridge, needs: readonly Service[], action: string): { line: string | null; down: boolean } {
  const [health, setHealth] = useState<ServiceStatus[]>([]);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = () =>
      void bridge.call<ServiceStatus[]>("ledger.status").then((r) => {
        if (!live) return;
        setHealth("ok" in r && Array.isArray(r.ok) ? r.ok : []);
        timer = setTimeout(look, SERVICES_EVERY_MS);
      }, () => undefined);
    look();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [bridge]);
  // the phone's connection is read at every render (each read and every tap renders the sheet again)
  return servicesLine(health, needs, action);
}

/** R4: how long a failed read waits before it is read again, sooner first. */
export const BACKOFF_MS = [2_000, 4_000, 8_000, 16_000, 30_000];

/**
 * R4: `read`, and again with backoff while it fails because a service did (a Problem naming one). Each answer goes to
 * `onAnswer`. Returns the stop (an effect's cleanup).
 */
export function readAgain<T>(read: () => Promise<BridgeResult<T>>, onAnswer: (r: BridgeResult<T>) => void, backoff: readonly number[] = BACKOFF_MS): () => void {
  let stopped = false;
  let tries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const go = () =>
    void read().then((r) => {
      if (stopped) return;
      onAnswer(r);
      if ("problem" in r && serviceOf(r.problem)) timer = setTimeout(go, backoff[Math.min(tries++, backoff.length - 1)]);
    }, () => undefined);
  go();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

/** A Problem a sheet says as its own line (a service failing), or null when it is the shell's to show. */
/** B30: never only "it didn't answer, your money is safe": the line also says what still works. */
export const sheetLineOf = (p: Problem): string | null => {
  const s = serviceOf(p);
  if (!s) return null;
  const line = problemLine(p);
  const works = SERVICE_EFFECTS[s].works;
  // say it once (4 Nov, a Safe Move): "Your money stays in your Safe." after "Your money is in your Safe." is the same line twice
  return /Your money/.test(line) && /^Your money/.test(works) ? line : `${line} ${works}`;
};
