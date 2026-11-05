// Contacts, kept on this phone only (device.store, which the host keeps apart per app). Never sent anywhere.
import type { Bridge } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import { payProblems } from "./pay-problems.ts";
import type { Recipient } from "./send.ts";

export interface Contact {
  id: string;
  name: string;
  to: Recipient;
  addedAtIso: string;
  lastPaidAtIso?: string;
}

const KEY = "contacts.v1";
const MAX_CONTACTS = 500;
const MAX_NAME = 40;

const sameDestination = (a: Recipient, b: Recipient): boolean =>
  a.kind === "address" && b.kind === "address"
    ? a.address === b.address && a.chain === b.chain
    : a.kind !== "address" && b.kind !== "address" && a.accountId === b.accountId;

export class ContactBook {
  readonly #bridge: Bridge;
  #contacts: Contact[];
  readonly #now: () => string;

  private constructor(bridge: Bridge, contacts: Contact[], now: () => string) {
    this.#bridge = bridge;
    this.#contacts = contacts;
    this.#now = now;
  }

  /** Reads the saved contacts. A damaged copy is reported and left as it is: never wiped silently. */
  static async open(bridge: Bridge, now: () => string = () => new Date().toISOString()): Promise<{ ok: ContactBook } | { problem: Problem }> {
    const r = await bridge.call<{ value: string | null }>("device.store.get", { key: KEY });
    if ("problem" in r) return r;
    if (r.ok.value === null) return { ok: new ContactBook(bridge, [], now) };
    try {
      const saved = JSON.parse(r.ok.value) as { v: number; contacts: Contact[] };
      if (saved.v !== 1 || !Array.isArray(saved.contacts)) throw new Error("unknown shape");
      return { ok: new ContactBook(bridge, saved.contacts, now) };
    } catch {
      return { problem: payProblems.storageUnreadable() };
    }
  }

  /** Most recently paid first, then by name. */
  list(): Contact[] {
    return [...this.#contacts].sort(
      (a, b) => (b.lastPaidAtIso ?? "").localeCompare(a.lastPaidAtIso ?? "") || a.name.localeCompare(b.name),
    );
  }

  /** As the person types: names and accounts that contain the text. */
  search(text: string): Contact[] {
    const q = text.trim().toLowerCase();
    if (!q) return this.list();
    const where = (c: Contact) => (c.to.kind === "address" ? c.to.address : c.to.accountId).toLowerCase();
    return this.list().filter((c) => c.name.toLowerCase().includes(q) || where(c).includes(q));
  }

  byName(name: string): Contact | undefined {
    const q = name.trim().toLowerCase();
    return this.#contacts.find((c) => c.name.toLowerCase() === q);
  }

  /** Saves a friend. The same destination twice just renames the existing contact. */
  async add(name: string, to: Recipient): Promise<{ ok: Contact } | { problem: Problem }> {
    const clean = name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_NAME);
    if (!clean) return { problem: { ...payProblems.recipientInvalid(), next: { kind: "fix-input", label: "Label this account", field: "contact-name" } } };
    const existing = this.#contacts.find((c) => sameDestination(c.to, to));
    if (existing) {
      existing.name = clean;
      const saved = await this.#save();
      return saved ? { problem: saved } : { ok: existing };
    }
    if (this.#contacts.length >= MAX_CONTACTS) this.#contacts = this.list().slice(0, MAX_CONTACTS - 1);
    const contact: Contact = { id: crypto.randomUUID(), name: clean, to, addedAtIso: this.#now() };
    this.#contacts.push(contact);
    const saved = await this.#save();
    return saved ? { problem: saved } : { ok: contact };
  }

  async remove(id: string): Promise<Problem | null> {
    this.#contacts = this.#contacts.filter((c) => c.id !== id);
    return this.#save();
  }

  async markPaid(id: string): Promise<Problem | null> {
    const c = this.#contacts.find((x) => x.id === id);
    if (!c) return null;
    c.lastPaidAtIso = this.#now();
    return this.#save();
  }

  async #save(): Promise<Problem | null> {
    const r = await this.#bridge.call("device.store.set", { key: KEY, value: JSON.stringify({ v: 1, contacts: this.#contacts }) });
    return "problem" in r ? r.problem : null;
  }
}
