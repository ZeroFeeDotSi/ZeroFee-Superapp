// Earn's reads beyond core's Chain: the epoch length, the validator set and blocks with their times, each asked of two
// independent nodes that must agree, the same rule core/chain.ts keeps. A disagreement is a Problem, never a guess.
import { NODES, standInsOf } from "@zerofee/core/chain";
import { ProblemError } from "@zerofee/core/problem";
import type { Network } from "@zerofee/core/signer";
import { earnProblems } from "./earn-problems.ts";
import { onCopy } from "@zerofee/core/fork";

export interface StampedBlock {
  hash: string;
  height: number;
  timestampNs: bigint;
}

export interface SeenValidator {
  /** The validator's staking pool account, e.g. "allnodes.poolv1.near". */
  accountId: string;
  stakeYocto: bigint;
  /** Share of its expected blocks, chunks and endorsements it produced this epoch (the lowest of those, and the lower of
   *  the two nodes' counts), 0–1. Null before any work was due. */
  uptime: number | null;
}

export interface ValidatorSet {
  epochStartHeight: number;
  validators: SeenValidator[];
  /** Validators dropped at the end of the last epoch. */
  kickedOut: string[];
}

export interface NetworkInfo {
  readonly network: Network;
  epochLength(): Promise<number>;
  /** A block both nodes hold under the same hash, or null when either no longer keeps it. "final": the newest such. */
  blockAt(height: number | "final"): Promise<StampedBlock | null>;
  validators(): Promise<ValidatorSet>;
}

/**
 * Nodes that keep old blocks, for a rate over 30 days. Two operators are needed for the two-node rule; on 25 Oct 2026
 * NEAR's own archival endpoint answered "THIS ENDPOINT IS DEPRECATED", so only FastNear's is dependable, and Earn
 * doesn't use these by default. Ordinary nodes keep about two epochs, which is what the rate spans without them.
 */
export const ARCHIVAL_NODES: Record<Network, string[]> = {
  testnet: ["https://archival-rpc.testnet.fastnear.com", "https://archival-rpc.testnet.near.org"],
  mainnet: onCopy("near", ["https://archival-rpc.mainnet.fastnear.com", "https://archival-rpc.mainnet.near.org"]),
};

class NodeDown extends Error {}
class NodeSaid extends Error {}

const disagree = () => new ProblemError(earnProblems.nodesDisagree());
const unreachable = () => new ProblemError(earnProblems.nodesUnreachable());

export class RpcNetwork implements NetworkInfo {
  readonly network: Network;
  private readonly nodes: string[];
  private readonly fetchFn: typeof fetch;

  constructor(network: Network, nodes: string[] = NODES[network], fetchFn: typeof fetch = (...a) => fetch(...a)) {
    if (new Set(nodes.slice(0, 2)).size < 2) throw new Error("the two-node rule needs two different nodes");
    this.network = network;
    this.nodes = nodes;
    this.fetchFn = fetchFn;
  }

