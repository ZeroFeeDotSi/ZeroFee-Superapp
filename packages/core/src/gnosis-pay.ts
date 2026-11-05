// Is this address a Gnosis Pay card account? Read on Gnosis Chain from two nodes, before Pay saves it or tops it up.
//
// A Gnosis Pay account is a Safe (v1.3.0) whose only owner is the unusable address 0x…0002, with exactly two modules,
// Gnosis Pay's Delay and Roles modules, each pointing at the Safe (docs.gnosispay.com, "About the GP Safe"). The pins
// below were read from Gnosis Chain on 25 Oct: the Safe singleton matches safe-global/safe-deployments; the two module
// implementations are the ones behind the latest Gnosis Pay-shaped accounts (106 of them), which aren't Zodiac's
// published copies. Confirm them against a real card account when the team has one.
//
// What this proves: the address is set up exactly like a Gnosis Pay account. It catches a typo, an ordinary wallet
// address, the wrong chain, and a contract of another kind. It can't prove the account is THIS person's: someone could
// build a look-alike. So the first top-up stays small, and the person checks it arrived in their own Gnosis Pay app.
import { keccak_256 } from "@noble/hashes/sha3.js";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";
import { readJson } from "./net.ts";
import { onCopy } from "./fork.ts";

export const GNOSIS_PAY = {
  chainId: 100,
  /** keccak256 of the Safe v1.3.0 proxy's runtime code (171 bytes). */
  proxyCodeHash: "0xb89c1b3bdf2cf8827818646bce9a8f6e372885f8c55e5c07acbd307cb133b000",
  /** Safe v1.3.0 singleton (canonical), stored in the proxy's slot 0. */
  singleton: "0xd9db270c1b5e3bd161e8c8503c55ceabee709552",
  /** The only owner: an address nobody can sign for, so the modules alone decide. */
  owner: "0x0000000000000000000000000000000000000002",
  /** The implementations behind the two modules (EIP-1167 proxies). */
  delayModule: "0x22d903fd45f441f51bcad198d14eba8a75ea1ef0",
  rolesModule: "0x732b9e9f259fba6f65a1a012dc89c20872ffbd2f",
};

/** Two free Gnosis Chain nodes run by different operators. */
export const GNOSIS_NODES = onCopy(null, ["https://rpc.gnosischain.com", "https://gnosis-rpc.publicnode.com"]);

export interface GnosisReader {
  /** One JSON-RPC read, answered by both nodes; throws ProblemError if they disagree or one can't answer. */
  read(method: string, params: unknown[]): Promise<string>;
}

export class RpcGnosis implements GnosisReader {
  private readonly nodes: string[];
  constructor(nodes = GNOSIS_NODES) {
    this.nodes = nodes;
  }

  async read(method: string, params: unknown[]): Promise<string> {
    const ask = async (url: string) => {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(10000) });
      const body: any = await readJson(res);
      if (body?.error || typeof body?.result !== "string") throw new Error("no answer");
      return body.result as string;
    };
    let answers: string[];
    try {
      answers = await Promise.all(this.nodes.slice(0, 2).map(ask));
    } catch {
      throw new ProblemError(securityProblems.nodesUnreachable());
    }
    if (answers[0].toLowerCase() !== answers[1].toLowerCase()) throw new ProblemError(securityProblems.nodesDisagree());
    return answers[0].toLowerCase();
  }
}

const SEL = { avatar: "0x5aef7de6", target: "0xd4b83992", getOwners: "0xa0e67e2b", getThreshold: "0xe75235b8", getModulesPaginated: "0xcc2f8452" };
const words = (hex: string) => hex.slice(2).match(/.{64}/g) ?? [];
const addr = (word: string | undefined) => `0x${(word ?? "").slice(24)}`;
const hex = (b: Uint8Array) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
const fromHex = (h: string) => Uint8Array.from((h.slice(2).match(/.{2}/g) ?? []).map((x) => parseInt(x, 16)));
const EIP1167 = /^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/;

