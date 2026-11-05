// ZeroFee Chat (D55): BitChat's location channels inside ZeroFee, with money in the chat. A place is a geohash: the
// person types a city (places.ts, a list in the app) or taps Nearby (the phone's location, read once, turned into the
// place on the phone and never sent); its messages are BitChat's kind-20000 events on the place's relays (relays.ts),
// signed by the core with this person's key for that place (nostr.sign; the key never reaches this app).
//
// Private messages (slice 2): anyone seen in a place can be messaged privately, BitChat's way (its geohash DMs: core
// bitchat-dm.ts). The core seals and opens them with the place's key (nostr.seal, nostr.open); they go over BitChat's
// own private-message relays (DM_RELAYS), and BitChat users read them in BitChat.
//
// Hide and mute (slice 2): one message, or one person, on this device only (moderation.ts). The first time someone
// joins a place they are told plainly that public places are unmoderated.
//
// Money, by the house rules (BITCHAT-RESEARCH §4), in a place and in a private message alike:
// - Only the person's OWN composer text is read as a command ("send 5 USDC to …", "send money to …"). It is never
//   posted; it opens the one money sheet's Send filled in (pay links.ts sendLink), paid from Private only (D85: never a
//   public send from the Safe or a chain wallet), and the person approves on the core's sheet. Nothing here signs a
//   payment or answers an approval.
// - An EVM address with no network said: a picker of the networks where the person holds that coin, nothing picked
//   when there is more than one.
// - Request posts "Request: 5 USDC on Base to <your address> · ZeroFee Chat". Someone's request shows as a chip that
//   only fills Send in when tapped. Someone's "send money to …" is text. Nothing opens on its own.
// - A send ends with the money sheet's own one line (B27): no "Sent · Share it in Zurich?" sheet after it.
//
// First use (B27, design review 2 Nov §9, change 10): a list of your chats with one "+"; before any chat, three lines and
// the two ways in (first-use.ts). Nearby opens its place by itself, even when the answer comes after its 10 s line.
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { More } from "@zerofee/design/More.tsx";
import type { NextStep, Problem } from "@zerofee/core/problem";
import type { BridgeResult } from "@zerofee/core/bridge";
import { GEOHASH_MESSAGE, type NostrEvent } from "@zerofee/core/nostr";
import { readDmContent } from "@zerofee/core/bitchat-dm";
import type { AppModule } from "@zerofee/shell-api/app-module.ts";
import { AppFrame, PushedFrame, useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { sendLink } from "@zerofee/pay/app/links.ts";
import type { Balance, Movement } from "@zerofee/wallet/types.ts";
import { isAccountId, isRoomId, NAMED_PLACE_MAX } from "@zerofee/core/chat-near";
import { readAsk, readSend, type AskCommand } from "../command.ts";
import { daoShort, isWhere, readDaos, readNames, whereName, type Dao } from "../rooms.ts";
import { NameBadge, Room, useNameBook } from "./Room.tsx";
import { useAgentZeroChip } from "./agentzero-chip.ts";
import { EMPTY_PLACE, FIRST_LINES, NO_MATCH, PRIVATE_FIRST, START_FOOT, placeLike, chatRows, matches, nearbyWords, notSentWords, opensOn, placeLine, rowTime, type ChatRow } from "../first-use.ts";
import { chainName, detect, evmChoices } from "../detect.ts";
import { deliveryWords, delivery, dmBytes, late, lateWords, nextLate, peerName, receive, retrying, seen, sending, unreadCount, type DmLine, type Dms } from "../dms.ts";
import { everyCity, placeAt, placeName } from "../places.ts";
import { NearbyTicket, nearby, onPhone } from "./location.ts";
import { cancelText, cancelledIds, chipFor, displayText, markMine, readRequest, requestAmount, requestText, requestWords, shown, type PayRequest, type Shown } from "../messages.ts";
import { SPLIT_DOLLARS_ONLY, SPLIT_HALF, SPLIT_MAX, SPLIT_MIN, SPLIT_NEAR_WORDS, splitLive, cameIn, cameInWords, dollars, readSplit, shareAmount, splitBill, splitRequest, splitText } from "../split.ts";
import { postableOwnAddress, requestRefusal, startCoin, testAccountFix, underBridgeMinimum } from "../request-coin.ts";
import { PayGate, markPaid, paidState, paidWords, readPaid, shortTx, type PaidBook, type PaidMark } from "../paid.ts";
import { tipKey, tipTarget, type TipTarget } from "../tip.ts";
import { chatCanSendOn } from "../chain-send.ts";
import { hide, mute, readHidden, readMuted, unmute, visible, type Muted } from "../moderation.ts";
import { RelayPool, type PoolStatus } from "../pool.ts";
import { linkParts } from "../links.ts";
import { DM_RELAYS, askedPlace, localRelay, relaysFor, sharedWithBitChat } from "../relays.ts";
import "./chat.css";

export const PUBLIC_BUILD = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_ZEROFEE_PUBLIC === "1";
/** Where Wallet's Send can pay out today (send-reach.ts): NEAR, Solana and its EVM networks. */
const SENDABLE = chatCanSendOn;
/** Networks a request can name: no memo needed, an address Wallet shows for the vault. */
const REQUEST_CHAINS = ["near", "sol", "hood", "base", "eth", "arb", "bsc"];
const MAX_SHOWN = 200;
/** BitChat's private messages hold 255 bytes (PrivateMessagePacket). */
const DM_LIMIT = 255;

/** What one place has shown this visit, kept while the page lives (the app may be unmounted between swipes). */
const kept = new Map<string, Shown[]>();
/** k-chat crawl (4 Nov, S3): each place's last line as the chats list showed it, kept on this device ("last-lines"), so
 *  after a reload the row says that line, not "City chat", before the place's relays answer again. */
const lastLines = new Map<string, { line: string; atIso: string }>();
export function readLastLines(raw: string | null): Map<string, { line: string; atIso: string }> {
  const out = new Map<string, { line: string; atIso: string }>();
  try {
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [where, x] of Object.entries(v as Record<string, { line?: unknown; atIso?: unknown }>)) {
        if (isWhere(where) && typeof x?.line === "string" && typeof x.atIso === "string") out.set(where, { line: x.line.slice(0, 300), atIso: x.atIso });
      }
    }
  } catch {
    /* a damaged record is none */
  }
  return out;
}
/** The private messages of one place this visit, in memory only (like BitChat's geohash DMs; the relays hold a day). */
const keptDms = new Map<string, Dms>();
/** Where the person is (the place, and the private conversation open in it), kept while the page lives: a send Chat hands
 *  to Wallet comes back here, done or cancelled, never to the list of places (grade 02g, G6). */
const here: { place: string | null; thread: string | null } = { place: null, thread: null };
/** Networks whose own coin a request names by itself (G4: no network to pick for NEAR, SOL, ETH or BNB). */
const COIN_HOME: Record<string, string> = { NEAR: "near", SOL: "sol", ETH: "eth", BNB: "bsc" };
/** Nearby's one ask at a time, kept while the page lives: its answer opens the place even if Chat left the screen. */
const nearbyTicket = new NearbyTicket();
/** The names of people in private conversations, as each place last showed them: the chats list's rows. */
const peerTitles = new Map<string, string>();

interface Pending {
  amount?: string;
  coin?: string;
  chain: string;
  place: string;
  /** The request (its message id) this payment pays, when it came from a chip: marked paid once it went (H7). */
  request?: string;
}

/** A request's message, as the chip needs it: its id and when it was asked. */
interface Asked {
  id: string;
  atIso: string;
}

export type Store = { get: (key: string) => Promise<string | null>; set: (key: string, value: string | null) => void };

function useStore(bridge: ReturnType<typeof useShell>["bridge"]): Store {
  return useMemo(() => ({
    get: async (key: string) => {
      const r = await bridge.call<{ value: string | null }>("device.store.get", { key });
      return "ok" in r ? r.ok.value : null;
    },
    set: (key: string, value: string | null) => void bridge.call("device.store.set", { key, value }),
  }), [bridge]);
}

/** Hide and mute, kept on this device (moderation.ts). */
function useModeration(store: Store) {
  const [muted, setMuted] = useState<Muted[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    void store.get("muted").then((raw) => setMuted(readMuted(raw)));
    void store.get("hidden").then((raw) => setHidden(readHidden(raw)));
  }, [store]);
  return {
    muted,
    mutedKeys: useMemo(() => new Set(muted.map((m) => m.pubkey)), [muted]),
    hiddenIds: useMemo(() => new Set(hidden), [hidden]),
    mute: (m: Muted) => setMuted((now) => { const next = mute(now, m); store.set("muted", JSON.stringify(next)); return next; }),
    unmute: (pubkey: string) => setMuted((now) => { const next = unmute(now, pubkey); store.set("muted", JSON.stringify(next)); return next; }),
    hide: (id: string) => setHidden((now) => { const next = hide(now, id); store.set("hidden", JSON.stringify(next)); return next; }),
  };
}

