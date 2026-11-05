// Private (D27): a small separate wallet for private payments, Security's pocket with an ordinary key, capped at $100.
// Its own screen says what it is in Security's words, verbatim; Add to Private is the one pill. Moving money in shows on
// chain, which the screen and the approval sheet both say; what's done with it after doesn't.
import { useEffect, useRef, useState } from "react";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { runJob } from "@zerofee/shell-api/job-run.ts";
import { JOB_WORDS } from "@zerofee/shell-api/job-start.ts";
import { mark } from "@zerofee/design/tap.ts";
import { JobReceipt, THROUGH_CONFIDENTIAL } from "../money/JobMade.tsx";
import type { Problem } from "@zerofee/core/problem";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { Keypad } from "@zerofee/design/Keypad.tsx";
import { isPositive } from "@zerofee/design/keypad.ts";
import type { Balance, Movement, Quote } from "../../types.ts";
import { More } from "@zerofee/design/More.tsx";
import { PRIVATE_HOW, PRIVATE_MORE, PRIVATE_SEEN, PRIVATE_WORDS, amountOf, coins, dollars, placeOf, oldWalletsLine, privateAllUsd, privateUsd } from "../format.ts";
import { Down, PrivateMark } from "../icons.tsx";
import { useWallet } from "../runtime.tsx";

/** Under "Job created." on Private's way home (copywriter, 5 Nov). */
export const PRIVATE_JOB_WATCH = "Watch it in Activity.";

/** `onMove`: Move with Private as its source (the copy review's walk, 5 Nov), offered once Private holds money. */
export function PrivateScreen({ onAdd, onSetUp, onDefault, onProblem, onMove }: { onAdd: () => void; onSetUp: () => void; onDefault: (on: boolean) => void; onProblem: (p: Problem) => void; onMove?: () => void }) {
  const { pocket, bridge, refresh } = useWallet();
  const { tasks } = useShell();
  const rows = pocket?.rows ?? [];
  const ready = pocket?.ready ?? false;
  const [moving, setMoving] = useState<"no" | "asking" | "sent">("no");
  // The way out, always offered while anything is in the pocket (even while Private is closed to new money).
  // the job (bug report, 5 Nov): the private balance is a hot key, so the job is made at the tap ("Job created.", its row
  // on Home and in Activity, the bell's pulse); a refusal after is said on its row, one before it (taken) here
  const home = async () => {
    if (moving === "asking") return;
    mark("tap");
    setMoving("asking");
    const end = await runJob<Movement[]>({
      tasks, title: "Move your Private balance to your Safe", usd: dollars(privateUsd(rows)), safe: false, money: ["private"],
      call: () => bridge.call<Movement[]>("ledger.fromPrivate", {}),
      declined: (r) => "problem" in r && /declined$/.test(r.problem.code),
      made: () => { mark("away"); setMoving("sent"); },
    });
    if ("declined" in end) return setMoving("no");
    if ("refused" in end) { setMoving("no"); return onProblem(end.refused); }
    if ("problem" in end) return void mark("refused");
    end.job.made(end.ok.map((m) => `send:${m.id}`));
    refresh();
  };
  return (
    <div className="wl wl-coin zf-enter">
      <div className="wl-total">
        <PrivateMark size={44} />
        <p className="wl-display">{dollars(pocket ? privateAllUsd(pocket) : privateUsd(rows))}</p>
        <p className="zf-small">Private · up to $10,000</p>
      </div>
      <div className="wl-where">
        <div className="zf-label">In Private</div>
        {rows.map((r) => (
          <div className="wl-kv" key={r.tokenId}>
            <span><CoinIcon symbol={r.symbol} icon={r.icon} size={20} />{r.symbol}</span>
            <span>{amountOf(r.amount, r.symbol)}</span>
          </div>
        ))}
        {rows.length === 0 && !pocket?.oldWords && <p className="zf-small wl-explain">{ready ? "Nothing here yet." : "Not set up yet."}</p>}
        {/* Security audit 4 Nov, finding 2: money under replaced words, moving here; never hidden, with Try again. */}
        {pocket?.oldWords && (
          <>
            <div className="zf-label">In your old wallets</div>
            {pocket.oldWords.rows.map((r) => (
              <div className="wl-kv" key={`old-${r.tokenId}`}>
                <span><CoinIcon symbol={r.symbol} icon={r.icon} size={20} />{r.symbol}</span>
                <span>{amountOf(r.amount, r.symbol)}</span>
              </div>
            ))}
            <p className="zf-small wl-explain" role="status">{oldWalletsLine(pocket.oldWords)}</p>
            {(pocket.oldWords.stuck || pocket.oldWords.unread) && <button className="zf-link" onClick={() => void bridge.call("ledger.oldWordsMove", {}).then(refresh)}>Try again</button>}
          </>
        )}
        {ready && (
          <button className="wl-kv wl-kv-btn" onClick={() => onDefault(!pocket?.defaultOn)} aria-pressed={pocket?.defaultOn ?? false}>
            <span>Use for payments by default</span>
            <span>{pocket?.defaultOn ? "On" : "Off"}</span>
          </button>
        )}
        {rows.length > 0 && (moving === "sent"
          ? <p className="zf-small wl-explain" role="status" data-testid="private-home-made">{JOB_WORDS.created} {THROUGH_CONFIDENTIAL} {PRIVATE_JOB_WATCH}</p>
          : <button className="zf-link" disabled={moving === "asking"} onClick={() => void home()}>{moving === "asking" ? "Moving…" : "Move it all to your Safe"}</button>)}
        <p className="zf-small wl-explain">{PRIVATE_WORDS}</p>
        <More label="What to know about your private balance" lines={[...PRIVATE_MORE, PRIVATE_SEEN, ...PRIVATE_HOW]} />
      </div>
      <div className="zf-fill" />
      <div className="zf-floor">
        {/* data and handler only; its look is the copy review's */}
        {ready && rows.length > 0 && onMove && <button className="zf-btn" data-testid="private-move" onClick={onMove}>Move</button>}
        <button className="zf-btn" onClick={ready ? onAdd : onSetUp}>{ready ? "Add to your private balance" : "Set up your private balance"}</button>
      </div>
    </div>
  );
}

