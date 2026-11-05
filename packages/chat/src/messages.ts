// What ZeroFee Chat posts and how it shows what others post (D55). Everything here is plain text a BitChat user reads
// as it is; nothing in it can move money.
//
// Someone else's message is only ever shown. Its one extra is a request chip, for a message in the request format
// below whose address checks out on its chain: tapping the chip FILLS Wallet's Send in, and the person still taps Send
// and approves on the core's sheet. A message that says "send money to …" is text, nothing else (messages.test.ts).
import { readable } from "@zerofee/core/signer";
import { MAX_CONTENT, type NostrEvent } from "@zerofee/core/nostr";
import { isAccountId } from "@zerofee/core/chat-near";
import { chainFromWords, chainName, detect } from "./detect.ts";

export interface PayRequest {
  amount: string;
  coin: string;
  chain: string;
  address: string;
  /** Who is asked to pay, when the request names one NEAR account (J3 part 2: "request 5 USDC from bob.near"). */
  from?: string;
}

const TAG = "ZeroFee Chat";

/** The request line: "Request: 5 USDC on Base to 0x… · ZeroFee Chat". */
export function requestText(r: PayRequest): string {
  return `Request: ${r.amount} ${r.coin.toUpperCase()} on ${chainName(r.chain)} to ${r.address}${r.from ? ` from ${r.from}` : ""} · ${TAG}`;
}

const REQUEST = /^Request: (\d{1,12}(?:\.\d{1,18})?) ([A-Z0-9]{2,10}) on ([A-Za-z][A-Za-z ]{1,23}) to (\S{2,128})(?: from ([a-z0-9._-]{2,64}))? · ZeroFee Chat$/;

/** A request as people read it (e2e walk 3 Nov: the bubble showed the wire line, "Request: 13.33 USDC on NEAR to
 *  zf-sample383081.testnet · ZeroFee Chat"): dollars first for a dollar coin, the coin and its network, no address (the
 *  Pay chip carries it), no app name. The line on the wire is unchanged, so every client still reads it. */
/** `to`: the bubble of a request with a Pay chip says where the money goes, in full (audit: never only on the chip). */
export function requestWords(r: PayRequest, mine: boolean, to = false): string {
  // k-chat crawl (4 Nov, S2): the bubble never said it was a request. It says so, and whose.
  return `${mine ? "Your request for" : "A request for"} ${requestAmount(r, to)}.`;
}

/** What a request asks, once: "$1.00 in USDC on NEAR" for a dollar coin (the Copywriter, 4 Nov: "$1.00 (1 USDC on
 *  NEAR)" said one number twice), "5 NEAR on NEAR" for any other. The "Your request" sheet leads with it as it is. */
export function requestAmount(r: PayRequest, to = false): string {
  const coin = r.coin.toUpperCase();
  const what = /^USD[CT]$/.test(coin) ? `$${Number(r.amount).toFixed(2)} in ${coin} on ${chainName(r.chain)}` : `${r.amount} ${coin} on ${chainName(r.chain)}`;
  return `${what}${to ? ` to ${r.address}` : ""}${r.from ? ` from ${r.from}` : ""}`;
}

/**
 * The Pay chip a public room shows under a message, or null (audit: a stranger could post a request under a friend's
 * nickname and get a chip). Only a poster whose NEAR account is checked (`account`), asking to be paid on NEAR to that
 * very account. A nickname, checked or not, never earns one; my own message never has one.
 */
export function chipFor(m: { mine: boolean; request?: PayRequest | undefined }, account: string | null | undefined): PayRequest | null {
  const r = m.request;
  if (!r || m.mine || !account) return null;
  return r.chain === "near" && r.address === account ? r : null;
}

/** Cancelling a request (k-chat crawl, 4 Nov, S2): a place's messages can't be taken back, so the person posts this
 *  line. BitChat users read it as it is; ZeroFee Chat shows the request it names as cancelled, with no Pay. */
export function cancelText(r: PayRequest): string {
  return `Cancelled: ${requestText(r).slice("Request: ".length)}`;
}
const CANCEL = /^Cancelled: (.+)$/;
/** The request a cancel line names, or null. */
export function readCancel(text: string, mine = false): PayRequest | null {
  const m = CANCEL.exec(text.trim());
  return m ? readRequest(`Request: ${m[1]}`, mine) : null;
}
const same = (a: PayRequest, b: PayRequest) => a.amount === b.amount && a.coin === b.coin && a.chain === b.chain && a.address === b.address && (a.from ?? "") === (b.from ?? "");
/** The ids of requests their own poster cancelled later in `list` (a cancel from anyone else counts for nothing). */
export function cancelledIds(list: readonly { id: string; pubkey: string; text: string; atIso: string; mine?: boolean }[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const m of list) {
    const r = readRequest(m.text, m.mine === true);
    if (!r) continue;
    if (list.some((n) => n.pubkey === m.pubkey && n.atIso >= m.atIso && n.id !== m.id && (() => { const c = readCancel(n.text, n.mine === true); return !!c && same(c, r); })())) out.add(m.id);
  }
  return out;
}

