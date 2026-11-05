// The alerts tests' harness (alerts.test.ts, audit-alerts.poc.test.ts): mocked NEAR nodes that list each account's
// keys, NEP-413 proofs by such a key, a store, a mail outbox, and a relay to call as the app, a mail client and a person.
import { generateKeyPairSync, randomBytes, sign as cryptoSign, type KeyObject } from "node:crypto";
import { encodeSignature, generateSigner } from "@fastnear/ml-dsa-65";
// @ts-ignore: plain JS
import { alertsProofMessage, createAlerts, memoryStore, nep413Hash } from "./alerts.mjs";
// @ts-ignore: plain JS
import { createRelay } from "./relay.mjs";

export const BASE = "https://relay.example";
export type State = { pending?: unknown; waiting?: unknown[]; legacy?: unknown; agent?: unknown };
type Mail = { to: string; subject: string; text: string };

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function b58(bytes: Uint8Array): string {
  let n = 0n;
  for (const x of bytes) n = (n << 8n) | BigInt(x);
  let s = "";
  while (n > 0n) (s = B58[Number(n % 58n)] + s), (n /= 58n);
  for (const x of bytes) if (x === 0) s = "1" + s; else break;
  return s;
}

/** A key as NEAR names it, and how it signs a 32-byte hash (the signature in NEAR's text form). */
export type NearKey = { publicKey: string; sign: (hash: Uint8Array) => string };

/** An ed25519 key ("ed25519:<base58>"). */
export function nearKey(): NearKey {
  const k = generateKeyPairSync("ed25519");
  const publicKey = `ed25519:${b58(Buffer.from(k.publicKey.export({ format: "jwk" }).x!, "base64url"))}`;
  return { publicKey, sign: (hash) => `ed25519:${b58(cryptoSign(null, hash, k.privateKey as KeyObject))}` };
}

/** An ML-DSA-65 key, as a ZeroFee account's are ("ml-dsa-65:<base58 of 1,952 bytes>"), signing as the core's keys do. */
export function mlDsaKey(): NearKey {
  const signer = generateSigner();
  return { publicKey: signer.publicKey, sign: (hash) => encodeSignature(signer.signHash(hash)) };
}

/** A NEP-413 proof by `key` for this relay (README "Proof of the account"). */
export function proofBy(key: NearKey, accountId: string, email: string, o: { recipient?: string; deadline?: string; nonce?: Buffer } = {}) {
  const deadline = o.deadline ?? new Date(Date.now() + 5 * 60_000).toISOString();
  const nonce = o.nonce ?? randomBytes(32);
  const hash = nep413Hash({ message: alertsProofMessage(accountId, email, deadline), nonce, recipient: o.recipient ?? new URL(BASE).host });
  return { deadline, nonce: nonce.toString("base64"), publicKey: key.publicKey, signature: key.sign(hash) };
}

/**
 * The function-call keys a ZeroFee account puts on itself, each with its methods as the contract adds them
 * (contracts/account-policy: DEVICE_METHODS without and with modules, SECOND_DEVICE_METHODS, RECOVERY_METHODS, the
 * agent module's AGENT_METHODS). "self-any": a key to the account itself with an empty list (any method). And
 * "device-elsewhere": the device's method list on a key to another contract (game.near).
 */
const DEVICE = "execute,execute_many,run,cancel,set_protection,add_second_device,remove_key,set_recovery_key,cancel_recovery,upgrade".split(",");
export const OWN_KEYS: Record<string, string[]> = {
  device: DEVICE,
  // In another order than the contract writes it: NEAR keeps the list as given, and the relay compares it as a set.
  "device-modules": [...DEVICE, ..."legacy_setup,legacy_off,legacy_check_in,legacy_cancel_claim,agent_set,agent_set_budget,agent_add_order,agent_resume,agent_pause,agent_remove_order,agent_revoke,agent_renew_key,kids_set,kids_off".split(",")].reverse(),
  guardian: "approve,decline,approve_recovery,refuse_recovery,refill_recovery_key".split(","),
  "guardian-r7": "approve,decline,approve_recovery,refuse_recovery".split(","),
  "guardian-r6": ["approve", "decline"],
  recovery: ["start_recovery", "finish_recovery"],
  agent: ["agent_pay", "agent_convert", "run_order"],
  "device-plus": [...DEVICE, "anything"],
  "device-part": DEVICE.slice(0, 3),
  "self-any": [],
};

/**
 * NEAR nodes answering the account contract's views from `stateOf`, and view_access_key from `keys` (account → its
 * keys: "full", one of OWN_KEYS for a function-call key on the account itself, or another contract's name for a key
 * to it). `drpc`: how that node misbehaves.
 */