function ChatRoot() {
  const shell = useShell();
  const { bridge } = shell;
  const store = useStore(bridge);
  const moderation = useModeration(store);
  // ?chatplace=u0qj (this computer only): the cross-app check opens on its place.
  const [place, setPlaceState] = useState<string | null>(() => askedPlace(globalThis.location?.search ?? "", PUBLIC_BUILD) ?? here.place);
  const setPlace = (g: string | null) => {
    if (g !== here.place) here.thread = null;
    here.place = g;
    setPlaceState(g);
  };
  const [nick, setNick] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  // Counts the sends Chat started that went: the places read their Activity again (a request it paid says "Paid"). The
  // money sheet says the one line itself; Chat adds no sheet after it (B27).
  const [sent, setSent] = useState(0);
  // Requests paid from this device (paid.ts): their chips never offer Pay again (grade 02h, H7).
  const [paid, setPaid] = useState<PaidBook>({});
  const onPaid = (id: string, mark: { link?: string; atIso: string }) => setPaid((now) => {
    const next = markPaid(now, id, mark);
    store.set("paid", JSON.stringify(next));
    return next;
  });
  useEffect(() => {
    void store.get("paid").then((raw) => setPaid((now) => ({ ...readPaid(raw), ...now })));
  }, [store]);

  // The person's NEAR account (J3 part 2): their name in NEAR rooms, and whose DAOs "Your DAOs" lists.
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => {
    void bridge.call<{ account?: { accountId?: string } }>("account.state").then((r) => {
      const id = "ok" in r ? r.ok.account?.accountId : undefined;
      if (typeof id === "string" && isAccountId(id)) setMe(id);
    });
  }, [bridge]);
  // "Your DAOs": every Sputnik DAO whose get_policy names the account now (ledger.daosOf), the last answer kept here so
  // the list shows at once; DAO rooms opened on this device are asked about too.
  const [daos, setDaos] = useState<Dao[]>([]);
  const [opened, setOpened] = useState<string[] | null>(null);
  useEffect(() => {
    void store.get("daos").then((raw) => setDaos((now) => (now.length ? now : readDaos(raw))));
    void store.get("daos-opened").then((raw) => setOpened(readNames(raw)));
  }, [store]);
  // Read only while Chat is the app on screen (AppContext.active): mounted beside Trade or Home as a neighbour, it reads
  // nothing on NEAR (3 Nov walk: ?demo read a test network's DAO list on every walk, from Trade, Chat never opened).
  useEffect(() => {
    if (!me || opened === null || !shell.active) return;
    let live = true;
    void bridge.call<{ daos: Dao[] }>("ledger.daosOf", { accountId: me, opened }).then((r) => {
      if (!live || !("ok" in r) || !Array.isArray(r.ok.daos)) return;
      const next = readDaos(JSON.stringify(r.ok.daos));
      setDaos(next);
      store.set("daos", JSON.stringify(next));
    });
    return () => { live = false; };
  }, [bridge, me, opened?.join(" "), shell.active]);
  /** A DAO room was opened here: asked about from now on (its get_policy says whether the person is in it). */
  const onDao = (dao: string) => setOpened((now) => {
    if (!now || now.includes(dao)) return now;
    const next = [dao, ...now].slice(0, 20);
    store.set("daos-opened", JSON.stringify(next));
    return next;
  });

  useEffect(() => {
    void store.get("nickname").then((n) => {
      if (n) return setNick(n);
      const made = `anon${1000 + Math.floor(Math.random() * 9000)}`;
      store.set("nickname", made);
      setNick(made);
    });
    // the last lines first, so the rows they fill draw with the list
    void store.get("last-lines").then((raw) => {
      for (const [where, l] of readLastLines(raw)) if (!lastLines.has(where)) lastLines.set(where, l);
    }).finally(() => void store.get("places").then((p) => {
      try {
        const list = p ? (JSON.parse(p) as unknown) : [];
        if (Array.isArray(list)) setRecent(list.filter((x): x is string => typeof x === "string" && isWhere(x)).slice(0, 6));
      } catch {
        /* a damaged list is no list */
      }
    }));
  }, [store]);

  const join = (g: string) => {
    nearbyTicket.opened();
    if (nearbyNow.state === "slow" || nearbyNow.state === "refused") setNearby("idle");
    setPlace(g);
    setRecent((now) => {
      const next = [g, ...now.filter((x) => x !== g)].slice(0, 6);
      store.set("places", JSON.stringify(next));
      return next;
    });
  };
  /** A private conversation from the chats list: its place, opened on it. */
  const openThread = (g: string, peer: string) => {
    join(g);
    here.thread = peer;
  };

  // Back from Wallet without a send (Back, or a Problem's way out): the place it was asked from, as the person left it.
  useEffect(() => {
    if (shell.requestedTab !== "back") return;
    void store.get("pending").then((raw) => {
      if (!raw) return;
      store.set("pending", null);
      try {
        const p = JSON.parse(raw) as Pending;
        if (typeof p.place === "string" && isWhere(p.place) && p.place !== here.place) setPlace(p.place);
      } catch {
        /* a damaged note is no note */
      }
    });
  }, [shell.requestedTab, shell.requestSeq]);

  // Back from Wallet after a send this app asked for: what happened is read from Activity, never from the link.
  useEffect(() => {
    if (shell.requestedTab !== "sent") return;
    const id = new URLSearchParams(shell.requestedLink ?? "").get("movement");
    void store.get("pending").then(async (raw) => {
      if (!raw || !id) return;
      store.set("pending", null);
      let pending: Pending;
      try {
        pending = JSON.parse(raw) as Pending;
      } catch {
        return;
      }
      const r = await bridge.call<Movement[]>("ledger.activity", { limit: 20 });
      const m = "ok" in r && Array.isArray(r.ok) ? r.ok.find((x) => x.id === id) : undefined;
      // The request it paid is paid: held by the account's wait too, since it goes when the wait ends (H7).
      if (m && pending.request && (m.status === "done" || m.status === "moving" || m.status === "waiting")) onPaid(pending.request, { atIso: m.startedAtIso, ...(m.explorerUrls[0] ? { link: m.explorerUrls[0] } : {}) });
      if (!m || (m.status !== "done" && m.status !== "moving")) return;
      if (pending.place !== here.place) setPlace(pending.place);
      setSent((n) => n + 1);
    });
  }, [shell.requestedTab, shell.requestSeq]);

  nearbyNow.join = join;
  if (!place) return <Chats recent={recent} daos={daos} moderation={moderation} onJoin={join} onThread={openThread} />;
  if (!nick) return null;
  // A NEAR room (J3 part 2): its own screen; there, a person's name is their NEAR account.
  if (isRoomId(place as unknown)) return <Room key={place} room={place} account={me} store={store} moderation={moderation} paid={paid} onPaid={onPaid} sent={sent} onLeave={() => setPlace(null)} onDao={onDao} />;
  return <Channel key={place} account={me} place={place} nick={nick} store={store} moderation={moderation} paid={paid} onPaid={onPaid} sent={sent} onLeave={() => setPlace(null)} onNick={(n) => { setNick(n); store.set("nickname", n); }} />;
}

type NearState = "idle" | "asking" | "slow" | "refused";
/** Nearby's state, kept while the page lives (security review M3): every mounted screen shows the one ask's state, and
 *  its answer goes to the Chat that is mounted when it comes (`join`), not the one that asked. */
const nearbyNow = { state: "idle" as NearState, listeners: new Set<(s: NearState) => void>(), join: null as ((g: string) => void) | null };
const setNearby = (s: NearState) => {
  nearbyNow.state = s;
  nearbyNow.listeners.forEach((l) => l(s));
};

/** Nearby, as both its buttons use it (the first screen's and the "+" sheet's row): a newer tap replaces an older ask; at
 *  10 s one line, "hasn't shared … yet" (never a waiting screen, and never "didn't" while iOS may still be asking: review
 *  L4); a fix, even one after the line, opens its place by itself unless the person opened another place meanwhile
 *  (B27: on the iPhone, iOS's own ask is read first and a yes after 10 s answered nothing). */
function useNearby(): { state: NearState; ask: () => void; words: ReturnType<typeof nearbyWords> } {
  const { bridge } = useShell();
  const [state, setState] = useState<NearState>(nearbyNow.state);
  useEffect(() => {
    nearbyNow.listeners.add(setState);
    setState(nearbyNow.state);
    return () => void nearbyNow.listeners.delete(setState);
  }, []);
  const ask = () => {
    const ticket = nearbyTicket.ask();
    setNearby("asking");
    void nearby(bridge, () => { if (nearbyTicket.current(ticket)) setNearby("slow"); }).then((at) => {
      // A newer tap asked again: that ask's answer decides.
      if (!nearbyTicket.current(ticket)) return;
      const fits = nearbyTicket.fits(ticket);
      if ("refused" in at) return setNearby("refused");
      setNearby("idle");
      // A place worked out here; only its letters ever leave the phone.
      if (fits) nearbyNow.join?.(placeAt(at.lat, at.lon));
    });
  };
  return { state, ask, words: nearbyWords(onPhone()) };
}

/** Chat's own screen (design review 2 Nov §9, change 10): your chats as rows and one "+"; before any chat, the three
 *  lines and the two ways in that the first line names. */
