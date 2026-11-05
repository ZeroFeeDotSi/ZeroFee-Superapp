// A NEAR room in ZeroFee Chat (J3 part 2, "NEARchat" in docs): a room for an account (a Sputnik DAO's room is its
// account's room) or a coin, beside the city places. Here a person's name is their NEAR account, shown only once it is
// checked: the account's own key signed a note naming their chat key, and NEAR says that key is still the account's
// (names.ts). To talk here the person shows their NEAR name once (the core's sheet: nostr.bind). Messages are Nostr
// events on Chat's own message servers, tagged with the room; BitChat users don't see them.
//
// Money as everywhere in Chat: only the person's own words are read as a command, and a payment always opens Wallet's
// Send, filled in, then the core's sheet. Here a request chip shows only when its author is checked and it asks to be
// paid to that same account (security review M2); anything else is plain text.
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { More } from "@zerofee/design/More.tsx";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import type { NextStep, Problem } from "@zerofee/core/problem";
import type { NostrEvent } from "@zerofee/core/nostr";
import { ROOM_MESSAGE, roomFor } from "@zerofee/core/chat-near";
import { isDaoName, type DaoRole, type NearProfile } from "@zerofee/core/chat-reads";
import type { Bridge } from "@zerofee/core/bridge";
import { PushedFrame, useShell } from "@zerofee/shell-api/AppFrame.tsx";
import type { Movement } from "@zerofee/wallet/types.ts";
import type { AskCommand } from "../command.ts";
import { cancelText, cancelledIds, displayText, requestText, shown, type PayRequest, type Shown } from "../messages.ts";
import { NameBook, accountWords, markWord, postAsLine } from "../names.ts";
import { keepText, readKept, roomKeepKey } from "../room-keep.ts";
import { RelayPool, type PoolStatus } from "../pool.ts";
import { DM_RELAYS, localRelay } from "../relays.ts";
import { roomAccount, whereName } from "../rooms.ts";
import type { PaidBook } from "../paid.ts";
import { tipTarget } from "../tip.ts";
import { BubbleText, Composer, MyRequestLine, MyRequestSheet, PUBLIC_BUILD, REQUEST_CANCELLED, RequestChip, RequestSheet, TipLink, useMoney, type Moderation, type Note, type Store } from "./ChatApp.tsx";
import { EMPTY_PLACE, notSentWords } from "../first-use.ts";
import { onPhone } from "./location.ts";

const MAX_SHOWN = 200;
/** What one room has shown this visit, kept while the page lives. */
const keptRooms = new Map<string, Shown[]>();

/** A checked NEAR name: the account, then its mark in its own badge, which no nickname or profile text can sit in (M1).
 *  A sample account on the demo or a test-network name says so after the mark (L3). */
export function NameBadge({ account }: { account: string }) {
  const word = markWord(account);
  return (
    <span className="ch-name" data-testid="chat-near-name">
      <span className="ch-name__id">{accountWords(account)}</span>
      <span className="ch-mark" aria-label={word ? `checked, ${word}` : "checked on NEAR"}>✓{word ? <small>{word}</small> : null}</span>
    </span>
  );
}

/** The NEAR names of the keys on screen: their records from the servers (pool.names), checked (NameBook). Re-asks the
 *  servers only when the set of keys changes; at most 100 keys (security review M6). */
export function useNameBook(bridge: Pick<Bridge, "call">, relays: readonly string[], authors: readonly string[], active: boolean): { book: NameBook; seen: number } {
  const [seen, setSeen] = useState(0);
  const book = useMemo(() => new NameBook(bridge, () => setSeen((n) => n + 1)), [bridge]);
  const pool = useRef<RelayPool | null>(null);
  const wanted = [...new Set(authors)].sort().slice(0, 100).join(" ");
  useEffect(() => {
    if (!active) return;
    const p = new RelayPool(relays, (e) => book.see(e));
    pool.current = p;
    return () => {
      p.close();
      if (pool.current === p) pool.current = null;
    };
  }, [active, book, relays.join(" ")]);
  useEffect(() => {
    if (wanted) pool.current?.names(wanted.split(" "));
  }, [wanted, active]);
  return { book, seen };
}

/** "Open a room": a .near name (an account's or a DAO's room) or a coin. A name is looked up on NEAR first (one
 *  view_account): no such account is one line, and nothing opens. */
