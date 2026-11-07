// NEAR trades on PAID doors only (rules 3, 9 and 9a, 5 Nov): a trade never waits on a free node. Two doors, both through
// ZeroFee's relay, which holds the keys (apps/quotes):
//   door 1  POST /v0/near, /v0/near/send    FastNEAR's paid plan (FASTNEAR_API_KEY)
//   door 2  POST /v0/near2, /v0/near2/send  a second operator's paid node (NEAR_DOOR2_URL; unset: 503, door 1 alone)
// A read asks door 1; when it fails (no answer, 429, 5xx, 503) or hasn't answered in DOOR_HEDGE_MS, door 2 is asked too
// and the first good answer wins, all inside DOOR_READ_MS (under the 2 s bar). A node's own verdict (an unknown account,
// a view that panicked) is an answer, not a failure: it is thrown as its words, as market/near.ts createNearRpc does.
// A send is the SAME signed bytes on both doors (never a second signature): door 1 first, door 2 when door 1 fails or
// hasn't taken it in SEND_HEDGE_MS; NEAR keeps one copy of a transaction, so both taking it is still one trade. Its
// outcome is then read by its hash on the doors (send_tx's own answer, the same shape).
// No free node is on the normal path. The one last resort (review, 5 Nov, rule 9: never fail from our end): when
// ZeroFee's relay ITSELF failed (no answer, or its own refusal: neither door reached NEAR), the same read, or the same
// signed bytes, go to NEAR's keyless public nodes (market/near.ts createNearRpc), as core near-proxy.ts does. When a door
// did reach NEAR and NEAR failed there, no free node is asked. Only when everything failed is a 9a line thrown, naming
// what is really down: NEAR (NearDoorsDown, trade.near.down) or ZeroFee's relay (NearRelayDown, trade.near.relay-down).
// A person's own NEAR server (Settings → Status, rule 9b; core own-servers.ts) goes ahead of both doors: a read asks it
// first and the doors too when it fails or hasn't answered in OWN_HEDGE_MS; a send gives it the signed bytes first and
// the doors the SAME bytes when it doesn't take them. While it misses, onSwitch says OWN_SWITCHED ("Your server didn't
// answer. Using ZeroFee's server."), cleared when it answers again.
import { sha256 } from "@noble/hashes/sha2.js";
import { ProblemError } from "@zerofee/core/problem";
import { createNearRpc, NEAR_RPC_HOSTS, type NearRpc } from "../market/near.ts";
import { NEAR_RELAY_SWITCHED, nearProblems } from "./problems.ts";
import { relayBase } from "../market/relay.ts";
import { base58 } from "../sol/bytes.ts";
import { OWN_SWITCHED, ownSaid } from "@zerofee/core/own-servers";

/** A door's id (code only, never shown: the person's line is nearProblems.nearDown) and its two relay routes. */
export interface NearDoor { id: "fastnear" | "near2"; read: string; send: string }
export const NEAR_DOORS: readonly NearDoor[] = [
  { id: "fastnear", read: "/v0/near", send: "/v0/near/send" },
  { id: "near2", read: "/v0/near2", send: "/v0/near2/send" },
];
/** Door 2 is asked when door 1 hasn't answered a read by then. */
export const DOOR_HEDGE_MS = 350;
/** A read's whole wait, both doors (inside the 2 s bar, with the tap's own work). */
export const DOOR_READ_MS = 1_500;
/** Door 2 is given the same bytes when door 1 hasn't taken them by then. */
export const SEND_HEDGE_MS = 300;
/** A send's broadcast, both doors. */
export const SEND_MS = 1_500;
/** How long a transaction's outcome is waited for by its hash (the engine's own wait is longer: rhea.ts RHEA_LAND_MS). */
export const OUTCOME_MS = 15_000;
const OUTCOME_POLL_MS = 120;
/** A person's own server gets this long alone before ZeroFee's doors are asked too (a read or the same signed bytes). */
export const OWN_HEDGE_MS = 500;

/** Every paid door failed (rule 9a): a ProblemError whose Problem is NEAR's one line (problems.ts nearDown, from
 *  services.ts serviceSays), so a trade that can't go says it by name, with where the money is. */
export class NearDoorsDown extends ProblemError {
  readonly doorsDown = true;
  readonly tried: string[];
  constructor(tried: string[]) { super(nearProblems.nearDown()); this.name = "NearDoorsDown"; this.tried = tried; }
}

/** ZeroFee's relay itself failed and NEAR's public nodes did too (rule 9a): the relay's line, never NEAR's. */
export class NearRelayDown extends ProblemError {
  readonly doorsDown = true;
  constructor() { super(nearProblems.nearRelayDown()); this.name = "NearRelayDown"; }
}

