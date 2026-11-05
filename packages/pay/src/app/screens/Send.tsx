// Send: pick a person (contacts kept on this phone) or type a NEAR name or address, type the amount, send. A friend
// who uses ZeroFee gets it inside the ledger in a couple of seconds; anyone else gets it on their own chain.
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Problem } from "@zerofee/core/problem";
import { Keypad } from "@zerofee/design/Keypad.tsx";
import { More } from "@zerofee/design/More.tsx";
import { isPositive } from "@zerofee/design/keypad.ts";
import { add, compare, round, sub } from "../../amount.ts";
import { AddPerson, Person } from "@zerofee/design/Person.tsx";
import { shortAddress, chainName } from "../../chains.ts";
import type { Balance, Movement } from "@zerofee/wallet/types.ts";
import { payProblems } from "../../pay-problems.ts";
import { didYouMean, findRecipient, type Recipient } from "../../send.ts";
import { readCopied } from "../clipboard.ts";
import { isUsdStable } from "../../tokens.ts";
import { shown } from "../format.ts";
import type { Prefill } from "../links.ts";
import { plainName, recentPeople, sameRecipient, type RecentPerson } from "../recent.ts";
import { usePay } from "../runtime.tsx";

export interface SendIntent {
  recipient: Recipient;
  /** A saved contact's name, or what the person typed: their own words. */
  name?: string;
  /** The name a link gives itself, unchecked (shown as "The code says it's …"). */
  label?: string;
  coin: Balance;
  amount: string;
  contactId?: string;
  /** From a link: the coin it asks for, its note and its reference. */
  askedTokenId?: string;
  note?: string;
  ref?: string;
}

/**
 * The coin a send starts with: the biggest dollar coin, else the biggest balance. To an address on another network, a
 * coin already on that network (paying across networks is converting, which this build doesn't do), so a Recent
 * person on Base is paid from the USDC on Base (the robot's pass 3: never a loop back to the keypad).
 */
function startingCoin(balances: Balance[], to?: Recipient | null): Balance | undefined {
  const byUsd = balances.filter((b) => b.listed !== false).sort((a, b) => Number(b.usd ?? 0) - Number(a.usd ?? 0));
  const first = (rows: Balance[]) => rows.find((b) => isUsdStable(b.symbol)) ?? rows[0];
  const there = to?.kind === "address" && to.chain ? byUsd.filter((b) => b.chain === to.chain && isPositive(b.amount)) : [];
  return first(there.length > 0 ? there : byUsd);
}

/**
 * `onScan`: the Scan button in the field: a friend's code is read by Scan, the same as any code. `person`: someone
 * tapped in Home's Recent, already picked. `onAddMoney`: Add money (Receive) on a coin's own network, for a shortfall.
 */
/** `oneScreen` (Job 1, the one money sheet; FLOW-V3: Send in 3 taps): who and how much on one screen. The name or
 *  address is looked up as it is typed, and the amount shows under it as soon as it is found: no "Use this address". */
