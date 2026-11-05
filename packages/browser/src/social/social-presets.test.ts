// Apps' apps (catalog.ts; app id "social"): on each, the page sees a wallet named "ZeroFee" (Wallet Standard and EIP-6963, from the
// one pinned provider.js), Connect reaches the engine as that known site, and a trade goes to the core as a signature of
// your Solana wallet (one per chain, D55) with the site's own origin, so the core's sheet says "<site> asks".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { createWalletEngine, type SiteRule, type WalletReply } from "../engine/engine.ts";
import { base58Encode } from "../engine/codec.ts";
import { PRESETS } from "../presets.ts";
import { siteRules } from "../sites.ts";
import { CATALOG } from "./catalog.ts";

const SOCIAL = CATALOG.map((a) => a.id);
const source = readFileSync(new URL("../provider/provider.js", import.meta.url), "utf8");
const SOL_ADDR = base58Encode(new Uint8Array(32).fill(7));

/** A page in wallet mode on `host`, as the iPhone host makes it: provider.js in the page world, the handler present. */
function page() {
  const window = new EventTarget() as EventTarget & Record<string, unknown>;
  window.webkit = { messageHandlers: { zerofeeWallet: { postMessage: async (m: { id: number }) => ({ id: m.id, result: null }) } } };
  window.top = window;
  const registered: { name: string; chains: string[] }[] = [];
  window.addEventListener("wallet-standard:register-wallet", (e) => (e as unknown as { detail: (api: unknown) => void }).detail({ register: (w: { name: string; chains: string[] }) => registered.push(w) }));
  const announced: { info: { name: string; rdns: string } }[] = [];
  window.addEventListener("eip6963:announceProvider", (e) => announced.push((e as CustomEvent).detail));
  vm.runInNewContext(source, { window, CustomEvent, Event, btoa, atob, crypto, setTimeout, Uint8Array, ArrayBuffer, Error, JSON, Object, Promise, Map, Set, String, Number, Array, Boolean });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  return { registered, announced, eth: window.ethereum as { isZeroFee?: boolean } | undefined };
}

for (const id of SOCIAL) {
  const preset = PRESETS.find((p) => p.id === id)!;
  const host = preset.hosts[0]!;

  test(`${preset.name}: the page sees a wallet named ZeroFee, on Solana, and only ZeroFee`, () => {
    const p = page();
    assert.deepEqual(p.registered.map((w) => w.name), ["ZeroFee"]);
    assert.ok(p.registered[0]!.chains.includes("solana:mainnet"));
    assert.ok(p.announced.length >= 1 && p.announced.every((a) => a.info.name === "ZeroFee" && a.info.rdns === "si.zerofee"));
    assert.equal(p.eth?.isZeroFee, true);
  });

  test(`${preset.name}: Connect on https://${host} gives the site's own wallet with no sheet (Social trading), and a trade is that wallet's, on the core's sheet, with the site's origin`, async () => {
    assert.ok(preset.chains.includes("sol"), "Solana: the wallet every app uses there");
    const calls: [string, Record<string, unknown>][] = [];
    const store = new Map<string, string>();
    const wallets: { id: string; kind: string; chain: string; address: string; site?: string; current?: boolean }[] = [];
    const bridge: Bridge = {
      async call<T>(method: string, params: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
        calls.push([method, params]);
        const ok = (v: unknown) => ({ ok: v as T });
        if (method === "device.store.get") return ok({ value: store.get(String(params.key)) ?? null });
        if (method === "device.store.set") return (store.set(String(params.key), String(params.value)), ok({ ok: true }));
        if (method === "subwallet.list") return ok(wallets.filter((w) => !params.kind || w.kind === params.kind));
        if (method === "subwallet.create") {
          // as the core: { kind: "site", site } is that site's own wallet (site-wallets.ts); { chain } the chain's one wallet
          const kind = String(params.kind ?? (params.chain === "sol" ? "trade" : "browser"));
          const w = { id: kind === "site" ? `site-${params.siteId}-${params.chain}` : `${kind}-${params.chain}`, kind, chain: String(params.chain), address: params.chain === "sol" ? SOL_ADDR : "0x" + "ba".repeat(20), ...(kind === "site" ? { site: String(params.siteId) } : { current: true }) };
          wallets.push(w);
          return ok(w);
        }
        if (method === "subwallet.site.forHost") {
          // as the core (audit C1): a listed site's own fixed wallet, by its exact host
          const host = new URL(String((params.site as { origin: string }).origin)).host;
          const siteId = ({ "pump.fun": "pump", "gmgn.ai": "gmgn" } as Record<string, string>)[host] ?? `host:${host}`;
          const id = `site-${siteId}-${params.chain}`;
          const w = wallets.find((x) => x.id === id) ?? { id, kind: "site", chain: String(params.chain), address: params.chain === "sol" ? SOL_ADDR : "0x" + "ba".repeat(20), site: siteId };
          if (!wallets.includes(w)) wallets.push(w);
          return ok(w);
        }
        if (method === "subwallet.sign") return ok({ status: "done", txHash: base58Encode(new Uint8Array(64).fill(3)), explorerUrl: "" });
        return { problem: { code: "x", whatHappened: "No.", money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } };
      },
      on: () => () => {},
    };
    const asked: [string, SiteRule][] = [];
    const engine = createWalletEngine({ bridge, site: siteRules({}), emit: () => {}, askConnect: async (h, rule) => (asked.push([h, rule]), true) });
    const ask = (method: string, params?: unknown) => engine.handle({ id: 1, method, params, origin: `https://${host}`, mainFrame: true });
    const account = (await ask("solana:connect", {})) as WalletReply;
    assert.ok("result" in account, JSON.stringify(account));
    assert.equal((account.result as { address: string }).address, SOL_ADDR);
    assert.deepEqual(asked, [], "its own wallet on its own site: no connect sheet");
    const sent = (await ask("solana:signAndSendTransaction", { address: SOL_ADDR, transaction: "AQID" })) as WalletReply;
    assert.ok("result" in sent, JSON.stringify(sent));
    const sign = calls.find(([m]) => m === "subwallet.sign")!;
    assert.equal(sign[1].id, `site-${id}-sol`, "the site's own wallet (product decision, 2 Nov, B24), never the one Trade and Chat use");
    assert.deepEqual(sign[1].site, { origin: `https://${host}` }, "the core's sheet says who asks");
    assert.ok(!calls.some(([m]) => m.startsWith("tx.") || m.startsWith("ledger.")), "the main balance is never asked");
  });
}

test("the Browser's fomo opens in its own app; pump.fun and GMGN as phones, in ZeroFee's window", () => {
  const by = Object.fromEntries(PRESETS.map((p) => [p.id, p]));
  assert.equal(by.fomo!.ownApp, true);
  assert.ok(!by.fomo!.desktop, "never the computer page shrunk");
  assert.ok(!by.pump!.desktop && !by.gmgn!.desktop && !by.pump!.ownApp && !by.gmgn!.ownApp);
  assert.deepEqual(by.gmgn!.hosts, ["gmgn.ai"]);
});
