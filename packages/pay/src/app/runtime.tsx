// One payment engine and one contact book per bridge, shared by every Pay screen. Both stay on the phone: the engine
// talks only to the bridge, the contacts only to device.store.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import { ContactBook } from "../contacts.ts";
// The public web build has no card (Coming soon): the card list loads only where cards exist, so its code never ships
// there (apps/web/deploy-app.sh: no "etherfi-cash" in the public bundle).
const PUBLIC = import.meta.env?.VITE_ZEROFEE_PUBLIC === "1";
import type { Balance } from "@zerofee/wallet/types.ts";
import { PayFlow } from "../pay.ts";

interface Runtime {
  bridge: Bridge;
  flow: PayFlow;
  contacts: ContactBook | null;
  balances: Balance[];
  /** True once balances have been read (answered or not), so a fully named link can choose Confirm or Send. */
  balancesRead: boolean;
  self?: string;
  /** True once the token list is in, so a link naming a coin can be read. */
  ready: boolean;
  /** Whether there can be a card here: this build proves a card's address on its chain, and it isn't a child's account
   * (D30: no card wallet on a child's phone; the core refuses it too). If not, the card is off screen (D13). */
  cardLive: boolean;
  /** Read balances again after a payment. */
  refresh: () => void;
}

const Ctx = createContext<Runtime | null>(null);

export function PayProvider({ bridge, children }: { bridge: Bridge; children: ReactNode }) {
  // Paying from a different coin stays off until 1Click funding by mt_transfer is proven on mainnet (plan.ts).
  const flow = useMemo(() => new PayFlow({ bridge, anyCoin: false }), [bridge]);
  const [contacts, setContacts] = useState<ContactBook | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [balancesRead, setBalancesRead] = useState(false);
  const [self, setSelf] = useState<string>();
  const [tick, setTick] = useState(0);
  const [ready, setReady] = useState(false);
  const [cardCheck, setCardCheck] = useState(false);
  /** A child's account (account.state.kid, the core's word, never the page's): no card (D30). */
  const [kid, setKid] = useState(false);
  // The card shows where a card can be added here: one this build can prove (card.check), or a hand-off card, which
  // its first small top-up checks instead (D35). Never on a child's account.
  const [handOff, setHandOff] = useState(false);
  const cardLive = !PUBLIC && (cardCheck || handOff) && !kid;

  useEffect(() => {
    let live = true;
    void flow.warm().then(() => live && setReady(true));
    if (!PUBLIC) void import("../partners/cards.ts").then(({ CARDS, cardCheckLive }) => {
      if (live) setHandOff(CARDS.some((c) => c.handOff));
      void cardCheckLive(bridge).then((yes) => live && setCardCheck(yes));
    }, () => undefined);
    void ContactBook.open(bridge).then((r) => live && "ok" in r && setContacts(r.ok));
    void bridge.call<{ account?: { accountId: string }; kid?: true }>("account.state").then((r) => {
      if (!live || !("ok" in r)) return;
      setSelf(r.ok.account?.accountId);
      setKid(r.ok.kid === true);
    });
    const off = bridge.on("ledger.balancesChanged", () => setTick((t) => t + 1));
    return () => {
      live = false;
      off();
    };
  }, [bridge, flow]);

  useEffect(() => {
    let live = true;
    void bridge.call<Balance[]>("ledger.balances").then((r) => {
      if (!live) return;
      if ("ok" in r) setBalances(r.ok);
      setBalancesRead(true);
    });
    if (tick > 0) void flow.warm();
    return () => {
      live = false;
    };
  }, [bridge, flow, tick]);

  useEffect(() => () => flow.close(), [flow]);

  const value = useMemo(() => ({ bridge, flow, contacts, balances, balancesRead, self, ready, cardLive, refresh: () => setTick((t) => t + 1) }), [bridge, flow, contacts, balances, balancesRead, self, ready, cardLive]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePay(): Runtime {
  const rt = useContext(Ctx);
  if (!rt) throw new Error("usePay() is only available inside <PayProvider>");
  return rt;
}
