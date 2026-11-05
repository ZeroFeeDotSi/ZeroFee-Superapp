// "Your wallets" (the Browser thesis, part 3): one row on the Browser's start page opens every site wallet ever made,
// on the whole screen (D135: one Sheet, Close). Each wallet: its site's logo (a listed site's own; any other site its
// first letter, never a favicon), its name (its host for a site ZeroFee doesn't list), its dollars and coins, and "Move
// back to Safe" (the money sheet's site Take out, Home's own, unchanged). "Move everything back" opens that sheet for
// each wallet with money, one after another. Empty wallets wait behind "Show empty".
// Reads only while this page is on screen: Spending's list when it opens (and on a change), each wallet's coins then and
// every 15 s (rest.ts `every`, the Browser's app id: never while hidden, covered or behind another app). What it read
// last is kept in memory for the next open (never on the device: no address, id or key is stored by this page).
// The pure rules are your-wallets.ts (tested in node). Its code loads when the row is first tapped, never in Home's load.
import { useCallback, useEffect, useRef, useState } from "react";
import type { SpendingWallet } from "@zerofee/core/spending";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { every } from "@zerofee/shell-api/rest.ts";
import { PRESET_LOGO } from "../app/chains.tsx";
import { presetForHost } from "../presets.ts";
import { usd } from "@zerofee/trade/app/format.ts";
import { Mark } from "./Favourites.tsx";
import { type SiteCoin } from "./site-wallet.ts";
import { keepLast, siteWalletsOf, words, yourWallets, type BackAsk, type WalletCard } from "./your-wallets.ts";

/** The Browser start page's app id (home-apps.tsx hosts the start page as "social"): its reads run only while it shows. */
const APP = "social";
/** How long the money sheet takes to leave before the next one opens ("Move everything back"). */
const NEXT_MS = 350;

/** The last read, for the next open in this session only (memory; nothing here is written to the device). */
let memo: { list: SpendingWallet[]; coins: Record<string, readonly SiteCoin[]> } | null = null;

const logoOf = (c: WalletCard): string | undefined => PRESET_LOGO[c.host ? presetForHost(c.host)?.id ?? "" : c.site];

function Tile({ c }: { c: WalletCard }) {
  const logo = logoOf(c);
  return <span className="yw-logo" aria-hidden="true"><Mark logo={logo} letter={c.letter} size={40} /></span>;
}

