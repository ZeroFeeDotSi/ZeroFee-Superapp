// What happens to a mail on arrival (D80): parse it minimally (from, subject, date, text; attachments dropped), seal it
// to each recipient mailbox's public key, store only the sealed bytes, and let the plaintext go. Nothing here logs or
// keeps a sender, a subject or a body. No sockets: the SMTP side (smtp.ts) hands the raw bytes in.
import PostalMime from "postal-mime";
import { boxKeyOk, fromB64url, sealMail, type Mail } from "@zerofee/agent/mail/keys";
import { htmlToText } from "@zerofee/agent/mail/code";
import type { MailStore } from "./store.ts";

/** The largest mail accepted, in bytes (raw, as sent). */
export const MAX_BYTES = 256 * 1024;
/** The most text kept from one mail. A sign-in mail is a few hundred characters. */
export const MAX_TEXT = 32 * 1024;

/** The mailbox name an address is for, on our domain only; null for anything else (no relaying). */
export function mailboxOf(address: unknown, domain: string): string | null {
  if (typeof address !== "string") return null;
  const at = address.lastIndexOf("@");
  if (at <= 0) return null;
  const local = address.slice(0, at).toLowerCase();
  const host = address.slice(at + 1).toLowerCase();
  return host === domain.toLowerCase() && /^[a-z]+\.[a-z]+$/.test(local) ? local : null;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** The four fields kept from a raw mail. */
export async function parseMail(raw: Uint8Array, now = Date.now()): Promise<Mail> {
  const email = await PostalMime.parse(raw);
  const f = email.from as { name?: string; address?: string } | undefined;
  const from = f ? (f.name && f.address ? `${f.name} <${f.address}>` : f.address || f.name || "") : "";
  const parsedDate = email.date ? Date.parse(email.date) : NaN;
  const text = email.text && email.text.trim() ? email.text : email.html ? htmlToText(email.html) : "";
  return {
    from: clip(from, 320),
    subject: clip(email.subject ?? "", 998),
    date: new Date(Number.isFinite(parsedDate) ? parsedDate : now).toISOString(),
    text: clip(text.trim(), MAX_TEXT),
  };
}

/**
 * Seals and stores one mail for each registered recipient. Returns how many copies were stored. The raw bytes are
 * zeroed afterwards; the parsed strings go out of scope here and are never written anywhere.
 */
export async function receive(raw: Uint8Array, recipients: readonly string[], store: MailStore, domain: string, now = Date.now()): Promise<number> {
  if (raw.length > MAX_BYTES) throw Object.assign(new Error("message too big"), { responseCode: 552 });
  const boxes = [...new Set(recipients.map((r) => mailboxOf(r, domain)).filter((m): m is string => m !== null))];
  const targets = boxes.map((m) => ({ m, reg: store.get(m) })).filter((t) => t.reg !== undefined);
  if (targets.length === 0) return 0;
  let mail: Mail | null = await parseMail(raw, now);
  try {
    let stored = 0;
    let failed = 0;
    // Each recipient on its own: one bad key or one failed write never stops the others, and since the mail is then
    // still taken (250), the sender never retries and no one gets it twice.
    for (const { m, reg } of targets) {
      try {
        const key = fromB64url(reg!.publicKey);
        if (!boxKeyOk(key)) throw new Error("bad box key");
        store.put(m, sealMail(key!, mail), now);
        stored++;
      } catch {
        failed++;
      }
    }
    // Nothing stored at all: ask the sender to try again later (a full disk, say), rather than lose it silently.
    if (stored === 0 && failed > 0) throw Object.assign(new Error("not stored"), { responseCode: 451 });
    return stored;
  } finally {
    mail = null;
    raw.fill(0);
  }
}