export function OpenRoomSheet({ onClose, onOpen }: { onClose: () => void; onOpen: (room: string) => void }) {
  const { bridge } = useShell();
  const [text, setText] = useState("");
  const [line, setLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const room = roomFor(text);
    if (!room) return setLine("Type a NEAR account, like alice.near, or a coin, like USDC.");
    const account = roomAccount(room);
    if (account) {
      setBusy(true);
      setLine(`Checking ${account}…`);
      const info = await bridge.call<{ exists: boolean }>("ledger.recipientInfo", { accountId: account });
      setBusy(false);
      if ("ok" in info && !info.ok.exists) return setLine(`There's no NEAR account called ${account}. Check it.`);
    }
    onOpen(room);
  };
  return (
    <Sheet title="Open a room" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)}>
        <input className="ch-input" value={text} onChange={(e) => { setText(e.target.value); setLine(null); }} placeholder="alice.near, a DAO, or USDC" aria-label="Room" autoCapitalize="off" autoCorrect="off" spellCheck={false} autoFocus data-testid="chat-room-name" />
        {line && <p className="zf-small" role="status" style={{ marginTop: 8 }} data-testid="chat-room-line">{line}</p>}
        <div className="zf-floor"><button className="zf-btn" disabled={!text.trim() || busy}>Open</button></div>
      </form>
    </Sheet>
  );
}

/** "Council: a.near, b.near, c.near and 2 more". */
const roleLine = (r: DaoRole) => `${r.name}: ${r.members.slice(0, 3).join(", ")}${r.members.length > 3 ? ` and ${r.members.length - 3} more` : ""}`;