function Chats({ recent, daos, moderation, onJoin, onThread }: { recent: string[]; daos: Dao[]; moderation: Moderation; onJoin: (g: string) => void; onThread: (g: string, peer: string) => void }) {
  const { muted, mutedKeys, hiddenIds } = moderation;
  const onUnmute = moderation.unmute;
  const [starting, setStarting] = useState(false);
  const [listing, setListing] = useState(false);
  const near = useNearby();
  const rows = chatRows([
    // Private conversations are rows here, not a section inside a place (§9.2).
    ...[...keptDms.entries()].flatMap(([where, dms]) => Object.values(dms).filter((c) => c.lines.length > 0 && !mutedKeys.has(c.peer)).map((c): ChatRow => {
      const last = c.lines[c.lines.length - 1]!;
      return { where, peer: c.peer, title: peerTitles.get(`${where} ${c.peer}`) ?? `Someone in ${placeName(where)}`, line: `${last.mine ? "You: " : ""}${displayText(last)}`, atIso: last.atIso, unread: c.unread };
    })),
    ...recent.map((where): ChatRow => {
      // A place's last line as the place shows it (placeLine: security review M1, M2). A NEAR room says only that it is
      // one: its unchecked names are folded away inside it.
      const last = isRoomId(where as unknown) ? null : placeLine(kept.get(where) ?? [], hiddenIds, mutedKeys) ?? lastLines.get(where) ?? null;
      return { where, title: whereName(where), line: last ? last.line : isRoomId(where as unknown) ? "Room" : "City chat", ...(last ? { atIso: last.atIso } : {}) };
    }),
    ...daos.filter((d) => !recent.includes(`near:${d.dao}`)).slice(0, 3).map((d): ChatRow => ({ where: `near:${d.dao}`, title: daoShort(d.dao), line: d.roles[0] ?? "Member" })),
  ]);
  const first = opensOn({ place: null, chats: rows.length }) === "first";
  const top = (
    <>
      <span className="zf-label" style={{ color: "var(--ink)" }}>Chat</span>
      {!first && <button className="ch-plus" aria-label="Start a chat" onClick={() => setStarting(true)} data-testid="chat-plus">+</button>}
    </>
  );
  const nearLine = (near.state === "slow" || near.state === "refused") && (
    <p className="zf-small ch-nearline" role="status" data-testid="chat-nearby-refused">{near.state === "slow" ? near.words.slow : near.words.refused} <button className="zf-link" onClick={() => setStarting(true)}>Pick a city</button></p>
  );
  return (
    <AppFrame name="Chat" top={top} tray={[]} tab="" onTab={() => {}}>
      {first ? (
        <div className="ch ch-first" data-testid="chat-first">
          {FIRST_LINES.map((l) => <p key={l} className="ch-firstline">{l}</p>)}
          <div className="ch-firstacts">
            <button className="zf-btn" onClick={near.ask} disabled={near.state === "asking"} data-testid="chat-nearby">{near.state === "asking" ? near.words.asking : "Nearby"}</button>
            <button className="zf-link ch-pick" onClick={() => setStarting(true)} data-testid="chat-pick-city">Pick a city</button>
          </div>
          {nearLine}
        </div>
      ) : (
        <div className="ch ch-col" data-testid="chat-chats">
          {rows.map((r) => (
            <button key={`${r.where} ${r.peer ?? ""}`} className="ch-row" onClick={() => (r.peer ? onThread(r.where, r.peer) : onJoin(r.where))} data-testid={r.peer ? "chat-row-private" : "chat-row"}>
              <span className="ch-row__dot" aria-hidden="true">{r.title.replace(/^[^\p{L}\p{N}]+/u, "").charAt(0).toUpperCase() || "#"}</span>
              <span className="ch-row__text">
                <span className="ch-row__title">{r.title}</span>
                <span className="zf-small ch-row__line">{r.line}</span>
              </span>
              <span className="zf-small ch-row__time">{r.unread ? <b className="ch-row__new">{r.unread}</b> : r.atIso ? rowTime(r.atIso) : ""}</span>
            </button>
          ))}
          {nearLine}
          {muted.length > 0 && (
            <button className="zf-row ch-place" style={{ marginTop: 22 }} onClick={() => setListing(true)} data-testid="chat-muted-row"><span>Muted people</span><span className="zf-small">{muted.length}</span></button>
          )}
        </div>
      )}
      {starting && <StartSheet near={near} onClose={() => setStarting(false)} onOpen={(g) => { setStarting(false); onJoin(g); }} />}
      {listing && (
        <Sheet title="Muted people" onClose={() => setListing(false)}>
          <p className="zf-small">Hidden on this device only. They aren't told.</p>
          {muted.map((m) => (
            <div key={m.pubkey} className="ch-place"><span>{m.who}</span><button className="zf-link" onClick={() => onUnmute(m.pubkey)}>Unmute</button></div>
          ))}
          {muted.length === 0 && <p className="zf-small">You haven't muted anyone.</p>}
        </Sheet>
      )}
    </AppFrame>
  );
}

/** "+" (§9.4): one field for a city, a NEAR name or a coin, its matches as you type, Nearby, and the one privacy line. A
 *  NEAR name is looked up first (one view_account): no such account is one line, and nothing opens. */
function StartSheet({ near, onClose, onOpen }: { near: ReturnType<typeof useNearby>; onClose: () => void; onOpen: (g: string) => void }) {
  const { bridge } = useShell();
  const [text, setText] = useState("");
  const [line, setLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const found = matches(text);
  // F41 re-test (k-chat, 4 Nov): the refusal said where it failed but not where to go. Its Pick a city goes to the
  // cities below (the field cleared, if something was typed, so they show), the first one ready to tap.
  const cities = useRef<HTMLDivElement>(null);
  const toCities = () => {
    if (text.trim()) setText("");
    setTimeout(() => {
      const el = cities.current;
      el?.scrollIntoView?.({ block: "start", behavior: "smooth" });
      el?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    }, 0);
  };
  const open = async (m: { where: string } | undefined) => {
    // sd-chat crawl (5 Nov, d): junk ("zz!!junk##") is never named back as a city; it keeps the no-match line below
    if (!m) return setLine(text.trim() && placeLike(text) ? `ZeroFee doesn't know a city called ${text.trim()}. Try a big city near it, or tap Nearby.` : null);
    const account = m.where.startsWith("near:") ? m.where.slice(5) : null;
    if (account) {
      setBusy(true);
      let info: BridgeResult<{ exists: boolean }>;
      try {
        info = await bridge.call<{ exists: boolean }>("ledger.recipientInfo", { accountId: account });
      } finally {
        if (alive.current) setBusy(false);
      }
      // the sheet closed meanwhile (Back, or Nearby opened a place): this answer opens nothing (security review M4)
      if (!alive.current) return;
      if ("ok" in info && !info.ok.exists) return setLine(`There's no NEAR account called ${account}. Check it.`);
    }
    onOpen(m.where);
  };
  return (
    <Sheet title="Start a chat" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (!busy) void open(found[0]); }}>
        <input className="ch-input" value={text} onChange={(e) => { setText(e.target.value); setLine(null); }} placeholder="A city, a .near account, or a coin" aria-label="City" autoCapitalize="words" autoCorrect="off" spellCheck={false} autoFocus data-testid="chat-city" />
      </form>
      {found.length > 0 && (
        <div className="ch-picks" role="group" aria-label="Matches">
          {found.map((m) => (
            <button key={m.where} className="zf-row ch-place" disabled={busy} onClick={() => void open(m)} data-testid="chat-city-row"><span>{m.name}</span><span className="zf-small">{m.what}</span></button>
          ))}
        </div>
      )}
      {line && <p className="zf-small" role="status" style={{ marginTop: 8 }} data-testid="chat-city-unknown">{line}</p>}
      {!line && text.trim() && found.length === 0 && <p className="zf-small" role="status" style={{ marginTop: 8 }} data-testid="chat-no-match">{NO_MATCH}</p>}
      {!text.trim() && (
        <button className="zf-row ch-place" style={{ marginTop: 10 }} onClick={near.ask} disabled={near.state === "asking"} data-testid="chat-nearby-row">
          <span>Nearby</span><span className="zf-small">{near.state === "asking" ? near.words.asking : "finds your city once"}</span>
        </button>
      )}
      {(near.state === "slow" || near.state === "refused") && <p className="zf-small" role="status">{near.state === "slow" ? near.words.slow : near.words.refused} <button className="zf-link" onClick={toCities} data-testid="chat-start-pick-city">Pick a city</button></p>}
      <p className="zf-small ch-fine">{START_FOOT}</p>
      {/* Finding 41: nothing typed, every city to tap: a way in that never needs this device's location. */}
      {!text.trim() && (
        <div className="ch-picks" ref={cities} role="group" aria-label="Cities">
          {everyCity().map((c) => (
            <button key={c.place + c.name} className="zf-row ch-place" disabled={busy} onClick={() => void open({ where: c.place })} data-testid="chat-city-pick"><span>{c.name}</span><span className="zf-small">{c.country}</span></button>
          ))}
        </div>
      )}
    </Sheet>
  );
}

/** Your name in city chats (on the place's "You here" sheet): up to 24 letters or numbers. */
function NickForm({ nick, onSave }: { nick: string; onSave: (n: string) => void }) {
  const [v, setV] = useState(nick);
  const ok = /^[\p{L}\p{N}_.-]{1,24}$/u.test(v.trim());
  return (
    <form className="ch-nickform" onSubmit={(e) => { e.preventDefault(); if (ok) onSave(v.trim()); }}>
      <span className="zf-small">Your nickname in city chats</span>
      <div className="ch-compose">
        <input className="ch-input" value={v} onChange={(e) => setV(e.target.value)} aria-label="Your nickname" maxLength={24} />
        <button className="zf-btn ch-post" disabled={!ok || v.trim() === nick}>Save</button>
      </div>
    </form>
  );
}

export type Note = { text: string } | null;
export type Moderation = ReturnType<typeof useModeration>;

