// The receiver's file store (D80). Two things only: which mailbox name belongs to which keys (public keys, nothing
// secret), and each mailbox's sealed mail, one file per message under a random id. No plaintext is ever written here.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Registration {
  /** The box public key, X25519, base64url: every mail is sealed to it. */
  publicKey: string;
  /** The sign public key, Ed25519, base64url: proofs for this mailbox must be signed by it. */
  signingKey: string;
  /** When it was first registered (ms). */
  at: number;
}

export interface StoredMessage {
  id: string;
  /** Arrival time (ms). */
  at: number;
  /** The sealed mail, base64url (packages/agent/src/mail/keys.ts). */
  sealed: string;
}

/** A message id: 12 hex digits of a write-time sequence number, then 20 random hex digits, so ids sort by storing. */
export const ID = /^[0-9a-f]{32}$/;
export const newId = (at: number) => at.toString(16).padStart(12, "0").slice(-12) + randomBytes(10).toString("hex");

export class MailStore {
  readonly dir: string;
  /** The most messages one mailbox keeps; the oldest go first. */
  readonly maxPerBox: number;
  private readonly regFile: string;
  private regs = new Map<string, Registration>();

  constructor(dir: string, opts: { maxPerBox?: number } = {}) {
    this.dir = dir;
    this.maxPerBox = opts.maxPerBox ?? 500;
    this.regFile = join(dir, "mailboxes.json");
    mkdirSync(join(dir, "box"), { recursive: true, mode: 0o700 });
    if (existsSync(this.regFile)) {
      const raw = JSON.parse(readFileSync(this.regFile, "utf8")) as Record<string, Registration>;
      for (const [name, reg] of Object.entries(raw)) this.regs.set(name, reg);
    }
  }

  get size(): number {
    return this.regs.size;
  }

  get(mailbox: string): Registration | undefined {
    return this.regs.get(mailbox);
  }

  register(mailbox: string, reg: Registration): void {
    this.regs.set(mailbox, reg);
    writeAtomic(this.regFile, JSON.stringify(Object.fromEntries(this.regs), null, 1));
  }

  private boxDir(mailbox: string): string {
    return join(this.dir, "box", mailbox);
  }

  /** The last sequence number handed out (ms-based, strictly increasing in this process). */
  private seq = 0;

  /**
   * Stores one sealed mail; returns its id. The id comes from a strictly increasing counter read at WRITE time (never
   * the arrival time), and above the mailbox's newest id, so a mail that took longer to parse can never land behind a
   * phone's `since` cursor. `at` is kept only as the arrival time shown.
   */
  put(mailbox: string, sealed: string, at = Date.now()): string {
    const dir = this.boxDir(mailbox);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const newest = this.ids(mailbox).at(-1);
    this.seq = Math.max(Date.now(), this.seq + 1, newest ? parseInt(newest.slice(0, 12), 16) + 1 : 0);
    const id = newId(this.seq);
    writeAtomic(join(dir, `${id}.json`), JSON.stringify({ id, at, sealed } satisfies StoredMessage));
    const ids = this.ids(mailbox);
    for (const old of ids.slice(0, Math.max(0, ids.length - this.maxPerBox))) rmSync(join(dir, `${old}.json`), { force: true });
    return id;
  }

  /** The mailbox's ids, oldest first. */
  private ids(mailbox: string): string[] {
    const dir = this.boxDir(mailbox);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json") && ID.test(f.slice(0, -5)))
      .map((f) => f.slice(0, -5))
      .sort();
  }

  /**
   * Oldest first, at most `limit`, only those after `since` when given; `more` when there are later ones still. The
   * phone pages forward with since = the last id it got, so no mail is ever skipped however many arrive at once.
   */
  list(mailbox: string, since?: string, limit = 50): { messages: StoredMessage[]; more: boolean } {
    const ids = this.ids(mailbox).filter((id) => since === undefined || id > since);
    return {
      messages: ids.slice(0, limit).map((id) => JSON.parse(readFileSync(join(this.boxDir(mailbox), `${id}.json`), "utf8")) as StoredMessage),
      more: ids.length > limit,
    };
  }

  remove(mailbox: string, id: string): boolean {
    if (!ID.test(id)) return false;
    const file = join(this.boxDir(mailbox), `${id}.json`);
    if (!existsSync(file)) return false;
    rmSync(file, { force: true });
    return true;
  }
}

function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, file);
}
