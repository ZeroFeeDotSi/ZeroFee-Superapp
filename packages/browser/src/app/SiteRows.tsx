// Sites that can see the Browser wallet's address, one line each with Disconnect (Security's C.5: removable in
// Settings). The Browser's Sites tab uses these rows, and so does the shell's Settings screen, which renders
// <ConnectedSiteRows bridge={forApps(bridge, "browser")} />: the connections live in the Browser's own device.store, so
// it reads them as the Browser. Disconnecting tells an open page at once (accountsChanged [], Solana's change).
import { useEffect, useMemo, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import type { SpendingWallet } from "@zerofee/core/spending";
import type { Connection } from "../engine/engine.ts";
import { presetForHost } from "../presets.ts";
import { browserSites } from "../service.ts";
import { CHAIN, Logo, PRESET_LOGO, when } from "./chains.tsx";
import { siteWalletLines, type SiteWalletLine } from "./site-wallet-lines.ts";
import "./browser.css";

/** The connections, reloaded when `active` turns on; null while loading. */
export function useConnections(bridge: Bridge, active = true) {
  const sites = useMemo(() => browserSites(bridge), [bridge]);
  const [list, setList] = useState<Connection[] | null>(null);
  const reload = () => void sites.connections().then(setList);
  useEffect(() => {
    if (active) reload();
  }, [active, sites]);
  const disconnect = (host: string) => void sites.disconnect(host).then(reload);
  return { list, disconnect };
}

export function SiteRow({ site, onDisconnect }: { site: Connection; onDisconnect: () => void }) {
  return (
    <div className="zf-row">
      <Logo src={PRESET_LOGO[presetForHost(site.host)?.id ?? ""] ?? CHAIN[site.chain]?.logo} />
      <span>
        <div className="t">{site.host}</div>
        <div className="d">{CHAIN[site.chain]?.name ?? ""} · since {when(site.sinceIso)}</div>
      </span>
      <button className="zf-link br-quiet" onClick={onDisconnect}>Disconnect</button>
    </div>
  );
}

/** For the shell's Settings: each site's own wallet (read from Spending's list), then the connected sites; one line only
 *  when there is neither. */
export function ConnectedSiteRows({ bridge }: { bridge: Bridge }) {
  const { list, disconnect } = useConnections(bridge);
  const [wallets, setWallets] = useState<SiteWalletLine[] | null>(null);
  useEffect(() => {
    let live = true;
    void bridge.call<SpendingWallet[]>("spending.wallets").then((r) => live && setWallets("ok" in r && Array.isArray(r.ok) ? siteWalletLines(r.ok) : []), () => live && setWallets([]));
    return () => { live = false; };
  }, [bridge]);
  if (!list || !wallets) return null;
  if (!list.length && !wallets.length) return <p className="zf-small">No site is signed in yet.</p>;
  return (
    <>
      {wallets.map((l) => <div className="zf-row" key={l.id} data-testid="site-wallet-line"><span><div className="t">{l.title}</div><div className="d">{l.line}</div></span></div>)}
      {list.map((c) => (
        <SiteRow key={c.host} site={c} onDisconnect={() => disconnect(c.host)} />
      ))}
    </>
  );
}
