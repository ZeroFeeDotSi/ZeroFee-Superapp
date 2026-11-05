// A faithful fake of Upstash's REST pipeline (SET NX PX, GET, DEL, INCRBY, the relay's fixed scripts), so the guards'
// own Redis code runs in tests with no network. Moved here from the retired credit tests (D152).
import { ONCE_THEN_ADD, PAYOUT_DONE, REFUND_ALL, TAKE_IF } from "../guards.mjs";

/** Upstash's REST pipeline over a Map: each command's `{result}`, as Redis answers it. */
export function fakeUpstash(now: () => number = Date.now) {
  const data = new Map<string, { v: string; until: number }>();
  const hashes = new Map<string, Map<string, string>>();
  const sets = new Map<string, Set<string>>();
  const live = (k: string) => {
    const e = data.get(k);
    if (e && now() >= e.until) data.delete(k);
    return data.get(k);
  };
  const one = (cmd: string[]): unknown => {
    const [op, key, ...rest] = cmd;
    switch (op) {
      case "SET": {
        const [v, ...opts] = rest;
        const up = opts.map((o) => o.toUpperCase());
        const px = up.indexOf("PX") >= 0 ? Number(opts[up.indexOf("PX") + 1]) : up.indexOf("EX") >= 0 ? Number(opts[up.indexOf("EX") + 1]) * 1000 : Infinity;
        if (up.includes("NX") && live(key!)) return null;
        data.set(key!, { v: v!, until: now() + px });
        return "OK";
      }
      case "GET":
        return live(key!)?.v ?? null;
      case "DEL":
        return Number(data.delete(key!)) + Number(hashes.delete(key!)) + Number(sets.delete(key!)) > 0 ? 1 : 0;
      case "HGET":
        return hashes.get(key!)?.get(rest[0]!) ?? null;
      case "HSET":
        if (!hashes.has(key!)) hashes.set(key!, new Map());
        hashes.get(key!)!.set(rest[0]!, rest[1]!);
        return 1;
      case "HINCRBY": {
        if (!hashes.has(key!)) hashes.set(key!, new Map());
        const h = hashes.get(key!)!;
        const n = Number(h.get(rest[0]!) ?? 0) + Number(rest[1]);
        h.set(rest[0]!, String(n));
        return n;
      }
      case "HGETALL":
        return [...(hashes.get(key!) ?? new Map())].flat();
      case "SADD":
        if (!sets.has(key!)) sets.set(key!, new Set());
        sets.get(key!)!.add(rest[0]!);
        return 1;
      case "SREM":
        return sets.get(key!)?.delete(rest[0]!) ? 1 : 0;
      case "SMEMBERS":
        return [...(sets.get(key!) ?? [])];
      case "INCR":
      case "INCRBY": {
        const e = live(key!);
        const n = (e ? Number(e.v) : 0) + (op === "INCR" ? 1 : Number(rest[0]));
        data.set(key!, { v: String(n), until: e?.until ?? Infinity });
        return n;
      }
      case "EVAL": {
        // The relay's two fixed scripts only, as Redis runs them: whole, with nothing in between.
        const [script, nk, ...rest2] = [key!, ...rest];
        const keys = rest2.slice(0, Number(nk));
        const argv = rest2.slice(Number(nk));
        if (script === ONCE_THEN_ADD) {
          if (one(["SET", keys[0]!, argv[0]!, "PX", argv[1]!, "NX"]) === null) return null;
          const total = one(["INCRBY", keys[1]!, argv[2]!]);
          one(["INCRBY", keys[2]!, argv[2]!]);
          return total;
        }
        if (script === REFUND_ALL) {
          const have = Number(live(keys[0]!)?.v ?? 0);
          if (have <= 0) return 0;
          one(["DEL", keys[0]!]);
          one(["HINCRBY", keys[1]!, "micros", String(have)]);
          one(["HSET", keys[1]!, "to", argv[0]!]);
          one(["SADD", keys[2]!, argv[1]!]);
          return have;
        }
        if (script === PAYOUT_DONE) {
          if (one(["SET", keys[3]!, argv[1]!, "PX", argv[2]!, "NX"]) === null) return -1;
          const have = Number(one(["HGET", keys[0]!, "micros"]) ?? 0);
          const paid = Number(argv[0]);
          if (have < paid || one(["HGET", keys[0]!, "to"]) !== argv[4]) return (one(["DEL", keys[3]!]), null);
          if (have === paid) (one(["DEL", keys[0]!]), one(["SREM", keys[1]!, argv[3]!]));
          else one(["HINCRBY", keys[0]!, "micros", String(-paid)]);
          one(["INCRBY", keys[2]!, String(paid)]);
          return have - paid;
        }
        if (script === TAKE_IF) {
          const have = Number(live(keys[0]!)?.v ?? 0);
          return have >= Number(argv[0]) ? one(["INCRBY", keys[0]!, String(-Number(argv[0]))]) : null;
        }
        throw new Error("fake upstash: an unknown script");
      }
      default:
        throw new Error(`fake upstash: ${op}`);
    }
  };
  /**
   * A failure to inject: the next pipeline call whose commands `when` matches fails, either before Redis applies it
   * ("drop") or after (its answer "lost", like a timeout). `left` such failures, then calls go through again.
   */
  const fail: { when: ((cmds: string[][]) => boolean) | null; mode: "drop" | "lost"; left: number } = { when: null, mode: "drop", left: 0 };
  const fetchFn = async (_url: string, init: { body: string }) => {
    const cmds = JSON.parse(init.body) as string[][];
    const hit = fail.when !== null && fail.left > 0 && fail.when(cmds);
    if (hit) fail.left--;
    if (hit && fail.mode === "drop") throw new TypeError("fetch failed");
    const out = cmds.map((c) => ({ result: one(c) }));
    if (hit) throw new DOMException("timed out", "TimeoutError");
    return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
  };
  return { data, hashes, sets, fetchFn, fail };
}
