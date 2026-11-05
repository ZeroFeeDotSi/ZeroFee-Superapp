// A mailbox's name on zerofee.si (D80): human-looking, `name.word`, never numbered. The receiver refuses any other name
// at registration, and the phone checks the same rules before it asks.

/** Words no mailbox may use, in either part: the mail system's own roles and anything that would pose as ZeroFee. */
export const RESERVED_WORDS: ReadonlySet<string> = new Set([
  "abuse",
  "admin",
  "administrator",
  "agentzero",
  "billing",
  "help",
  "hostmaster",
  "info",
  "mail",
  "mailer",
  "noreply",
  "postmaster",
  "root",
  "security",
  "support",
  "system",
  "webmaster",
  "zerofee",
]);

/** Null when the name may be registered; otherwise why not. */
export function mailboxNameProblem(name: unknown): "bad-name" | "reserved" | null {
  if (typeof name !== "string" || name.length < 3 || name.length > 40 || !/^[a-z]+\.[a-z]+$/.test(name)) return "bad-name";
  return name.split(".").some((part) => RESERVED_WORDS.has(part)) ? "reserved" : null;
}
