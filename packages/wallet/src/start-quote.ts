// A brand-new account's first NEAR (M7), the older set-up path: loaded with its first use, never in Home's first load
// (speed budget, 3 Nov). The rules are the ledger's own, moved here unchanged. It works before any account exists: no
// account, no key, no signature.
import { ProblemError } from "@zerofee/core/problem";
import { FUND_EVERY_CHAIN } from "@zerofee/core/fund-every-chain";
import { fromUnits } from "./amount.ts";
import type { QuoteResponse } from "./apis.ts";
import { NEAR_DECIMALS, WRAPPED_NEAR, type Catalogue } from "./catalogue.ts";
import type { convertRequest } from "./convert.ts";
import { EVM_CHAINS, validAddress } from "./addresses.ts";
import type { StartQuote } from "./types.ts";
import { walletProblems } from "./wallet-problems.ts";
import { quoteDeadline } from "@zerofee/core/quote-deadline";

const text = (v: unknown) => (typeof v === "string" ? v : "");
const units = (v: unknown): bigint | null => (typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : null);

/**
 * A real 1Click quote: exactly what the new account needs plus 5% headroom, as NEAR at its 64-hex implicit address
 * (wNEAR, the only NEAR 1Click lists on NEAR, delivered to that address), paid with any coin 1Click quotes, refunded
 * to the person's own address on the sending network. Shown only once the test dust run proves it arrives as NEAR
 * that creates the account (D13).
 */
export async function startQuote(p: Record<string, unknown>, x: { catalogue: () => Promise<Catalogue>; ask1Click: (r: ReturnType<typeof convertRequest>) => Promise<QuoteResponse>; now: () => number }): Promise<StartQuote> {
  const fund = text(p.fundAddress).trim();
  if (!/^[0-9a-f]{64}$/.test(fund)) throw new ProblemError(walletProblems.recipientInvalid());
  const need = units(text(p.needYocto));
  if (need === null || need <= 0n) throw new ProblemError(walletProblems.amountInvalid());
  const from = (p.from ?? {}) as { chain?: unknown; assetId?: unknown };
  const cat = await x.catalogue();
  const coin = cat.coin(text(from.assetId));
  const network = cat.startNetworks().find((n) => n.id === text(from.chain));
  // D115: set-up takes our trading chains' coins only while the core's switch is off (review 5: this older path too)
  if (!FUND_EVERY_CHAIN && network && !["sol", "hood", "near"].includes(network.id)) throw new ProblemError(walletProblems.tokenUnsupported(coin?.symbol, network.name));
  if (!coin || !network || coin.chain !== network.id || coin.assetId === WRAPPED_NEAR) throw new ProblemError(walletProblems.tokenUnsupported(coin?.symbol, network?.name ?? cat.network(text(from.chain))?.name));
  const refundTo = text(p.refundTo).trim();
  // EVM and Solana addresses are checked here; 1Click checks every network's own form.
  const known = EVM_CHAINS.has(network.id) || network.id === "sol";
  if (known ? !validAddress(network.id, refundTo) : !/^[A-Za-z0-9:._-]{8,128}$/.test(refundTo)) throw new ProblemError(walletProblems.startRefund(network.name));
  const deadline = quoteDeadline(x.now(), 60 * 60_000);
  const r = await x.ask1Click({
    dry: false,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: 100,
    originAsset: coin.assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: WRAPPED_NEAR,
    amount: ((need * 105n) / 100n).toString(),
    refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient: fund,
    recipientType: "DESTINATION_CHAIN",
    deadline,
    ...(network.id === "stellar" ? { depositMode: "MEMO" as const } : {}),
  } as ReturnType<typeof convertRequest>);
  const atLeast = BigInt(r.quote.minAmountOut);
  if (!r.quote.depositAddress || atLeast < need) throw new ProblemError(walletProblems.quoteUnavailable("The swap service can't give enough NEAR for this right now."));
  return {
    depositAddress: r.quote.depositAddress,
    ...(r.quote.depositMemo ? { memo: r.quote.depositMemo } : {}),
    amountIn: fromUnits(r.quote.amountIn, coin.decimals),
    symbol: coin.symbol,
    tokenId: coin.assetId,
    chain: network.id,
    nearOut: fromUnits(atLeast, NEAR_DECIMALS),
    ...(typeof r.quote.timeEstimate === "number" ? { etaSeconds: r.quote.timeEstimate } : {}),
    expiresIso: r.quote.deadline ?? deadline,
    refundTo,
  };
}