/** Coins that can move into Private: listed coins native to NEAR, in the ledger or on the account (route B). */
/** Kept in step with WalletApp.tsx's own copy (the screen loads later; review: one rule). */
export const canGoPrivate = (b: Balance) => b.listed !== false && b.held !== "private" && b.chain === "near" && !b.bridged;

/** What "Private" is, said where the Move into it is first approved (first-time hunt, 5 Nov; words only). */
export const PRIVATE_IS = "Private is your NEAR wallet the public can't see into.";

export function AddToPrivate({ from, onPickFrom, onDone, onProblem, onHeld }: {
  from: Balance | null;
  onPickFrom: () => void;
  onDone: (m?: Movement) => void;
  onProblem: (p: Problem) => void;
  onHeld: (held: NonNullable<Movement["held"]>) => void;
}) {
  const { bridge, chains, tokens } = useWallet();
  const { tasks } = useShell();
  /** The job is made: what it moves, and the receipt shows ("Job created.") until Done. */
  const [made, setMade] = useState<string | null>(null);
  const ended = useRef<{ m?: Movement; closed?: boolean }>({});
  const [amount, setAmount] = useState("0");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const symbol = from?.symbol ?? "";
  const decimals = Math.min(6, from?.tokenId === "near" ? 24 : tokens.get(from?.tokenId ?? "")?.decimals ?? 6);

  useEffect(() => {
    setQuote(null);
    setWhy(null);
    if (!from || !isPositive(amount)) return;
    let live = true;
    const t = setTimeout(() => {
      void bridge.call<Quote>("ledger.quoteToPrivate", { tokenId: from.tokenId, amount }).then((r) => {
        if (!live) return;
        if ("ok" in r) setQuote(r.ok);
        else setWhy(r.problem.whatHappened);
      });
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [bridge, from?.tokenId, amount]);

  // the job (bug report, 5 Nov): made on this move's own Face ID yes (the Safe's Approve), or on the core's answer when
  // no yes is heard here (the phone's own chip sheet); a No makes nothing. A refusal after is said on its row.
  const go = async () => {
    if (!quote || busy) return;
    mark("tap");
    setBusy(true);
    const what = `${coins(amount, decimals)} ${symbol}`.trim();
    const end = await runJob<Movement>({
      tasks, title: `Move ${what} to your Private balance`, safe: true, money: ["safe"],
      call: () => bridge.call<Movement>("ledger.toPrivate", { quoteId: quote.id }),
      declined: (r) => "problem" in r && /declined$/.test(r.problem.code),
      made: () => { setMade(what); setBusy(false); },
    });
    setBusy(false);
    if ("declined" in end) return setMade(null);
    if ("refused" in end) { mark("refused"); return onProblem(end.refused); }
    if ("problem" in end) return void mark("refused");
    const m = end.ok;
    end.job.made(m.status === "waiting" ? [] : [`send:${m.id}`]);
    if (m.status === "waiting" && m.held) { setMade(null); return onHeld(m.held); }
    setAmount("0");
    if (ended.current.closed) return;
    ended.current.m = m;
  };
  const doneMade = () => { const m = ended.current.m; ended.current = { closed: true }; setMade(null); onDone(m); };

  if (made !== null) {
    return (
      <div className="wl wl-convert">
        <JobReceipt amount={made} icon={<PrivateMark size={44} />} testid="private-add-made" onDone={doneMade} />
      </div>
    );
  }

  return (
    <div className="wl wl-convert">
      <button className="wl-chain" onClick={onPickFrom}>
        {from ? <CoinIcon symbol={from.symbol} icon={from.icon} size={24} /> : null}
        <span>{from ? from.symbol : "Choose a coin"}</span>
        {from && <span className="zf-small wl-place">{placeOf(from, chains)}</span>}
        <span className="wl-change">{from ? amountOf(from.amount, from.symbol) : ""} <Down /></span>
      </button>
      <div className="wl-amount">
        <p className="wl-big">{coins(amount, decimals)} <small>{symbol}</small></p>
        <p className="zf-small" aria-live="polite">
          {quote ? `In your private balance: about ${amountOf(quote.amountOut, symbol)} ${symbol} · at least ${amountOf(quote.minOut, symbol)}` : why ?? (isPositive(amount) && from ? "Getting a price…" : " ")}
        </p>
      </div>
      <Keypad value={amount} decimals={decimals} onChange={setAmount} />
      <div className="zf-floor">
        <button className="zf-btn" disabled={!quote || busy} onClick={() => void go()}>{busy ? "Moving…" : `Move ${coins(amount, decimals)} ${symbol} to your private balance`.replace(/\s+/g, " ").trim()}</button>
        <p className="zf-small" data-testid="private-is">{PRIVATE_IS}</p>
        <p className="zf-small">{PRIVATE_SEEN}</p>
      </div>
    </div>
  );
}