export interface CardCheck {
  isCard: boolean;
  /** Why not, in plain words. */
  why?: string;
}

/** Does `address` hold a Gnosis Pay account on Gnosis Chain? Every read is answered by both nodes. */
export async function checkGnosisPayAccount(address: unknown, chain: GnosisReader, pins = GNOSIS_PAY): Promise<CardCheck> {
  if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) return { isCard: false, why: "That isn't a Gnosis Chain address. One starts with 0x and has 40 more letters and digits." };
  const a = address.toLowerCase();
  if ((await chain.read("eth_chainId", [])) !== "0x64") throw new ProblemError(securityProblems.nodesUnreachable());
  const call = (to: string, data: string) => chain.read("eth_call", [{ to, data }, "latest"]);
  const code = await chain.read("eth_getCode", [a, "latest"]);
  if (code === "0x") return { isCard: false, why: "This is an ordinary wallet address, not a Gnosis Pay account. Copy the address from the Gnosis Pay app." };
  if (hex(keccak_256(fromHex(code))) !== pins.proxyCodeHash || addr(words(await chain.read("eth_getStorageAt", [a, "0x0", "latest"]))[0]) !== pins.singleton) {
    return { isCard: false, why: "This address isn't a Gnosis Pay account." };
  }
  const owners = words(await call(a, SEL.getOwners)).slice(2).map(addr);
  const threshold = BigInt(await call(a, SEL.getThreshold));
  const list = words(await call(a, `${SEL.getModulesPaginated}${"1".padStart(64, "0")}${"a".padStart(64, "0")}`));
  const modules = list.slice(3, 3 + Number(BigInt(`0x${list[2] ?? "0"}`))).map(addr);
  const impls: string[] = [];
  for (const m of modules) {
    const impl = EIP1167.exec(await chain.read("eth_getCode", [m, "latest"]))?.[1];
    const pointsHere = addr(words(await call(m, SEL.avatar))[0]) === a && addr(words(await call(m, SEL.target))[0]) === a;
    impls.push(impl && pointsHere ? `0x${impl}` : "other");
  }
  const shaped =
    owners.length === 1 && owners[0] === pins.owner && threshold === 1n && impls.length === 2 && impls.includes(pins.delayModule) && impls.includes(pins.rolesModule);
  return shaped ? { isCard: true } : { isCard: false, why: "This is a Gnosis Safe account, but not a Gnosis Pay one." };
}

/** Monerium's EURe on Gnosis Chain, the euro a Gnosis Pay card spends (18 decimals, read from the coin on 26 Oct). */
export const EURE = { token: "0x420ca0f9b9b604ce0fd9c18ef134c705e5fa3430", decimals: 18 };

export interface CardBalance {
  /** A plain decimal ("248.5"), exact. */
  amount: string;
  symbol: "EURe";
  readAtIso: string;
}

/** The card account's EURe (balanceOf on the coin), answered by both nodes. Reading only: no key involved. */
export async function readCardBalance(address: unknown, chain: GnosisReader, nowMs = Date.now()): Promise<CardBalance> {
  if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new ProblemError(securityProblems.requestInvalid("address is an address on Gnosis Chain (0x and 40 more letters and digits)"));
  if ((await chain.read("eth_chainId", [])) !== "0x64") throw new ProblemError(securityProblems.nodesUnreachable());
  const raw = await chain.read("eth_call", [{ to: EURE.token, data: `0x70a08231${address.slice(2).toLowerCase().padStart(64, "0")}` }, "latest"]);
  if (!/^0x[0-9a-f]{64}$/.test(raw)) throw new ProblemError(securityProblems.nodesUnreachable());
  const units = BigInt(raw), scale = 10n ** BigInt(EURE.decimals);
  const frac = (units % scale).toString().padStart(EURE.decimals, "0").replace(/0+$/, "");
  return { amount: `${units / scale}${frac ? `.${frac}` : ""}`, symbol: "EURe", readAtIso: new Date(nowMs).toISOString() };
}
