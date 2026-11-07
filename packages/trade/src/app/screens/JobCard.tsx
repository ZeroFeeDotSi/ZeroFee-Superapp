// One row in Activity (V1 port slice 7, the A+ pass of 3 Nov): a hairline row like Phantom's list: the coin's own logo,
// what happened ("Bought DOPE") over what moved and when ("1,501 DOPE · now"), the dollars on the right, and a status only
// while it isn't done ("Sending…", "Didn't go through"); no pill, no box. A tap opens its steps as a timeline that fills: a
// check and the time for a step done, a pulse and how long for the one happening now, a number for the next. Running and
// waiting rows open by themselves. A held Add's row leads to the shell's Waiting screen, where its hold can run or be
// cancelled (D17).
import { useEffect, useState } from "react";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { Check } from "@zerofee/design/icons.tsx";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { about } from "../boards.ts";
import { clockTime as clock, usd, whenWords } from "../format.ts";
import { KEPT_CLAIM_SEC, keptDone, keptRunning, keptWay, openByDefault, type Card, type KeptFacts, type KeptView } from "../job-cards.ts";
import { useCoinDetail, useLogo, useTrade } from "../runtime.tsx";


/** The coin's own logo (a shimmer while it comes; never a letter); a move's row wears the Safe's mark. */
function CardLogo({ card }: { card: Card }) {
  if (!card.coin) return <span className="ac-img ac-img--move" aria-hidden="true"><CoinIcon symbol="·" icon={card.moveIcon === "bsc" ? "bsc" : card.moveIcon ?? "near"} size={36} /></span>;
  return <CoinLogo chain={card.coin.chain} address={card.coin.address} />;
}
function CoinLogo({ chain, address }: { chain: NonNullable<Card["coin"]>["chain"]; address: string }) {
  const d = useCoinDetail(chain, address);
  const logo = useLogo(d.value?.logoUrl);
  return logo.src ? <img className="ac-img" src={logo.src} alt="" width={36} height={36} />
    : logo.state === "none" && d.value ? <span className="ac-img ac-img--none" aria-hidden="true" /> : <span className="zf-shimmer ac-img" aria-hidden="true" />;
}

/** Ref's lost and found for a kept trade's coin, read on two nodes by the service (null: can't tell; undefined: reading). */
function useKeptHeld(k: KeptFacts | undefined, n: number): string | null | undefined {
  const { svc } = useTrade();
  const [held, setHeld] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!k) return;
    let live = true;
    setHeld(undefined);
    svc.keptHeld(k.id).then((h) => { if (live) setHeld(h); }, () => { if (live) setHeld(null); });
    return () => { live = false; };
  }, [svc, k?.id, n]);
  return held;
}

/**
 * A kept trade's way back (the audit's MUST, 7 Nov; the copy review's words): some in Ref's lost and found: its amount and Get it back (the
 * core signs claim_lostfound; one tx however often it is tapped, on this card or another kept one of the coin; then the
 * trades are done and booked once); none: who to ask, the facts behind Show details, each with Copy (keptWay).
 */
function KeptWay({ k, view, onClaim, running }: { k: KeptFacts; view: KeptView; onClaim: () => void; running: boolean }) {
  const [details, setDetails] = useState(false);
  const copy = (v: string) => { void navigator.clipboard?.writeText(v).catch(() => undefined); };
  return (
    <div className="tr-kept" data-testid="kept-way">
      {view.body && <p className="zf-small">{view.body}</p>}
      {view.claim && (running
        ? <p className="zf-small">{keptRunning(k.symbol, KEPT_CLAIM_SEC)}</p>
        : <button className="zf-btn tr-kept-go" onClick={onClaim}>{view.claim.label}</button>)}
      {view.details && (details
        ? <div className="tr-kept-details"><p className="zf-small">{view.details.head}</p>
            {view.details.rows.map((r) => (
              <div key={r.label} className="tr-kept-row"><span className="l">{r.label}</span><span className="v">{r.value}</span>
                <button className="zf-link tr-kept-copy" onClick={() => copy(r.value)}>Copy</button></div>
            ))}</div>
        : <button className="zf-link tr-kept-more" onClick={() => setDetails(true)}>{view.details.open}</button>)}
    </div>
  );
}

