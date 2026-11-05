import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { PROVIDER_SHA256 } from "./pin.ts";

const source = readFileSync(new URL("./provider.js", import.meta.url), "utf8");
/** Values made inside the page's realm, compared as plain data. */
const data = (x: unknown) => JSON.parse(JSON.stringify(x));

type Sent = { id: number; method: string; params: unknown };
type Reply = (msg: Sent) => unknown;

/** A page with WebKit's message handler, as the host gives it in wallet mode. */
function page(options: { reply?: Reply; subframe?: boolean; noHandler?: boolean; ethereum?: unknown } = {}) {
  const sent: Sent[] = [];
  const window = new EventTarget() as EventTarget & Record<string, unknown>;
  const handler = {
    postMessage: async (msg: Sent) => {
      sent.push(msg);
      return (options.reply ?? (() => ({ id: msg.id, result: null })))(msg);
    },
  };
  if (!options.noHandler) window.webkit = { messageHandlers: { zerofeeWallet: handler } };
  window.top = options.subframe ? {} : window;
  if (options.ethereum) window.ethereum = options.ethereum;
  // The page's own wallet-standard app: collects what registers.
  const registered: Record<string, unknown>[] = [];
  window.addEventListener("wallet-standard:register-wallet", (e) => (e as unknown as { detail: (api: unknown) => void }).detail({ register: (w: Record<string, unknown>) => registered.push(w) }));
  vm.runInNewContext(source, { window, CustomEvent, Event, btoa, atob, crypto, setTimeout, Uint8Array, ArrayBuffer, Error, JSON, Object, Promise, Map, Set, String, Number, Array, Boolean });
  return { window, handler, sent, registered, eth: window.ethereum as Record<string, (...a: unknown[]) => unknown> & { request: (a: unknown) => Promise<unknown> } };
}

test("the pinned hash is the file's: a changed provider.js fails here before the host refuses it", () => {
  assert.equal(createHash("sha256").update(source).digest("hex"), PROVIDER_SHA256);
});

test("nothing is offered in a frame inside the page, or without the host's handler", () => {
  assert.equal(page({ subframe: true }).window.ethereum, undefined);
  assert.equal(page({ noHandler: true }).window.ethereum, undefined);
});

