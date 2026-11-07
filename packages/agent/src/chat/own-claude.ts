// The person's own Claude key, straight to Anthropic from this device: the Anthropic SDK, Anthropic's address, and the
// failures read by the SDK's own error classes. Only turn.ts's ownClaude() imports this file, and only where its inline
// checks allow (VITE_AGENTZERO_OWN_KEY=1 and not VITE_ZEROFEE_PUBLIC, or a node test): no build people get contains it
// (the public deploy check refuses "x-api-key" and "api.anthropic.com"; tools/bundle-grep.sh names this file's chunk),
// and the funded-wallet relay path never loads it.
import { ANTHROPIC_BASE_URL } from "../claude.ts";
import { anthropicReachable } from "./anthropic-check.ts";
import { OWN_FAULT, chatRequest, type ChatMessage } from "./turn.ts";
import type { ClaudeChoice } from "./model.ts";
import type { Stream } from "./relay-stream.ts";

/** One client for the person's key (speed worker, 3 Nov: a new client each turn was ~4 ms of the first send's 31 ms),
 *  in memory only: a new key, or a turn with none, drops it. */
let ownClient: { key: string; fetch: typeof fetch | undefined; client: InstanceType<typeof import("@anthropic-ai/sdk").default> } | null = null;
export async function ownClientFor(key: string, anthropicFetch?: typeof fetch) {
  if (ownClient && ownClient.key === key && ownClient.fetch === anthropicFetch) return ownClient.client;
  ownClient = null;
  const { default: Sdk } = await import("@anthropic-ai/sdk");
  // the page's fetch as it is at each call (a kept client never holds on to an old one)
  const client = new Sdk({ apiKey: key, baseURL: ANTHROPIC_BASE_URL, dangerouslyAllowBrowser: true, maxRetries: 0, timeout: 60_000, fetch: anthropicFetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a)) });
  ownClient = { key, fetch: anthropicFetch, client };
  return client;
}
export const dropOwnClient = (): void => void (ownClient = null);
export async function ownStream(messages: ChatMessage[], key: string, choice: ClaudeChoice, anthropicFetch?: typeof fetch, signal?: AbortSignal): Promise<Stream> {
  const client = await ownClientFor(key, anthropicFetch);
  return client.messages.stream(chatRequest(messages, new Date(), choice), signal ? { signal } : undefined) as unknown as Stream;
}

/** The own-key path's failures, by the SDK's own error classes. `started`: some of the answer had come. With no status
 *  to read (real-Claude walk, 3 Nov: the network, or a wrong key, whose 401 has no CORS header, so a browser and the
 *  iPhone's web view can't read it), Anthropic answering at all tells them apart. */
export async function ownFault(e: unknown, started: boolean, fetchFn?: typeof fetch): Promise<string> {
  const { default: Sdk } = await import("@anthropic-ai/sdk");
  if (e instanceof Sdk.AuthenticationError || e instanceof Sdk.PermissionDeniedError) return OWN_FAULT.key;
  if (e instanceof Sdk.BadRequestError && /credit balance/i.test(String(e.message))) return "Your Claude account has no credit left.";
  if (e instanceof Sdk.RateLimitError) return "Claude is busy. Try again in a minute.";
  if (!(e instanceof Sdk.APIError) || e instanceof Sdk.APIConnectionError) {
    if (!(await anthropicReachable(fetchFn))) return OWN_FAULT.offline;
    if (e instanceof Sdk.APIConnectionError && !(e instanceof Sdk.APIConnectionTimeoutError) && !started) return OWN_FAULT.key;
  }
  // dead ends row 21: Anthropic down is named (529 overloaded is a 5xx too)
  if (e instanceof Sdk.APIError && typeof e.status === "number" && e.status >= 500) return OWN_FAULT.down;
  return OWN_FAULT.other;
}

/** Claude overloaded or down (5xx, 529) or a timeout, before any answer came: worth one more ask. Never a key, credit or
 *  rate-limit failure (those are said), never after the answer began (the person saw part of it). */
export async function transient(e: unknown): Promise<boolean> {
  const { default: Sdk } = await import("@anthropic-ai/sdk");
  if (e instanceof Sdk.APIConnectionTimeoutError) return true;
  return e instanceof Sdk.APIError && typeof e.status === "number" && e.status >= 500;
}