export function Room({ room, account, store, moderation, paid, onPaid, sent, onLeave, onDao }: {
  room: string; account: string | null; store: Store; moderation: Moderation; paid: PaidBook; onPaid: (id: string, mark: { link?: string; atIso: string }) => void;
  sent: number; onLeave: () => void; onDao: (dao: string) => void;
}) {
  const shell = useShell();
  const { bridge } = shell;
  const title = whereName(room);
  const target = roomAccount(room);
  const isDao = !!target && isDaoName(target);
  const [messages, setMessages] = useState<Shown[]>(() => keptRooms.get(room) ?? []);
  const [status, setStatus] = useState<PoolStatus>({ open: 0, total: 0 });
  const [myKey, setMyKey] = useState<string | null>(null);
  const [named, setNamed] = useState<"asking" | "no" | "yes">("asking");
  const [text, setText] = useState("");
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<null | { ask?: AskCommand; line?: string }>(null);
  // k-chat crawl (4 Nov), as in a place: a request shows at once, and your own one opens its sheet
  const [pending, setPending] = useState<string | null>(null);
  const [myRequest, setMyRequest] = useState<{ m: Shown; request: PayRequest } | null>(null);
  const [person, setPerson] = useState<{ pubkey: string; account: string } | null>(null);
  const [others, setOthers] = useState(false);
  const [policy, setPolicy] = useState<{ roles: DaoRole[]; capped: boolean } | null>(null);
  const mine = useRef(new Set<string>());
  const posted = useRef(new Set<string>());
  const pool = useRef<RelayPool | null>(null);
  const waiting = useRef<NostrEvent[]>([]);
  const local = localRelay(globalThis.location?.search ?? "", PUBLIC_BUILD);
  const relays = local ? [local] : DM_RELAYS;
  const money = useMoney(room, store, setNote, onPaid, (ask) => setAsking({ ask }));

  const problem = async (p: Problem) => {
    const next: NextStep = await shell.showProblem(p);
    if (next.kind === "open" && next.screen.startsWith("security/")) shell.openApp("security", next.screen.slice("security/".length));
  };

  /** Posts an event on the room's servers (or keeps it until they are open). */
  const publish = async (e: NostrEvent) => {
    if (!pool.current) {
      waiting.current.push(e);
      return { ok: 0, of: relays.length };
    }
    return pool.current.publish(e);
  };

  // sd-chat crawl (5 Nov, b): what the room showed is kept on this device, and shown again after a reload (room-keep.ts)
  const events = useRef(new Map<string, NostrEvent>());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keep = () => {
    if (saveTimer.current !== undefined) return;
    saveTimer.current = setTimeout(() => {
      saveTimer.current = undefined;
      store.set(roomKeepKey(room), keepText([...events.current.values()], room));
    }, 300);
  };
  const add = (e: NostrEvent, kept = false) => {
    if (!events.current.has(e.id)) {
      events.current.set(e.id, e);
      if (!kept) keep();
    }
    setMessages((now) => {
      if (now.some((m) => m.id === e.id)) return now;
      const next = [...now, shown(e, mine.current, posted.current)].sort((a, b) => a.atIso.localeCompare(b.atIso)).slice(-MAX_SHOWN);
      keptRooms.set(room, next);
      return next;
    });
  };

  useEffect(() => {
    let live = true;
    void store.get(roomKeepKey(room)).then((raw) => { if (live) for (const e of readKept(raw, room)) add(e, true); });
    return () => { live = false; };
  }, [room]);

  // The room's servers, only while Chat is on screen.
  useEffect(() => {
    if (!shell.active) return;
    const p = new RelayPool(relays, (e) => add(e), setStatus);
    pool.current = p;
    p.room(room);
    for (const e of waiting.current.splice(0)) void p.publish(e);
    return () => {
      p.close();
      if (pool.current === p) pool.current = null;
    };
  }, [shell.active, room, relays.join(" ")]);

  const authors = messages.filter((m) => !m.mine).map((m) => m.pubkey);
  const { book } = useNameBook(bridge, relays, myKey ? [...authors, myKey] : authors, shell.active);

  // The person's key for NEAR rooms, and their NEAR name on it if they showed it before (signed again, no sheet).
  useEffect(() => {
    if (!account) return setNamed("no");
    void bridge.call<{ pubkey: string }>("nostr.publicKey", { room: true }).then((r) => {
      if (!("ok" in r)) return setNamed("no");
      mine.current.add(r.ok.pubkey);
      setMyKey(r.ok.pubkey);
      setMessages((now) => now.map((m) => (m.pubkey === r.ok.pubkey && !m.mine ? { ...m, mine: true, request: undefined } : m)));
    });
    void bridge.call<{ event: NostrEvent } | null>("nostr.bound", { room: true }).then((r) => {
      if ("ok" in r && r.ok) {
        book.mine(r.ok.event);
        void publish(r.ok.event);
        setNamed("yes");
      } else setNamed("no");
    });
  }, [bridge, account, room]);

  // A DAO's roles, from its get_policy (read on NEAR): who is in it. Being in it puts the room in "Your DAOs".
  useEffect(() => {
    if (!isDao || !target) return;
    let live = true;
    void bridge.call<{ policy: { roles: DaoRole[]; capped: boolean } | null }>("ledger.daoPolicy", { dao: target }).then((r) => {
      if (!live || !("ok" in r)) return;
      setPolicy(r.ok.policy);
      if (account && r.ok.policy?.roles.some((x) => x.members.includes(account))) onDao(target);
    });
    return () => { live = false; };
  }, [bridge, target, account]);

  const roleOf = (acct: string) => policy?.roles.find((r) => r.members.includes(acct))?.name ?? null;
  const members = policy ? new Set(policy.roles.flatMap((r) => r.members)).size : 0;
  const accountOf = (m: Shown) => (m.mine ? account : book.account(m.pubkey));
  const mutedAccounts = new Set(moderation.muted.filter((x) => x.pubkey.startsWith("near:")).map((x) => x.pubkey.slice(5)));
  const shownAll = messages.filter((m) => m.mine || (!moderation.hiddenIds.has(m.id) && !moderation.mutedKeys.has(m.pubkey) && !mutedAccounts.has(book.account(m.pubkey) ?? "")));
  // Checked names first: messages from keys with no checked name are folded away, one line says how many (M6).
  const unchecked = shownAll.filter((m) => !m.mine && !book.account(m.pubkey));
  const list = others ? shownAll : shownAll.filter((m) => m.mine || book.account(m.pubkey));
  const cancelled = cancelledIds(shownAll);

  const [activity, setActivity] = useState<Movement[]>([]);
  const chips = list.filter((m) => m.request && !paid[m.id]).length;
  useEffect(() => {
    if (!shell.active || chips === 0) return;
    let live = true;
    void bridge.call<Movement[]>("ledger.activity", { limit: 50 }).then((r) => { if (live && "ok" in r && Array.isArray(r.ok)) setActivity(r.ok); });
    return () => { live = false; };
  }, [shell.active, chips, sent]);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [list.length]);

  /** Show the NEAR name here: the core's sheet, then the record on the room's servers. */
  const showName = async () => {
    setBusy(true);
    try {
      const r = await bridge.call<{ event: NostrEvent } | { declined: true }>("nostr.bind", { room: true });
      if ("problem" in r) return void problem(r.problem);
      if ("declined" in r.ok) return setNote({ text: "Not now. You can read this room; to talk, use your NEAR account." });
      book.mine(r.ok.event);
      await publish(r.ok.event);
      setNamed("yes");
      setNote(null);
    } finally {
      setBusy(false);
    }
  };

  const post = async (content: string): Promise<boolean> => {
    setBusy(true);
    try {
      const r = await bridge.call<NostrEvent>("nostr.sign", { room, kind: ROOM_MESSAGE, content });
      if ("problem" in r) {
        void problem(r.problem);
        return false;
      }
      posted.current.add(r.ok.id);
      add(r.ok);
      const to = await publish(r.ok);
      if (to.ok === 0) setNote({ text: notSentWords({ online: globalThis.navigator?.onLine !== false, phone: onPhone() }) });
      return true;
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const typed = text.trim();
    if (!typed || busy) return;
    setNote(null);
    const asked = money.command(typed);
    if (asked === "done") return setText("");
    if (asked === "fix") return;
    if (await post(typed)) setText("");
  };

  // A send started here comes back here.
  const what = isDao ? `${members ? `${members} member${members === 1 ? "" : "s"}` : "A DAO"} · anyone can post` : "Anyone can post here";

  return (
    <PushedFrame name={title} mark={<span className={`ch-live${status.open > 0 ? " on" : ""}`} role="img" aria-label={status.open > 0 ? "Connected" : "Not connected yet"} data-testid="chat-live" />} onBack={onLeave}>
      <div className="ch ch-chat">
        <More label={what} className="ch-conn" lines={[
          isDao ? `The DAO ${target}. Who is in it comes from NEAR.` : target ? `A room about ${accountWords(target)}.` : `A room about ${title}.`,
          "Names here are NEAR accounts. A ✓ means NEAR shows it's really their account.",
          "Never pay because a message asks.",
          `${status.open > 0 ? "Connected" : "Connecting…"}${local ? " (on this computer)" : ""}.`,
        ]}>
          {policy && policy.roles.slice(0, 3).map((r) => <p key={r.name} className="zf-small" data-testid="chat-dao-role">{roleLine(r)}</p>)}
          {policy && policy.roles.length > 3 && <p className="zf-small">And {policy.roles.length - 3} more roles.</p>}
        </More>
        <div className="ch-list" ref={listRef} data-bar-stay="" data-testid="chat-list">
          {list.length === 0 && <p className="zf-small ch-empty" data-testid="chat-empty">{EMPTY_PLACE}</p>}
          {list.map((m) => {
            const acct = accountOf(m);
            const role = acct ? roleOf(acct) : null;
            const chip = m.request && acct && !m.mine && m.request.chain === "near" && m.request.address === acct ? m.request : null;
            return (
              <div key={m.id} className={`ch-msg${m.mine ? " ch-mine" : ""}`} data-testid="chat-msg">
                {m.mine
                  ? <div className="ch-who">You</div>
                  : acct
                    ? <button className="ch-who ch-whobtn" onClick={() => setPerson({ pubkey: m.pubkey, account: acct })} data-testid="chat-who"><NameBadge account={acct} />{role ? <span className="ch-role">{role}</span> : null}</button>
                    : <div className="ch-who" data-testid="chat-who-unchecked">Not checked</div>}
                <BubbleText text={displayText(m)} />
                {m.mine && !cancelled.has(m.id) && <MyRequestLine m={m} cancelled={false} onOpen={(request) => setMyRequest({ m, request })} />}
                {chip && cancelled.has(m.id) && <p className="zf-small ch-paid" role="status" data-testid="chat-request-cancelled">{REQUEST_CANCELLED}</p>}
                {chip && !cancelled.has(m.id) && <RequestChip request={chip} asked={m} who={acct!} money={money} paid={paid} activity={activity} me={account} />}
                {/* C-4: a room's authors are their checked accounts; an unchecked one gets no Tip */}
                {acct && <TipLink target={tipTarget({ pubkey: m.pubkey, mine: m.mine, text: m.text, ...(m.request ? { request: m.request } : {}) }, acct, [])} author={m.pubkey} id={m.id} who={acct} money={money} paid={paid} />}
              </div>
            );
          })}
          {pending && (
            <div className="ch-msg ch-mine ch-pending" data-testid="chat-pending">
              <div className="ch-who">You</div>
              <div className="ch-text">{pending}</div>
              <p className="zf-small" role="status">Posting…</p>
            </div>
          )}
          {!others && unchecked.length > 0 && (
            <button className="zf-link ch-others" onClick={() => setOthers(true)} data-testid="chat-unchecked">{unchecked.length} from names not checked · Show</button>
          )}
        </div>
        {note && <p className="zf-small ch-note" role="status" data-testid="chat-note">{note.text}</p>}
        {named === "yes" ? (
          <Composer text={text} busy={busy} placeholder="Message" label="Message" action="Post" onText={(t) => { setText(t); setNote(null); }} onSubmit={(e) => void submit(e)} onDollar={() => setAsking({})} />
        ) : named === "no" ? (
          <div className="ch-bind">
            <p className="zf-small">{postAsLine(account)}</p>
            {account && <button className="zf-btn" disabled={busy} onClick={() => void showName()} data-testid="chat-use-near-name">Use my NEAR account here</button>}
          </div>
        ) : null}
      </div>
      {money.picker}
      {myRequest && (
        <MyRequestSheet request={myRequest.request} cancelled={cancelled.has(myRequest.m.id)} audience={`everyone in ${title}`} onClose={() => setMyRequest(null)}
          onCancel={async () => { const ok = await post(cancelText(myRequest.request)); if (ok) setMyRequest(null); return ok; }} />
      )}
      {person && (
        <PersonSheet who={person.account} role={roleOf(person.account)} onClose={() => setPerson(null)}
          onPay={() => { const to = person.account; setPerson(null); void money.payTo(to); }}
          onMute={() => { moderation.mute({ pubkey: `near:${person.account}`, who: person.account }); setPerson(null); }} />
      )}
      {asking && account && (
        <RequestSheet audience={`everyone in ${title}`} nick={account} nearAccount={account} ask={asking.ask} {...(asking.line ? { refusedFirst: asking.line } : {})} onClose={() => setAsking(null)}
          later={{ onPending: (words) => { setPending(words); setAsking(null); }, onLater: (a) => { setPending(null); setAsking({ ask: a.ask, line: a.line }); } }}
          onPost={async (r) => { setAsking(null); try { await post(requestText(r)); } finally { setPending(null); } }} onProblem={(p) => { setAsking(null); setPending(null); void problem(p); }} />
      )}
    </PushedFrame>
  );
}