export interface NearDoorsDeps {
  /** The relay's base (VITE_ZEROFEE_RELAY). */
  relay: string;
  fetch?: typeof fetch;
  /** The last resort when the relay itself fails: NEAR's keyless public nodes (default: market/near.ts createNearRpc). */
  free?: NearRpc;
  /** Rule 9a, never silent: told NEAR_RELAY_SWITCHED (problems.ts) when a trade went on through NEAR's public servers
   *  because the relay itself failed, and null when a door answers again (the sheet's one calm line while it lasts). */
  onSwitch?(line: string | null): void;
  /** The person's own NEAR server (core own-servers.ts ownServer), read at each call; null: none. */
  own?(): string | null;
  /** Timers (tests drive a virtual clock). */
  sleep?(ms: number): Promise<void>;
  now?(): number;
}

/** Where a door failed: at NEAR (the relay answered for it), at the relay itself, absent (no key: 503 not-configured),
 *  or slow (no answer in time: either). */
type Where = "near" | "relay" | "absent" | "slow";
type Got = { ok: true; value: any } | { ok: false; verdict: Error } | { ok: false; down: true; at: Where };

/** The relay's own codes for NEAR failing behind it (near-read.mjs, near-send.mjs); any other refusal is the relay's. */
const AT_NEAR = new Set(["quotes.upstream.unreachable", "quotes.near.busy", "quotes.near.too-big", "quotes.near.refused"]);
async function whereOf(r: Response): Promise<Where> {
  const code = await r.json().then((j: { code?: unknown }) => j?.code, () => undefined);
  return code === "quotes.not-configured" ? "absent" : typeof code === "string" && AT_NEAR.has(code) ? "near" : "relay";
}

const b64ToBytes = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** A signed NEAR transaction's hash (base58 sha256 of the transaction's bytes) and signer; null when it isn't one. */
export function signedTxId(signedBase64: string): { hash: string; signer: string } | null {
  let bytes: Uint8Array;
  try { bytes = b64ToBytes(signedBase64); } catch { return null; }
  if (bytes.length < 4 + 2 + 65) return null;
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  if (len < 2 || len > 64 || 4 + len > bytes.length - 65 || bytes[bytes.length - 65] !== 0) return null;
  const signer = new TextDecoder().decode(bytes.subarray(4, 4 + len));
  return { hash: base58(sha256(bytes.subarray(0, bytes.length - 65))), signer };
}

export interface NearDoors {
  /** Door 1 first, door 2 on its failure: the engine's first node (reads, the send, the outcome). */
  rpc: NearRpc;
  /** Door 2 first, door 1 on its failure: the engine's other node (the FINAL check, a second operator when both are up). */
  rpc2: NearRpc;
}

