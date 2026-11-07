// Details (D51, D52, D55, D56): every wallet behind the two pots, one tap from Home. Each row has its network, its full
// address (tap to copy), what it holds and its marks ("Key exported", old words). One wallet per network, shared by Trade,
// the apps and Chat; an older one is listed while it holds anything. The Safe's phone key never leaves the chip, so the
// Safe has no export: its backup is the 24 words, which the phone doesn't keep (SIMPLE-SUPERAPP-v2 §1.3): "Get new words"
// replaces them. A Spending wallet's key exports from one card after the list ("Show this wallet's key", then which wallet; 5 Nov,
// it was "Export key" on every card) behind a plain warning, a typed phrase (audit K-5), the core's own sheet and Face ID; on the phone it shows only on ZeroFee's own screen, which hides from screenshots (SecretSheet.swift). D56:
// after an export ZeroFee keeps using the wallet. "Behind the scenes" lists the quiet moves (refills, gas, older wallets).
import { useEffect, useState } from "react";
import type { Problem } from "@zerofee/core/problem";
import type { SpendingActivity, SpendingWallet } from "@zerofee/core/spending";
import { SIM_ACCOUNT, accountWords } from "@zerofee/chat/account-words.ts";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { More } from "@zerofee/design/More.tsx";
import { outsideShort } from "@zerofee/core/format";
import { Waiting } from "../Waiting.tsx";
import { ago, amountOf, coins, dollars, safeLines, type lines } from "../format.ts";
import { useWallet } from "../runtime.tsx";
import { ThisDevice } from "@zerofee/shell-api/approval-words.ts";
import { keyPlaceWords } from "@zerofee/shell-api/key-place.ts";
import { SHOW_KEY_PHRASE, marksOf, showKeyConfirmed, statusWords } from "../hub.ts";

const SHOWN_MS = 60_000;
const NETWORK: Record<string, string> = { near: "NEAR", sol: "Solana", hood: "Robinhood Chain", bsc: "BNB Chain", eth: "Ethereum", base: "Base", gnosis: "Gnosis", arb: "Arbitrum" };

import { copyText } from "../copy-text.ts";
const copy = copyText;

/** The Safe's address (the copy review's S4, 7 Nov): one row, "Your Safe address" with Copy; its id is never on the screen (it was
 *  "zf-sam…tnet"). Copy copies all of it. */
