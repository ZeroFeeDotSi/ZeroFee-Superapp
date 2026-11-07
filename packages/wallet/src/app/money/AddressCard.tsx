// Home's address card (HomeActions.addressCard, D127, D138): at the top of a wallet's tab, the same single row as Add's
// ("SOL wallet": a tap copies its ONE-TIME private address, a QR icon opens it full screen). The address is from Add
// (subwallet.add.quote: 1Click's address on the chain, the money through the NEAR wallet's private balance, then on to
// this wallet); never the wallet's own public address. The same address each time the tab opens (its key kept on this
// phone's sealed store, add-coins.ts cardKey) until the core says it can take no more; then a new one at once (addStep). Loaded after Home's first paint:
// Home's first load never carries it.
import { useEffect, useState } from "react";
import type { AddAddress, AddChain } from "@zerofee/core/add-outside";
import { useWallet } from "../runtime.tsx";
import { addRows, cardKey, keepCardKey } from "./add-coins.ts";
import { AddressRow, QrSheet } from "./AddSheet.tsx";
import { homeProof } from "./home-proof.ts";
import { addCardStore, addCardsSealed, sealAddCards } from "./add-keep.ts";

// row 16: the kept key lives in Home's sealed store (add-keep.ts); the card waits for it before it picks one
const store = addCardStore;

export function AddressCard({ wallet, proof = homeProof() }: { wallet: AddChain; proof?: boolean }) {
  // D125: off until the $1 proof passes: no card at all (never the wallet's public address)
  return proof ? <Sealed wallet={wallet} /> : null;
}

function Sealed({ wallet }: { wallet: AddChain }) {
  const { bridge } = useWallet();
  const [ready, setReady] = useState(addCardsSealed);
  useEffect(() => { if (!ready) void sealAddCards(bridge).finally(() => setReady(true)); }, []);
  return ready ? <Card wallet={wallet} /> : null;
}

function Card({ wallet }: { wallet: AddChain }) {
  const { bridge } = useWallet();
  const row = addRows().find((r) => r.chain === wallet);
  // the kept key; the core itself refuses it once money reached its address or it ran out (ADD_USED, review H1), and the
  // row then asks with a new key at once (addStep): never Home's on-the-way line, which forgets an Add after an hour
  const [key] = useState(() => cardKey(store(), wallet, new Set()));
  const [qr, setQr] = useState<{ a: AddAddress } | null>(null);
  // a wallet whose Add isn't open yet (NEAR, BNB): no card at all
  if (!row || !key) return null;
  return (
    <>
      <div className="wl-addlist wl-addcard" data-testid="address-card">
        <AddressRow key={key} bridge={bridge} row={row} to="wallet" slot={wallet} initialKey={key} onQr={(a) => setQr({ a })} onGone={(gone) => setQr((q) => (q?.a.depositAddress === gone ? null : q))} onAddress={(k, a) => keepCardKey(store(), wallet, k, Date.parse(a.untilIso), a.depositAddress)} />
      </div>
      {qr && <QrSheet row={row} to="wallet" a={qr.a} onClose={() => setQr(null)} />}
    </>
  );
}