/** What a message shows: a valid request (or its cancel) in words; anything else as it was posted. */
export function displayText(m: { text: string; mine: boolean }, o: { to?: boolean } = {}): string {
  const r = readRequest(m.text, m.mine);
  if (r) return requestWords(r, m.mine, !!o.to);
  const c = readCancel(m.text, m.mine);
  if (c) return `${m.mine ? "You cancelled your request for" : "Cancelled their request for"} ${requestAmount(c)}.`;
  return m.text;
}

/** A request in a message, when its address really is on the chain it names; else null (it shows as text). `mine`: your
 *  own message, read for its words and its Cancel only (never a Pay chip): the address as you posted it, checked or not,
 *  so a Sim request to its sample address reads as a request (sd-chat crawl, 5 Nov, a). Anyone else's is checked. */
export function readRequest(text: string, mine = false): PayRequest | null {
  const m = REQUEST.exec(text.trim());
  if (!m) return null;
  const [, amount, coin, network, address, from] = m;
  const chain = chainFromWords(network!);
  if (!chain || !(Number(amount) > 0)) return null;
  const d = detect(address!, network!);
  const ok = "ok" in d && d.ok.kind === "one" && d.ok.chain === chain;
  if (!ok && !mine) return null;
  return { amount: amount!, coin: coin!, chain, address: ok ? d.ok.address : address!, ...(from && isAccountId(from) ? { from } : {}) };
}

/** "Sent $5.00 (5 USDC) on Solana · <tx link>", posted only when the person taps Share. Dollars first (J6): a dollar coin
 *  is its own dollars; another coin's are the approval sheet's figure that Wallet's Send hands back (`usd`), or none. */
export function sentText(s: { amount: string; coin: string; chain: string; link?: string; usd?: string }): string {
  const coin = `${s.amount} ${s.coin.toUpperCase()}`;
  const usd = s.usd && /^\$\d{1,3}(,\d{3})*\.\d{2}$/.test(s.usd) ? s.usd : /^USD[CT]$/.test(s.coin.toUpperCase()) && Number(s.amount) > 0 ? `$${Number(s.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null;
  return `Sent ${usd ? `${usd} (${coin})` : coin} on ${chainName(s.chain)}${s.link ? ` · ${s.link}` : ""}`;
}

/** One message on screen. */
export interface Shown {
  id: string;
  /** The sender's name as BitChat shows it: nickname#last four of their key. */
  who: string;
  pubkey: string;
  text: string;
  atIso: string;
  mine: boolean;
  /** Only a valid request makes one; tapping it fills Send in. */
  request?: PayRequest;
  /** Where BitChat says it was sent from far away (["t","teleport"]). */
  teleported: boolean;
}

const LONG = 600;

/** BitChat's display name: the "n" tag (or anon) and the key's last four hex. Unreadable characters blanked. */
export function whoOf(e: Pick<NostrEvent, "tags" | "pubkey">): string {
  const nick = readable(e.tags.find((t) => t[0] === "n")?.[1] ?? "").replace(/[✓✔☑✅]/gu, "").trim().slice(0, 32) || "anon";
  // A nickname that could pass for a NEAR name (a dot, or a look-alike of one) says it isn't checked: only a checked
  // name's own badge says whose account it is (J3 part 2, security review M1).
  return `${nick}#${e.pubkey.slice(-4)}${/[.․．。｡·•]/u.test(nick) ? " (not checked)" : ""}`;
}

/** A verified kind-20000 event as a message on screen. Long text is cut at 600 characters (a 10,000-character post
 *  never stalls the list); control and direction characters are blanked. */
export function shown(e: NostrEvent, myKeys: ReadonlySet<string>, posted: ReadonlySet<string> = new Set()): Shown {
  const raw = e.content.slice(0, MAX_CONTENT * 5);
  const text = readable(raw.length > LONG ? `${raw.slice(0, LONG)}…` : raw);
  const mine = myKeys.has(e.pubkey) || posted.has(e.id);
  const request = readRequest(raw);
  // Never a throw while the list draws (pool.ts already drops a time past the clock): an impossible date reads as 1970.
  const at = new Date(e.created_at * 1000);
  return {
    id: e.id,
    who: whoOf(e),
    pubkey: e.pubkey,
    text,
    atIso: Number.isNaN(at.getTime()) ? new Date(0).toISOString() : at.toISOString(),
    mine,
    ...(request && !mine ? { request } : {}),
    teleported: e.tags.some((t) => t[0] === "t" && t[1] === "teleport"),
  };
}

/**
 * Your own messages are "You", whenever they arrive (J3 C2: "Ava#a393 · hello from Ava" above Ava's own "You · hello
 * from Ava"). A place's last hour can reach the app before the core has said which key is yours there (a reload, the
 * phone's app opened again): those of yours are marked once the key is known, by the key, or by the id of what you
 * posted. A message of yours never offers a Pay chip. The same list comes back when nothing changes.
 */
export function markMine(list: readonly Shown[], myKeys: ReadonlySet<string>, posted: ReadonlySet<string>): readonly Shown[] {
  let changed = false;
  const next = list.map((m) => {
    if (m.mine || !(myKeys.has(m.pubkey) || posted.has(m.id))) return m;
    changed = true;
    const { request: _drop, ...rest } = m;
    return { ...rest, mine: true };
  });
  return changed ? next : list;
}
