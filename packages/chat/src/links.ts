// Links in a message (sd-chat crawl, 5 Nov, g: "https://zerofee.si/some/link?x=1" was plain text). Only an https address
// becomes a link, and it opens in ZeroFee's Browser (never in this page, never a script): http, javascript:, data:, a
// name with a user or password in it (https://example.com@evil.example), or anything the URL parser refuses stays text.

export type Part = { text: string } | { text: string; url: string; host: string };

const CANDIDATE = /https:\/\/[^\s<>"'`]+/gi;
/** What ends a sentence after a link, never part of it. */
const TRAILING = /[.,;:!?…)\]}'"’”]+$/u;

/** The one https address `raw` is, checked, or null. */
export function safeLink(raw: string): { url: string; host: string } | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".") || raw.length > 2000) return null;
  return { url: u.href, host: u.hostname.replace(/^www\./, "") };
}

/** A message's text in parts: plain text, and each https link in it (checked) with its host. */
export function linkParts(text: string): Part[] {
  const out: Part[] = [];
  let at = 0;
  for (const m of text.matchAll(CANDIDATE)) {
    const start = m.index ?? 0;
    // a link inside a word ("xhttps://…") is text
    if (start > 0 && /[\p{L}\p{N}]/u.test(text[start - 1]!)) continue;
    const raw = m[0].replace(TRAILING, "");
    const link = safeLink(raw);
    if (!link) continue;
    if (start > at) out.push({ text: text.slice(at, start) });
    out.push({ text: raw, ...link });
    at = start + raw.length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