export function createNearDoors(d: NearDoorsDeps): NearDoors {
  const base = relayBase(d.relay);
  if (!base) throw new Error("no relay");
  const f = d.fetch ?? ((...a) => fetch(...a));
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = d.now ?? Date.now;
  // the last resort: FastNEAR's public endpoint, then dRPC's (measured 5 Nov: 150–230 ms, 240–500 ms); never Intear's
  // (1.7–2.1 s alone eats the 2 s bar), which core chain.ts keeps for non-trade reads only
  const free = d.free ?? createNearRpc(f, NEAR_RPC_HOSTS);
  /** Trades are going through NEAR's public servers (the relay itself failed): said once, cleared when a door answers. */
  let switched = false;
  /** The person's own server missed its last ask: OWN_SWITCHED is said until it answers again. */
  let ownOff = false;
  const doorAnswered = () => { if (switched) { switched = false; d.onSwitch?.(ownOff ? OWN_SWITCHED : null); } };
  const ownAnswer = (answered: boolean) => {
    ownSaid("near", answered);
    if (answered === !ownOff) return;
    ownOff = !answered;
    if (!switched) d.onSwitch?.(ownOff ? OWN_SWITCHED : null);
  };

  /** One door, one read: an answer, a node's verdict, or down and where (never a throw). */
  async function ask(door: NearDoor, method: string, params: unknown, ms: number): Promise<Got> { return askAt(`${base}${door.read}`, method, params, ms); }
  async function askAt(url: string, method: string, params: unknown, ms: number): Promise<Got> {
    const ac = typeof AbortController === "undefined" ? undefined : new AbortController();
    const cut = sleep(ms).then((): Got => { ac?.abort(); return { ok: false, down: true, at: "slow" }; });
    const go = (async (): Promise<Got> => {
      try {
        const r = await f(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), ...(ac ? { signal: ac.signal } : {}) });
        if (!r.ok) return { ok: false, down: true, at: await whereOf(r) };
        const j = await r.json() as { result?: any; error?: { cause?: { name?: string }; data?: string; message?: string } };
        if (j?.error) return { ok: false, verdict: Object.assign(new Error(`${j.error.cause?.name ?? ""} ${j.error.data ?? j.error.message ?? ""}`.trim()), { node: true }) };
        if (j?.result?.error) return { ok: false, verdict: Object.assign(new Error(String(j.result.error)), { node: true }) };
        if (j?.result === undefined) return { ok: false, down: true, at: "relay" };
        return { ok: true, value: j.result };
      } catch { return { ok: false, down: true, at: "relay" }; }
    })();
    return Promise.race([go, cut]);
  }

  /**
   * Every door failed. A door that reached NEAR and NEAR failed there: NEAR's line, no free node. Otherwise the relay
   * itself failed (or was slow): the last resort, NEAR's public nodes; a node's verdict there is still an answer; their
   * failure too says what was really down (the relay, when it answered for no door; else NEAR).
   */
  async function lastResort(at: Where[], tried: string[], method: string, params: unknown): Promise<any> {
    if (at.includes("near")) throw new NearDoorsDown(tried);
    try {
      const value = await free(method, params);
      if (!switched) { switched = true; d.onSwitch?.(NEAR_RELAY_SWITCHED); }
      return value;
    } catch (e) {
      if ((e as { node?: boolean })?.node) throw e;
      throw at.includes("relay") ? new NearRelayDown() : new NearDoorsDown(tried);
    }
  }

  /** Both doors in `order`: the second when the first fails or is slow (a waiting tx read: both at once). */
  async function read(order: readonly NearDoor[], method: string, params: unknown): Promise<any> {
    const waits = method === "tx" && typeof (params as { wait_until?: unknown })?.wait_until === "string" && (params as { wait_until: string }).wait_until !== "NONE";
    const ms = waits ? OUTCOME_MS : DOOR_READ_MS;
    return new Promise((resolve, reject) => {
      let open = 0, settled = false, second = false;
      const tried: string[] = [];
      const at: Where[] = [];
      const start = (door: NearDoor) => {
        open++; tried.push(door.id);
        void ask(door, method, params, ms).then((g) => {
          open--;
          if (settled) return;
          if (g.ok) { settled = true; doorAnswered(); resolve(g.value); return; }
          if ("verdict" in g) { settled = true; doorAnswered(); reject(g.verdict); return; }
          at.push(g.at);
          if (!second) { second = true; start(order[1]!); return; }
          if (open === 0) { settled = true; lastResort(at, tried, method, params).then(resolve, reject); }
        });
      };
      start(order[0]!);
      // an outcome waited for (a send's): both doors at once, so a door that dies or hangs mid-wait never costs its wait
      if (waits) { second = true; start(order[1]!); }
      else void sleep(DOOR_HEDGE_MS).then(() => { if (!settled && !second) { second = true; start(order[1]!); } });
    });
  }

  /** The person's own server first, then `rest` (the doors) when it fails or hasn't answered in OWN_HEDGE_MS. A node's
   *  verdict from it is an answer. No own server: `rest` alone. */
  function ownFirst<T>(method: string, params: unknown, ms: number, rest: () => Promise<T>): Promise<T> {
    const own = d.own?.() ?? null;
    if (!own) return rest();
    return new Promise<T>((resolve, reject) => {
      let settled = false, fell = false;
      const fall = () => {
        if (fell) return;
        fell = true;
        rest().then((v) => { if (!settled) { settled = true; resolve(v); } }, (e) => { if (!settled) { settled = true; reject(e); } });
      };
      void askAt(own, method, params, ms).then((g) => {
        if (g.ok || "verdict" in g) ownAnswer(true); else ownAnswer(false);
        if (settled) return;
        if (g.ok) { settled = true; resolve(g.value); return; }
        if ("verdict" in g) { settled = true; reject(g.verdict); return; }
        fall();
      });
      void sleep(OWN_HEDGE_MS).then(() => { if (!settled) fall(); });
    });
  }

  /** The signed bytes to the person's own server (send_tx, not waiting): true once it took them. */
  async function ownTook(own: string, tx: string): Promise<boolean> {
    const g = await askAt(own, "send_tx", { signed_tx_base64: tx, wait_until: "NONE" }, SEND_MS);
    ownAnswer(g.ok || "verdict" in g);
    return g.ok;
  }

  /** The same signed bytes to door 1, and to door 2 when door 1 fails or is slow: true once a door took them, else
   *  where each door failed. A person's own server is given them first; the doors the same bytes when it doesn't take
   *  them, or hasn't in OWN_HEDGE_MS. */
  async function broadcast(tx: string): Promise<true | Where[]> {
    const own = d.own?.() ?? null;
    if (own) {
      const viaOwn = ownTook(own, tx);
      const first = await Promise.race([viaOwn, sleep(OWN_HEDGE_MS).then(() => null)]);
      if (first === true) return true;
      // the own server may still take them while the doors are asked: either taking them is the one trade (NEAR keeps
      // one copy), and the first to take them answers
      const doors = doorsBroadcast(tx);
      const never = new Promise<never>(() => {});
      const ownLater = first === false ? never : viaOwn.then((t) => (t ? (true as const) : never));
      const doorsDone = doors.then(async (b) => (b === true || first === false ? b : (await viaOwn) ? (true as const) : b));
      return Promise.race([ownLater, doorsDone]);
    }
    return doorsBroadcast(tx);
  }
  async function doorsBroadcast(tx: string): Promise<true | Where[]> {
    const one = async (door: NearDoor): Promise<true | Where> => {
      const ac = typeof AbortController === "undefined" ? undefined : new AbortController();
      const cut = sleep(SEND_MS).then((): Where => { ac?.abort(); return "slow"; });
      const go = (async (): Promise<true | Where> => {
        try {
          const r = await f(`${base}${door.send}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx }), ...(ac ? { signal: ac.signal } : {}) });
          if (!r.ok) return await whereOf(r);
          return (await r.json() as { sent?: unknown })?.sent === true ? true : "relay";
        } catch { return "relay"; }
      })();
      return Promise.race([go, cut]);
    };
    return new Promise((resolve) => {
      let open = 0, settled = false, second = false;
      const at: Where[] = [];
      const start = (door: NearDoor) => {
        open++;
        void one(door).then((took) => {
          open--;
          if (settled) return;
          if (took === true) { settled = true; resolve(true); return; }
          at.push(took);
          if (!second) { second = true; start(NEAR_DOORS[1]!); return; }
          if (open === 0) { settled = true; resolve(at); }
        });
      };
      start(NEAR_DOORS[0]!);
      void sleep(SEND_HEDGE_MS).then(() => { if (!settled && !second) { second = true; start(NEAR_DOORS[1]!); } });
    });
  }

  /** send_tx as a node answers it: broadcast on the doors, then the outcome by its hash (UNKNOWN_TRANSACTION: not seen yet). */
  async function sendTx(order: readonly NearDoor[], params: unknown): Promise<any> {
    const p = params as { signed_tx_base64?: unknown; wait_until?: unknown };
    const id = typeof p?.signed_tx_base64 === "string" ? signedTxId(p.signed_tx_base64) : null;
    if (!id) throw Object.assign(new Error("near.doors.unsigned"), { node: true });
    const wait = typeof p.wait_until === "string" ? p.wait_until : "EXECUTED_OPTIMISTIC";
    const sent = await broadcast(p.signed_tx_base64 as string);
    // the relay itself failed on both doors: the SAME bytes, once, to NEAR's public nodes (the last resort); NEAR failing
    // behind a door: NEAR's line
    if (sent !== true) return lastResort(sent, NEAR_DOORS.map((x) => x.id), "send_tx", { signed_tx_base64: p.signed_tx_base64, wait_until: wait });
    if (wait === "NONE") return { final_execution_status: "NONE", transaction: { hash: id.hash, signer_id: id.signer } };
    const until = now() + OUTCOME_MS;
    for (;;) {
      try {
        return await readAny(order, "tx", { tx_hash: id.hash, sender_account_id: id.signer, wait_until: wait });
      } catch (e) {
        if (!/UNKNOWN_TRANSACTION|doesn't exist|does not exist/i.test(String((e as Error)?.message)) || now() >= until) throw e;
        await sleep(OUTCOME_POLL_MS);
      }
    }
  }

  const readAny = (order: readonly NearDoor[], method: string, params: unknown) => {
    const waits = method === "tx" && typeof (params as { wait_until?: unknown })?.wait_until === "string" && (params as { wait_until: string }).wait_until !== "NONE";
    return ownFirst(method, params, waits ? OUTCOME_MS : DOOR_READ_MS, () => read(order, method, params));
  };
  const rpcOf = (order: readonly NearDoor[]): NearRpc => (method, params) => (method === "send_tx" ? sendTx(order, params) : readAny(order, method, params));
  return { rpc: rpcOf(NEAR_DOORS), rpc2: rpcOf([NEAR_DOORS[1]!, NEAR_DOORS[0]!]) };
}
