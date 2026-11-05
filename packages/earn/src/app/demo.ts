// Earn in the web demo (?demo), for MockBridge's sample account only: the real Earn service, on an in-memory sample NEAR
// seeded like the design board (validators, a sample balance, one stake earning and one ready to bring home). A stake,
// unstake or withdrawal the sample sheet approves moves sample NEAR, so every screen can be tried. Nothing touches a node.
// There is one sample NEAR per sample account, shared by the Earn app and the shell's reader (reader.ts), so Wallet's
// balance shows what Earn shows. Both pass the Earn app's bridge, forApps(…, "earn"); the first one made is kept.
// For the first-open journey (D21): ?demo&earn=new starts with idle NEAR and nothing staked, ?demo&earn=empty with no
// NEAR either. Plain ?demo has two stakes, so the journey is skipped there.
import type { Bridge } from "@zerofee/core/bridge";
import type { TxAction, TxOutcome, TxRequest } from "@zerofee/core/signer";
import { createEarnService } from "../staking.ts";
import { FakeNear, near } from "../testing/fake-near.ts";

/** MockBridge's sample accounts. A real account never matches. */
export const isSampleAccount = (id: string): boolean => /^zf-sample\d+\.testnet$/.test(id);

const RATE_PAUSE_MS = 1200;

const samples = new Map<string, Bridge>();

/** The sample Earn for a sample account, made once. */
export function sampleEarn(bridge: Bridge, accountId: string): Bridge {
  let earn = samples.get(accountId);
  if (!earn) samples.set(accountId, (earn = createSampleEarn(bridge, accountId)));
  return earn;
}

function createSampleEarn(bridge: Bridge, accountId: string): Bridge {
  const chain = new FakeNear("testnet");
  // The sample's newest block is now, so "ready in about 21 hours" and "starts earning in about 5 hours" read as they would.
  chain.genesisNs = BigInt(Date.now()) * 1_000_000n - BigInt(Math.round(chain.height * chain.blockSeconds * 1e9));
  for (let i = 1; i <= 10; i++) chain.addPool(`big${i}.poolv1.near`, { stake: near(40_000_000 + i) });
  chain.addPool("allnodes.poolv1.near", { stake: near(6_384_397), growth: 0.0537 });
  chain.addPool("autostake.poolv1.near", { stake: near(1_463_311), growth: 0.0537 });
  const zavodil = chain.addPool("zavodil.poolv1.near", { stake: near(17_854_679), fee: { numerator: 1, denominator: 100 }, growth: 0.0531, liquid: near(5000) });
  const allnodes = chain.pools.get("allnodes.poolv1.near")!;
  allnodes.liquid = near(5000);
  const start = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("earn");
  const fresh = start === "new" || start === "empty";
  // 112.40 NEAR idle after storage and the reserve; with earn=empty, only the storage and the reserve.
  chain.accounts.set(accountId, { balance: start === "empty" ? near(0.06) : near(112.46), storageBytes: 1000n });
  if (!fresh) {
    allnodes.stakers.set(accountId, { staked: near(50.21), unstaked: 0n, canWithdraw: false });
    zavodil.stakers.set(accountId, { staked: near(30.1), unstaked: near(20), canWithdraw: true });
  }

  // Approved sample signatures move sample NEAR.
  const effects: Bridge = {
    async call<T>(method: string, params?: Record<string, unknown>) {
      const r = await bridge.call<T>(method, params);
      if (method === "tx.request" && "ok" in r && (r.ok as TxOutcome).status === "done") apply((params as { request: TxRequest }).request);
      return r;
    },
    on: (e, h) => bridge.on(e, h),
  };
  const apply = (req: TxRequest) => {
    for (const g of [{ receiverId: req.receiverId, actions: req.actions }, ...(req.then ?? [])]) for (const a of g.actions) step(g.receiverId, a);
  };
  const step = (receiverId: string, a: TxAction) => {
    const pool = chain.pools.get(receiverId);
    const me = chain.accounts.get(accountId)!;
    if (!pool || a.kind !== "call") return;
    const s = pool.stakers.get(accountId) ?? { staked: 0n, unstaked: 0n, canWithdraw: false };
    const amount = typeof a.args.amount === "string" ? BigInt(a.args.amount) : null;
    if (a.method === "deposit_and_stake") {
      const v = BigInt(a.depositYocto);
      me.balance -= v;
      pool.stakers.set(accountId, { ...s, staked: s.staked + v, added: (s.added ?? 0n) + v });
    } else if (a.method === "unstake" || a.method === "unstake_all") {
      const v = amount ?? s.staked;
      pool.stakers.set(accountId, { ...s, staked: s.staked - v, unstaked: s.unstaked + v, canWithdraw: false });
    } else if (a.method === "withdraw" || a.method === "withdraw_all") {
      const v = amount ?? s.unstaked;
      me.balance += v;
      pool.stakers.set(accountId, { ...s, unstaked: s.unstaked - v });
    }
  };

  const svc = createEarnService({ bridge: effects, chain, network: chain });
  // What Earn would have kept on the device for these two stakes.
  let seeded: Promise<unknown> | null = null;
  const seed = () =>
    (seeded ??= bridge.call<{ value: string | null }>("device.store.get", { key: "pools" }).then((r) => {
      if (fresh || ("ok" in r && r.ok.value)) return;
      return bridge.call("device.store.set", {
        key: "pools",
        value: JSON.stringify({
          "allnodes.poolv1.near": { feeAtStake: { numerator: 0, denominator: 100 }, principal: near(50).toString() },
          "zavodil.poolv1.near": { feeAtStake: { numerator: 1, denominator: 100 }, principal: near(30).toString() },
        }),
      });
    }));
  const measured = new Set<string>();
  return {
    async call<T>(method: string, params?: Record<string, unknown>) {
      await seed();
      // Measuring a rate takes a while on real nodes the first time, then it's kept; the sample does the same.
      const poolId = String(params?.poolId);
      if (method === "earn.rate" && !measured.has(poolId)) {
        await new Promise((r) => setTimeout(r, RATE_PAUSE_MS));
        measured.add(poolId);
      }
      return svc.call<T>(method, params);
    },
    on: (e, h) => svc.on(e, h),
  };
}
