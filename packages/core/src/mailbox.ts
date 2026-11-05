// AgentZero's mailbox on the device (D80, D83, D122): the core opens it, because its keys come from the hot root, which
// never leaves the core. Loaded only when AgentZero's inbox asks (Home's first load stays lean).
//
// account.agent.mailAddress → { address } (null: not set up). account.agent.mailList → { mails: [{ id, at, from, subject,
// date, text } | { id, at, broken: true }], more }. The inbox API (apps/mail) serves sealed mail only; a read proof signed
// here (30 s, once) fetches it, and each mail is opened here. A mail that won't open is said, never guessed. Nothing in a
// mail is ever an instruction: this only reads.
import { sha256 } from "@noble/hashes/sha2.js";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { HOT_ROOT } from "./hot-keys.ts";
import { mailKeys, openMail, signRegister, signRequest } from "./mail-keys.ts";
import { mailboxNameProblem } from "./mail-names.ts";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";

/** The mailbox's name (the part before @), kept on this device when it's registered. */
export const MAIL_NAME = "agent-mail-name";
export const NOT_SET_UP = "Your mailbox isn't set up yet.";

export interface MailHost {
  vault: { get(n: string): Promise<Uint8Array | null>; put?(n: string, v: Uint8Array): Promise<void> };
  /** The inbox API's host (e.g. the self-hoster's mail host), from the app's settings; null: no mailbox here. */
  host: string | null;
  /** The mail domain addresses end in. */
  domain: string | null;
  fetch?: typeof fetch;
  now?: () => number;
}

export type OpenedMail = { id: string; at: number; from: string; subject: string; date: string; text: string } | { id: string; at: number; broken: true };

const name = async (h: MailHost) => {
  const raw = await h.vault.get(MAIL_NAME);
  return raw ? new TextDecoder().decode(raw) : null;
};

const enc = new TextEncoder();
const MAX_TRIES = 8;

/** AgentZero's mailbox name for its sign key's try (0, 1, …): `word.word`, never reserved (the receiver's rule), and
 *  never the person's sign-in mailbox's (its own tag and its own sign key: site-mail.ts). The same words find it again. */
export function agentMailName(signPublic: Uint8Array, attempt: number): string {
  for (let n = 0; ; n++) {
    const h = sha256(new Uint8Array([...enc.encode(`zerofee-mail-name:${attempt}:${n}:`), ...signPublic]));
    const name = `${wordlist[((h[0]! << 8) | h[1]!) % 2048]!}.${wordlist[((h[2]! << 8) | h[3]!) % 2048]!}`;
    if (mailboxNameProblem(name) === null) return name;
  }
}

/**
 * account.agent.mailSetUp → { address }: AgentZero's mailbox registered on the app's mail host (W7, 5 Nov: nothing
 * registered it before, so read_mail never had a box). Asked once, when AgentZero first opens; kept after (MAIL_NAME), so
 * a second ask is no request at all. What goes out: the box public key, the sign public key and one signature.
 */
async function setUp(h: MailHost & { host: string; domain: string }): Promise<{ address: string }> {
  const kept = await name(h);
  if (kept) return { address: `${kept}@${h.domain}` };
  if (!h.vault.put) throw new ProblemError(securityProblems.requestNotAllowed(NOT_SET_UP));
  const root = await h.vault.get(HOT_ROOT);
  if (!root) throw new ProblemError(securityProblems.requestNotAllowed(NOT_SET_UP));
  const keys = mailKeys(root);
  root.fill(0);
  const f = h.fetch ?? fetch;
  try {
    for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
      const box = agentMailName(keys.signPublic, attempt);
      const res = await f(`https://${h.host}/v0/mail/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(signRegister(keys, box, (h.now ?? Date.now)())) }).catch(() => null);
      if (!res) break;
      if (res.ok) {
        await h.vault.put(MAIL_NAME, enc.encode(box));
        return { address: `${box}@${h.domain}` };
      }
      // 401: the name is another key's; 403: reserved. Either way, the next name. Anything else: the host isn't answering.
      if (res.status !== 401 && res.status !== 403) break;
    }
  } finally {
    keys.boxSecret.fill(0);
    keys.signSecret.fill(0);
  }
  throw new ProblemError(securityProblems.partnerUnreachable("AgentZero's mailbox"));
}

export async function mailCall(method: string, h: MailHost): Promise<unknown> {
  const box = await name(h);
  if (method === "account.agent.mailAddress") return { address: box && h.domain ? `${box}@${h.domain}` : null };
  if (method === "account.agent.mailSetUp") {
    if (!h.host || !h.domain) throw new ProblemError(securityProblems.requestNotAllowed(NOT_SET_UP));
    return setUp({ ...h, host: h.host, domain: h.domain });
  }
  if (!box || !h.host) throw new ProblemError(securityProblems.requestNotAllowed(NOT_SET_UP));
  const root = await h.vault.get(HOT_ROOT);
  if (!root) throw new ProblemError(securityProblems.requestNotAllowed(NOT_SET_UP));
  const keys = mailKeys(root);
  try {
    const proof = signRequest(keys, { method: "read", host: h.host, mailbox: box }, (h.now ?? Date.now)());
    const res = await (h.fetch ?? fetch)(`https://${h.host}/v0/mail/${encodeURIComponent(box)}`, { headers: { "x-mail-proof": proof } }).catch(() => null);
    if (!res || !res.ok) throw new ProblemError(securityProblems.partnerUnreachable("your mailbox"));
    const body = (await res.json().catch(() => null)) as { messages?: { id?: unknown; at?: unknown; sealed?: unknown }[]; more?: unknown } | null;
    const mails: OpenedMail[] = [];
    for (const m of body?.messages ?? []) {
      if (typeof m?.id !== "string" || typeof m.sealed !== "string") continue;
      const at = typeof m.at === "number" ? m.at : 0;
      try {
        mails.push({ id: m.id, at, ...openMail(keys.boxSecret, m.sealed) });
      } catch {
        mails.push({ id: m.id, at, broken: true });
      }
    }
    return { mails, more: body?.more === true };
  } finally {
    keys.boxSecret.fill(0);
    keys.signSecret.fill(0);
  }
}