/** Someone in a NEAR room: their account, checked; their near.social display name, read when this opens and never in
 *  the list or in place of the account (security review M3); Pay, Mute. */
function PersonSheet({ who, role, onClose, onPay, onMute }: { who: string; role: string | null; onClose: () => void; onPay: () => void; onMute: () => void }) {
  const { bridge } = useShell();
  const [profile, setProfile] = useState<NearProfile | null>(null);
  useEffect(() => {
    let live = true;
    void bridge.call<NearProfile>("ledger.nearProfile", { accountId: who }).then((r) => { if (live && "ok" in r) setProfile(r.ok); });
    return () => { live = false; };
  }, [bridge, who]);
  return (
    <Sheet title="NEAR account" onClose={onClose}>
      <div className="ch-person">
        <div>
          <NameBadge account={who} />
          {profile?.name && <p className="zf-small" data-testid="chat-profile-name">Calls themselves {profile.name}</p>}
          {role && <p className="zf-small">{role.charAt(0).toUpperCase()}{role.slice(1)} in this DAO</p>}
        </div>
      </div>
      <div className="ch-picks">
        <button className="zf-row ch-place" onClick={onPay} data-testid="chat-pay-person"><span>Pay this account</span><span className="zf-small">You approve next</span></button>
        <button className="zf-row ch-place" onClick={onMute} data-testid="chat-mute-account"><span>Mute this account</span><span className="zf-small">On this phone</span></button>
      </div>
    </Sheet>
  );
}
