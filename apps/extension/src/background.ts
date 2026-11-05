// The background worker: it holds the vault, the one part of the extension that opens the trading key. It listens to two
// kinds of caller (messages.ts): the content script on a supported site, which may only say which page it is on and ask
// for the panel; and the panel, which may use the vault. It keeps, per tab, which coin the page shows, for the panel.
import { createMarket } from "@zerofee/trade/market/index.ts";
import { fromBase64 } from "@zerofee/trade/sol/bytes.ts";
import { createSolRpc } from "@zerofee/trade/sol/rpc.ts";
import { PANEL_PATH, readPageMessage, readPanelMessage, senderKind, type PanelMessage } from "./messages.ts";
import { extProblems } from "./problems.ts";
import { coinFromUrl } from "./site.ts";
import { simulatedSpend } from "./vault/spend.ts";
import { laterStore, idbStore, moveToOwnStore } from "./vault/own-store.ts";
import { AT_REST, createVault, type Store } from "./vault/vault.ts";

const store = (a: chrome.storage.StorageArea): Store => ({
  async get<T>(k: string) { return (await a.get(k))[k] as T | undefined; },
  set: (k, v) => a.set({ [k]: v }),
  remove: (k) => a.remove(k),
});

// The unlocked key lives in session storage: memory only, and never readable by content scripts.
void chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

const rpc = createSolRpc();
const market = createMarket();
const vault = createVault({
  // the sealed wallet in the extension's own IndexedDB, moved there once from chrome.storage.local (audit L26)
  local: laterStore(moveToOwnStore(store(chrome.storage.local), idbStore(indexedDB), AT_REST)),
  session: store(chrome.storage.session),
  spend: (tx, owner) => simulatedSpend(rpc, tx, owner),
  solUsd: () => market.nativeUsd("sol"),
});

export const tabKey = (tabId: number) => `tab.${tabId}`;

async function answer(m: PanelMessage): Promise<unknown> {
  switch (m.t) {
    case "vault.status": return { ok: await vault.status() };
    case "vault.create": return vault.create(m.passcode);
    case "vault.unlock": return vault.unlock(m.passcode);
    case "vault.lock": await vault.lock(); return { ok: true };
    case "vault.limit": return vault.setPerTradeUsd(m.usd, m.passcode);
    case "vault.signSol": return vault.signSol(m.tx, m.purpose, m.passcode === undefined ? {} : { passcode: m.passcode });
    case "vault.linkCode": return vault.linkCode(m.passcode, m.code);
    case "vault.unlockTouch": return vault.unlockTouch(fromBase64(m.prf));
    case "vault.touchOn": return vault.touchOn(m.passcode, { credId: m.credId, salt: fromBase64(m.salt), prf: fromBase64(m.prf) });
    case "vault.touchOff": return vault.touchOff(m.passcode);
  }
}

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  const kind = senderKind(sender, chrome.runtime.id);
  if (kind === "page") {
    const msg = readPageMessage(m, sender), tabId = sender.tab!.id!;
    // opened at once, inside the click's user gesture, which Chrome requires
    if (msg?.t === "open") void chrome.sidePanel.open({ tabId }).catch(() => undefined);
    if (msg?.t === "page") {
      // D157: the side panel is the ZeroFee app; on a supported trading site's tab it is the trading panel, as before
      void chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH.slice(1), enabled: true }).catch(() => undefined);
      void chrome.storage.session.set({ [tabKey(tabId)]: { href: msg.href, coin: coinFromUrl(msg.href) } });
    }
    return false;
  }
  if (kind === "panel") {
    const msg = readPanelMessage(m);
    if (!msg) return false;
    answer(msg).then(reply, () => reply({ problem: extProblems.stopped() }));
    return true;
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => { void chrome.storage.session.remove(tabKey(tabId)); });