test("EIP-6963: announces ZeroFee with its own name, rdns and a data-URI icon, now and on request", () => {
  const p = page();
  const seen: { info: Record<string, string>; provider: unknown }[] = [];
  p.window.addEventListener("eip6963:announceProvider", (e) => seen.push((e as CustomEvent).detail));
  p.window.dispatchEvent(new Event("eip6963:requestProvider"));
  assert.equal(seen.length, 1);
  const { info, provider } = seen[0];
  assert.equal(info.name, "ZeroFee");
  assert.equal(info.rdns, "si.zerofee");
  assert.match(info.icon, /^data:image\/svg\+xml;base64,/);
  assert.match(info.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(provider, p.window.ethereum);
  assert.ok(Object.isFrozen(seen[0]) && Object.isFrozen(info));
});

test("window.ethereum is ours only when no other wallet set it, and never poses as another wallet", () => {
  const other = { isOther: true };
  assert.equal(page({ ethereum: other }).window.ethereum, other);
  const p = page();
  assert.equal(p.eth.isZeroFee, true);
  assert.equal(p.eth.isMetaMask, undefined);
  assert.ok(Object.isFrozen(p.window.ethereum));
});

test("a request goes to the host as { id, method, params } only: the page never names its origin", async () => {
  const p = page({ reply: (m) => ({ id: m.id, result: m.method === "eth_requestAccounts" ? ["0x" + "ab".repeat(20)] : "0x2105" }) });
  const changes: unknown[] = [];
  p.eth.on("accountsChanged", (a: unknown) => changes.push(a));
  assert.deepEqual(await p.eth.request({ method: "eth_requestAccounts" }), ["0x" + "ab".repeat(20)]);
  assert.deepEqual(Object.keys(p.sent[0]).sort(), ["id", "method", "params"]);
  assert.deepEqual(data(p.sent[0].params), []);
  assert.deepEqual(data(changes), [["0x" + "ab".repeat(20)]]);
  assert.equal(p.eth.selectedAddress, "0x" + "ab".repeat(20));
});

test("the host's error comes back as an EIP-1193 error with its code", async () => {
  const p = page({ reply: (m) => ({ id: m.id, error: { code: 4001, message: "The person said no." } }) });
  await assert.rejects(p.eth.request({ method: "personal_sign", params: ["0x01", "0x" + "ab".repeat(20)] }), (e: { code: number; message: string }) => e.code === 4001 && e.message === "The person said no.");
  await assert.rejects(p.eth.request({}), (e: { code: number }) => e.code === -32602);
  await assert.rejects(p.eth.request({ method: "eth_call", params: [{ big: 1n }] }), (e: { code: number }) => e.code === -32602);
});

test("postMessage is taken at document start: a page that swaps it later can't intercept requests", async () => {
  const p = page();
  const stolen: unknown[] = [];
  p.handler.postMessage = async (m: Sent) => (stolen.push(m), { id: m.id, result: "stolen" });
  assert.equal(await p.eth.request({ method: "eth_chainId" }), null);
  assert.equal(stolen.length, 0);
});

test("the host's events reach the site: chain and accounts change, and disconnect empties the accounts", async () => {
  const p = page({ reply: (m) => ({ id: m.id, result: m.method === "eth_chainId" ? "0x1" : ["0x" + "cd".repeat(20)] }) });
  const events: [string, unknown][] = [];
  for (const name of ["connect", "chainChanged", "accountsChanged", "disconnect"]) p.eth.on(name, (v: unknown) => events.push([name, v]));
  await p.eth.request({ method: "eth_chainId" });
  await p.eth.request({ method: "eth_accounts" });
  const send = (event: string, data: unknown) => p.window.dispatchEvent(new CustomEvent("zerofee-wallet:event", { detail: { event, data } }));
  send("chainChanged", "0x2105");
  send("disconnect", null);
  assert.deepEqual(
    events.map(([n]) => n),
    ["connect", "accountsChanged", "chainChanged", "accountsChanged", "disconnect"],
  );
  assert.equal(p.eth.chainId, "0x2105");
  assert.equal(p.eth.selectedAddress, null);
  assert.equal((events.at(-1)?.[1] as { code: number }).code, 4900);
});

const SOL = "So11111111111111111111111111111111111111112";
const KEY = Buffer.alloc(32, 7).toString("base64");

test("Solana: registers with the Wallet Standard, now and when an app says it is ready", () => {
  const p = page();
  assert.equal(p.registered.length, 1);
  const w = p.registered[0] as { name: string; chains: string[]; features: Record<string, unknown>; accounts: unknown[] };
  assert.equal(w.name, "ZeroFee");
  assert.deepEqual(data(w.chains), ["solana:mainnet"]);
  assert.deepEqual(Object.keys(w.features).sort(), ["solana:signAndSendTransaction", "solana:signMessage", "solana:signTransaction", "standard:connect", "standard:disconnect", "standard:events"]);
  assert.equal(w.accounts.length, 0);
  const later: unknown[] = [];
  p.window.dispatchEvent(Object.assign(new Event("wallet-standard:app-ready"), { detail: { register: (x: unknown) => later.push(x) } }));
  assert.equal(later[0], w);
});

test("Solana: connect, then sign a transaction and sign-and-send, with bytes carried as base64", async () => {
  const p = page({
    reply: (m) => {
      if (m.method === "solana:connect") return { id: m.id, result: { address: SOL, publicKey: KEY } };
      if (m.method === "solana:signTransaction") return { id: m.id, result: { signedTransaction: Buffer.from([9, 9]).toString("base64") } };
      if (m.method === "solana:signAndSendTransaction") return { id: m.id, result: { signature: Buffer.alloc(64, 1).toString("base64") } };
      return { id: m.id, result: { signature: Buffer.alloc(64, 2).toString("base64") } };
    },
  });
  type F = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;
  const w = p.registered[0] as { features: F; accounts: { address: string; publicKey: Uint8Array }[] };
  const changes: unknown[] = [];
  (w.features["standard:events"] as unknown as { on: (e: string, f: (x: unknown) => void) => void }).on("change", (x) => changes.push(x));
  const { accounts } = (await w.features["standard:connect"].connect()) as { accounts: { address: string; publicKey: Uint8Array }[] };
  assert.equal(accounts[0].address, SOL);
  assert.deepEqual([...accounts[0].publicKey], [...Buffer.alloc(32, 7)]);
  assert.equal(changes.length, 1);
  const account = w.accounts[0];

  const [signed] = (await w.features["solana:signTransaction"].signTransaction({ account, transaction: new Uint8Array([1, 2, 3]), chain: "solana:mainnet" })) as { signedTransaction: Uint8Array }[];
  assert.deepEqual([...signed.signedTransaction], [9, 9]);
  assert.deepEqual(data(p.sent.at(-1)?.params), { address: SOL, transaction: "AQID", chain: "solana:mainnet" });

  const [sent] = (await w.features["solana:signAndSendTransaction"].signAndSendTransaction({ account, transaction: new Uint8Array([1]) })) as { signature: Uint8Array }[];
  assert.equal(sent.signature.length, 64);

  const [msg] = (await w.features["solana:signMessage"].signMessage({ account, message: new TextEncoder().encode("hi") })) as { signature: Uint8Array; signatureType: string }[];
  assert.equal(msg.signatureType, "ed25519");
  assert.deepEqual(data(p.sent.at(-1)?.params), { address: SOL, message: "aGk=" });
});

test("Solana: an account the site wasn't given, or another chain, is refused before anything is sent", async () => {
  const p = page({ reply: (m) => ({ id: m.id, result: { address: SOL, publicKey: KEY } }) });
  type F = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;
  const w = p.registered[0] as { features: F };
  await assert.rejects(w.features["solana:signTransaction"].signTransaction({ account: { address: SOL }, transaction: new Uint8Array([1]) }), (e: { code: number }) => e.code === 4100);
  await w.features["standard:connect"].connect();
  const before = p.sent.length;
  await assert.rejects(w.features["solana:signTransaction"].signTransaction({ account: { address: SOL }, transaction: new Uint8Array([1]), chain: "solana:devnet" }), (e: { code: number }) => e.code === 4901);
  await assert.rejects(w.features["solana:signMessage"].signMessage({ account: { address: "Other1111111111111111111111111111111111111" }, message: new Uint8Array([1]) }), (e: { code: number }) => e.code === 4100);
  assert.equal(p.sent.length, before);
});