/** Payments from the person's own words, and from a tapped request chip: always Wallet's Send, filled in. */
export function useMoney(place: string, store: Store, setNote: (n: Note) => void, onPaid: (id: string, mark: { link?: string; atIso: string }) => void, onAsk?: (a: AskCommand) => void) {
  const shell = useShell();
  const { bridge } = shell;
  const [pick, setPick] = useState<null | { address: string; chains: string[]; amount?: string; coin?: string }>(null);

  /** Opens the one money sheet's Send over Chat, filled in. The person taps Send there and approves on the core's sheet.
   *  D85 (privacy first): it pays from Private only; when Private is short it stops and says by how much (Wallet's
   *  SendSheet, chat-private.ts). Never the public chain-wallet send (subwallet.send) and never the Safe's transfer. */
  const openSend = async (to: { address: string; chain: string; amount?: string; coin?: string; request?: string }) => {
    const pending: Pending = { chain: to.chain, place, ...(to.amount ? { amount: to.amount } : {}), ...(to.coin ? { coin: to.coin } : {}), ...(to.request ? { request: to.request } : {}) };
    store.set("pending", JSON.stringify(pending));
    // The one money sheet, in place over Chat (Job 1): it tells Chat "sent" or "back" as Wallet's Send did.
    shell.openMoney({ kind: "send", link: sendLink({ to: to.address, chain: to.chain, ...(to.coin ? { coin: to.coin } : {}), ...(to.amount ? { amount: to.amount } : {}), back: "chat" }) });
  };

  /** A NEAR name must exist: one view_account before anything opens (J3 part 2, "names work as addresses"). It takes a
   *  network round trip, so the tap is answered at once ("Checking…"). False: there's no such account, said in one line. */
  const nameExists = async (name: string): Promise<boolean | null> => {
    setNote({ text: `Checking ${name}…` });
    const info = await bridge.call<{ exists: boolean }>("ledger.recipientInfo", { accountId: name });
    if ("ok" in info && !info.ok.exists) {
      setNote({ text: `There's no NEAR account called ${name}. Check it.` });
      return false;
    }
    setNote(null);
    return "ok" in info ? true : null;
  };

  /** A payment with its address read: the network settled (said, or picked), then Wallet's Send. */
  const pay = async (p: { address: string; chain?: string; candidates?: string[]; amount?: string; coin?: string; request?: string }) => {
    if (p.chain) {
      if (!SENDABLE(p.chain)) return setNote({ text: `ZeroFee can't send to ${chainName(p.chain)} addresses yet. Try NEAR, Solana or Base.` });
      if (p.chain === "near" && p.address.includes(".")) {
        if ((await nameExists(p.address)) === false) return;
      }
      return openSend({ address: p.address, chain: p.chain, amount: p.amount, coin: p.coin, request: p.request });
    }
    const r = await bridge.call<Balance[]>("ledger.balances");
    const balances = "ok" in r && Array.isArray(r.ok) ? r.ok : [];
    const choice = evmChoices(p.candidates ?? [], balances, p.coin);
    if (choice.chains.length === 0) return setNote({ text: `You hold no ${p.coin ?? "coins"} on a network that address takes. Try "on <network>".` });
    if (choice.picked) return openSend({ address: p.address, chain: choice.picked, amount: p.amount, coin: p.coin });
    setPick({ address: p.address, chains: choice.chains, amount: p.amount, coin: p.coin });
  };

  /** The person's own words: "post" when they are not a payment; "fix" when they are one that can't be read (the line
   *  under the composer says why, and the words stay); "done" when Send is opening. A payment is never posted. */
  const command = (typed: string): "post" | "fix" | "done" => {
    // "request 5 USDC from bob.near": the name looked up first, then the Request sheet, filled in (J3 part 2).
    const asked = onAsk ? readAsk(typed) : null;
    if (asked && "problem" in asked) {
      setNote({ text: asked.problem });
      return "fix";
    }
    if (asked) {
      void nameExists(asked.ok.from).then((there) => { if (there !== false) onAsk!(asked.ok); });
      return "done";
    }
    const cmd = readSend(typed);
    if (cmd === null) return "post";
    if ("problem" in cmd) {
      setNote({ text: cmd.problem });
      return "fix";
    }
    const d = detect(cmd.ok.to, cmd.ok.on);
    if ("problem" in d) {
      setNote({ text: d.problem.reason });
      return "fix";
    }
    if (d.ok.kind === "one") void pay({ address: d.ok.address, chain: d.ok.chain, amount: cmd.ok.amount, coin: cmd.ok.coin });
    else void pay({ address: d.ok.address, candidates: d.ok.chains, amount: cmd.ok.amount, coin: cmd.ok.coin });
    return "done";
  };

  /** A request chip, tapped: Send filled in from it. Never without the tap, never for a request already paid, and one
   *  payment at a time: a second tap while the first is opening asks nothing (paid.ts PayGate, grade 02h H7). */
  const gate = useRef(new PayGate());
  const [opening, setOpening] = useState<string | null>(null);
  const payRequest = async (r: PayRequest, asked: Asked, mark: PaidMark | null) => {
    if (!gate.current.open(asked.id, mark)) return;
    setOpening(asked.id);
    try {
      await pay({ address: r.address, chain: r.chain, amount: r.amount, coin: r.coin, request: asked.id });
    } finally {
      gate.current.done(asked.id);
      setOpening(null);
    }
  };

  const picker = pick && (
    <Sheet title="Which network?" onClose={() => setPick(null)}>
      <p className="zf-small">That address works on several networks. You hold {pick.coin ?? "coins"} on these. Pick the one the other person uses:</p>
      <div className="ch-picks" role="group" aria-label="Networks">
        {pick.chains.map((c) => (
          <button key={c} className="zf-row ch-place" onClick={() => { const p = pick; setPick(null); void openSend({ address: p.address, chain: c, amount: p.amount, coin: p.coin }); }}>
            <span>{chainName(c)}</span><span className="zf-small">Pick</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
  /** Pay a NEAR account by its name (a person in a NEAR room): looked up, then Send with no amount, the person types it. */
  const payTo = (account: string) => pay({ address: account, chain: "near" });
  /** C-4: a Tip, tapped. The same gate as a request's chip (one payment at a time, never twice from this device); Send
   *  opens on Hidden with the author filled in and no amount: the person types the dollars and picks the coin. */
  const tip = async (t: TipTarget, key: string, mark: PaidMark | null) => {
    if (!gate.current.open(key, mark)) return;
    setOpening(key);
    try {
      await pay({ address: t.address, chain: t.chain, request: key });
    } finally {
      gate.current.done(key);
      setOpening(null);
    }
  };
  return { command, payRequest, payTo, tip, opening, picker, onPaid };
}

/** Someone's request: Pay, or once it is paid (this device's record, or the account's Activity) "Paid · <tx>" and no
 *  Pay at all (grade 02h, H7). A USDC request on NEAR may be AgentZero's to pay (agentzero-chip.ts): its words on the
 *  chip, its check on who gets paid under it before the tap, and only privately (D91). `me`: this person's NEAR account. */
/** k-chat crawl (4 Nov). The place's field says what it's for (it was "Message" under "Say hello. Anyone here can see it."). */
export const PLACE_FIELD = "Say something to everyone here";
/** Under a request its poster cancelled: no Pay. */
export const REQUEST_CANCELLED = "Cancelled. Don't pay this.";
/** Your own open request: what happens with it. A request paid on NEAR leaves no record here to read, so it never says
 *  "Paid" by guessing. */
export const MY_REQUEST_OPEN = "Anyone here can still pay it.";
export const MY_REQUEST_CANCELLED = "You cancelled it.";

/** k-chat crawl (4 Nov, S2): under your own request, its state and a way into it. */
export function MyRequestLine({ m, cancelled, onOpen }: { m: Shown; cancelled: boolean; onOpen: (r: PayRequest) => void }) {
  const request = readRequest(m.text, m.mine);
  if (!request) return null;
  return (
    <div className="ch-chip">
      <button className="zf-link ch-paid" onClick={() => onOpen(request)} data-testid="chat-my-request">{cancelled ? MY_REQUEST_CANCELLED : MY_REQUEST_OPEN} See it ›</button>
    </div>
  );
}

/** Your own request, opened: what it asks, who sees it, and Cancel. A place's message can't be taken back, so Cancel
 *  posts one line that says so; ZeroFee Chat then shows the request with no Pay. */
export function MyRequestSheet({ request, cancelled, audience, onClose, onCancel }: { request: PayRequest; cancelled: boolean; audience: string; onClose: () => void; onCancel: () => Promise<boolean> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title="Your request" onClose={onClose}>
      <p className="zf-body ch-sheetlead" data-testid="chat-my-request-words">{`${requestAmount(request)}.`}</p>
      <p className="zf-small" role="status">{cancelled ? MY_REQUEST_CANCELLED : MY_REQUEST_OPEN}</p>
      <p className="zf-small">{`${audience.charAt(0).toUpperCase()}${audience.slice(1)} can see it.`}</p>
      {!cancelled && (
        <div className="zf-floor ch-sheetfloor"><button className="zf-btn" disabled={busy} data-testid="chat-my-request-cancel" onClick={async () => { setBusy(true); try { await onCancel(); } finally { setBusy(false); } }}>{busy ? "Cancelling…" : "Cancel request"}</button></div>
      )}
    </Sheet>
  );
}

export function RequestChip({ request, asked, who, money, paid, activity, me }: { request: PayRequest; asked: Asked; who: string; money: ReturnType<typeof useMoney>; paid: PaidBook; activity: readonly Movement[]; me?: string | null }) {
  const { bridge } = useShell();
  const mark = paidState(asked.id, request, asked.atIso, paid, activity);
  const az = useAgentZeroChip(request, asked.id, me, money.onPaid);
  if (az.closed && !mark) return <div className="ch-chip"><p className="zf-small" role="status" data-testid="chat-az-line">{az.line}</p></div>;
  if (mark) {
    const link = mark.link;
    return (
      <div className="ch-chip">
        {link
          ? <button className="zf-link ch-paid" data-testid="chat-chip-paid" aria-label={`${paidWords(mark)}. See the record of it`} onClick={() => void bridge.call("device.openUrl", { url: link, mode: "sheet" })}>{paidWords(mark)}</button>
          : <p className="zf-body ch-paid" data-testid="chat-chip-paid">{paidWords(mark)}</p>}
        <p className="zf-small">{mark.from === "waiting" ? `Your ${request.amount} ${request.coin} to ${who} waits first. It goes when the wait ends.` : `You paid ${request.amount} ${request.coin} to ${who}${mark.from === "activity" ? ", as your Activity shows" : ""}.`}</p>
        {az.line && <p className="zf-small" role="status" data-testid="chat-az-line">{az.line}</p>}
      </div>
    );
  }
  const opening = money.opening === asked.id;
  return (
    <div className="ch-chip">
      {az.label
        // AgentZero pays only on a real tap on this very chip: its mark, and the click itself passed through (review M2).
        ? <button className="zf-btn ch-chipbtn" data-testid="chat-az-chip" data-agentzero-pay={asked.id} disabled={az.busy} onClick={(e) => az.pay(e.nativeEvent)}>{az.busy ? "Paying…" : az.label}</button>
        : <button className="zf-btn ch-chipbtn" data-testid="chat-chip" disabled={money.opening !== null || az.waiting} onClick={() => void money.payRequest(request, asked, mark)}>{opening ? "Opening…" : `Pay ${request.amount} ${request.coin}${request.coin.toUpperCase() === chainName(request.chain).toUpperCase() ? "" : ` on ${chainName(request.chain)}`}`}</button>}
      {az.warn && <p className="zf-small ch-azwarn" role="note" data-testid="chat-az-warn">{az.warn}</p>}
      {az.line && <p className="zf-small" role="status" data-testid="chat-az-line">{az.line}</p>}
      {/* The first-time "Anyone can post here" sheet is gone (B27: a place opens at once); its warning sits where it matters. */}
      <p className="zf-small">{request.from ? `${who} asks ${request.from}.` : `Asked by ${who}.`} Pay only people you know. You approve next.</p>
    </div>
  );
}

/** C-1: under the person's own split line, what came in so far, from their own Activity only (split.ts). Nothing is
 *  said where Activity can't see that network's payments come in (NEAR: no deposit record), never a guess. */
function SplitCameIn({ lines, at, activity }: { lines: readonly { mine: boolean; text: string; atIso: string }[]; at: number; activity: readonly Movement[] }) {
  const { bridge } = useShell();
  const split = splitLive(lines[at]!.atIso) ? readSplit(lines[at]!.text) : null;
  const request = split ? splitRequest(lines, at, readRequest) : null;
  const [assetId, setAssetId] = useState<string | null>(null);
  const want = request && request.chain !== "near" ? `${request.chain} ${request.coin}` : null;
  useEffect(() => {
    if (!want) return;
    let live = true;
    const [chain, coin] = want.split(" ");
    void bridge.call<{ assetId: string; chain: string; symbol: string }[]>("ledger.tokens").then((r) => {
      const hit = "ok" in r && Array.isArray(r.ok) ? r.ok.filter((t) => t.chain === chain && t.symbol.toUpperCase() === coin) : [];
      if (live && hit.length === 1) setAssetId(hit[0]!.assetId);
    });
    return () => { live = false; };
  }, [bridge, want]);
  // NEAR: Activity has no record of money coming in on NEAR, so it can't count; it says where to look (never silent)
  if (split && request?.chain === "near") return <p className="zf-small ch-came" role="status" data-testid="chat-split-came">{SPLIT_NEAR_WORDS}</p>;
  if (!split || !request || !assetId) return null;
  return <p className="zf-small ch-came" role="status" data-testid="chat-split-came">{cameInWords(cameIn(request, assetId, lines[at]!.atIso, split.people, activity), split)}</p>;
}

/** C-4: "Tip" under a message whose author can be paid (tip.ts), or "Tipped" once this device tipped it. */
export function TipLink({ target, author, id, who, money, paid }: { target: TipTarget | null; author: string; id: string; who: string; money: ReturnType<typeof useMoney>; paid: PaidBook }) {
  const { bridge } = useShell();
  if (!target) return null;
  const key = tipKey(author, id);
  const mark = paid[key] ?? null;
  if (mark) {
    const tx = shortTx(mark.link);
    const words = `Tipped${tx ? ` · ${tx}` : ""}`;
    return mark.link
      ? <button className="zf-link ch-tip" data-testid="chat-tipped" aria-label={`${words}. See the record of it`} onClick={() => void bridge.call("device.openUrl", { url: mark.link!, mode: "sheet" })}>{words}</button>
      : <p className="zf-small ch-tip" data-testid="chat-tipped">{words}</p>;
  }
  return <button className="zf-link ch-tip" data-testid="chat-tip" aria-label={`Tip ${who}`} disabled={money.opening !== null} onClick={() => void money.tip(target, key, mark)}>{money.opening === key ? "Opening…" : "Tip"}</button>;
}

function Channel({ account, place, nick, store, moderation, paid, onPaid, sent, onLeave, onNick }: { account: string | null; place: string; nick: string; store: Store; moderation: Moderation; paid: PaidBook; onPaid: (id: string, mark: { link?: string; atIso: string }) => void; sent: number; onLeave: () => void; onNick: (n: string) => void }) {
  const shell = useShell();
  const { bridge } = shell;
  const [messages, setMessages] = useState<Shown[]>(() => kept.get(place) ?? []);
  const [status, setStatus] = useState<PoolStatus>({ open: 0, total: 0 });
  const [me, setMe] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  // k-chat crawl (4 Nov): a request on its way shows at once ("Posting…"); one the sheet must take back reopens it with
  // its line; your own request's bubble opens its sheet (what it asks, Cancel)
  const [pending, setPending] = useState<string | null>(null);
  const [again, setAgain] = useState<{ ask: AskCommand; line: string } | null>(null);
  const [myRequest, setMyRequest] = useState<{ m: Shown; request: PayRequest } | null>(null);
  const [person, setPerson] = useState<Shown | null>(null);
  const [thread, setThreadState] = useState<string | null>(() => (here.place === place ? here.thread : null));
  const setThread = (t: string | null) => {
    // the place's line is about the place, never carried into a private conversation (B27 break matrix)
    setNote(null);
    here.thread = t;
    setThreadState(t);
  };
  // "You're anon5504" (§9, a room's one line): your name here, the NEAR switch and what leaves this phone, one tap down.
  const [you, setYou] = useState(false);
  const [dms, setDmsState] = useState<Dms>(() => keptDms.get(place) ?? {});
  const dmsRef = useRef(dms);
  const pool = useRef<RelayPool | null>(null);
  const dmPool = useRef<RelayPool | null>(null);
  const mine = useRef(new Set<string>());
  /** The ids of what this person posted here this visit: theirs, whenever the place sends them back (J3 C2). */
  const posted = useRef(new Set<string>());
  const names = useRef(new Map<string, string>());
  const live = useRef({ muted: moderation.mutedKeys, thread });
  live.current = { muted: moderation.mutedKeys, thread };
  const list = useRef<HTMLDivElement>(null);
  const local = localRelay(globalThis.location?.search ?? "", PUBLIC_BUILD);
  const relays = local ? [local] : relaysFor(place);
  const dmRelays = local ? [local] : DM_RELAYS;
  const shared = local ? null : sharedWithBitChat(place).length;
  const [askFrom, setAskFrom] = useState<AskCommand | null>(null);
  // "request 5 USDC from bob.near" in the place (in a private conversation, the $ beside the field is the way).
  const money = useMoney(place, store, setNote, onPaid, (a) => (live.current.thread ? setNote({ text: "Tap $ to ask for money here." }) : setAskFrom(a)));

  // "Show my NEAR name" (J3 part 2), one switch per place, a city or wider: then this place uses the person's named key
  // here (never BitChat's anonymous one: what they said before stays without a name), their nickname is their account,
  // and ZeroFee readers see it checked. Off: back to the anonymous key.
  const namedOk = !!account && place.length <= NAMED_PLACE_MAX;
  const [named, setNamed] = useState(false);
  const [naming, setNaming] = useState(false);
  useEffect(() => {
    if (!namedOk) return setNamed(false);
    void store.get(`named:${place}`).then((v) => setNamed(v === "1"));
  }, [store, place, namedOk]);
  const keyAsk = named ? { geohash: place, named: true } : { geohash: place };
  const shownNick = named && account ? (account.length <= 32 ? account : `${account.slice(0, 31)}…`) : nick;

  const setDms = (next: Dms) => {
    dmsRef.current = next;
    keptDms.set(place, next);
    setDmsState(next);
  };

  const problem = async (p: Problem) => {
    const next: NextStep = await shell.showProblem(p);
    if (next.kind === "open" && next.screen.startsWith("security/")) shell.openApp("security", next.screen.slice("security/".length));
  };

  // This place's key (its public half only): our own messages are told apart by it, and private messages come to it.
  useEffect(() => {
    // The anonymous key is always yours here too (posts from before the switch stay "You").
    if (named) void bridge.call<{ pubkey: string }>("nostr.publicKey", { geohash: place }).then((r) => { if ("ok" in r) mine.current.add(r.ok.pubkey); });
    void bridge.call<{ pubkey: string }>("nostr.publicKey", keyAsk).then((r) => {
      if ("ok" in r) {
        mine.current.add(r.ok.pubkey);
        names.current.delete(r.ok.pubkey);
        setMe(r.ok.pubkey);
        // What the place sent before the key was known: yours are "You" now (J3 C2).
        setMessages((now) => {
          const next = markMine(now, mine.current, posted.current) as Shown[];
          if (next !== now) kept.set(place, next);
          return next;
        });
      } else void problem(r.problem);
    });
  }, [bridge, place, named]);

  const add = (e: NostrEvent) => {
    setMessages((now) => {
      if (now.some((m) => m.id === e.id)) return now;
      const s = shown(e, mine.current, posted.current);
      if (!s.mine) names.current.set(s.pubkey, s.who);
      const next = [...now, s].sort((a, b) => a.atIso.localeCompare(b.atIso)).slice(-MAX_SHOWN);
      kept.set(place, next);
      return next;
    });
  };

  // The place's relays, only while this app is on screen (AppContext.active).
  useEffect(() => {
    if (!shell.active) return;
    const p = new RelayPool(relays, (e) => add(e), setStatus);
    pool.current = p;
    p.join(place);
    return () => {
      p.close();
      if (pool.current === p) pool.current = null;
    };
  }, [shell.active, place, relays.join(" ")]);

  /** Seals one private message or ack (the core): the wrap to post and the message's id. */
  const seal = async (params: Record<string, unknown>): Promise<{ event: NostrEvent; messageId: string } | null> => {
    const r = await bridge.call<{ event: NostrEvent; messageId: string }>("nostr.seal", { ...keyAsk, ...params });
    if ("problem" in r) {
      void problem(r.problem);
      return null;
    }
    return r.ok;
  };
  /** Posts a sealed wrap on BitChat's private relays; true when one took it. */
  const postWrap = async (event: NostrEvent): Promise<boolean> => (await (dmPool.current?.publish(event) ?? Promise.resolve({ ok: 0, of: dmRelays.length }))).ok > 0;
  const sealAndPost = async (params: Record<string, unknown>): Promise<boolean> => {
    const r = await seal(params);
    return r ? postWrap(r.event) : false;
  };

  // Private messages to this person's key in the place, from BitChat's private relays, while on screen.
  useEffect(() => {
    if (!shell.active || !me) return;
    const onWrap = async (e: NostrEvent) => {
      const r = await bridge.call<{ from: string; at: number; content: string } | null>("nostr.open", { ...keyAsk, event: e });
      if (!("ok" in r) || !r.ok) return;
      const payload = await readDmContent(r.ok.content);
      if (!payload) return;
      const { from, at } = r.ok;
      const got = receive(dmsRef.current, from, at, payload, { muted: live.current.muted.has(from), viewing: live.current.thread === from });
      if (got.dms !== dmsRef.current) setDms(got.dms);
      // BitChat answers every new message with a delivered ack (never a muted sender's): so do we.
      if (got.ack) void sealAndPost({ to: from, kind: "delivered", messageId: got.ack });
    };
    const p = new RelayPool(dmRelays, (e) => void onWrap(e));
    dmPool.current = p;
    p.inbox(me);
    return () => {
      p.close();
      if (dmPool.current === p) dmPool.current = null;
    };
  }, [shell.active, place, me, dmRelays.join(" ")]);

  const shownMessages = visible(messages, moderation.hiddenIds, moderation.mutedKeys);
  const cancelled = cancelledIds(shownMessages);
  // The chats list's row for this place, kept on this device for after a reload (readLastLines)
  const lastLine = placeLine(messages, moderation.hiddenIds, moderation.mutedKeys);
  useEffect(() => {
    if (!lastLine) return;
    const was = lastLines.get(place);
    if (was?.line === lastLine.line && was.atIso === lastLine.atIso) return;
    lastLines.set(place, lastLine);
    store.set("last-lines", JSON.stringify(Object.fromEntries([...lastLines].slice(-12))));
  }, [lastLine?.line, lastLine?.atIso, place]);
  // NEAR names in this place (J3 part 2): a key whose checked name is an account shows it, with its mark.
  const { book } = useNameBook(bridge, relays, shownMessages.filter((m) => !m.mine).map((m) => m.pubkey), shell.active);
  // Your own name here, shown again (signed again, no sheet) each time you come back with the switch on.
  useEffect(() => {
    if (!named || !shell.active) return;
    void bridge.call<{ event: NostrEvent } | null>("nostr.bound", { geohash: place, named: true }).then((r) => {
      if ("ok" in r && r.ok) void pool.current?.publish(r.ok.event);
      // Near its end (or gone): said, never quietly dropped while the switch still reads on (diff review L8).
      else if ("ok" in r) setNote({ text: "Your NEAR account here needs a new yes. Turn it off, then on." });
    });
  }, [named, shell.active, place]);
  const toggleNamed = async () => {
    if (naming) return;
    setNaming(true);
    try {
      const r = await bridge.call<{ event: NostrEvent } | { declined: true }>(named ? "nostr.unbind" : "nostr.bind", { geohash: place, named: true });
      if ("problem" in r) return void problem(r.problem);
      if ("declined" in r.ok) return;
      await pool.current?.publish(r.ok.event);
      store.set(`named:${place}`, named ? null : "1");
      setNamed(!named);
      setNote({ text: named ? "Your NEAR account is off here. Messages you sent with it still show it." : `People here see you as ${account}.` });
    } finally {
      setNaming(false);
    }
  };

  // The account's own Activity, read while a request this device has no record of paying is on screen: a request paid
  // from another device, or before, says "Paid" too (grade 02h, H7). Read again after each send Chat started.
  const [activity, setActivity] = useState<Movement[]>([]);
  const unpaid = [...shownMessages.flatMap((m) => (m.request ? [m.id] : [])), ...Object.values(dms).flatMap((c) => c.lines.flatMap((l) => (l.request ? [l.id] : [])))].filter((id) => !paid[id]).length;
  // C-1: the person's own splits on screen, here or in a private chat: what came in is read from their Activity, again
  // every 30 s while one is on screen
  const splits = [...shownMessages.filter((m) => m.mine), ...Object.values(dms).flatMap((c) => c.lines.filter((l) => l.mine))].filter((m) => readSplit(m.text) && splitLive(m.atIso)).length;
  useEffect(() => {
    if (!shell.active || (unpaid === 0 && splits === 0)) return;
    let live = true;
    const read = () => void bridge.call<Movement[]>("ledger.activity", { limit: 50 }).then((r) => { if (live && "ok" in r && Array.isArray(r.ok)) setActivity(r.ok); });
    read();
    const again = splits > 0 ? setInterval(read, 30_000) : null;
    return () => { live = false; if (again) clearInterval(again); };
  }, [shell.active, unpaid, splits, sent]);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [shownMessages.length]);

  /** Signs (core) and posts (relays) one plain message. */
  const post = async (content: string): Promise<boolean> => {
    setBusy(true);
    try {
      const r = await bridge.call<NostrEvent>("nostr.sign", { ...keyAsk, kind: GEOHASH_MESSAGE, content, nickname: shownNick, teleport: true });
      if ("problem" in r) {
        void problem(r.problem);
        return false;
      }
      add(r.ok);
      const sentTo = await (pool.current?.publish(r.ok) ?? Promise.resolve({ ok: 0, of: relays.length }));
      // Change 2: the cause by name, this device's internet or Chat's servers (B27 break matrix).
      if (sentTo.ok === 0) setNote({ text: notSentWords({ online: globalThis.navigator?.onLine !== false, phone: onPhone() }) });
      return true;
    } finally {
      setBusy(false);
    }
  };

  /** One private message to `to`: sealed by the core, on screen as "Sending…" BEFORE it is posted (an ack that comes
   *  back fast must find it: J3 C4), then sent, delivered or not sent. */
  const sendDm = async (to: string, content: string): Promise<boolean> => {
    const r = await seal({ to, kind: "message", text: content });
    if (!r) return false;
    setDms(sending(dmsRef.current, to, r.messageId, content, Date.now() / 1000));
    const took = await postWrap(r.event);
    setDms(delivery(dmsRef.current, to, r.messageId, took ? "sent" : "failed"));
    return true;
  };

  /** Send again: one of ours with no "Delivered" after 10 s (or not sent), the same message with its id kept. */
  const resendDm = async (to: string, line: DmLine): Promise<void> => {
    const r = await seal({ to, kind: "message", text: line.text, messageId: line.id });
    if (!r) return;
    setDms(retrying(dmsRef.current, to, line.id, Date.now()));
    const took = await postWrap(r.event);
    setDms(delivery(dmsRef.current, to, line.id, took ? "sent" : "failed"));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const typed = text.trim();
    if (!typed || busy) return;
    setNote(null);
    // The person's own words only: a command is never posted (it would show an address and amount to the place).
    const asked = money.command(typed);
    if (asked === "done") return setText("");
    if (asked === "fix") return;
    if (await post(typed)) setText("");
  };

  // One name for one person: the place's kept messages name them too after Chat comes back (grade 02g, G14: "anon#e1cb").
  // Someone who hasn't posted where this phone could read it is "Someone in Zurich", never a made-up anon name (J3 C3).
  const known = (pubkey: string) => names.current.get(pubkey) ?? messages.find((m) => m.pubkey === pubkey && !m.mine)?.who;
  // A checked NEAR name (J3 part 2) is who they are, here and in a private conversation.
  const whoOf = (pubkey: string) => book.account(pubkey) ?? peerName(pubkey, known, dms, placeName(place));
  const conversations = Object.values(dms).filter((c) => !moderation.mutedKeys.has(c.peer) && c.lines.length > 0);
  // The chats list names each conversation as this place last did.
  for (const c of conversations) peerTitles.set(`${place} ${c.peer}`, whoOf(c.peer));
  // Someone wrote privately while you're in the place: one line over the field, which opens it (never a strip on top).
  const fresh = conversations.find((c) => c.unread > 0);

  if (thread) {
    return (
      <Thread
        place={place}
        peer={thread}
        who={whoOf(thread)}
        checked={book.account(thread)}
        dms={dms}
        money={money}
        paid={paid}
        activity={activity}
        note={note}
        onNote={(t) => setNote({ text: t })}
        onSeen={() => setDms(seen(dmsRef.current, thread))}
        onSend={(t) => sendDm(thread, t)}
        onResend={(l) => void resendDm(thread, l)}
        onMute={() => { moderation.mute({ pubkey: thread, who: whoOf(thread) }); setThread(null); }}
        onProblem={(p) => void problem(p)}
        onBack={() => setThread(null)}
      />
    );
  }

  const hasConversation = person ? conversations.some((c) => c.peer === person.pubkey) : false;
  return (
    <PushedFrame name={placeName(place)} mark={<span className={`ch-live${status.open > 0 ? " on" : ""}`} role="img" aria-label={status.open > 0 ? "Connected" : "Not connected yet"} data-testid="chat-live" />} onBack={onLeave}>
      <div className="ch ch-chat">
        {/* §9, a room: under the title one small line, "You're anon5504"; your name, the NEAR switch and what leaves
            this phone are one tap down (change 3: nothing else above the messages). */}
        <button className="zf-link ch-you" onClick={() => setYou(true)} data-testid="chat-you">You're {shownNick}</button>
        <div className="ch-list" ref={list} data-bar-stay="" data-testid="chat-list">
          {shownMessages.length === 0 && <p className="zf-small ch-empty" data-testid="chat-empty">{EMPTY_PLACE}</p>}
          {shownMessages.map((m, i) => (
            <div key={m.id} className={`ch-msg${m.mine ? " ch-mine" : ""}`} data-testid="chat-msg">
              {/* No "· from afar" (J3 C5): every ZeroFee person who typed a city carried BitChat's teleport mark, so it
                  told no one anything and put jargon on every row. */}
              {m.mine ? <div className="ch-who">You</div> : <button className="ch-who ch-whobtn" onClick={() => setPerson(m)} data-testid="chat-who">{book.account(m.pubkey) ? <NameBadge account={book.account(m.pubkey)!} /> : m.who}</button>}
              <BubbleText text={displayText(m, { to: !!chipFor(m, book.account(m.pubkey)) })} />
              {m.mine && <SplitCameIn lines={shownMessages} at={i} activity={activity} />}
              {/* QA (5 Nov): a cancel is said once, by the posted cancel line; nothing more under the request */}
              {m.mine && !cancelled.has(m.id) && <MyRequestLine m={m} cancelled={false} onOpen={(request) => setMyRequest({ m, request })} />}
              {m.request && cancelled.has(m.id) && <p className="zf-small ch-paid" role="status" data-testid="chat-request-cancelled">{REQUEST_CANCELLED}</p>}
              {/* A Pay chip only for a checked author paying that same account on NEAR (diff review L7, as in rooms). A
                  nickname never earns one (audit: a stranger posted under a friend's nickname); its bubble says where
                  the money goes, in full. A request its poster cancelled has none (k-chat crawl, 4 Nov, S2). */}
              {!cancelled.has(m.id) && chipFor(m, book.account(m.pubkey)) && <RequestChip request={chipFor(m, book.account(m.pubkey))!} asked={m} who={book.account(m.pubkey)!} money={money} paid={paid} activity={activity} me={account} />}
              <TipLink target={tipTarget(m, book.account(m.pubkey), shownMessages)} author={m.pubkey} id={m.id} who={whoOf(m.pubkey)} money={money} paid={paid} />
            </div>
          ))}
          {pending && (
            <div className="ch-msg ch-mine ch-pending" data-testid="chat-pending">
              <div className="ch-who">You</div>
              <div className="ch-text">{pending}</div>
              <p className="zf-small" role="status">Posting…</p>
            </div>
          )}
        </div>
        {fresh && <button className="zf-link ch-note ch-fresh" onClick={() => setThread(fresh.peer)} data-testid="chat-private-new">{whoOf(fresh.peer)} sent you a message ›</button>}
        {note && <p className="zf-small ch-note" role="status" data-testid="chat-note">{note.text}</p>}
        {/* k-chat crawl (4 Nov, S3): the field says what it's for; Post stays off until there's something to post */}
        <Composer text={text} busy={busy} placeholder={PLACE_FIELD} label={PLACE_FIELD} action="Post" onText={(t) => { setText(t); setNote(null); }} onSubmit={(e) => void submit(e)} onDollar={() => setAsking(true)} />
      </div>
      {money.picker}
      {myRequest && (
        <MyRequestSheet request={myRequest.request} cancelled={cancelled.has(myRequest.m.id)} audience={`everyone in ${placeName(place)}`} onClose={() => setMyRequest(null)}
          onCancel={async () => { const ok = await post(cancelText(myRequest.request)); if (ok) setMyRequest(null); return ok; }} />
      )}
      {person && (
        <Sheet title={whoOf(person.pubkey)} onClose={() => setPerson(null)}>
          {/* Acceptance 4 (B27): the first thing a tapped name shows is the private message. */}
          <p className="zf-body ch-sheetlead" data-testid="chat-private-first">{PRIVATE_FIRST}</p>
          <PrivateFirst who={whoOf(person.pubkey)} money={money} onSend={async (t) => { const ok = await sendDm(person.pubkey, t); if (ok) { setThread(person.pubkey); setPerson(null); } return ok; }} onCommand={() => setPerson(null)} />
          <div className="ch-picks">
            {hasConversation && <button className="zf-row ch-place" data-testid="chat-dm-open" onClick={() => { setThread(person.pubkey); setPerson(null); }}><span>See your messages</span><span className="zf-small">Only they see them</span></button>}
            <button className="zf-row ch-place" data-testid="chat-hide" onClick={() => { moderation.hide(person.id); setPerson(null); }}><span>Hide this message</span><span className="zf-small">On this device</span></button>
            <button className="zf-row ch-place" data-testid="chat-mute" onClick={() => { moderation.mute({ pubkey: person.pubkey, who: person.who }); setPerson(null); }}><span>Mute {person.who}</span><span className="zf-small">Hides all they say</span></button>
          </div>
        </Sheet>
      )}
      {you && (
        <Sheet title="You here" onClose={() => setYou(false)}>
          <NickForm nick={nick} onSave={(n) => { onNick(n); setYou(false); }} />
          {namedOk && (
            <button role="switch" aria-checked={named} className="ch-switch" disabled={naming} onClick={() => void toggleNamed()} data-testid="chat-near-switch">
              <span>Show my NEAR account</span><span className={`ch-switch__knob${named ? " on" : ""}`} aria-hidden="true" />
            </button>
          )}
          <More label="What leaves this device" className="ch-conn" lines={[
            `${status.open} of ${relays.length} message servers connected${local ? " (on this computer)" : ""}.`,
            ...(shared === null ? [] : [shared > 0 ? `People on BitChat here use ${shared} of them, so they see these messages too.` : "People on BitChat here use other servers."]),
            ...(me ? [`Others see you as ${shownNick}#${me.slice(-4)}. The four letters tell two people with one name apart.`] : []),
            "We look at where you are only when you tap Nearby. Then only your city's short code goes out.",
            "The servers that carry chats can see where you connect from.",
          ]} />
        </Sheet>
      )}
      {(asking || askFrom || again) && <RequestSheet audience={`everyone in ${placeName(place)}`} nick={shownNick} {...(again ? { ask: again.ask, refusedFirst: again.line } : askFrom ? { ask: askFrom } : {})} onClose={() => { setAsking(false); setAskFrom(null); setAgain(null); }}
        later={{ onPending: (words) => { setPending(words); setAsking(false); setAskFrom(null); setAgain(null); }, onLater: (a) => { setPending(null); setAgain(a); } }}
        onPost={async (r) => { setAsking(false); setAskFrom(null); setAgain(null); try { await post(requestText(r)); } finally { setPending(null); } }} onSplit={async (line, r) => { setAsking(false); setAskFrom(null); if ((await post(line)) && !(await post(requestText(r)))) setNote({ text: SPLIT_HALF }); }} onProblem={(p) => { setAsking(false); setAskFrom(null); setAgain(null); setPending(null); void problem(p); }} />}
    </PushedFrame>
  );
}

/** The field every chat ends with (§9, a room): a round $ (Ask for money), the field, and Post or Send. The field has the
 *  cursor when the screen opens (B27: a place opens with its composer focused). */
/** A bubble's words, its https links tappable (sd-chat crawl, 5 Nov, g), never in this page; anything else stays text
 *  (links.ts). ZeroFee's Browser opens only an explorer's page handed over (proofUrlOk), so a chat link opens outside it:
 *  on the phone the system's browser sheet (device.openUrl, as a payment's record does), on the web a new tab, cut off
 *  from this page (noopener). */
export function BubbleText({ text }: { text: string }) {
  const shell = useShell();
  const parts = linkParts(text);
  return (
    <div className="ch-text">
      {parts.map((p, i) => ("url" in p
        ? <a key={i} className="ch-link" href={p.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${p.host}`} data-testid="chat-link" onClick={(e) => { if (!onPhone()) return; e.preventDefault(); void shell.bridge.call("device.openUrl", { url: p.url, mode: "sheet" }); }}>{p.text}</a>
        : p.text))}
    </div>
  );
}

export function Composer({ text, busy, placeholder, label, action, maxLength = 2000, tooLong = false, onText, onSubmit, onDollar }: {
  text: string; busy: boolean; placeholder: string; label: string; action: "Post" | "Send"; maxLength?: number; tooLong?: boolean;
  onText: (t: string) => void; onSubmit: (e: FormEvent) => void; onDollar: () => void;
}) {
  return (
    <form className="ch-compose ch-compose--money" onSubmit={onSubmit}>
      <button type="button" className="ch-dollar" aria-label="Ask for money" onClick={onDollar} data-testid="chat-dollar">$</button>
      <input value={text} onChange={(e) => onText(e.target.value)} placeholder={placeholder} aria-label={label} maxLength={maxLength} autoCapitalize="sentences" autoFocus data-testid="chat-composer" />
      <button className="zf-btn ch-post" disabled={!text.trim() || busy || tooLong}>{action}</button>
    </form>
  );
}

/** The first private message, written in the person's sheet: their name, the words, Send. A payment typed here is read
 *  as the person's own command, as in any composer (never sent as a message). */
function PrivateFirst({ who, money, onSend, onCommand }: { who: string; money: ReturnType<typeof useMoney>; onSend: (text: string) => Promise<boolean>; onCommand: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const bytes = dmBytes(text.trim());
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const typed = text.trim();
    if (!typed || busy || bytes > DM_LIMIT) return;
    const asked = money.command(typed);
    if (asked === "done") return onCommand();
    if (asked === "fix") return;
    setBusy(true);
    try {
      if (await onSend(typed)) setText("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="ch-compose" style={{ marginTop: 12 }} onSubmit={(e) => void submit(e)}>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Your message" aria-label="Private message" maxLength={255} autoCapitalize="sentences" data-testid="chat-dm-first" />
      <button className="zf-btn ch-post" disabled={!text.trim() || busy || bytes > DM_LIMIT}>Send</button>
    </form>
  );
}

/** One private conversation: BitChat's geohash DM with one person's key in this place. */
function Thread({ place, peer, who, checked, dms, money, paid, activity, note, onNote, onSeen, onSend, onResend, onMute, onProblem, onBack }: {
  place: string; peer: string; who: string; checked?: string | null; dms: Dms; money: ReturnType<typeof useMoney>; paid: PaidBook; activity: readonly Movement[]; note: Note; onNote: (text: string) => void;
  onSeen: () => void; onSend: (text: string) => Promise<boolean>; onResend: (line: DmLine) => void; onMute: () => void; onProblem: (p: Problem) => void; onBack: () => void;
}) {
  const [text, setText] = useState("");
  // A line of ours with no "Delivered" after 10 s says so (J3 C4): the screen looks again when the next one is due.
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const lines = dms[peer]?.lines ?? [];
  // C-4: every line here is the peer's or this person's; a Tip pays only the peer's own words (tip.ts)
  const said = lines.map((l) => ({ pubkey: peer, mine: l.mine, ...(l.request ? { request: l.request } : {}) }));
  const bytes = dmBytes(text.trim());
  // "Someone in Zurich" (no name of theirs seen here: J3 C3) reads as "this person" inside a sentence.
  const them = who.startsWith("Someone in ") ? "this person" : who;
  useEffect(() => {
    // Measured from the clock now, not from when the screen last drew (a message sent a minute after opening the
    // conversation must turn late 10 s after it went, not 70).
    const due = nextLate(lines, Date.now());
    if (due === null) return;
    const t = setTimeout(() => setNow(Date.now()), due + 50);
    return () => clearTimeout(t);
  }, [lines, now]);
  useEffect(() => {
    onSeen();
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [lines.length]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const typed = text.trim();
    if (!typed || busy || bytes > DM_LIMIT) return;
    const asked = money.command(typed);
    if (asked === "done") return setText("");
    if (asked === "fix") return;
    setBusy(true);
    try {
      if (await onSend(typed)) setText("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <PushedFrame name={who} onBack={onBack}>
      <div className="ch ch-chat">
        {/* One small line under the title, as in a place (§9; change 3: nothing else above the messages). */}
        <div className="ch-dmtop">
          <p className="zf-small ch-you" data-testid="chat-dm-who">Only {them} sees this. In {placeName(place)}.</p>
          <button className="zf-link ch-mute" onClick={onMute} data-testid="chat-dm-mute">Mute</button>
        </div>
        <div className="ch-list" ref={list} data-bar-stay="" data-testid="chat-dm-list">
          {lines.length === 0 && <p className="zf-small ch-empty">Only {them} sees what you write here.</p>}
          {lines.map((l, i) => (
            <div key={`${l.mine ? "m" : "t"}${l.id}`} className={`ch-msg${l.mine ? " ch-mine" : ""}`} data-testid="chat-dm-msg">
              <div className="ch-who">{l.mine ? "You" : who}</div>
              <BubbleText text={displayText(l)} />
              {l.mine && <SplitCameIn lines={lines} at={i} activity={activity} />}
              {l.mine && l.status && !late(l, Date.now()) && <div className="zf-small ch-delivery" data-testid="chat-dm-delivery">{l.status === "failed" ? notSentWords({ online: globalThis.navigator?.onLine !== false, phone: onPhone() }) : deliveryWords[l.status]}</div>}
              {l.mine && late(l, Date.now()) && (
                <div className="zf-small ch-delivery ch-late" data-testid="chat-dm-late">
                  <span>{l.status === "failed" ? notSentWords({ online: globalThis.navigator?.onLine !== false, phone: onPhone() }) : lateWords(l.status)}</span>
                  <button className="zf-link" onClick={() => onResend(l)} data-testid="chat-dm-resend">Send again</button>
                </div>
              )}
              {l.request && <RequestChip request={l.request} asked={l} who={who} money={money} paid={paid} activity={activity} />}
              <TipLink target={tipTarget({ pubkey: peer, mine: l.mine, text: l.text, ...(l.request ? { request: l.request } : {}) }, checked, said)} author={peer} id={l.id} who={who} money={money} paid={paid} />
            </div>
          ))}
        </div>
        {note && <p className="zf-small ch-note" role="status" data-testid="chat-note">{note.text}</p>}
        {bytes > DM_LIMIT && <p className="zf-small ch-note" role="status">This message is too long for BitChat. Make it shorter.</p>}
        <Composer text={text} busy={busy} placeholder={`Message ${who}`} label="Private message" action="Send" maxLength={255} tooLong={bytes > DM_LIMIT} onText={setText} onSubmit={(e) => void submit(e)} onDollar={() => setAsking(true)} />
      </div>
      {money.picker}
      {asking && <RequestSheet audience={who} nick={null} onClose={() => setAsking(false)} onPost={async (r) => { setAsking(false); await onSend(requestText(r)); }} onSplit={async (line, r) => { setAsking(false); if ((await onSend(line)) && !(await onSend(requestText(r)))) onNote(SPLIT_HALF); }} onProblem={(p) => { setAsking(false); onProblem(p); }} />}
    </PushedFrame>
  );
}

/** Request money: an amount and a coin; the network is the coin's own (NEAR for NEAR, Solana for SOL…), or for a dollar
 *  coin the one the person receives on, with Change (grade 02g, G4: never a list of six to read first). The vault's own
 *  address there (ledger.depositAddress) goes in it. A test account asks for test NEAR (G2): on the test network the
 *  sheet starts on NEAR at once, from the page's network, never after a balance read (grade 02h, H2), and what the
 *  sheet shows when Post is tapped is what is posted: nothing changes a field while it posts. */
/** k-chat crawl (4 Nov, S3: "Posting…" 13 s): a request leaves the sheet at once. `onPending` puts it in the list as
 *  "Posting…" while its address is read; `onLater` brings the sheet back, the amount kept and the refusal on it, when the
 *  request can't go (the sheet is gone by then). Without them the sheet waits as before (a split always does). */
export interface RequestLater { onPending: (words: string) => void; onLater: (again: { ask: AskCommand; line: string }) => void }

export function RequestSheet({ audience, nick, onClose, onPost, onProblem, nearAccount, ask, onSplit, later, refusedFirst }: { audience: string; nick: string | null; onClose: () => void; onPost: (r: PayRequest) => Promise<void>; onProblem: (p: Problem) => void; nearAccount?: string; ask?: AskCommand; onSplit?: (line: string, r: PayRequest) => Promise<void>; later?: RequestLater; refusedFirst?: string }) {
  const { bridge } = useShell();
  const away = useRef(false);
  const [amount, setAmount] = useState(ask?.amount ?? "");
  // C-1 Split the bill (split.ts): the bill's total and how many share it; the request asks each other person's share
  const [splitting, setSplittingState] = useState(false);
  // a split asks in dollars: switching to it starts on USDC (the person can pick USDT)
  const toggleSplit = () => {
    const next = !splitting;
    setSplittingState(next);
    if (next && !/^USD[CT]$/.test(coin)) { setCoin("USDC"); setPicked(null); }
  };
  const [total, setTotal] = useState("");
  const [people, setPeople] = useState(2);
  const shares = splitting ? splitBill(total, people) : null;
  const [coin, setCoin] = useState(() => ask?.coin ?? startCoin(globalThis.location?.search ?? "", PUBLIC_BUILD));
  const [picked, setPicked] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [usual, setUsual] = useState("near");
  const [busy, setBusy] = useState(false);
  // A refusal the person fixes here (another coin or network, a bigger amount): one line on the sheet, the amount kept.
  const [refused, setRefused] = useState<string | null>(refusedFirst ?? null);
  const posting = useRef(false);
  useEffect(() => {
    let live = true;
    // A dollar coin's network: the one the person receives on. Never changed under "Posting…".
    void bridge.call<{ chain: string | null }>("ledger.receiveChain").then((r) => { if (live && !posting.current && "ok" in r && r.ok.chain && REQUEST_CHAINS.includes(r.ok.chain)) setUsual(r.ok.chain); });
    return () => { live = false; };
  }, [bridge]);
  // In a NEAR room (J3 part 2) a request is paid to the account itself, on NEAR: its name is the address.
  const chain = nearAccount ? "near" : picked ?? COIN_HOME[coin] ?? usual;
  const dollarCoin = /^USD[CT]$/.test(coin);
  const ok = (splitting ? !!shares && "ok" in shares && dollarCoin : /^\d{1,12}(\.\d{1,18})?$/.test(amount) && Number(amount) > 0) && /^[A-Z0-9]{2,10}$/.test(coin);
  // Dead ends row 12: "Choose another network" opened nothing in Chat and the sheet had closed, so the amount was lost.
  const refuse = (p: Problem) => {
    const line = requestRefusal(p, { coin, network: chainName(chain) });
    if (line) say(line);
    else onProblem(p);
  };
  /** A refusal line: on the sheet, or (the sheet already gone) the sheet back with it. */
  const say = (line: string) => {
    if (away.current && later) later.onLater({ ask: { amount, coin, ...(ask?.from ? { from: ask.from } : {}) } as AskCommand, line });
    else setRefused(line);
  };
  // Any edit clears the refusal: the next tap asks again (not the first run, which would clear one brought back).
  const edited = useRef(false);
  useEffect(() => { if (edited.current) setRefused(null); edited.current = true; }, [amount, coin, chain, total, people, splitting]);
  const make = async () => {
    if (posting.current) return;
    posting.current = true;
    setBusy(true);
    setRefused(null);
    if (later && !splitting) {
      away.current = true;
      later.onPending(requestWords({ amount, coin, chain, address: "" }, true));
    }
    try {
      // NEAR on NEAR is the account's own NEAR, by name: the one coin a test account can be paid (G2).
      let tokenId = "near";
      // a split asks its share in this coin: a dollar coin as dollars, another at its price (rounded up, never less)
      let asked = amount;
      const split = splitting && shares && "ok" in shares ? shares.ok : null;
      if (splitting && !split) return;
      if (!(chain === "near" && coin === "NEAR") || split) {
        const tokens = await bridge.call<{ assetId: string; chain: string; symbol: string; priceUsd?: string }[]>("ledger.tokens");
        const listed = "ok" in tokens && Array.isArray(tokens.ok) ? tokens.ok : [];
        const token = listed.filter((t) => t.chain === chain && t.symbol.toUpperCase() === coin);
        if (!(chain === "near" && coin === "NEAR")) {
          if (token.length !== 1) return refuse({ code: "chat.request.coin", whatHappened: `ZeroFee can't receive ${coin} on ${chainName(chain)}. Pick another coin or network.`, money: { state: "not-involved" }, next: { kind: "nothing", label: "Go back" } });
          tokenId = token[0]!.assetId;
        }
        if (split) {
          const share = shareAmount(split.eachCents, coin);
          if (!share) return;
          asked = share;
        }
      }
      const usd = /^(USDC|USDT)$/.test(coin) ? Number(asked) : undefined;
      const r = await bridge.call<{ address: string; memo?: string; minAmount?: string; sample?: boolean }>("ledger.depositAddress", { chain, token: tokenId, ...(usd ? { usd } : {}) });
      if ("problem" in r) {
        if (r.problem.code === "ledger.account.testnet") return refuse({ code: "chat.request.test-account", whatHappened: "A test account can ask only for test NEAR, on NEAR.", money: { state: "not-involved" }, next: { kind: "nothing", label: "Go back" }, more: testAccountFix({ coin, network: chainName(chain) }) });
        return refuse(r.problem);
      }
      if (r.ok.memo) return refuse({ code: "chat.request.memo", whatHappened: `A ${chainName(chain)} request needs a memo, which chat can't carry.`, money: { state: "not-involved" }, next: { kind: "nothing", label: "Go back" }, more: "Pick another network." });
      // Our own address is checked like anyone's before it is posted: a request no one can pay is never sent.
      // sd-chat crawl (5 Nov, a): a Sim request to its sample address is posted (request-coin.ts postableOwnAddress)
      if (!postableOwnAddress(r.ok, chain)) return refuse({ code: "chat.request.address", whatHappened: `Your ${chainName(chain)} address looks wrong. Nothing was asked.`, money: { state: "not-involved" }, next: { kind: "nothing", label: "Go back" }, more: "Try another network." });
      // A NEAR room's request is paid to the account itself (its name, which the room shows as checked): never another
      // address under that name.
      if (nearAccount && r.ok.address !== nearAccount) return refuse({ code: "chat.request.address", whatHappened: "Your NEAR account didn't match this ask, so nothing was posted.", money: { state: "not-involved" }, next: { kind: "nothing", label: "Go back" } });
      // Dead ends row 5: the bridge never credits a payment under its least, so a request under it is never posted.
      const least = underBridgeMinimum(asked, r.ok.minAmount, coin);
      if (least) return say(least);
      const request = { amount: asked, coin, chain, address: r.ok.address, ...(ask && !split ? { from: ask.from } : {}) };
      // review M2: Activity read once BEFORE the split goes out, so every deposit already there is dated before the ask
      if (split) await bridge.call("ledger.activity", { limit: 50 });
      if (split && onSplit) await onSplit(splitText(split), request);
      else await onPost(request);
    } finally {
      posting.current = false;
      setBusy(false);
    }
  };
  return (
    <Sheet title={splitting ? "Split a bill" : "Ask for money"} onClose={onClose}>
      <div className="ch-form">
        {onSplit && !nearAccount && <button type="button" className="zf-link ch-splitswitch" disabled={busy} onClick={toggleSplit} data-testid="chat-split-switch"><span>{splitting ? "Ask for one amount instead" : "Split a bill"}</span><span aria-hidden="true">›</span></button>}
        {splitting ? (
          <>
            <label className="ch-field"><span className="zf-small">The bill's total, in dollars</span><input className="ch-input" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value.replace(",", "."))} aria-label="The bill's total" placeholder="48.50" disabled={busy} data-testid="chat-split-total" /></label>
            <div className="ch-field">
              <span className="zf-small">People, you too</span>
              <div className="ch-people" role="group" aria-label="People, you too">
                <button type="button" className="ch-tab" aria-label="One fewer" disabled={busy || people <= SPLIT_MIN} onClick={() => setPeople((n) => Math.max(SPLIT_MIN, n - 1))}>−</button>
                <span className="zf-body" data-testid="chat-split-people">{people}</span>
                <button type="button" className="ch-tab" aria-label="One more" disabled={busy || people >= SPLIT_MAX} onClick={() => setPeople((n) => Math.min(SPLIT_MAX, n + 1))}>+</button>
              </div>
            </div>
            {total.trim() && shares && <p className="zf-body" style={{ marginTop: 10 }} role="status" data-testid="chat-split-each">{"ok" in shares ? (shares.ok.askerCents === shares.ok.eachCents ? `Each pays ${dollars(shares.ok.eachCents)}, you too.` : `Each pays ${dollars(shares.ok.eachCents)}. You pay ${dollars(shares.ok.askerCents)}.`) : shares.line}</p>}
          </>
        ) : (
          <label className="ch-field"><span className="zf-small">{dollarCoin ? "Amount in dollars" : `Amount in ${coin || "the coin"}`}</span><input className="ch-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", "."))} aria-label={dollarCoin ? "Amount in dollars" : `Amount in ${coin || "the coin"}`} placeholder="5" disabled={busy} /></label>
        )}
        <label className="ch-field"><span className="zf-small">Coin</span><input className="ch-input" value={coin} onChange={(e) => { setPicked(null); setCoin(e.target.value.toUpperCase().trim()); }} aria-label="Coin" maxLength={10} disabled={busy} /></label>
        <div className="ch-net">
          <span className="zf-small" data-testid="chat-request-network">On {chainName(chain)}</span>
          {!changing && !nearAccount && <button type="button" className="zf-link" onClick={() => setChanging(true)} disabled={busy} data-testid="chat-request-change">Change</button>}
        </div>
        {changing && (
          <div className="ch-chains" role="group" aria-label="Network">
            {REQUEST_CHAINS.map((c) => <button key={c} type="button" className={`ch-tab${c === chain ? " on" : ""}`} aria-pressed={c === chain} onClick={() => { setPicked(c); setChanging(false); }}>{chainName(c)}</button>)}
          </div>
        )}
        {splitting && !dollarCoin && <p className="zf-small" role="status" style={{ marginTop: 8 }} data-testid="chat-split-dollars">{SPLIT_DOLLARS_ONLY}</p>}
        {refused && <p className="zf-body" role="alert" style={{ marginTop: 10 }} data-testid="chat-request-refused">{refused}</p>}
        {/* Security review 2 Nov (Low): say plainly what posting reveals. */}
        {/* J3 C8: the warning in one line, what follows from it one tap down. */}
        {/* k-chat crawl (4 Nov, S4): one string, never "E | veryone" split in two for a screen reader */}
        <p className="zf-small" style={{ marginTop: 10 }} data-testid="chat-request-privacy">{`${audience.charAt(0).toUpperCase()}${audience.slice(1)} will see your ${chainName(chain)} address.`}</p>
        <More label="What that means" className="ch-conn" lines={[...(nick && !nearAccount ? [`Your nickname ${nick} goes with it.`] : []), "Anyone with the address can see what it holds and sends."]} />
      </div>
      <div className="zf-floor"><button className="zf-btn" disabled={!ok || busy} onClick={() => void make()}>{busy ? (nick ? "Posting…" : "Sending…") : splitting ? (nick ? "Post the split" : "Send the split") : nick ? "Post the request" : "Send the request"}</button></div>
    </Sheet>
  );
}

export const chatApp: AppModule = { id: "chat", name: "ZeroFee Chat", line: "Chat with anyone on BitChat nearby", Root: ChatRoot };
