// Converting one coin into another through 1Click, paid in one of the two ways a post-quantum account can pay (it can't
// sign intents), always delivered back into this account's own ledger, with any refund there too:
//   intents       route A: a quote with deposit type INTENTS, funded by mt_transfer of exactly amountIn inside NEAR Intents
//   near-ledger   route B: a quote paid on NEAR (ORIGIN_CHAIN) by ft_withdraw out of the ledger to 1Click's NEAR address
//   near-account  route B from coins on the account (D14): ft_transfer, or for NEAR itself wrap-and-transfer, in one
//                 transaction to the coin's own contract
// Route B takes only coins native to NEAR (NEAR, native USDC, USDT …). Each route stays shut until the test mainnet
// dust proof shows it works (tools/wallet/PROOF.md steps 2 and 3): CONVERT_ROUTES is the one line that opens them.
import type { TxRequest } from "@zerofee/core/signer";
import type { QuoteRequest } from "./apis.ts";
import { NATIVE_NEAR, WRAPPED_NEAR, type Coin } from "./catalogue.ts";
import { ftTransfer, mtTransfer, nearAsWnearTo, registerOn, withdrawToNear } from "./moves.ts";
import type { Holding } from "./send.ts";

export type ConvertRoute = "intents" | "near-ledger" | "near-account";
export interface Routes {
  /** Route A: an INTENTS quote funded by mt_transfer. */
  intents: boolean;
  /** Route B: a quote paid on NEAR. */
  nearOrigin: boolean;
}

/** Shut until the test dust proof passes. Opening a route that passed is this one line. */
export const CONVERT_ROUTES: Routes = { intents: false, nearOrigin: false };

/** 1Click's id for the coin being paid. NEAR on the account goes as wrapped NEAR. */
export const originAsset = (tokenId: string) => (tokenId === NATIVE_NEAR ? WRAPPED_NEAR : tokenId);

/** The route this coin can take, from the place that holds enough of it; null when none is open for it. */
export function routeFor(o: { tokenId: string; coin?: Coin; held: Holding; units: bigint; routes: Routes }): ConvertRoute | null {
  const nearNative = o.tokenId === NATIVE_NEAR || o.coin?.route === "near";
  if (o.tokenId !== NATIVE_NEAR && o.held.ledger >= o.units) {
    if (o.routes.intents) return "intents";
    if (o.routes.nearOrigin && nearNative) return "near-ledger";
  }
  if (nearNative && o.routes.nearOrigin && o.held.account >= o.units) return "near-account";
  return null;
}

/** The 1Click quote: exact input, 1% slippage, delivered into this account's ledger, refunds there too. */
export function convertRequest(route: ConvertRoute, o: { from: string; to: string; units: bigint; me: string; dry: boolean; deadlineIso: string }): QuoteRequest {
  return {
    dry: o.dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: originAsset(o.from),
    depositType: route === "intents" ? "INTENTS" : "ORIGIN_CHAIN",
    destinationAsset: o.to,
    amount: o.units.toString(),
    refundTo: o.me,
    refundType: "INTENTS",
    recipient: o.me,
    recipientType: "INTENTS",
    deadline: o.deadlineIso,
  };
}

/** The transactions that pay the quote's deposit address exactly `units`. */
export function fundingSteps(route: ConvertRoute, o: { tokenId: string; units: bigint; depositAddress: string; registered: boolean; storageYocto: string; me: string; why: string }): TxRequest[] {
  if (route === "intents") return [mtTransfer({ to: o.depositAddress, tokenId: o.tokenId, units: o.units, why: o.why })];
  if (route === "near-account" && o.tokenId === NATIVE_NEAR) {
    return [nearAsWnearTo({ accountId: o.me, to: o.depositAddress, yocto: o.units, registerTo: !o.registered, why: o.why })];
  }
  const contract = originAsset(o.tokenId).slice("nep141:".length);
  const storage = o.registered ? [] : [registerOn({ contract, accountId: o.depositAddress, yocto: o.storageYocto, why: "Let the swap service's address receive this coin" })];
  if (route === "near-ledger") return [...storage, withdrawToNear({ contract, receiverId: o.depositAddress, units: o.units, why: o.why })];
  return [...storage, ftTransfer({ contract, to: o.depositAddress, units: o.units, why: o.why })];
}
