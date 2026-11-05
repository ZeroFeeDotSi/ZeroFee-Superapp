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
import { ago, usd } from "../format.ts";
import { openByDefault, type Card } from "../job-cards.ts";
import { useCoinDetail, useLogo } from "../runtime.tsx";

/** A step's time to the minute, "2:23 am" (UX audit 4 Nov: "02:23:36 AM" three times over). */
const clock = (at: number) => new Date(at).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s/g, " ").toLowerCase();

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

export function JobCard({ card }: { card: Card }) {
  const { showWaiting } = useShell();
  const live = openByDefault(card);
  const [open, setOpen] = useState(live);
  useEffect(() => { if (live) setOpen(true); }, [live]);
  // what moved and when, or, for one that didn't go, why (its result says where the money is)
  const sub = card.badge === "Didn't go" ? card.result : [card.units ?? (card.coin ? undefined : card.result), ago(card.at)].filter(Boolean).join(" · ");
  return (
    <article className={`tr-card tr-act${card.status ? (card.badge === "Didn't go" ? " is-off" : " is-live") : ""}`} aria-label={card.title}>
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
      {open && card.held && <button className="zf-link tr-card-held" onClick={() => showWaiting(card.held!)}>See it in Waiting</button>}
    </article>
  );
}
