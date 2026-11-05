// The one Claude every AgentZero path uses (D82): Claude Opus 5.5 only, at effort medium, adaptive thinking (the
// only mode Opus 5.5 has), no fallback to another model. The relay's copy (apps/quotes/agentzero.mjs RULE_MODEL, effort)
// is held equal to this by apps/quotes/agentzero.test.ts.
export const CLAUDE_MODEL = "claude-opus-5-5";
export const CLAUDE_EFFORT = "medium" as const;
/** What a screen says when the person's own key is used. */
export const CLAUDE_OWN_LABEL = "Claude Opus 5.5 · your own key";
/** Anthropic's own address, pinned: the person's key is sent nowhere else. */
export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
/** Where the person's own Anthropic key is kept on this device (device.secret.*). */
export const KEY_NAME = "anthropic-key";

/** A fresh random fence word for the page's text in a prompt, so the page can't close the fence. */
export function freshNonce(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
