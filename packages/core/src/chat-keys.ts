// The core's nostr.* methods for ZeroFee Chat, in one place for the core (demo-core.ts, the phone's isolated core) and
// the sample demo (MockBridge): the same checks, the same keys, the same note. Chat only (forApps stamps `app`); nothing
// here ever returns a secret: a public key, an event the core built and signed itself, or what a private message said.
//
//   nostr.publicKey {geohash[, named]} | {room}     the key's public half
//   nostr.sign      {geohash[, named], kind 20000/20001, content, nickname?, teleport?} | {room, kind 9, content}
//   nostr.seal/open {geohash[, named], …}           BitChat's private messages (bitchat-dm.ts); never in a room
//   nostr.bind      {room: true} | {geohash, named: true}   the account's note on its sheet, then the record event
//   nostr.bound     the same                          the record again, freshly signed by the chat key, no sheet; or null
//   nostr.unbind    {geohash, named: true}            forgets it; the empty record that takes the name back
//
// Security review of the design (2 Nov): M4 (one of room or place, the key and the event from the same field), M7
// (names only in a city or wider; room and named keys per account), L7 (one sheet at a time, a pause after a no).
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";
import type { PlainWords } from "./signer.ts";
import { publicKeyHex, signChat, signChatWith, type NostrEvent } from "./nostr.ts";
import { openChatDm, sealChatDm } from "./bitchat-dm.ts";
import { chatKeyAsk, chatNameHash, chatSecret, nameEvent, nameUntil, recordSigned, signRoom, type ChatKeyAsk, type ChatNameRecord } from "./chat-near.ts";

export interface ChatKeysHost {
  /** The Chat seed (32 bytes). The caller's copy: wiped after each use. */
  seed(): Promise<Uint8Array>;
  /** The account this device holds, when ready; null otherwise. */
  account(): Promise<string | null>;
  /**
   * The account's own key signs the note, after a sheet with `words` (the phone's chip builds and shows its own from
   * the parts). Null: the person said no. Its key and signature in NEAR's text forms.
   */
  signNote(note: { account: string; chatKey: string; until: string; nonce: Uint8Array; hash: Uint8Array; words: PlainWords }): Promise<{ publicKey: string; signature: string } | null>;
  /** The kept records (not secret): JSON, or null. */
  load(): Promise<string | null>;
  save(json: string | null): Promise<void>;
  now?: () => number;
}

const toBase64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
/** How long a no on the name sheet holds the next one back (L7). */
const AFTER_NO_MS = 5000;
/** A note this close to its end is renewed on a sheet rather than shown again. */
const RENEW_MS = 3 * 86_400_000;

type Kept = Record<string, ChatNameRecord>;
const slotOf = (ask: ChatKeyAsk): string => (ask.kind === "room" ? "room" : `place:${ask.geohash}`);

export class ChatKeys {
  private busy = false;
  private quietUntil = 0;
  private readonly host: ChatKeysHost;
  constructor(host: ChatKeysHost) {
    this.host = host;
  }

  private now(): number {
    return this.host.now?.() ?? Date.now();
  }

  /** Runs `use` with the request's secret (wiped after). Rooms and named keys need the account, which is the core's. */
  private async withKey<T>(p: Record<string, unknown>, use: (secret: Uint8Array, ask: ChatKeyAsk, account: string | null, seed: Uint8Array) => T | Promise<T>): Promise<T> {
    const ask = chatKeyAsk(p);
    const account = ask.kind === "place" && !ask.named ? null : await this.host.account();
    if ((ask.kind === "room" || ask.named) && !account) throw new ProblemError(securityProblems.notReady());
    const seed = await this.host.seed();
    const secret = chatSecret(seed, ask, account);
    try {
      return await use(secret, ask, account, seed);
    } finally {
      secret.fill(0);
      seed.fill(0);
    }
  }

  publicKey(p: Record<string, unknown>): Promise<{ pubkey: string }> {
    return this.withKey(p, (secret) => ({ pubkey: publicKeyHex(secret) }));
  }

  sign(p: Record<string, unknown>): Promise<NostrEvent> {
    return this.withKey(p, async (secret, ask, account, seed) => {
      if (ask.kind === "room") {
        // In a NEAR room your name is your account: no message goes out before it is (diff review L1).
        const r = (await this.kept())["room"];
        if (!r || r.account !== account || !(Date.parse(r.until) > this.now())) throw new ProblemError(securityProblems.requestNotAllowed("Show your NEAR account first. Then you can talk in NEAR rooms."));
        return signRoom(seed, account!, p, this.now() / 1000);
      }
      // signChatWith wipes the copy it is given
      return ask.named ? signChatWith(secret.slice(), p, { nowSeconds: this.now() / 1000 }) : signChat(seed, p, { nowSeconds: this.now() / 1000 });
    });
  }