export function YourWalletsPage({ onClose }: { onClose: () => void }) {
  const shell = useShell();
  const { bridge, active } = shell;
  const [list, setList] = useState<SpendingWallet[]>(() => memo?.list ?? []);
  const [coins, setCoins] = useState<Record<string, readonly SiteCoin[]>>(() => memo?.coins ?? {});
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const [read, setRead] = useState<"first" | "ok" | "failed">(() => (memo ? "ok" : "first"));
  const [showEmpty, setShowEmpty] = useState(false);
  /** A money sheet is up over this page: the page steps aside until it closes (one sheet at a time). */
  const [away, setAway] = useState(false);
  const [line, setLine] = useState("");
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => bridge.on("spending.changed", refresh), [bridge, refresh]);
  const ids = useRef<string[]>([]);

  // Spending's list: when the page opens, on a change, and after a money sheet
  useEffect(() => {
    if (!active) return;
    let live = true;
    void bridge.call<SpendingWallet[]>("spending.wallets").then((r) => {
      if (!live) return;
      if ("ok" in r && Array.isArray(r.ok)) {
        setList(r.ok);
        setRead("ok");
        memo = { list: r.ok, coins: memo?.coins ?? {} };
      } else setRead("failed"); // the last list stays on screen, said so
    }, () => live && setRead("failed"));
    return () => void (live = false);
  }, [active, bridge, tick]);

  // each wallet's coins: now, then every 15 s while this page is on screen; a wallet that doesn't answer keeps its last view
  const walletIds = siteWalletsOf(list).map((w) => w.id).join(",");
  ids.current = walletIds ? walletIds.split(",") : [];
  useEffect(() => {
    if (!active || !walletIds) return;
    let live = true;
    const look = () => {
      const want = ids.current;
      void Promise.all(want.map((id) => bridge.call<SiteCoin[]>("subwallet.coins", { id }).then((r) => ("ok" in r && Array.isArray(r.ok) ? r.ok : null), () => null))).then((got) => {
        if (!live) return;
        const byId = Object.fromEntries(want.map((id, k) => [id, got[k] ?? null]));
        setCoins((prev) => {
          const next = keepLast(prev, byId);
          memo = { list: memo?.list ?? [], coins: next };
          return next;
        });
        setFailed(new Set(want.filter((_, k) => !got[k])));
      });
    };
    look();
    const stop = every(15_000, look, APP);
    return () => { live = false; stop(); };
  }, [active, bridge, walletIds]);

  const v = yourWallets({ list, coins, failed, read });

  /** The money sheet's site Take out for each wallet in `queue`, one after another; any sheet closed without moving
   *  stops the rest. The page comes back when the last one closes. */
  const move = (queue: BackAsk[], of = queue.length, moved = 0) => {
    const ask = queue[0];
    if (!ask) return;
    setLine("");
    setAway(true);
    shell.openMoney({ kind: "siteback", wallet: ask.wallet, name: ask.name, ...(ask.also.length ? { also: ask.also } : {}), back: true, usd: ask.usd }, (end) => {
      if (end.went) {
        // its one row is Home's own job (wallet site-back.ts: Now, its tracker, the Activity centre), never a Browser task too
        if (queue.length > 1) return void setTimeout(() => move(queue.slice(1), of, moved + 1), NEXT_MS);
        if (of > 1) setLine(words.allDone);
      } else if (of > 1 && moved > 0) setLine(words.allStopped(moved, of));
      setAway(false);
      refresh();
    });
  };

  if (away) return null;
  const card = (c: WalletCard) => (
    <li key={c.site} className="yw-card" data-testid={`yw-${c.site}`}>
      <div className="yw-head">
        <Tile c={c} />
        <span className="yw-name">{c.name}</span>
        <span className="yw-usd" data-testid="yw-usd">{c.dollars}</span>
      </div>
      {c.unpriced && <p className="zf-small yw-note">{words.noPrice}</p>}
      {c.coins.length > 0 && (
        <ul className="yw-coins" aria-label={`Coins in your ${c.name} wallet`}>
          {c.coins.map((x) => <li key={x.key}><span>{x.symbol || x.name}</span><span>{x.value}</span></li>)}
        </ul>
      )}
      {c.notes.map((n) => <p key={n} className="zf-small yw-note">{n}</p>)}
      {c.back && <button className="yw-back" onClick={() => move([c.back!])}>{words.backUsd(usd(c.back.usd))}</button>}
    </li>
  );
  const allEmpty = read !== "first" && !v.money.length && v.empty.length > 0;
  return (
    <Sheet title={words.title} onClose={onClose}>
      <div className="yw-page" data-testid="your-wallets">
        <section className="yw-top">
          <p className="yw-big" data-testid="yw-total">{v.total}</p>
          <p className="zf-small yw-sub">{words.total}</p>
          {v.totalNote && <p className="zf-small yw-sub">{v.totalNote}</p>}
        </section>
        {v.sweep.length > 1 && (
          <div className="yw-all">
            <button className="zf-btn" data-testid="yw-all" onClick={() => move(v.sweep)}>{words.all}</button>
            <p className="zf-small yw-sub">{words.allLine(v.sweep.length)}</p>
          </div>
        )}
        <p className="zf-small yw-line" role="status" aria-live="polite">{line}</p>
        {read === "failed" && <p className="zf-small yw-note">{words.readFailed} <button className="zf-link" onClick={refresh}>Look again</button></p>}
        {read === "first" && !list.length && <p className="zf-small yw-note">{words.looking}</p>}
        {read !== "first" && !v.money.length && !v.empty.length && <p className="zf-small yw-note" data-testid="yw-none">{words.none}</p>}
        {v.money.length > 0 && <ul className="yw-list">{v.money.map(card)}</ul>}
        {allEmpty && <p className="zf-small yw-note">{words.allEmpty}</p>}
        {v.empty.length > 0 && (allEmpty || showEmpty) && (
          <>
            {!allEmpty && <h2 className="sw-h">{words.empty}</h2>}
            <ul className="yw-list yw-list--empty">{v.empty.map(card)}</ul>
          </>
        )}
        {v.empty.length > 0 && !allEmpty && (
          <button className="zf-link yw-toggle" data-testid="yw-show-empty" aria-expanded={showEmpty} onClick={() => setShowEmpty((s) => !s)}>
            {showEmpty ? words.hideEmpty : words.showEmpty(v.empty.length)}
          </button>
        )}
      </div>
    </Sheet>
  );
}
