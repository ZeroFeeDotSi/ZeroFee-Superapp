// For tests whose subject isn't the payee pin (audit H4): an honest page, which asks the core to pay exactly the payee
// the honest test relay quoted, so each test keeps checking its own rule. The pin itself is tested on the core as it is
// (private-payee.test.ts): a payee left out, or one the relay swapped, signs nothing.
import type { SubWallets } from "../subwallets.ts";

type Status = (depositAddress: string, tag?: string) => Promise<unknown>;

/** The payee the relay's quote for this address pays, as an honest page would have asked for it. */
async function asked(status: Status, depositAddress: unknown, tag: unknown): Promise<unknown> {
  const raw = (await status(String(depositAddress), typeof tag === "string" ? tag : undefined).catch(() => null)) as { quoteResponse?: { quoteRequest?: Record<string, unknown> } } | null;
  const req = raw?.quoteResponse?.quoteRequest;
  return req ? { recipient: req.recipient, recipientType: req.recipientType, destinationAsset: req.destinationAsset } : undefined;
}

/** `w`, with privatePay and hiddenFromRow given the honest page's payee whenever a test leaves it out. */
export function honestPage<T extends SubWallets>(w: T, status: Status): T {
  const pay = w.privatePay.bind(w), row = w.hiddenFromRow.bind(w);
  // a Send's own key (the audit's M9) passes through; the pair and plan arguments stay off, as before
  w.privatePay = async (id, dep, intent, why, tag, inDep, send, payee, _pair, _job, sendJob) => pay(id, dep, intent, why, tag, inDep, send, payee ?? (await asked(status, dep, tag)), undefined, undefined, sendJob);
  w.hiddenFromRow = async (chain, inDep, outDep, intent, tag, why, payee, coin) => row(chain, inDep, outDep, intent, tag, why, payee ?? (await asked(status, outDep, tag)), coin);
  return w;
}