export function nodes(stateOf: (account: string) => State, keys: Map<string, Map<string, string>>, o: { delayMs?: number; down?: (url: string) => boolean; disagree?: (url: string) => boolean } = {}) {
  let calls = 0;
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls++;
    if (o.delayMs) await new Promise((r) => setTimeout(r, o.delayMs));
    if (o.down?.(url)) throw new Error("down");
    const p = JSON.parse(String(init.body)).params;
    const permissionOf = (account: string, k: string) => {
      const own = OWN_KEYS[k];
      return k === "full" ? "FullAccess"
        : k === "device-elsewhere" ? { FunctionCall: { receiver_id: "game.near", method_names: DEVICE, allowance: null } }
        : { FunctionCall: { receiver_id: own ? account : k, method_names: own ?? [], allowance: null } };
    };
    if (p.request_type === "view_access_key") {
      const k = keys.get(p.account_id)?.get(p.public_key);
      if (!k) return new Response(JSON.stringify({ error: { cause: { name: "UNKNOWN_ACCESS_KEY" } } }));
      return new Response(JSON.stringify({ result: { nonce: 1, permission: permissionOf(p.account_id, k), block_height: Math.floor(Math.random() * 1e6) } }));
    }
    if (p.request_type === "view_access_key_list") {
      const list = [...(keys.get(p.account_id) ?? new Map()).entries()].map(([public_key, k]) => ({ public_key, access_key: { nonce: 1, permission: permissionOf(p.account_id, k) } }));
      return new Response(JSON.stringify({ result: { keys: o.disagree?.(url) ? [] : list, block_height: 1 } }));
    }
    const state = stateOf(p.account_id);
    const method = p.method_name as string;
    const value = method === "pending" ? state.pending ?? null : method === "waiting_requests" ? state.waiting ?? [] : method === "agent" ? state.agent ?? null : state.legacy ?? null;
    const bytes = [...Buffer.from(JSON.stringify(o.disagree?.(url) ? "other" : value))];
    return new Response(JSON.stringify({ result: { result: bytes } }));
  }) as typeof fetch;
  return { fetchFn, calls: () => calls };
}

export function setup(o: { stateOf?: (a: string) => State; delayMs?: number; down?: (url: string) => boolean; disagree?: (url: string) => boolean; mailDelayMs?: number; base?: string | undefined; operator?: string; now?: () => number } = {}) {
  const mails: Mail[] = [];
  const store = memoryStore();
  const keys = new Map<string, Map<string, string>>();
  const n = nodes(o.stateOf ?? (() => ({})), keys, o);
  const mail = async (m: Mail) => {
    if (o.mailDelayMs) await new Promise((r) => setTimeout(r, o.mailDelayMs));
    mails.push(m);
  };
  const alerts = createAlerts({ store, mail, base: "base" in o ? o.base : BASE, cronSecret: "cron-secret", operator: o.operator, fetchFn: n.fetchFn, ...(o.now ? { now: o.now } : {}) });
  const relay = createRelay({ key: "k", secret: "s", origins: ["zerofee-app://app"], alerts });
  let ips = 0;
  const nextIp = () => `192.0.${Math.floor(++ips / 250)}.${ips % 250}`;
  const post = (path: string, body: unknown, ip = "198.51.100.1", host = BASE) =>
    relay(new Request(`${host}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "zerofee-app://app" }, body: JSON.stringify(body) }), ip);
  /** A link opened (each from its own address, as people's mail clients are). */
  const get = (url: string, headers: Record<string, string> = {}) => relay(new Request(url.startsWith("http") ? url : `${BASE}${url}`, { headers }), nextIp());
  /** The page's button pressed: its form posted back, as a browser does. */
  const press = async (page: Response, host = BASE) => {
    const text = await page.text();
    const action = /action="([^"]+)"/.exec(text)?.[1];
    const t = /name="t" value="([^"]+)"/.exec(text)?.[1];
    const f = /name="f" value="([^"]+)"/.exec(text)?.[1];
    if (!action || !t || !f) return new Response(text);
    return relay(new Request(`${host}${action}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: host }, body: new URLSearchParams({ t, f }).toString() }), nextIp());
  };
  const linkIn = (m: Mail) => /https:\/\/\S+/.exec(m.text)![0];
  const lastTo = (to: string) => [...mails].reverse().find((m) => m.to === to);
  const round = () => get("/v0/alerts/check", { authorization: "Bearer cron-secret" });
  /** Gives `account` a key (full by default; ML-DSA-65 as a ZeroFee account's, or ed25519), as creating it on NEAR would. */
  const keyFor = (account: string, kind = "full", type: "ml-dsa-65" | "ed25519" = "ml-dsa-65") => {
    const k = type === "ml-dsa-65" ? mlDsaKey() : nearKey();
    keys.set(account, (keys.get(account) ?? new Map()).set(k.publicKey, kind));
    return k;
  };
  const settle = () => new Promise((r) => setTimeout(r, 5));
  /** Subscribe with a proof by `key` (or none), open the emailed link, press its button: 200 when alerts are on. */
  const subscribeAndConfirm = async (accountId: string, email: string, key: NearKey | null, ip = "198.51.100.1") => {
    const had = mails.length;
    const r = await post("/v0/alerts/subscribe", { accountId, email, ...(key ? { proof: proofBy(key, accountId, email) } : {}) }, ip);
    if (r.status !== 200) return r.status;
    // The email goes after the answer: waited for (up to 2 s).
    for (let i = 0; i < 400 && !mails.slice(had).some((x) => x.to === email); i++) await settle();
    const m = lastTo(email);
    if (!m) return 0;
    const done = await press(await get(linkIn(m)));
    return (await done.text()).includes("Alerts are on") ? 200 : 409;
  };
  return { mails, store, relay, post, get, press, linkIn, lastTo, round, nodes: n, keys, keyFor, subscribeAndConfirm, settle };
}