  private async rpc(url: string, method: string, params: unknown): Promise<any> {
    let body: any;
    try {
      const r = await this.fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // A numeric id: dRPC refuses `validators` with a string one (422).
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(15000),
      });
      // A 422 is a node's real answer (its body says why); a 429 or a 5xx is the node being busy or down.
      if (!r.ok && r.status !== 422) throw new NodeDown(`${url} answered ${r.status}`);
      body = await r.json();
    } catch (e) {
      throw e instanceof NodeDown ? e : new NodeDown(String(e));
    }
    if (body?.error) {
      const text = JSON.stringify(body.error);
      if (/UNKNOWN_BLOCK|GARBAGE_COLLECTED|DB Not Found|doesn't exist|not found/i.test(text)) throw new NodeSaid("missing");
      throw new NodeDown(text);
    }
    return body?.result;
  }

  /** Two nodes' answers; a third stands in for one that is down or busy, as in core's RpcChain. */
  private async both(method: string, params: unknown): Promise<[any, any] | "missing"> {
    // the app's one order (core's standInsOf): on mainnet NEAR's own node before Intear (a real-money test, 4 Nov)
    const spare = standInsOf(this.nodes);
    const one = async (url: string): Promise<{ ok: any } | "missing"> => {
      try {
        return { ok: await this.rpc(url, method, params) };
      } catch (e) {
        if (e instanceof NodeSaid) return "missing";
        const stand = spare.shift();
        if (stand) return one(stand);
        throw unreachable();
      }
    };
    const [a, b] = await Promise.all([one(this.nodes[0]), one(this.nodes[1])]);
    return a === "missing" || b === "missing" ? "missing" : [a.ok, b.ok];
  }

  async epochLength(): Promise<number> {
    const r = await this.both("EXPERIMENTAL_protocol_config", { finality: "final" });
    if (r === "missing") throw unreachable();
    const [a, b] = r.map((x) => x?.epoch_length);
    if (!Number.isInteger(a) || a !== b) throw disagree();
    return a;
  }

  /** The header of a block both nodes hold under the same hash: `height`, or the newest final one they share. */
  private async header(height: number | "final"): Promise<any | null> {
    if (height === "final") {
      const r = await this.both("block", { finality: "final" });
      if (r === "missing") throw unreachable();
      // The newer node must hold the older node's final block under the same hash (as core's commonBlock does).
      const older = Math.min(r[0].header.height, r[1].header.height);
      const h = await this.header(older);
      if (!h) throw disagree();
      return h;
    }
    const r = await this.both("block", { block_id: height });
    if (r === "missing") return null;
    const [a, b] = r.map((x) => x?.header);
    if (!a || a.hash !== b?.hash) throw disagree();
    return a;
  }

  async blockAt(height: number | "final"): Promise<StampedBlock | null> {
    const h = await this.header(height);
    return h && { hash: h.hash, height: h.height, timestampNs: BigInt(h.timestamp_nanosec ?? h.timestamp) };
  }

  async validators(): Promise<ValidatorSet> {
    // By the epoch of a final block both nodes hold: "the newest" can reach a node behind a load balancer that hasn't
    // seen that block yet, and a block id only works for an epoch's last block.
    const final = await this.header("final");
    const r = await this.both("validators", { epoch_id: final.epoch_id });
    if (r === "missing") throw unreachable();
    const [a, b] = r;
    if (a?.epoch_start_height !== b?.epoch_start_height) throw disagree();
    const kicked = (x: any) => ((x.prev_epoch_kickout ?? []) as any[]).map((k) => String(k.account_id)).sort();
    if (kicked(a).join() !== kicked(b).join()) throw disagree();
    const other = new Map<string, any>((b.current_validators as any[]).map((v) => [v.account_id, v]));
    if (other.size !== a.current_validators.length) throw disagree();
    const validators = (a.current_validators as any[]).map((v): SeenValidator => {
      const w = other.get(v.account_id);
      if (!w || w.stake !== v.stake) throw disagree();
      const u = [uptimeOf(v), uptimeOf(w)].filter((x): x is number => x !== null);
      return { accountId: v.account_id, stakeYocto: BigInt(v.stake), uptime: u.length ? Math.min(...u) : null };
    });
    return { epochStartHeight: a.epoch_start_height, validators, kickedOut: kicked(a) };
  }
}

/** The lowest share of due work done: blocks, chunks and (since chunk validation) endorsements. */
function uptimeOf(v: any): number | null {
  const shares = [
    [v.num_produced_blocks, v.num_expected_blocks],
    [v.num_produced_chunks, v.num_expected_chunks],
    [v.num_produced_endorsements, v.num_expected_endorsements],
  ]
    .filter(([done, due]) => Number.isFinite(done) && Number.isFinite(due) && due > 0)
    .map(([done, due]) => done / due);
  return shares.length ? Math.min(...shares) : null;
}
