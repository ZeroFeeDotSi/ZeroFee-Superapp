// Pay's own receipts per provider (D38): what this phone sent to each card, exchange or shop, so Home can say "sent so
// far" where a provider's balance can't be read. Only Pay's own sends are kept (amount and coin), never anything from a
// provider's page (Security §4b.6). Kept on this phone only.
import type { Bridge } from "@zerofee/core/bridge";
import { add } from "./amount.ts";

const KEY = "sent.v1";

/** Per provider id: the amount sent so far, per coin. */
export type Sent = Record<string, Record<string, string>>;

export async function loadSent(bridge: Bridge): Promise<Sent> {
  const r = await bridge.call<{ value: string | null }>("device.store.get", { key: KEY });
  if (!("ok" in r) || !r.ok.value) return {};
  try {
    const v = JSON.parse(r.ok.value) as unknown;
    return v && typeof v === "object" ? (v as Sent) : {};
  } catch {
    return {};
  }
}

/** Adds a send that went through (paid, or on hold: it will go). */
export async function addSent(bridge: Bridge, provider: string, amount: string, coin: string): Promise<void> {
  const sent = await loadSent(bridge);
  const mine = sent[provider] ?? {};
  sent[provider] = { ...mine, [coin]: add(mine[coin] ?? "0", amount) };
  await bridge.call("device.store.set", { key: KEY, value: JSON.stringify(sent) });
}

/** Forgets a provider's receipts when the person removes it. */
export async function forgetSent(bridge: Bridge, provider: string): Promise<void> {
  const sent = await loadSent(bridge);
  delete sent[provider];
  await bridge.call("device.store.set", { key: KEY, value: JSON.stringify(sent) });
}

// A send on hold isn't sent yet: it can still be cancelled from Waiting (Security, on 0af02c9). It's kept as pending,
// by its hold's id, and counted only when the hold runs (account.waiting.ended "ran"); a cancel drops it.
const PENDING = "sent.pending.v1";
type Pending = Record<string, { provider: string; amount: string; coin: string }>;

async function loadPending(bridge: Bridge): Promise<Pending> {
  const r = await bridge.call<{ value: string | null }>("device.store.get", { key: PENDING });
  if (!("ok" in r) || !r.ok.value) return {};
  try {
    return JSON.parse(r.ok.value) as Pending;
  } catch {
    return {};
  }
}

export async function addPending(bridge: Bridge, holdId: string, provider: string, amount: string, coin: string): Promise<void> {
  const p = await loadPending(bridge);
  p[holdId] = { provider, amount, coin };
  await bridge.call("device.store.set", { key: PENDING, value: JSON.stringify(p) });
}

/** Providers with a send on hold right now (Home says "Waiting" on their tile). */
export async function heldFor(bridge: Bridge): Promise<Set<string>> {
  return new Set(Object.values(await loadPending(bridge)).map((p) => p.provider));
}

/** A hold ended: counted as sent if it ran; dropped either way. */
export async function settlePending(bridge: Bridge, holdId: string, ran: boolean): Promise<void> {
  const p = await loadPending(bridge);
  const one = p[holdId];
  if (!one) return;
  delete p[holdId];
  await bridge.call("device.store.set", { key: PENDING, value: JSON.stringify(p) });
  if (ran) await addSent(bridge, one.provider, one.amount, one.coin);
}
