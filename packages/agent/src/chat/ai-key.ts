// AgentZero's AI key (product decision, 3 Nov: "on top there should be API keys; you just copy-paste any model key and we auto-read
// the provider and run it; only Claude for now, OpenAI later"). The person pastes a key; we read the provider from its
// shape, check a Claude key once with Anthropic straight from this device (GET /v1/models: no words, no cost), and only
// after Anthropic says yes (200) keep it in the device's secret store, under the same name the chat and Jobs and
// limits' KeySheet read (agentzero.claude-key). An OpenAI key is never kept and never sent anywhere. The clipboard is
// read only by pasteKey, which only the Paste button's tap calls (D33). The check itself lives in anthropic-check.ts.
import type { Bridge } from "@zerofee/core/bridge";
import { signUp } from "../zero/rulebox.ts";
import type { NeedsKey } from "./turn.ts";
import { CHAT_SECRETS } from "./use-chat-turn.ts";

export type KeyShape = { kind: "claude"; key: string } | { kind: "openai" } | { kind: "junk" };
export type KeyCheck = "ok" | "refused" | "busy" | "unreachable";

/** A Claude key as Jobs and limits' KeySheet takes it (AgentApp's CLAUDE_KEY). */
const CLAUDE = /^sk-ant-[A-Za-z0-9_-]{20,250}$/;

/** Every space and line break out (a key pasted from a page often carries a newline or a wrapped line). */
export const cleanKey = (raw: string): string => raw.replace(/\s+/g, "");

/** The provider, read from the key's own shape. Only a Claude key comes back with the key itself. */
export function readKey(raw: string): KeyShape {
  const k = cleanKey(raw);
  if (k.startsWith("sk-ant-")) return CLAUDE.test(k) ? { kind: "claude", key: k } : { kind: "junk" };
  if (/^sk-[A-Za-z0-9_-]{20,}$/.test(k)) return { kind: "openai" };
  return { kind: "junk" };
}

/** What the screen says for each answer (one short sentence each). */
export const KEY_LINE = {
  openai: "That's an OpenAI key. OpenAI comes next; paste a Claude key for now.",
  junk: "That doesn't look like an AI key.",
  refused: "Claude didn't accept that key.",
  busy: "Claude is busy. Try again in a minute.",
  unreachable: "Couldn't reach Claude. Check your connection.",
  ready: "Claude is ready",
  /** the public web: no key of one's own is used there (the funded wallet pays), so none is checked or kept */
  unavailable: "Your own Claude key isn't used on the web. AgentZero thinks on its own wallet.",
} as const;

export type KeySaved = { ok: true; provider: "Claude"; tail: string } | { ok: false; line: string };

/** The key's last 4 characters: all the screen ever shows of it. */
export const keyTail = (key: string): string => cleanKey(key).slice(-4);

/**
 * Paste → provider → check → save. Saved only after Anthropic answered 200; an OpenAI key or junk is never checked,
 * never saved. `save` is the device's secret store (saveKey below), passed in so tests hold it.
 */
export async function setUpKey(raw: string, o: { fetch?: typeof fetch; save: (key: string) => Promise<boolean> }): Promise<KeySaved> {
  const shape = readKey(raw);
  if (shape.kind !== "claude") return { ok: false, line: KEY_LINE[shape.kind] };
  // the key check (Anthropic's address and the key's header) is its own file, loaded only where a key is used at all:
  // the public web build reads this flag inline and leaves it, and the address, out
  if (import.meta.env?.VITE_ZEROFEE_PUBLIC === "1") return { ok: false, line: KEY_LINE.unavailable };
  const checked = await (await import("./anthropic-check.ts")).checkClaudeKey(shape.key, o.fetch);
  if (checked !== "ok") return { ok: false, line: KEY_LINE[checked] };
  if (!(await o.save(shape.key).catch(() => false))) return { ok: false, line: "This iPhone couldn't keep the key. Try again." };
  return { ok: true, provider: "Claude", tail: keyTail(shape.key) };
}

/** The device's secret store, the chat's own name for the key (the KeySheet and the chat read the same one). */
export async function saveKey(bridge: Bridge, key: string | null): Promise<boolean> {
  const r = await bridge.call("device.secret.set", { key: CHAT_SECRETS.ownKey, value: key });
  return "ok" in r;
}

/** The saved key, as the screen may show it: its provider and last 4, never the key. */
export async function savedKey(bridge: Bridge): Promise<{ provider: "Claude"; tail: string } | null> {
  const r = await bridge.call<{ value: string | null }>("device.secret.get", { key: CHAT_SECRETS.ownKey });
  const v = "ok" in r ? r.ok?.value?.trim() : null;
  return v ? { provider: "Claude", tail: keyTail(v) } : null;
}

/** The Paste button's tap, and only that: the phone's own paste (UIPasteboard), or in a browser the page's clipboard. */
export async function pasteKey(bridge: Bridge): Promise<string | null> {
  const host = await bridge.call<{ text: string | null }>("device.clipboard.read", {}).catch(() => undefined);
  if (host && "ok" in host) return host.ok.text?.trim() || null;
  try {
    return (await navigator.clipboard.readText()).trim() || null;
  } catch {
    return null;
  }
}

export type KeyState = { saved: { provider: "Claude"; tail: string } } | { free: true } | { needs: NeedsKey };

/**
 * The chat's key handling on one bridge (the AgentZero app's). `probe`: what the chat opens on: a saved key, the free
 * reading (a token kept, or a sign-up that answers), or the key card. `use`: a key typed or pasted, checked, then saved.
 * `paste`: the clipboard, for the Paste button's tap only. Nothing here reads the clipboard but `paste`.
 */
/** `ownKey: false` (own-key.ts off: every build people get): a key saved earlier is never looked at; probe only signs up. */
export function keyController(bridge: Bridge, o: { fetch?: typeof fetch; relayBase: string | null; ownKey?: boolean }) {
  const get = async (key: string) => {
    const r = await bridge.call<{ value: string | null }>("device.secret.get", { key });
    return "ok" in r ? (r.ok?.value ?? null) : null;
  };
  return {
    async probe(): Promise<KeyState> {
      const saved = o.ownKey === false ? null : await savedKey(bridge);
      if (saved) return { saved };
      if (!o.relayBase) return { needs: "no-key" };
      if (await get(CHAT_SECRETS.token)) return { free: true };
      // the same sign-up the first turn would make; its token is kept for that turn
      const t = await signUp(o.relayBase, (o.fetch ?? fetch) as never);
      if (t === null) return { needs: "off" };
      if (t === "refused") return { needs: "full" };
      await bridge.call("device.secret.set", { key: CHAT_SECRETS.token, value: t });
      return { free: true };
    },
    use: (raw: string): Promise<KeySaved> => setUpKey(raw, { ...(o.fetch ? { fetch: o.fetch } : {}), save: (k) => saveKey(bridge, k) }),
    remove: (): Promise<boolean> => saveKey(bridge, null),
    paste: (): Promise<string | null> => pasteKey(bridge),
  };
}
export type KeyController = ReturnType<typeof keyController>;

/** The key card's line for why it's there (none when there simply is no key yet). */
export const NEEDS_LINE: Record<NeedsKey, string | null> = {
  "no-key": null,
  off: null,
  "used-up": "Your free reading is used up.",
  full: "Free reading is full for today.",
};