export function JobCard({ card }: { card: Card }) {
  const { showWaiting } = useShell();
  const { svc } = useTrade();
  const live = openByDefault(card);
  const [open, setOpen] = useState(live);
  useEffect(() => { if (live) setOpen(true); }, [live]);
  // a kept trade (the audit's MUST, 7 Nov): Rhea's lost and found read, its head in the row; a claim's receipt stays once done
  const [n, setN] = useState(0);
  const [claim, setClaim] = useState<{ at: number; done?: [string, string] }>();
  const held = useKeptHeld(card.kept, n);
  const kv = card.kept ? keptWay(card.kept, held) : undefined;
  const k = card.kept;
  const onClaim = () => {
    if (!k || claim) return;
    const at = Date.now();
    setClaim({ at });
    void svc.claimKept(k.id).catch(() => undefined).then((r) => {
      if (r) setClaim({ at, done: keptDone(k, r.got, Date.now() - at) });   // the service's save redraws the card done
      else { setClaim(undefined); setN((x) => x + 1); }
    });
  };
  // what moved and when, or, for one that didn't go, why (its result says where the money is). T2-6 (the copy review's walk, 8 Nov):
  // when is the clock time ("8:15 am") by the service's own clock; "now" only in the row's first 60 s, then redrawn
  const at = (svc.now ?? Date.now)();   // a stand-in service (a test's) without its own clock: the wall's
  const [, redraw] = useState(0);
  useEffect(() => {
    const left = 60_000 - (at - card.at);
    if (left <= 0) return;
    const t = setTimeout(() => redraw((x) => x + 1), left + 50);
    return () => clearTimeout(t);
  }, [card.at, at]);
  const sub = kv ? kv.head : card.badge === "Didn't go" || card.badge === "Check" ? card.result : [card.units ?? (card.coin ? undefined : card.result), whenWords(card.at, at)].filter(Boolean).join(" · ");
  return (
    <article className={`tr-card tr-act${card.status ? (card.badge === "Didn't go" ? " is-off" : card.badge === "Check" ? " is-check" : " is-live") : ""}`} aria-label={card.title}>
      <button className="tr-card-hd" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <CardLogo card={card} />
        <span className="ac-mid"><span className="t">{card.title}</span><span className="d">{sub}</span></span>
        <span className="ac-right">
          {card.usd !== undefined && <span className="ac-usd">{usd(card.usd)}</span>}
          {card.status && <span className="ac-status">{card.status}</span>}
        </span>
      </button>
      {open && (
        <ol className="tr-steps" aria-label="What happened">
          {card.steps.map((s, i) => (
            <li key={s.label} className={`tr-step tr-step--${s.state}`}>
              <i aria-hidden="true">{s.state === "done" ? <Check /> : s.state === "now" ? <b className="zf-live" /> : i + 1}</i>
              <span>{s.label}{s.note && <small>{s.note}</small>}</span>
              <small className="tr-step-at">{s.state === "done" && s.at ? clock(s.at) : s.state === "now" && s.etaSec !== undefined ? about(s.etaSec) : ""}</small>
            </li>
          ))}
        </ol>
      )}
      {open && k && kv && <KeptWay k={k} view={kv} onClaim={onClaim} running={!!claim} />}
      {claim?.done && <div className="tr-kept" data-testid="kept-done"><p className="zf-small">{claim.done[0]}</p><p className="zf-small">{claim.done[1]}</p></div>}
      {open && card.held && <button className="zf-link tr-card-held" onClick={() => showWaiting(card.held!)}>See it in Waiting</button>}
    </article>
  );
}
