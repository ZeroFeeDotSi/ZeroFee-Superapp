// The Browser's listener for a Browser tab's Top up (the Browser thesis, part 2): the rules are top-up-host.ts's.
import { useEffect, useRef } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { showPage } from "./tabs.ts";
import { TOPUP_HOST_EVENT, topUpHandler, type WalletRow } from "./top-up-host.ts";

/** The Browser's listener (mounted with the Browser's page, HubRoot): `browser` is the Browser engine's bridge, where its
 *  tabs are. */
export function useTopUpHost(browser: Bridge | undefined): void {
  const shell = useShell();
  const onScreen = useRef(shell.active);
  onScreen.current = shell.active;
  const { bridge, openMoney } = shell;
  useEffect(() => {
    if (!browser) return;
    const handle = topUpHandler({
      onScreen: () => onScreen.current,
      wallets: async () => {
        const r = await bridge.call<WalletRow[]>("spending.wallets");
        return "ok" in r ? r.ok : null;
      },
      siteWallet: async (host) => {
        const r = await bridge.call<{ id: string }>("subwallet.site.forHost", { chain: "sol", site: { origin: `https://${host}` } });
        return "ok" in r && typeof r.ok?.id === "string" ? r.ok.id : null;
      },
      openMoney,
      showTab: (id) => showPage(browser, id),
      went: (host) => void browser.call("device.site.money", { host, went: true }).catch(() => undefined),
    });
    return browser.on(TOPUP_HOST_EVENT, (e) => void handle(e));
  }, [browser, bridge, openMoney]);
}