  seal(p: Record<string, unknown>): Promise<unknown> {
    if (p.room !== undefined) throw new ProblemError(securityProblems.requestInvalid("private messages are in places only"));
    return this.withKey(p, (secret, ask, _a, seed) => sealChatDm(seed, p, ask.kind === "place" && ask.named ? { secret: secret.slice() } : {}));
  }

  open(p: Record<string, unknown>): Promise<unknown> {
    if (p.room !== undefined) throw new ProblemError(securityProblems.requestInvalid("private messages are in places only"));
    return this.withKey(p, (secret, ask, _a, seed) => openChatDm(seed, p, this.now() / 1000, ask.kind === "place" && ask.named ? secret.slice() : undefined));
  }

  private async kept(): Promise<Kept> {
    try {
      const raw = await this.host.load();
      const v = raw ? (JSON.parse(raw) as unknown) : {};
      return v && typeof v === "object" ? (v as Kept) : {};
    } catch {
      return {};
    }
  }

  /** Only `{room: true}` or `{geohash, named: true}`: a name is never put on BitChat's anonymous place key. */
  private nameAsk(p: Record<string, unknown>): void {
    const ask = chatKeyAsk(p);
    if (ask.kind === "room" ? ask.room !== true : !ask.named) throw new ProblemError(securityProblems.requestInvalid("a name goes on the room key or a named place key"));
  }

  async bind(p: Record<string, unknown>): Promise<{ event: NostrEvent } | { declined: true }> {
    this.nameAsk(p);
    if (this.busy || this.now() < this.quietUntil) throw new ProblemError(securityProblems.requestNotAllowed("One account at a time. Try again in a few seconds."));
    this.busy = true;
    try {
      return await this.withKey(p, async (secret, ask, account) => {
        const chatKey = publicKeyHex(secret);
        const until = nameUntil(this.now());
        const nonce = globalThis.crypto.getRandomValues(new Uint8Array(32));
        const hash = chatNameHash(account!, chatKey, until, toBase64(nonce));
        const day = new Date(until).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
        const words: PlainWords = ask.kind === "room"
          ? { title: "Use your NEAR account in Chat", lines: [`In NEAR rooms, people see you as ${account}.`, "It's only for Chat. No money moves.", `It lasts until ${day}.`], warnings: [], effect: [] }
          : { title: "Show your NEAR account here", lines: [`People in this place see you as ${account}.`, "Your old messages here won't show it.", "It's only for Chat. No money moves.", `It lasts until ${day}.`], warnings: [], effect: [] };
        const signed = await this.host.signNote({ account: account!, chatKey, until, nonce, hash, words });
        if (!signed) {
          this.quietUntil = this.now() + AFTER_NO_MS;
          return { declined: true as const };
        }
        const record: ChatNameRecord = { v: 1, account: account!, publicKey: signed.publicKey, signature: signed.signature, nonce: toBase64(nonce), until };
        if (!recordSigned(record, chatKey, this.now())) throw new ProblemError(securityProblems.signatureInvalid());
        const kept = await this.kept();
        kept[slotOf(ask)] = record;
        await this.host.save(JSON.stringify(kept));
        return { event: nameEvent(secret, record, this.now() / 1000) };
      });
    } finally {
      this.busy = false;
    }
  }

  /** The kept name again (a fresh record signed by the chat key), while its note is for this account and not near its
   *  end; null otherwise (then Chat asks with nostr.bind). */
  bound(p: Record<string, unknown>): Promise<{ event: NostrEvent } | null> {
    this.nameAsk(p);
    return this.withKey(p, async (secret, ask, account) => {
      const r = (await this.kept())[slotOf(ask)];
      if (!r || r.account !== account || !(Date.parse(r.until) - this.now() > RENEW_MS) || !recordSigned(r, publicKeyHex(secret), this.now())) return null;
      return { event: nameEvent(secret, r, this.now() / 1000) };
    });
  }

  unbind(p: Record<string, unknown>): Promise<{ event: NostrEvent }> {
    this.nameAsk(p);
    return this.withKey(p, async (secret, ask) => {
      const kept = await this.kept();
      delete kept[slotOf(ask)];
      await this.host.save(Object.keys(kept).length ? JSON.stringify(kept) : null);
      return { event: nameEvent(secret, null, this.now() / 1000) };
    });
  }

  /** nostr.* for Chat. */
  call(method: string, p: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case "nostr.publicKey": return this.publicKey(p);
      case "nostr.sign": return this.sign(p);
      case "nostr.seal": return this.seal(p);
      case "nostr.open": return this.open(p);
      case "nostr.bind": return this.bind(p);
      case "nostr.bound": return this.bound(p);
      case "nostr.unbind": return this.unbind(p);
      default: throw new ProblemError(securityProblems.methodUnknown(method));
    }
  }
}