function AccountLine({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  // the copy review's Sim re-walk (5 Nov): the Sim's own "zf-account" is machine text, and nothing paid to it lands: it says Chat's
  // words for it (chat account-words.ts, "Sample account"), with no Copy
  if (id === SIM_ACCOUNT) return <p className="zf-small" data-testid="details-account">{accountWords(id)}</p>;
  return (
    <button className="wl-dt-addr" data-testid="details-account" aria-label="Copy your Safe's address" onClick={() => { void copy(id); setCopied(true); setTimeout(() => setCopied(false), 1600); }}>
      <span className="wl-dt-addr__text">{DETAILS_WORDS.address}</span>
      <span className="zf-chip">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function Address({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  // R2 (the design review §2.4): a long hex or base58 address shows short, in the core sheet's 6+6 form (outsideShort;
  // the copy review's ruling, 5 Nov: "677012…a4b809"), with the Copy chip; its groups
  // of four, to compare by eye (grade 01d Q13), open under "Show full address". Copy copies it whole.
  const long = /^[0-9a-zA-Z]{25,}$/.test(text);
  return (
    <>
      {/* the screen reader says what Copy copies, never the full address (QA, 5 Nov: "five full-hex wallets") */}
      <button className="wl-dt-addr" aria-label={`Copy ${label}'s address`} onClick={() => { void copy(text); setCopied(true); setTimeout(() => setCopied(false), 1600); }}>
        <span className="wl-dt-addr__text" translate="no">{long ? outsideShort(text) : text}</span>
        <span className="zf-chip">{copied ? "Copied" : "Copy"}</span>
      </button>
      {long && <More label="Show full address" className="wl-dt-more wl-dt-full"><code translate="no">{text.match(/.{1,4}/g)!.join(" ")}</code></More>}
    </>
  );
}

/** the copy review's S4 (7 Nov): the Safe card's words. Its first row is the address (the "Safe" heading names the card; 53, 7 Nov:
 *  no "Your Safe" line under it). Where the key is comes from the one platform table (key-place.ts): "the phone" only
 *  inside the iPhone app, "this device" in a browser. */
export const DETAILS_WORDS = { address: "Your Safe address" } as const;

/** The wallets' read didn't answer (MoneyHost's own words for it). */
export const WALLETS_DIDNT_ANSWER = "Your wallets didn't answer.";

export function Details({ onNewWords, onProblem }: { onNewWords: () => void; onProblem: (p: Problem) => void }) {
  // one source with Home (the grade of 3 Nov: Details said 324.9 NEAR $1,439.30 where Home said 326.9 NEAR $1,448.16):
  // the Safe Home shows, its pocket's coins counted under it (format.ts safeLines)
  const { bridge, kid, shown: view } = useWallet();
  const { balances, chains, earning, pocket } = view;
  const [account, setAccount] = useState<string | null>(null);
  /** Each network's wallet (its address), read here and not from Spending's balances (finding 8: Details showed only the
   *  Safe while Spending was unread); "failed" when the read didn't answer, with Try again. */
  const [wallets, setWallets] = useState<SpendingWallet[] | "failed" | null>(null);
  const [quiet, setQuiet] = useState<SpendingActivity[]>([]);
  const [behind, setBehind] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    // k-security crawl (4 Nov, S3: "Reading your account…" 15 s while NEAR was busy): the account's name is this device's
    // own record (account.id, no read on NEAR), so it shows at once; account.state no longer holds it up.
    void bridge.call<{ accountId: string } | null>("account.id").then((r) => {
      if (!live) return;
      if ("ok" in r && r.ok?.accountId) return setAccount(r.ok.accountId);
      // no record here to read (a demo's stand-in): the account's state, as before
      void bridge.call<{ account?: { accountId: string } }>("account.state").then((s) => live && "ok" in s && setAccount(s.ok.account?.accountId ?? null));
    });
    setWallets((w) => (w === "failed" ? null : w));
    void bridge.call<SpendingWallet[]>("spending.wallets").then((r) => live && setWallets("ok" in r && Array.isArray(r.ok) ? r.ok : "failed"), () => live && setWallets("failed"));
    void bridge.call<SpendingActivity[]>("spending.activity").then((r) => live && "ok" in r && setQuiet(r.ok.filter((x) => !x.shown)));
    return () => { live = false; };
  }, [bridge, tick]);
  // where the Safe's key is, as this platform can say it (key-place.ts); the web says it once, on the row
  const key = keyPlaceWords();
  const safe = balances ? safeLines(balances, pocket, chains, earning) : null;
  // Spending lists an older wallet only while it holds anything (D55); every other one always
  // Spending's own cash first, then one wallet per network (D55); an older one only while it holds anything
  const shown = [...(Array.isArray(wallets) ? wallets : [])].sort((a, b) => Number(b.role === "hub") - Number(a.role === "hub"));
  return (
    <div className="wl wl-dt zf-enter">
      <div className="zf-label wl-dt-head">Safe</div>
      <div className="wl-dt-card">
        {account ? <AccountLine id={account} /> : <p className="zf-small">Reading your account…</p>}
        {/* A list over 3 collapses (UI-SIMPLICITY-RULES 4): the three biggest coins, the rest one tap down. */}
        {safe && safe.lines.slice(0, 3).map((l) => <CoinRow key={l.key} l={l} />)}
        {safe && safe.lines.length > 3 && (
          <More label={`${safe.lines.length - 3} more coin${safe.lines.length - 3 === 1 ? "" : "s"}`} className="wl-dt-more">
            {safe.lines.slice(3).map((l) => <CoinRow key={l.key} l={l} />)}
          </More>
        )}
        <More label={key.neverLeaves} className="wl-dt-more" lines={[...(key.neverLeavesWhy ? [key.neverLeavesWhy] : []), "Your 24 backup words bring your Safe back on a new device, after its wait."]} />
      </div>
      <div className="wl-dt-card">
        <div className="wl-dt-row1"><span className="t">Backup words</span></div>
        {/* The one question this card answers first; how the words work one tap down (UI-SIMPLICITY-RULES 2, 10). */}
        <p className="zf-small">Lost your paper, or did someone see it?</p>
        <button className="zf-link wl-dt-act" onClick={onNewWords}>Get new words</button>
        <More label="About your words" className="wl-dt-more" lines={[`${ThisDevice()} doesn't keep them, so they can't be shown again.`, "New words take over after your Safe's wait."]} />
      </div>

      {/* a child's phone has no wallets (D30); Spending not answering yet is never that (finding 8) */}
      {kid !== true && (
        <>
          <div className="zf-label wl-dt-head">Your wallets</div>
          {wallets === "failed" ? (
            <div className="wl-dt-note"><p className="zf-small" role="alert">{WALLETS_DIDNT_ANSWER}</p><button className="zf-link wl-dt-act" onClick={() => setTick((t) => t + 1)}>Try again</button></div>
          ) : !wallets ? <Waiting size={32} text="Reading your wallets…" /> : shown.length === 0 ? (
            <p className="zf-small wl-dt-note">Your wallets appear here after your first Top up.</p>
          ) : (
            <>
              {shown.map((w) => <WalletCard key={w.id} w={w} />)}
              {/* QA (5 Nov, Details C+: "Export key" ×5): one card for every wallet's key, after the list */}
              <KeysCard wallets={shown.filter((w) => w.role !== "hub")} onProblem={onProblem} onExported={() => setTick((t) => t + 1)} />
            </>
          )}
          {quiet.length > 0 && (
            <>
              <button className="wl-row wl-more" aria-expanded={behind} onClick={() => setBehind(!behind)}><span className="t">Behind the scenes</span><span className="zf-small">{quiet.length}</span></button>
              {behind && quiet.map((m) => (
                <div className="wl-row wl-row-2" key={m.id}>
                  <div><div className="t">{m.words}</div><div className="d">{statusWords(m)}</div></div>
                  <div className="r"><div className="vd">{ago(m.atIso, Date.now())}</div></div>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** One of the Safe's coins: its amount, then its dollars. */
function CoinRow({ l }: { l: ReturnType<typeof lines>["lines"][number] }) {
  return (
    <div className="wl-kv">
      <span><CoinIcon symbol={l.symbol} icon={l.listed ? l.icon : undefined} size={20} />{l.listed ? `${amountOf(l.amount, l.symbol)} ${l.symbol}` : `${coins(l.amount)} · Unlisted coin`}</span>
      <span>{l.usd !== undefined ? dollars(l.usd) : ""}</span>
    </div>
  );
}

const networkOf = (w: SpendingWallet) => NETWORK[w.network] ?? w.network;
const nameOf = (w: SpendingWallet) => (w.role === "hub" ? "Your NEAR wallet's cash" : w.label);
const shortAddress = (a: string) => (/^[0-9a-zA-Z]{25,}$/.test(a) ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

/** The Details words for a wallet's key (the Copywriter, 5 Nov). */
export const KEY_WORDS = { head: "A wallet's key", note: "Use it to open a wallet in another app.", show: "Show this wallet's key", pick: "Which wallet?", hub: "Its key stays in ZeroFee." } as const;

function WalletCard({ w }: { w: SpendingWallet }) {
  const name = nameOf(w);
  const marks = marksOf(w);
  return (
    <div className="wl-dt-card">
      <div className="wl-dt-row1"><span className="t">{name}</span><span className="zf-small">{networkOf(w)}</span></div>
      {marks.length > 0 && <div className="wl-dt-marks">{marks.map((m) => <span key={m} className={`wl-tag${m === "Key exported" ? " wl-tag-alert" : ""}`}>{m}</span>)}</div>}
      <Address text={w.address} label={name} />
      <div className="wl-kv"><span>Holds</span><span>{w.unread ? "Can't see it right now" : w.holds ? w.holds : Number(w.coinsUsd) > 0 ? `${dollars(w.cashUsd ?? "0")} cash · ${dollars(w.coinsUsd ?? "0")} in coins` : dollars(w.cashUsd ?? "0")}</span></div>
      {w.role === "older" && <p className="zf-small wl-dt-note">An older wallet. Its cash moves to your {networkOf(w)} wallet; coins stay until sold.</p>}
      {w.role === "chain" && !w.inCap && <p className="zf-small wl-dt-note">Used by your apps on {networkOf(w)}. Outside your Trade limit.</p>}
      {w.role === "hub" && <p className="zf-small wl-dt-note">{KEY_WORDS.hub}</p>}
    </div>
  );
}

/** Every wallet's key in one place: "Show this wallet's key", which wallet, then the same warning, typed phrase and export as before
 *  (audit K-5; the core's own sheet and Face ID). The NEAR wallet's cash has no key to show (it stays in ZeroFee). */
function KeysCard({ wallets, onProblem, onExported }: { wallets: SpendingWallet[]; onProblem: (p: Problem) => void; onExported: () => void }) {
  const [picking, setPicking] = useState(false);
  const [id, setId] = useState<string | null>(null);
  const w = wallets.find((x) => x.id === id);
  if (wallets.length === 0) return null;
  return (
    <div className="wl-dt-card" data-testid="details-keys">
      <div className="wl-dt-row1"><span className="t">{KEY_WORDS.head}</span></div>
      {w ? (
        <>
          <div className="wl-dt-row1"><span className="zf-small">{`${nameOf(w)} · ${networkOf(w)} · ${shortAddress(w.address)}`}</span></div>
          <KeyExport key={w.id} w={w} onProblem={onProblem} onExported={onExported} onDone={() => { setId(null); setPicking(false); }} />
        </>
      ) : picking ? (
        <>
          <p className="zf-small">{KEY_WORDS.pick}</p>
          <div className="wl-rows">
            {wallets.map((x) => (
              <button key={x.id} className="wl-row wl-row-2 wl-pick" onClick={() => setId(x.id)} data-testid="details-key-pick">
                <div><div className="t">{nameOf(x)}</div><div className="d">{`${networkOf(x)} · ${shortAddress(x.address)}`}</div></div>
              </button>
            ))}
          </div>
          <button className="zf-link wl-dt-act" onClick={() => setPicking(false)}>Not now</button>
        </>
      ) : (
        <>
          <p className="zf-small">{KEY_WORDS.note}</p>
          <button className="zf-link wl-dt-act" onClick={() => (wallets.length === 1 ? setId(wallets[0]!.id) : setPicking(true))}>{KEY_WORDS.show}</button>
        </>
      )}
    </div>
  );
}

/** One wallet's key export, as each card had it: the warning, the typed phrase, then the core's export. */
function KeyExport({ w, onProblem, onExported, onDone }: { w: SpendingWallet; onProblem: (p: Problem) => void; onExported: () => void; onDone: () => void }) {
  const { bridge } = useWallet();
  const [typed, setTyped] = useState("");
  const [shown, setShown] = useState<{ key?: string; native?: true } | null>(null);
  useEffect(() => {
    if (!shown?.key) return;
    const t = setTimeout(() => setShown(null), SHOWN_MS);
    return () => clearTimeout(t);
  }, [shown]);
  const exportKey = async () => {
    setTyped("");
    const r = await bridge.call<{ secretKey?: string; shown?: boolean; declined?: true }>("spending.exportKey", { id: w.id });
    if ("problem" in r) return onProblem(r.problem);
    if (r.ok.secretKey) setShown({ key: r.ok.secretKey });
    else if (r.ok.shown) setShown({ native: true });
    if (r.ok.secretKey || r.ok.shown) onExported();
  };
  if (shown?.key) return (
    <div className="wl-dt-key">
      <p className="zf-small wl-dt-warn">Anyone who sees this key can take this wallet's money.</p>
      <p className="zf-small">Write it by hand. It hides in a minute.</p>
      <code translate="no">{shown.key}</code>
      <button className="zf-link wl-dt-act" onClick={() => { setShown(null); onDone(); }}>Hide</button>
    </div>
  );
  if (shown?.native) return (
    <>
      <p className="zf-small wl-dt-note" role="status">Shown on ZeroFee's own screen.</p>
      <button className="zf-link wl-dt-act" onClick={onDone}>Done</button>
    </>
  );
  return (
    <div className="wl-dt-key">
      <p className="zf-small wl-dt-warn">Anyone who sees this key can spend this wallet's money, now and later.</p>
      <More label="What showing it means" className="wl-dt-more" lines={[`Anyone with it can spend everything in your ${networkOf(w)} wallet. That includes what ZeroFee adds later, up to your limit.`, "ZeroFee keeps using this wallet.", "If you think someone saw the key, move its money to your Safe and get new words."]} />
      <p className="zf-small">To see it, type <b>{SHOW_KEY_PHRASE}</b>.</p>
      <input className="wl-dt-input" aria-label={`Type ${SHOW_KEY_PHRASE}`} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} />
      <div className="wl-dt-acts">
        <button className="zf-link wl-dt-act" disabled={!showKeyConfirmed(typed)} onClick={() => void exportKey()}>Show its key</button>
        <button className="zf-link wl-dt-act" onClick={() => { setTyped(""); onDone(); }}>Not now</button>
      </div>
    </div>
  );
}
