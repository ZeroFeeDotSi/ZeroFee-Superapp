import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { startBrowserWallet } from "./service.ts";

/** The host as the service sees it: it raises device.wallet.request and records what comes back. */
function host(allow: boolean) {
  const calls: [string, Record<string, unknown>][] = [];
  const handlers = new Map<string, (p: unknown) => void>();
  const store = new Map<string, string>();
  const bridge: Bridge = {
    async call<T>(method: string, params: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      calls.push([method, params]);
      const ok = (v: unknown) => ({ ok: v as T });
      if (method === "device.wallet.askConnect") return ok({ allow });
      if (method === "device.store.get") return ok({ value: store.get(String(params.key)) ?? null });
      if (method === "device.store.set") return (store.set(String(params.key), String(params.value)), ok({ ok: true }));
      if (method === "subwallet.list") return ok([]);
      if (method === "subwallet.create") return ok({ id: "browser-sol", kind: "browser", chain: "sol", address: "11111111111111111111111111111111" });
      if (method === "subwallet.site.forHost") return ok({ id: "site-host-sol", kind: "site", chain: "sol", address: "11111111111111111111111111111111" });
      return ok({ ok: true });
    },
    on<T>(event: string, handler: (p: T) => void) {
      handlers.set(event, handler as (p: unknown) => void);
      return () => handlers.delete(event);
    },
  };
  const raise = async (payload: unknown) => {
    handlers.get("device.wallet.request")?.(payload);
    await new Promise((r) => setTimeout(r, 5));
  };
  return { bridge, calls, raise, handlers };
}

test("a request from the host is answered with device.wallet.reply; the connect sheet is the host's own", async () => {
  const h = host(true);
  startBrowserWallet(h.bridge);
  await h.raise({ id: 7, method: "solana:connect", params: {}, origin: "https://pump.fun", mainFrame: true, wallet: "browser" });
  assert.equal(h.calls.find(([m]) => m === "device.wallet.askConnect"), undefined, "pump.fun's own wallet on pump.fun: no connect sheet (Social trading)");
  // a known site with no wallet of its own still gets the host's own sheet
  await h.raise({ id: 8, method: "eth_requestAccounts", params: [], origin: "https://app.mtpelerin.com", mainFrame: true, wallet: "browser" });
  const reply = h.calls.find(([m]) => m === "device.wallet.reply")?.[1] as { id: number; result: { address: string } };
  assert.equal(reply.id, 7);
  assert.equal(reply.result.address, "11111111111111111111111111111111");
});

test("a no on the host's sheet is the site's 4001; the card's window is left to Pay's engine", async () => {
  const h = host(false);
  startBrowserWallet(h.bridge);
  await h.raise({ id: 1, method: "eth_requestAccounts", params: [], origin: "https://xn--pmp-0na.fun", mainFrame: true });
  assert.equal(h.calls.find(([m]) => m === "device.wallet.askConnect")?.[1].lookAlike, true);
  assert.deepEqual(h.calls.find(([m]) => m === "device.wallet.reply")?.[1], { id: 1, error: { code: 4001, message: "The person said no." } });
  const before = h.calls.length;
  await h.raise({ id: 2, method: "eth_requestAccounts", params: [], origin: "https://app.gnosispay.com", mainFrame: true, wallet: "pay" });
  assert.equal(h.calls.length, before);
});

test("security review 2 Nov (Low): after new backup words have run, a site gets the new words' wallet, never the cached old one", async () => {
  const OLD = "11111111111111111111111111111111", NEW = "So11111111111111111111111111111111111111112";
  // pump.fun's own wallet (core site-wallets.ts): the old words' one, then the new words' one
  let list = [{ id: "w-old", kind: "site", site: "pump", chain: "sol", address: OLD }];
  const h = host(true);
  const call = h.bridge.call.bind(h.bridge);
  h.bridge.call = async <T,>(method: string, params: Record<string, unknown> = {}): Promise<BridgeResult<T>> => (method === "subwallet.list" ? (h.calls.push([method, params]), { ok: list as T }) : method === "subwallet.site.forHost" ? (h.calls.push([method, params]), { ok: list.find((w) => !(w as { oldWords?: boolean }).oldWords) as T }) : call<T>(method, params));
  startBrowserWallet(h.bridge);
  const connect = async (id: number) => {
    await h.raise({ id, method: "solana:connect", params: {}, origin: "https://pump.fun", mainFrame: true, wallet: "browser" });
    return (h.calls.filter(([m]) => m === "device.wallet.reply").at(-1)?.[1] as { result: { address: string } }).result.address;
  };
  assert.equal(await connect(1), OLD);
  // the words renewed: the old wallet is listed with oldWords and is no longer current; the new words' one is
  list = [{ ...list[0]!, oldWords: true } as never, { id: "w-new", kind: "site", site: "pump", chain: "sol", address: NEW }];
  assert.equal(await connect(2), OLD, "the control: without the event the session's wallet is kept");
  h.handlers.get("recovery.renewed")?.({});
  assert.equal(await connect(3), NEW, "after recovery.renewed: the new words' wallet");
});

test("stop() unsubscribes", () => {
  const h = host(true);
  startBrowserWallet(h.bridge).stop();
  assert.equal(h.handlers.size, 0);
});

test("a Browser tab's request (the host's auto) connects a typed site with no sheet; the same request without it asks (control)", async () => {
  const h = host(false);
  startBrowserWallet(h.bridge);
  await h.raise({ id: 1, method: "solana:connect", params: { silent: true }, origin: "https://some-dex.example", mainFrame: true, wallet: "browser", auto: true });
  assert.equal(h.calls.find(([m]) => m === "device.wallet.askConnect"), undefined, "no connect sheet");
  assert.deepEqual(h.calls.find(([m]) => m === "subwallet.site.forHost")?.[1], { chain: "sol", site: { origin: "https://some-dex.example" } });
  assert.equal((h.calls.find(([m]) => m === "device.wallet.reply")?.[1] as { result: { address: string } }).result.address, "11111111111111111111111111111111");
  await h.raise({ id: 2, method: "solana:connect", params: {}, origin: "https://other-dex.example", mainFrame: true, wallet: "browser" });
  assert.equal(h.calls.find(([m]) => m === "device.wallet.askConnect")?.[1].host, "other-dex.example");
  assert.deepEqual(h.calls.filter(([m]) => m === "device.wallet.reply").at(-1)?.[1], { id: 2, error: { code: 4001, message: "The person said no." } });
});