export function Send({ onSend, onRequest, onScan, onAddMoney, onProblem, prefill, person, canSend, oneScreen = false }: { oneScreen?: boolean; canSend?: (r: Recipient) => string | null; onSend: (s: SendIntent) => void; onRequest?: () => void; onScan?: () => void; onAddMoney: (ask: { chain: string; amount: string; symbol: string; tokenId: string }) => void; onProblem: (p: Problem) => void; prefill?: Prefill | null; person?: RecentPerson | null }) {
  const { bridge, contacts, balances, self, flow } = usePay();
  const people = contacts?.list() ?? [];
  // People sent to lately and not saved yet, from Activity: shown beside the saved ones, so nobody starts from "New".
  const [recent, setRecent] = useState<RecentPerson[]>([]);
  useEffect(() => {
    let live = true;
    void bridge.call<Movement[]>("ledger.activity", { limit: 20 }).then((r) => live && "ok" in r && Array.isArray(r.ok) && setRecent(recentPeople(r.ok, contacts?.list() ?? [])));
    return () => {
      live = false;
    };
  }, [bridge, contacts]);
  // The last person paid is already picked, so paying them again is the amount and one tap (ALPHA: one-click use).
  const lastPaid = people.find((p) => p.lastPaidAtIso);
  const [who, setWho] = useState<{ recipient: Recipient; name?: string; label?: string; contactId?: string } | null>(null);
  const picked = useRef(false);
  useEffect(() => {
    if (picked.current || prefill || !lastPaid) return;
    picked.current = true;
    setWho({ recipient: lastPaid.to, name: lastPaid.name, contactId: lastPaid.id });
    setTyping(false);
  }, [lastPaid, prefill]);
  const [typing, setTyping] = useState(oneScreen ? !person : people.length === 0 && !person);
  const [copiedNone, setCopiedNone] = useState(false);
  /** An address this build can't send to (the public release: networks the ledger can't pay out on), said at entry. */
  const [refused, setRefused] = useState<string | null>(null);
  /** A NEAR name with no account that is two letters or fewer from someone they've paid or saved (grade 02g, F21). */
  const [guess, setGuess] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [amount, setAmount] = useState("0");
  const [note, setNote] = useState<string | undefined>();
  const [linkCoin, setLinkCoin] = useState<string | undefined>();
  const [ref, setRef] = useState<string | undefined>();
  const coin = useMemo(() => balances.find((b) => b.tokenId === linkCoin && b.listed !== false) ?? startingCoin(balances, who?.recipient), [balances, linkCoin, who]);
  // Dollars first, as Home says them (UX walk 2 Nov): the coin's own dollar figure from Wallet's balance, so the same
  // money reads the same here. No price, no dollars: the coin amount alone.
  // A dollar coin (USDC, USDT) is a dollar each, as the approval sheet counts it, never a list's 0.9995.
  const stable = !!coin && isUsdStable(coin.symbol);
  const perCoin = stable ? 1 : coin && Number(coin.usd) > 0 && Number(coin.amount) > 0 ? Number(coin.usd) / Number(coin.amount) : null;
  const dollarsOf = (n: string) => (perCoin === null || !(Number(n) > 0) ? null : `$${(Number(n) * perCoin).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  // Dollars first on the keypad too (UX round 2: "Send is led by NEAR amounts"): with a price, the person types dollars
  // and the exact coin amount that leaves is said under them. A link's amount is in its coin, so it stays in the coin.
  // A dollar coin is typed in dollars too (J6: the demo's Send typed "1000 USDC"): the coin amount is the dollars.
  const [usd, setUsd] = useState("0");
  const [coinFixed, setCoinFixed] = useState(false);
  const byUsd = perCoin !== null && !!coin && !coinFixed;
  const typeUsd = (v: string) => {
    setUsd(v);
    const n = Number(v.replace(/\.$/, ""));
    setAmount(stable ? (n > 0 ? v.replace(/\.$/, "") : "0") : perCoin && n > 0 ? round((n / perCoin).toFixed(8), 4, "down") : "0");
  };

  // A NEAR name another app handed over (ZeroFee Chat's "send 5 USDC to alice.near"): Send looks it up itself, once,
  // and says what NEAR answered (J3 part 2; diff review M-B: never a word taken from the link).
  const [nameLine, setNameLine] = useState<string | null>(null);
  const linkedName = prefill && (prefill.recipient.kind === "near-wallet" || prefill.recipient.kind === "ledger") && prefill.recipient.accountId.includes(".") ? prefill.recipient.accountId : null;
  useEffect(() => {
    setNameLine(null);
    if (!linkedName) return;
    let live = true;
    void bridge.call<{ exists: boolean }>("ledger.recipientInfo", { accountId: linkedName }).then((r) => {
      if (live && "ok" in r) setNameLine(r.ok.exists ? "Exists on NEAR" : `There's no NEAR account called ${linkedName}.`);
    });
    return () => { live = false; };
  }, [bridge, linkedName]);

  // A link another app handed Pay: who, and how much if it says. The person confirms.
  useEffect(() => {
    if (!prefill) return;
    setWho({ recipient: prefill.recipient, label: prefill.label });
    setTyping(false);
    setAmount(prefill.amount ?? "0");
    setCoinFixed(!!prefill.amount);
    setNote(prefill.note);
    setLinkCoin(prefill.tokenId);
    setRef(prefill.ref);
  }, [prefill]);

  // The link's amount is in the link's coin. Not holding it: the amount goes, never the same number in another coin.
  const checkedLink = useRef<Prefill | null>(null);
  useEffect(() => {
    // Judged once the link's coin is in this screen's state: a link handed over after the balances were read (Wallet's
    // Send from another app) would otherwise be checked against the coin picked before it, and refused.
    if (!prefill?.tokenId || checkedLink.current === prefill || balances.length === 0 || linkCoin !== prefill.tokenId) return;
    checkedLink.current = prefill;
    if (coin?.tokenId === prefill.tokenId) return;
    setAmount("0");
    const asked = flow.tokens?.byAsset(prefill.tokenId);
    onProblem(payProblems.coinNeeded(asked ? flow.tokens!.label(asked) : "the coin the link asks for"));
  }, [prefill, coin, linkCoin, balances.length, flow, onProblem]);

  // Someone tapped in Home's Recent: picked, the keypad next.
  useEffect(() => {
    if (!person) return;
    picked.current = true;
    const saved = people.find((c) => sameRecipient(c.to, person.recipient));
    setWho(saved ? { recipient: saved.to, name: saved.name, contactId: saved.id } : { recipient: person.recipient, name: person.name });
    setTyping(false);
  }, [person]);

  const pickRecent = (r: RecentPerson) => {
    setWho({ recipient: r.recipient, name: r.name });
    setTyping(false);
    setNote(undefined);
    setRef(undefined);
    setLinkCoin(undefined);
  };
  const pickContact = (id: string) => {
    const c = people.find((p) => p.id === id);
    if (c) setWho({ recipient: c.to, name: c.name, contactId: c.id });
    // Picking someone else leaves the link behind: its note and reference were for its own recipient.
    setNote(undefined);
    setRef(undefined);
    setLinkCoin(undefined);
  };
  /** Who the pasted or typed text is: a saved person by name, a NEAR name, or an address (checked on its network). */
  const lookUp = async (value: string) => {
    if (!value.trim()) return;
    const found = await findRecipient(bridge, value, { contacts: contacts ?? undefined, self });
    setGuess(null);
    // A typo is said right under the field (one line, the field stays): the whole Problem screen is for the rest
    if ("problem" in found) {
      if (found.problem.code === "pay.send.recipient-missing") {
        const known = [...people, ...recent].flatMap((x) => { const r = "to" in x ? x.to : x.recipient; return r.kind === "address" ? [] : [r.accountId]; });
        setGuess(didYouMean(value.trim().toLowerCase(), known));
      }
      return found.problem.next.kind === "fix-input" ? setRefused(`${found.problem.whatHappened} Fix it, then tap Use this address.`) : onProblem(found.problem);
    }
    // A pasted link: the field shows the name or address read out of it, and a near: link's amount is filled in (G19).
    if (found.ok.fromLink) {
      setText(found.ok.fromLink.text);
      if (found.ok.fromLink.amount && balances.some((b) => b.tokenId === "near")) {
        setLinkCoin("near");
        setAmount(found.ok.fromLink.amount);
        setCoinFixed(true);
      }
    }
    const no = canSend?.(found.ok.recipient) ?? null;
    setRefused(no);
    if (no) return;
    const known = found.ok.contactId ? people.find((p) => p.id === found.ok.contactId) : undefined;
    setWho({ recipient: found.ok.recipient, ...(known ? { name: known.name, contactId: known.id } : {}) });
    if (!oneScreen) setTyping(false);
  };
  // One screen: the name or address is looked up a moment after the person stops typing (no tap to confirm it).
  useEffect(() => {
    if (!oneScreen || text.trim().length < 3) return;
    const t = setTimeout(() => void lookUp(text), 450);
    return () => clearTimeout(t);
  }, [oneScreen, text]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void lookUp(text);
  };
  // Paste fills the field and goes straight on to the amount (UI's robot walk: three taps after a paste).
  const paste = async () => {
    const copied = await readCopied(bridge);
    // Nothing copied: said right under the field, nothing else moves (the robot's pass 2).
    setCopiedNone(!copied);
    if (!copied) return;
    setText(copied);
    await lookUp(copied);
  };
  // Someone new is saved once the send goes through (PayApp), so a send that doesn't never leaves a second face.
  const sendNow = () => {
    if (!who || !coin) return;
    // Someone picked from Recent is checked too: an address this build can't pay out to never reaches the sheet.
    const no = canSend?.(who.recipient) ?? null;
    if (no) return onProblem({ code: "pay.send.network-unsupported", whatHappened: no, money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "Use another address" } });
    onSend({ ...who, ...(who.contactId ? {} : { name: who.name ?? plainName(who.recipient) }), coin, amount: amount.replace(/\.$/, ""), askedTokenId: linkCoin, note, ref });
  };
  const where = who && (who.recipient.kind === "address" ? shortAddress(who.recipient.address) : who.recipient.accountId);
  // One payment takes one coin from one place (send.ts), so Send's figure can be less than Wallet's row for the coin
  // (the same coin on other chains, or on the account itself): say the whole in the same line (Wallet's suggestion).
  // More than this coin holds: say the exact gap here, before any sheet (the robot's pass 3).
  const short = coin && isPositive(amount) && compare(amount.replace(/\.$/, ""), coin.amount) > 0 ? sub(amount.replace(/\.$/, ""), coin.amount) : null;
  const on = coin && coin.chain !== "near" ? ` on ${chainName(coin.chain)}` : "";
  const inAll = coin ? balances.filter((b) => b.symbol === coin.symbol && b.listed !== false).reduce((sum, b) => add(sum, b.amount), "0") : "0";
  // Wallet's own figure for the coin (the hub's 7.1993 NEAR, not "7.19"): cents for dollars, 4 places for the rest.
  const places = coin && isUsdStable(coin.symbol) ? 2 : 4;
  const all = coin ? round(coin.amount, places, "down") : "0";
  // The real gap, rounded up so adding it is always enough (grade 02f, F7: "needs 0.80 more" for a gap of 0.8007). NEAR's
  // own fee comes out of the 0.06 NEAR Wallet keeps apart for fees, never out of the amount; another chain's fee is on top.
  const need = short ? shown(short, places, "up") : "";
  const feeWords = !coin ? "" : coin.tokenId === "near" ? " Its fee comes from the NEAR kept back for fees." : coin.chain !== "near" ? " Its network fee comes on top, shown before you pay." : "";

  return (
    <div className="py py-col">
      {people.length + recent.length > 0 && <div className="zf-label" style={{ marginBottom: 8 }}>Recent</div>}
      <div className="py-people" role="group" aria-label="People">
        {people.map((p) => <Person key={p.id} name={p.name} picked={who?.contactId === p.id} onPick={() => pickContact(p.id)} />)}
        {recent.filter((r) => !people.some((c) => sameRecipient(c.to, r.recipient))).map((r) => <Person key={r.key} name={r.name} picked={!who?.contactId && Boolean(who) && sameRecipient(who!.recipient, r.recipient)} onPick={() => pickRecent(r)} />)}
        <AddPerson onAdd={() => { setWho(null); setTyping(true); }} />
      </div>

      {typing && (
        // The form fills the screen, so its one pill sits low, under the thumb (02f, E17: it was at y 221 of 844).
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", flex: oneScreen ? "none" : 1 }}>
          <label className="py-field">
            <input autoFocus value={text} onChange={(e) => { setText(e.target.value); setCopiedNone(false); setRefused(null); setGuess(null); if (oneScreen) setWho(null); }} placeholder={onScan ? "Paste an address or scan a code" : "Paste an address or a NEAR account"} aria-label="Who to send to" />
            {onScan && <button type="button" className="py-change" onClick={onScan}>Scan</button>}
          </label>
          {copiedNone && <p className="zf-small" role="status" style={{ marginTop: 8 }}>Nothing copied yet. Copy their address, then tap Paste.</p>}
          {/* One screen: while the name is looked up, one quiet line says so (never a field that seems to do nothing). */}
          {oneScreen && text.trim().length >= 3 && !who && !refused && !guess && <p className="zf-small" role="status" style={{ marginTop: 8 }}>Looking up {text.trim()}…</p>}
          {refused && <p className="zf-small" role="status" style={{ marginTop: 8 }}>{refused}</p>}
          {guess && <button type="button" className="zf-link" style={{ display: "block", minHeight: 44 }} onClick={() => { setText(guess); setRefused(null); void lookUp(guess); }}>Did you mean {guess}?</button>}
          {!oneScreen && <div className="zf-fill" />}
          {/* Empty: the pill pastes, and the clipboard is read on this tap only (D33). Typed: Continue. */}
          <div className="py-floor">
            {text.trim()
              ? !oneScreen && <button className="zf-btn">Use this address</button>
              : <button type="button" className="zf-btn" onClick={() => void paste()}>Paste the address you copied</button>}
          </div>
          {onRequest && <button type="button" className="zf-link" style={{ display: "block", margin: "0 auto" }} onClick={onRequest}>Ask for money instead</button>}
        </form>
      )}
      {(!typing || (oneScreen && who)) && (
        <>
          <div className="zf-fill py-center" style={{ display: "grid", placeContent: "center", gap: 8 }}>
            <div className="py-mono">{where ?? "Pick someone"}</div>
            {/* A NEAR name, looked up by Send itself (J3 part 2: names as addresses): it exists, or one line says it doesn't.
                Never a mark that it is anyone in particular. */}
            {nameLine && <p className="zf-small" role="status" data-testid="send-name">{nameLine}</p>}
            {note && <p className="zf-small">{note}</p>}
            {byUsd ? (
              <>
                <div className="py-big"><small>$</small>{usd}</div>
                {isPositive(amount) && <p className="zf-small">{shown(amount, places)} {coin!.symbol}</p>}
              </>
            ) : (
              <>
                <div className="py-big">{amount} <small>{coin?.symbol ?? ""}</small></div>
                {dollarsOf(amount) && <p className="zf-small">About {dollarsOf(amount)}</p>}
              </>
            )}
            {/* One payment comes from one place (S3), so this is what one send can take, not the Wallet total. */}
            {coin && short
              ? <p className="zf-small" role="status">You have {shown(coin.amount, places)} {coin.symbol}{on}; this needs {need} more.{feeWords}</p>
              // One line (J6, demo/017: two sentences under the amount): what one send can take, in dollars; the rest of
              // the coin elsewhere is one tap down.
              : coin && (
                <>
                  <p className="zf-small">{dollarsOf(coin.amount) ? (stable ? dollarsOf(coin.amount) : `${dollarsOf(coin.amount)} (${shown(coin.amount, places)} ${coin.symbol})`) : `${shown(coin.amount, places)} ${coin.symbol}`}{on} ready to send</p>
                  {inAll !== coin.amount && Number(inAll) > Number(coin.amount) && <More label={`Your other ${stable ? `$${shown((Number(inAll) - Number(coin.amount)).toFixed(6), 2)}` : `${shown((Number(inAll) - Number(coin.amount)).toFixed(6), 2)} ${coin.symbol}`}`} lines={["One payment comes from one place. Send the rest as a second payment."]} />}
                </>
              )}
            {/* Send all (grade 02f, F6): the whole figure above, never retyped. The fee figure is the sheet's alone (F1). */}
            {coin && !short && isPositive(all) && amount !== all && <button type="button" className="zf-link" style={{ justifySelf: "center" }} onClick={() => { setAmount(all); setUsd(byUsd ? (stable ? round(all, 2, "down") : (Number(all) * perCoin!).toFixed(2)) : "0"); }}>Send all {byUsd ? dollarsOf(all) : `${shown(all, places)} ${coin.symbol}`}</button>}
            {who?.recipient.kind === "ledger" && <p className="zf-small">Usually arrives in seconds.</p>}
          </div>
          {byUsd ? <Keypad value={usd} decimals={2} onChange={typeUsd} /> : <Keypad value={amount} decimals={places} onChange={setAmount} />}
          <div className="py-floor">
            {/* Short: the one pill is the way out, adding the gap on that coin's network; the dead Send goes (the robot's pass 5). */}
            {coin && short ? (
              <button className="zf-btn" onClick={() => onAddMoney({ chain: coin.chain, amount: round(short, places, "up"), symbol: coin.symbol, tokenId: coin.tokenId })}>Add {need} {coin.symbol}{on}</button>
            ) : (
              <>
                <button className="zf-btn" disabled={!who || !coin || !isPositive(amount)} onClick={sendNow}>
                  Send{isPositive(amount) && coin ? (byUsd ? ` ${dollarsOf(amount)}` : ` ${amount.replace(/\.$/, "")} ${coin.symbol}`) : ""}
                </button>
                {onRequest && <button className="zf-link" onClick={onRequest}>Ask for money</button>}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
