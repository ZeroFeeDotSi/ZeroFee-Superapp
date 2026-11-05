// The Pay app: its tray (Scan, Send, Cash, Card), and Confirm, Paid, Request and the waits as pushed screens (Back, no
// tray, so a payment can't be left half-way). Every Problem goes to the shell's Problem screen; its next step is
// followed here. Pay owns every outward move (D12): Wallet's Send opens this app on "send".
import { useEffect, useRef, useState } from "react";
import type { NextStep, Problem } from "@zerofee/core/problem";
import { Mark } from "@zerofee/design/Mark.tsx";
import { isPositive } from "@zerofee/design/keypad.ts";
import type { AppModule } from "@zerofee/shell-api/app-module.ts";
import { AppFrame, PushedFrame, useShell, type TrayItem } from "@zerofee/shell-api/AppFrame.tsx";
import type { Confirm, Step } from "../pay.ts";
import type { PayTarget } from "../plan.ts";
import { payProblems } from "../pay-problems.ts";
import { verifySellReturn } from "../partners/ramps.ts";
import { targetForSend } from "../send.ts";
import { SAFE_WAIT, payingText, screenDecimals, shown, shownFor } from "./format.ts";
import { chainName } from "../chains.ts";
import { TrayReceive, TrayScan, TraySend } from "./icons.tsx";
import { PayProvider, usePay } from "./runtime.tsx";
import { CardTab } from "./screens/Card.tsx";
import { Cash, SELL_ORDERS, type SellExpected } from "./screens/Cash.tsx";
import { ConfirmView } from "./screens/Confirm.tsx";
import { Arrived, NotArrived, OnHold, Paid } from "./screens/Paid.tsx";
import { fullyNamed, prefillFromLink, type Prefill } from "./links.ts";
import { ReceiveScreen } from "@zerofee/wallet/app/ReceiveScreen.tsx";
import type { Chain } from "@zerofee/wallet/types.ts";
import { BankTile } from "./screens/BankTile.tsx";
import { Home, type Asking, type Tile } from "./screens/Home.tsx";
import { countryFor, loadCountry, saveCountry, type Provider } from "../countries.ts";
import { addPending, addSent, forgetSent, loadSent, settlePending } from "../receipts.ts";
import { answerArrived, ledgerFor, recordBuy } from "../checkout.ts";
import { BANK_TILE_ON, REGISTRY } from "../registry.ts";
import { Checkout, NO_UNDO } from "./screens/Checkout.tsx";
import type { CardProduct } from "../partners/cards.ts";
import type { ExchangePreset } from "../partners/exchange.ts";
import { CountryStep } from "./screens/Country.tsx";
import { Offers } from "./screens/Offers.tsx";
import { Cost } from "./screens/Cost.tsx";
import { loadBank, type SavedBank } from "../partners/banks.ts";
import { CARDS, confirmFirstTopUp, loadCard, loadCards, moneyBackAsset, rememberForgotten, rememberTopUp, type SavedCard } from "../partners/cards.ts";
import { Request } from "./screens/Request.tsx";
import { Scan } from "./screens/Scan.tsx";
import { Send, type SendIntent } from "./screens/Send.tsx";
import type { RecentPerson } from "./recent.ts";
import { AmountAsk, CoinSheet, NetworkSheet, WebSheet } from "./screens/Sheets.tsx";
import { BankConfirm, BankHandoff, BankOnly, BankPaid, BankPayIn, BankSent } from "./screens/Bank.tsx";
import { ExchangeTile } from "./screens/ExchangeTile.tsx";
import { answerExchangeArrived, exchangeTarget, loadExchange, presetFor, rememberExchangeSend, type SavedExchange } from "../partners/exchange.ts";
import { BANK_PARTNER, markBankPaid, payInTarget, type BankBill } from "../bank.ts";
import "./pay.css";

// D29: Home is the app; the tray is three actions, Scan on the right. Everything else opens on top of Home with Back.
type Tab = "home" | "send" | "receive" | "scan" | "card" | "bank" | "exchange" | "cash" | "voucher";
type TrayId = "send" | "receive" | "scan";
const TRAY: TrayItem<TrayId>[] = [
  { id: "send", label: "Send", icon: TraySend },
  { id: "receive", label: "Receive", icon: TrayReceive },
  { id: "scan", label: "Scan", icon: TrayScan },
];
const TABS: Tab[] = ["home", "send", "receive", "scan", "card", "bank", "exchange", "cash", "voucher"];
const TITLES: Record<Exclude<Tab, "home">, string> = { send: "Send", receive: "Receive", scan: "Scan", card: "Card", bank: "Bank", exchange: "Exchange", cash: "Cash", voucher: "Gift cards" };

type Verb = "Pay" | "Send" | "Top up";
type View =
  | { kind: "tabs" }
  /** `hidden`: the money left Hidden, not the Safe (its On its way line says so). */
  | { kind: "wait"; text: string; detail?: string; hidden?: boolean }
  | { kind: "amount"; symbol: string; decimals: number }
  | { kind: "confirm"; c: Confirm; changed?: boolean }
  /** `home`: a test went through; Done goes Home, where its tile asks "did it arrive?". */
  | { kind: "paid"; step: Extract<Step, { kind: "paid" }>; ms?: number; home?: boolean }
  | { kind: "held"; step: Extract<Step, { kind: "held" }> }
  | { kind: "request" }
  | { kind: "country"; first?: boolean }
  | { kind: "offers" }
  | { kind: "cost"; provider: Provider }
  | { kind: "voucher-arrived"; id: string }
  | { kind: "voucher-refund"; id: string }
  | { kind: "bank-only"; title: string; detail?: string }
  | { kind: "arrived"; amount: string; card: string; productId: SavedCard["productId"] }
  /** "No, it didn't": a card's (productId), or an exchange's (`exchange`: its preset, null for one of the person's own). */
  | { kind: "not-arrived"; card: string; address: string; url: string; productId?: SavedCard["productId"]; exchange?: ExchangePreset["id"] | null }
  /** A test send to a new exchange address went through: did it arrive? (UI's product call, Security's SHOULD) */
  | { kind: "exchange-arrived"; amount: string; name: string }
  | { kind: "bank"; bill: BankBill; stage: "confirm" | "handoff" | "pay-in"; opened?: boolean }
  | { kind: "bank-sent"; bill: BankBill; step: Extract<Step, { kind: "paid" }> }
  | { kind: "bank-paid"; bill: BankBill; step: Extract<Step, { kind: "paid" }>; relabelled: boolean };

function PayScreens() {
  const shell = useShell();
  const { bridge, flow, refresh, contacts, ready, self, cardLive, balances, balancesRead } = usePay();
  const [cashKind, setCashKind] = useState<"buy" | "sell">("buy");
  /** Several cards side by side (D38), one per product. */
  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  /** The card a top-up is for (its "did it arrive?" and its next amount are that card's own). */
  const toppingUp = useRef<SavedCard["productId"] | null>(null);
  /** The gate (D38): until a card, bank account or exchange is set up, Pay opens on "What's available", never Home. */
  const [providersRead, setProvidersRead] = useState(false);
  const [savedBank, setSavedBank] = useState<SavedBank | null>(null);
  const [savedExchange, setSavedExchange] = useState<SavedExchange | null>(null);
  /** A send to the person's own exchange is in flight: when it lands, the next one starts from it. */
  const toExchange = useRef(false);
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  /** The shop picked in "What's available" (kind voucher), and the one a checkout payment is for. */
  const [voucherId, setVoucherId] = useState<string | undefined>();
  const checkoutFor = useRef<string | null>(null);
  /** Re-reads a shop's caps after the person's answer. */
  const [checkoutKey, setCheckoutKey] = useState(0);
  /** Shops bought from on this phone (Pay's receipts): each is a provider on Home, and passes the gate. */
  const [vouchers, setVouchers] = useState<string[]>([]);
  /** The provider a card top-up or exchange send is for: its receipt is kept once it goes through (Home's "sent so far"). */
  const sendingTo = useRef<string | null>(null);
  /**
   * A test (a new card, shop or exchange address) that went out: "did it arrive?" is asked only when the person comes
   * back from the provider's page, or taps its tile; never by itself (the robot's pass 3). `asks` shows on Home's tiles
   * at once, `askOnReturn` waits for device.returned, `left` is a Done on "On its way" (the result then shows nothing).
   */
  const [asks, setAsks] = useState<Asking[]>([]);
  const askOnReturn = useRef<Asking | null>(null);
  const waitAsk = useRef<Asking | null>(null);
  const left = useRef(false);
  const [reload, setReload] = useState(0);
  const answered = (id: string) => {
    setAsks((a) => a.filter((x) => x.id !== id));
    if (askOnReturn.current?.id === id) askOnReturn.current = null;
  };
  const keepReceipt = async (step: Extract<Step, { kind: "paid" | "held" }>) => {
    const id = sendingTo.current;
    sendingTo.current = null;
    if (!id) return;
    const { amount, token } = step.confirm.target;
    // On hold: pending until the hold runs (a cancel never counts, Security on 0af02c9).
    if (step.kind === "held" && step.held) return addPending(bridge, step.held.id, id, amount, token.symbol);
    if (step.kind === "paid") await addSent(bridge, id, amount, token.symbol);
  };
  useEffect(() => bridge.on<{ id: string; ended: string }>("account.waiting.ended", ({ id, ended }) => void settlePending(bridge, id, ended === "ran")), [bridge]);
  /** Someone new from Send, saved as a person once the send goes through (paid or on hold), never before. */
  const newPerson = useRef<{ name: string; recipient: SendIntent["recipient"] } | null>(null);
  const saveNewPerson = async () => {
    const p = newPerson.current;
    newPerson.current = null;
    if (!p || !contacts) return;
    const saved = await contacts.add(p.name, p.recipient);
    if ("ok" in saved) await contacts.markPaid(saved.ok.id);
  };
  /** Add money for a shortfall: Receive opens on that coin's own network, saying how much and to come back. */
  const [receiveFor, setReceiveFor] = useState<{ chain: string; amount: string; symbol: string; tokenId: string; ok?: boolean } | undefined>();
  /**
   * Money back from a provider (D38): Receive on its network, with the provider's own page one tap away. Only where
   * Receive's address really takes that coin on that network (ledger.chains: the network is there and credits the
   * coin, Security's MUSTs 1–2 on 61fcaef); otherwise just "Open X" and why. Nothing is ever sent to a guess.
   */
  const [withdrawFrom, setWithdrawFrom] = useState<{ name: string; url: string; chain: string; coin: string; ok: boolean; back: Tab; asset?: string } | undefined>();
  /** Receive takes this coin on this network: a card's by its pinned contract only (moneyBackAsset), else by symbol. */
  const receives = async (chainId: string, symbol: string, cardId?: CardProduct["id"]): Promise<boolean> => {
    const r = await bridge.call<Chain[]>("ledger.chains");
    const net = "ok" in r && Array.isArray(r.ok) ? r.ok.find((c) => c.id === chainId) : undefined;
    const asset = !flow.tokens ? undefined : cardId ? moneyBackAsset(cardId, symbol, flow.tokens) : flow.tokens.find(chainId, { symbol })?.assetId;
    return Boolean(net && asset && net.coins.includes(asset));
  };
  const takeOut = async (from: { name: string; url: string; chain: string; coin: string; cardId?: CardProduct["id"] }) => {
    // Back returns to the card or exchange it came from, not Home (the robot's walk): that same card.
    if (from.cardId) setCardStart(from.cardId);
    // The coin it sends back, so Receive's address and minimum are for it (USDC, in dollars), never the network's ETH.
    const asset = !flow.tokens ? undefined : from.cardId ? moneyBackAsset(from.cardId, from.coin, flow.tokens) : flow.tokens.find(from.chain, { symbol: from.coin })?.assetId;
    setWithdrawFrom({ ...from, ok: await receives(from.chain, from.coin, from.cardId), back: tab, ...(asset ? { asset } : {}) });
    setTab("receive");
  };
  /** The person's bank country (D36): an ISO code, "ZZ" anywhere else, null before they're asked. */
  const [country, setCountry] = useState<string | null>(null);
  /** Opened from "What's available": the card or exchange picked there. */
  const [cardStart, setCardStart] = useState<CardProduct["id"] | undefined>();
  /** "Try another address": the card's paste step straight away (no sign-up, no other card). */
  const [cardRetry, setCardRetry] = useState(false);
  const [exchangeStart, setExchangeStart] = useState<ExchangePreset["id"] | undefined>();
  /** Someone tapped in Home's Recent: Send opens with them picked. */
  const [person, setPerson] = useState<RecentPerson | null>(null);
  const handledLink = useRef<string | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("home");
  const [view, setView] = useState<View>({ kind: "tabs" });
  const [sheet, setSheet] = useState<null | { kind: "coin"; c: Confirm } | { kind: "network"; networks: string[]; send?: SendIntent } | { kind: "web"; url: string }>(null);
  const verb = useRef<Verb>("Pay");
  const fromScan = useRef(true);
  const last = useRef<(() => Promise<Step>) | null>(null);
  const pendingSell = useRef<SellExpected | null>(null);
  /** The bank bill the USDC now going to Mt Pelerin pays: its arrival there is "On its way", never Paid. */
  const paying = useRef<BankBill | null>(null);

  const tabs = () => {
    paying.current = null;
    toExchange.current = false;
    setView({ kind: "tabs" });
  };
  const open = (url: string) => void bridge.call("device.openUrl", { url, mode: "sheet" });

  /** A place in Pay by any of its names (a Problem's next step, another app's request). */
  const go = (place: string) => {
    if (place === "request") return setView({ kind: "request" });
    if (place === "cash-in" || place === "cash") {
      setCashKind("buy");
      return setTab("cash");
    }
    // No card here (a child's account, or no card check in this build): the card's page isn't a place to go.
    if (place === "card" && !cardLive) return setTab("home");
    if (TABS.includes(place as Tab)) setTab(place as Tab);
  };
  /** A Problem's "fix it" step: the field it names comes back empty, so the person can paste it again (robot pass 4). */
  const [fix, setFix] = useState<{ field: string; n: number }>({ field: "", n: 0 });
  const follow = (next: NextStep) => {
    if (next.kind === "fix-input") setFix((f) => ({ field: next.field, n: f.n + 1 }));
    if (next.kind === "open") {
      go(next.screen);
      return tabs();
    }
    if (next.kind === "retry" && last.current) return void run(last.current);
    tabs();
  };
  // No card here (a child's account, D30): a Problem never offers "Pay with my card"; it says Go back instead.
  const problem = async (p: Problem) =>
    follow(await shell.showProblem(!cardLive && p.next.kind === "open" && p.next.screen === "card" ? { ...p, next: { kind: "nothing", label: "Go back" } } : p));

  const handle = async (step: Step): Promise<void> => {
    switch (step.kind) {
      case "confirm":
        return setView({ kind: "confirm", c: step.confirm, changed: step.changed });
      case "ask":
        if (step.field === "network") {
          setView({ kind: "tabs" });
          return setSheet({ kind: "network", networks: step.networks ?? [] });
        }
        return setView({ kind: "amount", symbol: step.symbol ?? step.token?.symbol ?? "", decimals: step.token ? screenDecimals(step.token) : 2 });
      case "bank":
        // A bank code Mt Pelerin can pay from the person's own personal IBAN (M3).
        paying.current = null;
        return setView({ kind: "bank", bill: step.bill, stage: "confirm" });
      case "open":
        // A code that is a web page: say which site, and open it only if the person says so (Security).
        tabs();
        return setSheet({ kind: "web", url: step.url });
      case "problem":
        tabs();
        // A bank code Pay can't pay: the product's two ways, your exchange (into your own bank) or your card.
        if (step.problem.code === "pay.code.bank-only") {
          void loadExchange(bridge).then(setSavedExchange);
          return setView({ kind: "bank-only", title: step.problem.whatHappened, detail: step.problem.more?.replace(/^You pay bank codes with your card\. ?/, "") });
        }
        // Sending, topping up or cashing out: a missing coin's next step is adding money, not the card (ALPHA (4)).
        if (step.problem.code === "pay.route.coin-needed" && verb.current !== "Pay") return problem({ ...step.problem, next: { kind: "open", label: "Add money", screen: "cash-in" } });
        return problem(step.problem);
      case "sent": {
        const amount = `${shownFor(step.confirm.target.amount, step.confirm.target.token)} ${step.confirm.target.token.symbol}`;
        waitAsk.current = await testAsk(amount);
        left.current = false;
        setView({ kind: "wait", text: "On its way", detail: `${amount} to ${step.confirm.payeePlain}`, ...(step.confirm.privacy?.on ? { hidden: true } : {}) });
        return handle(await flow.settle(step));
      }
      case "held":
        // Held by the account's protection: the shell's Waiting screen shows it (cancel, or run it when ready), and
        // Pay shows it as on hold. Never the Paid screen: nothing has moved.
        refresh();
        // A held payment to Mt Pelerin is on hold like any other (D17): never "On its way".
        paying.current = null;
        if (step.held) shell.showWaiting(step.held);
        await saveNewPerson();
        await keepReceipt(step);
        // A shop's purchase, or a test send to an exchange, on hold still counts against its caps (the careful side).
        if (checkoutFor.current) await recordBuy(bridge, checkoutFor.current, step.confirm.target.amount);
        checkoutFor.current = null;
        if (toExchange.current) setSavedExchange(await rememberExchangeSend(bridge, step.confirm.target.amount));
        toExchange.current = false;
        return setView({ kind: "held", step });
      case "paid": {
        refresh();
        await saveNewPerson();
        await keepReceipt(step);
        const amount = `${shownFor(step.confirm.target.amount, step.confirm.target.token)} ${step.confirm.target.token.symbol}`;
        // A test that went through: only the person can say it arrived (the chain can't prove whose an address is).
        let ask: Asking | null = null;
        if (checkoutFor.current) {
          // Paid at the shop's checkout: its code comes by email.
          const id = checkoutFor.current;
          checkoutFor.current = null;
          await recordBuy(bridge, id, step.confirm.target.amount);
          if (!(await ledgerFor(bridge, id)).confirmed) ask = { kind: "voucher", id, name: REGISTRY.find((r) => r.id === id)?.name ?? id, amount };
        }
        if (toExchange.current) {
          toExchange.current = false;
          const e = await rememberExchangeSend(bridge, step.confirm.target.amount);
          setSavedExchange(e);
          if (e && !e.confirmed) ask = { kind: "exchange", id: e.preset ?? "exchange", name: e.name, amount };
        }
        let bill: BankBill | null = null;
        if (paying.current) {
          bill = paying.current;
          paying.current = null;
        }
        if (verb.current === "Top up" && toppingUp.current) {
          const productId = toppingUp.current;
          toppingUp.current = null;
          // The next top-up starts from this one (ALPHA: one-click use).
          await rememberTopUp(bridge, step.confirm.target.amount, productId);
          const card = await loadCard(bridge, productId);
          if (card && !card.confirmed) ask = { kind: "card", id: productId, name: CARDS.find((x) => x.id === card.productId)?.name ?? "your card", amount };
        }
        if (ask) {
          const a = ask;
          askOnReturn.current = a;
          setAsks((all) => [...all.filter((x) => x.id !== a.id), a]);
        }
        // Done on "On its way": the person has moved on; Home and Recent show the result, nothing pops up.
        if (left.current) {
          left.current = false;
          setReload((k) => k + 1);
          return;
        }
        // The USDC reached Mt Pelerin: the bank transfer is still Mt Pelerin's to send, so it's on its way.
        if (bill) return setView({ kind: "bank-sent", bill, step });
        return setView({ kind: "paid", step, ms: flow.stopwatch.read().paid, home: Boolean(ask) });
      }
    }
  };
  const run = async (action: () => Promise<Step>, text = "Getting the price") => {
    last.current = action;
    setSheet(null);
    setView({ kind: "wait", text });
    let step: Step;
    try {
      step = await action();
    } catch {
      // Never stuck on a waiting screen: anything unexpected is the plain "couldn't get a price", and nothing moved.
      step = { kind: "problem", problem: payProblems.quoteFailed() };
    }
    await handle(step);
  };

  const scanned = (code: string) => {
    newPerson.current = null;
    checkoutFor.current = null;
    sendingTo.current = null;
    verb.current = "Pay";
    fromScan.current = true;
    void run(() => flow.read(code));
  };
  const payTarget = (t: PayTarget, v: Verb, payWith?: string, bill?: BankBill) => {
    newPerson.current = null;
    checkoutFor.current = null;
    sendingTo.current = null;
    paying.current = bill ?? null;
    verb.current = v;
    fromScan.current = false;
    void run(() => flow.send(t, payWith));
  };
  /**
   * A repeat action to someone already set up (a confirmed card, a saved person): one tap, then Face ID. Pay's Confirm
   * shows only when there's something to say first: a hold, the Private switch, a changed price. The approval sheet
   * still shows exactly what leaves the balance. "Waiting for Face ID" only once the Safe's sheet is next (review M4):
   * a payment Hidden can make stops on Confirm, at its Hold, and never said Face ID.
   */
  const quick = (t: PayTarget, v: Verb, payWith?: string) => {
    newPerson.current = null;
    checkoutFor.current = null;
    sendingTo.current = null;
    paying.current = null;
    verb.current = v;
    fromScan.current = false;
    void run(() => flow.sendAtOnce(t, payWith, () => setView({ kind: "wait", text: SAFE_WAIT })));
  };
  /**
   * To the person's own exchange, a card's top-up, a shop's checkout: the amount goes straight to the approval sheet,
   * which says it once, with the address in full on its Details line (the robot's walk: never the same "Pay 12.34 USDC"
   * on two screens). Confirm still comes first when it has something to say (a hold, Private, a new price).
   */
  const sendToExchange = (e: SavedExchange, amount: string) => {
    if (!flow.tokens) return void problem(payProblems.quoteFailed());
    const t = exchangeTarget(e, amount, flow.tokens);
    if ("problem" in t) return void problem(t.problem);
    quick(t.ok, "Send");
    toExchange.current = true;
    sendingTo.current = e.preset ?? "exchange";
  };
  const send = (s: SendIntent, network?: string) => {
    const tokens = flow.tokens;
    // A link with a reference is paid in the coin it names, never a stand-in.
    const coin = tokens?.byAsset(s.ref && s.askedTokenId ? s.askedTokenId : s.coin.tokenId);
    if (!tokens || !coin) return void problem(payProblems.quoteFailed());
    const t = targetForSend(s.recipient, coin, s.amount, tokens, { network, memo: s.ref, message: s.note });
    if ("problem" in t) {
      // A bare 0x address works on every EVM chain: ask which one, then build the same send again.
      if (t.ask === "network") return setSheet({ kind: "network", networks: t.networks ?? [], send: s });
      return void problem(t.problem);
    }
    if (s.contactId) void contacts?.markPaid(s.contactId);
    // Send's pill goes straight to the approval sheet, which says the amount, who (their name, the account under it) and
    // the fee: one confirmation, not two (the robot's pass 2). Pay's Confirm still comes first when it has something to
    // say (a hold, the Private switch, a changed price), and for a link's send, whose words are the link's.
    if (!s.ref && !s.askedTokenId) quick({ ...t.ok, name: s.name }, "Send", s.coin.tokenId);
    else payTarget({ ...t.ok, name: s.name, label: s.label }, "Send", s.ref && s.askedTokenId ? s.askedTokenId : s.coin.tokenId);
    // Set after the payment starts (each start clears it): saved only if this one goes through.
    if (!s.contactId && !s.ref && s.name) newPerson.current = { name: s.name, recipient: s.recipient };
  };

  // Another app asked for a tab (Wallet's Send → "send", Add money → "cash"). Every request counts, also with Pay already
  // open: the shell keeps neighbouring apps mounted and bumps requestSeq on each openApp (UI's cross-app walk).
  useEffect(() => {
    const t = shell.requestedTab;
    if (!t) return;
    setSheet(null);
    tabs();
    go(t);
  }, [shell.requestedTab, shell.requestSeq]);

  // Someone picked from Home's Recent is for that one visit to Send.
  useEffect(() => {
    if (tab !== "send") setPerson(null);
    if (tab !== "receive") {
      setReceiveFor(undefined);
      setWithdrawFrom(undefined);
    }
    if (tab === "home") {
      setCardStart(undefined);
      setCardRetry(false);
      setExchangeStart(undefined);
    }
  }, [tab]);

  // Home's tiles: what's set up, read again each time Home shows (a card or a bank saved on its page).
  useEffect(() => {
    if (tab !== "home" || view.kind !== "tabs") return;
    let live = true;
    void Promise.all([loadCards(bridge), loadBank(bridge), loadExchange(bridge), loadSent(bridge)]).then(([c, b, e, sent]) => {
      setVouchers(Object.keys(sent).filter((id) => REGISTRY.some((r) => r.id === id && r.kind === "voucher")));
      if (!live) return;
      setSavedCards(c);
      setSavedBank(b);
      setSavedExchange(e);
      setProvidersRead(true);
    });
    return () => {
      live = false;
    };
  }, [bridge, tab, view.kind, reload]);

  // First open: Pay's one question, "Where is your bank?" (D36), unless another app opened Pay to act on something.
  // Then, with money already, Home (the robot's pass 2); on an empty account, what's available there. Read once.
  const setupChecked = useRef(false);
  useEffect(() => {
    if (setupChecked.current || shell.requestedLink || shell.requestedTab || !balancesRead) return;
    setupChecked.current = true;
    void loadCountry(bridge).then((c) => {
      setCountry(c);
      if (c === null) setView({ kind: "country", first: true });
    });
  }, [bridge, shell.requestedLink, shell.requestedTab, balancesRead]);
  // After the one question: Pay's home, which is "What's available" until a provider exists (the gate, D38).
  const pickCountry = (code: string, first: boolean) => {
    void saveCountry(bridge, code);
    setCountry(code);
    if (first) return tabs();
    setView({ kind: "offers" });
  };
  const openTile = (t: Tile) => (t === "bank" && !BANK_TILE_ON ? undefined : setTab(t));
  /** A provider picked in "What's available": its own page in Pay, or, made only in its own app, its own site. */
  /** A tile's test waits for its answer: the same question as right after the send (the robot's final round). */
  /** At "sent": is this a test the person will be asked about? (So Done on "On its way" can say so on its tile at once.) */
  const testAsk = async (amount: string): Promise<Asking | null> => {
    if (checkoutFor.current) {
      const id = checkoutFor.current;
      return (await ledgerFor(bridge, id)).confirmed ? null : { kind: "voucher", id, name: REGISTRY.find((r) => r.id === id)?.name ?? id, amount };
    }
    if (toExchange.current && savedExchange && !savedExchange.confirmed) return { kind: "exchange", id: savedExchange.preset ?? "exchange", name: savedExchange.name, amount };
    const card = toppingUp.current ? await loadCard(bridge, toppingUp.current) : null;
    if (card && !card.confirmed) return { kind: "card", id: card.productId, name: CARDS.find((x) => x.id === card.productId)?.name ?? "your card", amount };
    return null;
  };
  const askAgain = (a: Asking) => {
    // Asked now: not again on the next return.
    if (askOnReturn.current?.id === a.id) askOnReturn.current = null;
    if (a.kind === "card") return setView({ kind: "arrived", amount: a.amount, card: a.name, productId: a.id as SavedCard["productId"] });
    if (a.kind === "exchange") return setView({ kind: "exchange-arrived", amount: a.amount, name: a.name });
    setView({ kind: "voucher-arrived", id: a.id });
  };
  /** Already set up: marked "Added" in What's available, and it opens its own page, not "Before you start". */
  const isAdded = (p: Provider) =>
    (p.card ? savedCards.some((c) => c.productId === p.card) : false) ||
    (p.section === "bank" && Boolean(savedBank)) ||
    (p.preset ? savedExchange?.preset === p.preset : false) ||
    (p.section === "voucher" && vouchers.includes(p.id));
  const offerPicked = (p: Provider) => (isAdded(p) ? pickProvider(p) : setView({ kind: "cost", provider: p }));
  const pickProvider = (p: Provider) => {
    tabs();
    if (p.card) {
      setCardStart(p.card);
      return setTab("card");
    }
    if (p.section === "bank") return BANK_TILE_ON ? setTab("bank") : undefined;
    if (p.section === "voucher" && p.fundable) {
      setVoucherId(p.id);
      return setTab("voucher");
    }
    if (p.preset) {
      setExchangeStart(p.preset);
      return setTab("exchange");
    }
    open(p.url);
  };

  // Another app handed Pay a payment link (openApp("pay", "send", link)): Send, filled in. Read once, when the coin
  // list is in; anything Send can't use is shown as its Problem.
  useEffect(() => {
    const link = shell.requestedLink;
    // Keyed by the request, so the same link handed over again is read again.
    const key = `${shell.requestSeq ?? 0}:${link}`;
    if (!link || key === handledLink.current || !ready || !balancesRead) return;
    handledLink.current = key;
    setTab("send");
    setView({ kind: "tabs" });
    const read = prefillFromLink(link, flow.tokens, self);
    if ("problem" in read) return void problem(read.problem);
    // Everything named (who, how much, the coin and a reference): straight to Confirm. Otherwise Send, filled in.
    const intent = fullyNamed(read.ok, balances);
    if (intent) send(intent);
    else setPrefill(read.ok);
  }, [shell.requestedLink, shell.requestSeq, ready, flow, self, balances, balancesRead]);

  // Opening Pay again with a test still unanswered ("Not yet", or a Done that left): ask it now (robot pass 4).
  const wasActive = useRef(shell.active);
  useEffect(() => {
    const opened = shell.active && !wasActive.current;
    wasActive.current = shell.active;
    if (opened && askOnReturn.current && viewKind.current === "tabs") askAgain(askOnReturn.current);
  }, [shell.active]);
  // Back from a provider's page after a test: now ask whether it arrived (only from Home or the Paid screen).
  const viewKind = useRef(view.kind);
  viewKind.current = view.kind;
  useEffect(() => bridge.on("device.returned", () => {
    const a = askOnReturn.current;
    if (a && (viewKind.current === "tabs" || viewKind.current === "paid")) askAgain(a);
  }), [bridge]);

  // A partner sends the person back after a sale in its own screens: read where to send, then the one payment.
  // The address is the partner's own record's, never the link's (iOS audit finding 2: the partner's page writes the link).
  useEffect(() => bridge.on<{ url: string }>("device.returned", async ({ url }) => {
    const expected = pendingSell.current;
    if (!expected) return;
    pendingSell.current = null;
    const read = await verifySellReturn(url, expected, SELL_ORDERS);
    if ("problem" in read) return void problem(read.problem);
    const usdc = flow.tokens?.find(read.ok.chain, { symbol: "USDC" });
    if (!usdc) return;
    payTarget({ to: { kind: "chain", chain: read.ok.chain, address: read.ok.address, ...(read.ok.memo ? { memo: read.ok.memo } : {}) }, token: usdc, amount: read.ok.amount, name: read.ok.partner === "banxa" ? "Banxa" : "MoonPay", notes: [] }, "Send");
  }), [bridge, flow]);

  let body;
  if (view.kind === "wait") {
    // Sent and settling: where the money is, and a way out (the robot's walk). What it becomes (Paid, a question)
    // still shows when it's done. A held payment never gets here: it goes to Waiting (D17).
    const going = view.text === "On its way";
    body = (
      <PushedFrame name="Pay" onBack={tabs}>
        <div className={going ? "py py-col" : "py-wait"}>
          {going && <div className="zf-fill" />}
          <div className="py-wait" style={going ? { flex: "none" } : undefined}>
            <Mark size={96} mode="loading" label={view.text} />
            <div><div className="zf-label">{view.text}</div>{view.detail && <p className="zf-small" style={{ marginTop: 8 }}>{view.detail}</p>}{going && <p className="zf-body" style={{ marginTop: 10 }}>{view.hidden ? "It has left Private." : "It has left your Safe."} It usually lands in a few minutes.</p>}</div>
          </div>
          {going && <div className="zf-fill" />}
          {going && <div className="py-floor"><button className="zf-btn" onClick={() => {
            // Moved on: the result shows on Home (a test's tile asks "did it arrive?" at once), nothing pops up later.
            left.current = true;
            const a = waitAsk.current;
            if (a) setAsks((all) => [...all.filter((x) => x.id !== a.id), a]);
            tabs();
            setTab("home");
          }}>Done</button></div>}
        </div>
      </PushedFrame>
    );
  } else if (view.kind === "amount") {
    body = <PushedFrame name="Pay" onBack={tabs}><AmountAsk symbol={view.symbol} decimals={view.decimals} onAmount={(amount) => void run(() => flow.answer({ amount }))} /></PushedFrame>;
  } else if (view.kind === "confirm") {
    const c = view.c;
    body = (
      <PushedFrame name="Pay" onBack={tabs}>
        <ConfirmView c={c} verb={verb.current} changed={view.changed} onChange={() => setSheet({ kind: "coin", c })} onPay={() => void run(() => flow.confirm(), payingText(c))} onPrivate={() => void run(() => flow.setPrivate(!c.privacy?.on))} bridge={bridge} />
      </PushedFrame>
    );
  } else if (view.kind === "paid") {
    body = (
      <PushedFrame name="Pay" onBack={tabs}>
        <Paid c={view.step.confirm} movement={view.step.movement} ms={view.ms} fromScan={fromScan.current} onDone={view.home ? () => { tabs(); setTab("home"); } : tabs} onOpen={open} />
      </PushedFrame>
    );
  } else if (view.kind === "bank-only") {
    body = (
      <PushedFrame name="Pay" onBack={tabs}>
        <BankOnly title={view.title} detail={view.detail} hasExchange={Boolean(savedExchange)} cardLive={cardLive} onExchange={() => { tabs(); setTab("exchange"); }} onCard={() => { tabs(); setTab("card"); }} />
      </PushedFrame>
    );
  } else if (view.kind === "country") {
    const first = Boolean(view.first);
    body = <PushedFrame name="Pay" onBack={() => (first ? pickCountry(country ?? "ZZ", true) : setView({ kind: "offers" }))}><CountryStep current={country} onPick={(c) => pickCountry(c, first)} /></PushedFrame>;
  } else if (view.kind === "offers") {
    body = <PushedFrame name="Pay" onBack={tabs}><Offers code={country ?? "ZZ"} kid={!cardLive} added={isAdded} onPick={offerPicked} onCountry={() => setView({ kind: "country" })} onLater={tabs} /></PushedFrame>;
  } else if (view.kind === "voucher-arrived" || view.kind === "voucher-refund") {
    const v = view;
    const shop = REGISTRY.find((r) => r.id === v.id);
    const name = shop?.name ?? "the shop";
    body = (
      <PushedFrame name="Pay" onBack={tabs}>
        {v.kind === "voucher-arrived" ? (
          <div className="py py-col">
            <div className="zf-fill" />
            <h1 className="zf-title py-center">Did your {name} code arrive, and does it work?</h1>
            <p className="zf-body py-center" style={{ marginTop: 10 }}>{name} sends it to your email.</p>
            <div className="zf-fill" />
            <div className="py-floor">
              <button className="zf-btn" onClick={async () => { await answerArrived(bridge, v.id, true); answered(v.id); tabs(); setTab("home"); }}>Yes, it works</button>
              <button className="zf-link" onClick={() => { askOnReturn.current = { kind: "voucher", id: v.id, name, amount: "" }; tabs(); setTab("home"); }}>Not yet</button>
              <button className="zf-link" onClick={async () => { await answerArrived(bridge, v.id, false); answered(v.id); setView({ kind: "voucher-refund", id: v.id }); }}>No, it didn't arrive</button>
              <p className="zf-small">Not yet? Pay asks again next time you open it.</p>
            </div>
          </div>
        ) : (
          <div className="py py-col">
            <div className="zf-fill" />
            <h1 className="zf-title py-center">Only {name} can give it back</h1>
            <p className="zf-body py-center" style={{ marginTop: 10 }}>If the code doesn't arrive or doesn't work, only {name} can give the money back. {NO_UNDO}</p>
            {shop?.facts.filter((f) => /refund/i.test(f)).map((f) => <p key={f} className="zf-small py-center" style={{ marginTop: 8 }}>{name} says: {f}</p>)}
            <div className="zf-fill" />
            <div className="py-floor">
              {shop?.refund && <button className="zf-btn" onClick={() => open(shop.refund!)}>Open {name}'s refund page</button>}
              <button className="zf-link" onClick={() => { tabs(); setTab("home"); }}>Back to Pay</button>
            </div>
          </div>
        )}
      </PushedFrame>
    );
  } else if (view.kind === "cost") {
    const p = view.provider;
    body = <PushedFrame name="Pay" onBack={() => setView({ kind: "offers" })}><Cost provider={p} onStart={() => pickProvider(p)} /></PushedFrame>;
  } else if (view.kind === "arrived") {
    body = (
      <PushedFrame name="Pay" onBack={tabs}>
        <Arrived
          amount={view.amount}
          card={view.card}
          onAnswer={async (a) => {
            // Read before the answer: a No forgets it, and the screen shows it to compare.
            const before = await loadCard(bridge, view.productId);
            const p = await confirmFirstTopUp(bridge, a, view.productId);
            if (a !== "not-yet") answered(view.productId);
            // Not yet: asked again the next time Pay opens (robot pass 4), and still on its tile meanwhile.
            else askOnReturn.current = { kind: "card", id: view.productId, name: view.card, amount: view.amount };
            // No: Pay's own plain screen, never the shell's Problem over the card's (the robot's walk).
            if (a === "no") {
              if (before) await rememberForgotten(bridge, before.productId, before.address);
              return setView({ kind: "not-arrived", card: view.card, address: before?.address ?? "", url: CARDS.find((c) => c.id === view.productId)?.signupUrl ?? "", productId: view.productId });
            }
            // Yes or Not yet: Home, its tile at once with its state (robot pass 5: no blank card screen while it loads).
            setTab("home");
            tabs();
            if (p) void problem(p);
          }}
        />
      </PushedFrame>
    );
  } else if (view.kind === "exchange-arrived") {
    const v = view;
    body = (
      <PushedFrame name="Pay" onBack={tabs}>
        <Arrived
          amount={v.amount}
          card={v.name}
          after={`Open ${v.name} and look. Pay sends more than $25 there only after you say yes.`}
          onAnswer={async (a) => {
            const preset = savedExchange?.preset;
            const address = savedExchange?.address ?? "";
            const e = await answerExchangeArrived(bridge, a);
            setSavedExchange(e);
            if (a !== "not-yet") answered(preset ?? "exchange");
            else askOnReturn.current = { kind: "exchange", id: preset ?? "exchange", name: v.name, amount: v.amount };
            // No: Pay forgets that address and what it sent there (it may be a look-alike), like a card's.
            if (a === "no") {
              await forgetSent(bridge, preset ?? "exchange");
              return setView({ kind: "not-arrived", card: v.name, address, url: presetFor(preset)?.site ?? "", exchange: preset ?? null });
            }
            setTab("exchange");
            tabs();
          }}
        />
      </PushedFrame>
    );
  } else if (view.kind === "not-arrived") {
    const v = view;
    body = <PushedFrame name="Pay" onBack={tabs}><NotArrived card={v.card} address={v.address} onOpen={v.url ? () => open(v.url) : undefined} onAgain={() => { if (v.exchange !== undefined) { setExchangeStart(v.exchange ?? undefined); setTab("exchange"); } else { setCardStart(v.productId); setCardRetry(true); setTab("card"); } tabs(); }} /></PushedFrame>;
  } else if (view.kind === "bank") {
    const v = view;
    body = (
      <PushedFrame name="Pay" onBack={tabs}>
        {v.stage === "confirm" && <BankConfirm bill={v.bill} onPay={() => setView({ ...v, stage: "handoff" })} />}
        {v.stage === "handoff" && <BankHandoff bill={v.bill} opened={Boolean(v.opened)} onOpen={() => { open(BANK_PARTNER.url); setView({ ...v, opened: true }); }} onNext={() => setView({ ...v, stage: "pay-in" })} />}
        {v.stage === "pay-in" && (
          <BankPayIn
            bill={v.bill}
            tokens={flow.tokens}
            onSend={(pasted, amount) => {
              const t = flow.tokens ? payInTarget(pasted, amount, v.bill, flow.tokens) : { problem: payProblems.quoteFailed() };
              if ("problem" in t) return void shell.showProblem(t.problem);
              payTarget(t.ok, "Send", undefined, v.bill);
            }}
          />
        )}
      </PushedFrame>
    );
  } else if (view.kind === "bank-sent") {
    const v = view;
    const usdc = v.step.confirm.target.amount;
    body = (
      <PushedFrame name="Pay" onBack={tabs}>
        <BankSent
          bill={v.bill}
          usdc={usdc}
          onDone={tabs}
          onPaid={async () => {
            // Only the person can say Mt Pelerin paid it: Activity's row says so in those words (UI, M3).
            const relabelled = await markBankPaid(bridge, v.step.movement.id, v.bill);
            setView({ kind: "bank-paid", bill: v.bill, step: v.step, relabelled });
          }}
        />
      </PushedFrame>
    );
  } else if (view.kind === "bank-paid") {
    body = <PushedFrame name="Pay" onBack={tabs}><BankPaid bill={view.bill} usdc={view.step.confirm.target.amount} relabelled={view.relabelled} onDone={tabs} /></PushedFrame>;
  } else if (view.kind === "held") {
    body = <PushedFrame name="Pay" onBack={tabs}><OnHold c={view.step.confirm} held={view.step.held} onDone={tabs} /></PushedFrame>;
  } else if (view.kind === "request") {
    body = <PushedFrame name="Ask for money" onBack={tabs}><Request /></PushedFrame>;
  } else {
    body = (
      tab === "home" ? (
        <AppFrame<TrayId> name="Pay" tray={TRAY} tab={"home" as TrayId} onTab={setTab}>
          {!providersRead
            ? <div className="py-wait"><Mark size={56} mode="loading" label="Opening Pay" /></div>
            : (cardLive && savedCards.length > 0) || savedBank || savedExchange || vouchers.length > 0
              ? <Home cards={cardLive ? savedCards : []} onCard={(id) => { setCardStart(id); setTab("card"); }} bank={BANK_TILE_ON ? savedBank : null} exchange={savedExchange} vouchers={vouchers} onVoucher={(id) => { setVoucherId(id); setTab("voucher"); }} cardLive={cardLive} onTile={openTile} onAdd={() => setView({ kind: "offers" })} onPerson={(p) => { setPerson(p); setTab("send"); }} onAsk={askAgain} pending={asks} />
              : <Offers code={country ?? "ZZ"} kid={!cardLive} added={isAdded} onPick={offerPicked} onCountry={() => setView({ kind: "country" })} />}
        </AppFrame>
      ) : (
        <PushedFrame name={TITLES[tab]} onBack={() => setTab(tab === "receive" && withdrawFrom ? withdrawFrom.back : "home")}>
          {tab === "scan" && <Scan onCode={scanned} onProblem={(p) => void problem(p)} active={shell.active} />}
          {/* Wallet's one Receive screen, in place (D29): every network; asking for an amount is Pay's Request. */}
          {tab === "receive" && receiveFor && (receiveFor.ok
            ? <p className="zf-body py-center" role="status" style={{ padding: "12px 16px 0" }}>Add {shown(receiveFor.amount, 2)} {receiveFor.symbol}{receiveFor.chain !== "near" ? ` on ${chainName(receiveFor.chain)}` : ""}. Come back and send.</p>
            : <p className="zf-body py-center" role="status" style={{ padding: "12px 16px 0" }}>ZeroFee can't take {receiveFor.symbol} on {chainName(receiveFor.chain)} right now.</p>)}
          {tab === "receive" && withdrawFrom && (
            <div className="py-center" role="status" style={{ padding: "12px 16px 0" }}>
              {/* Plain (the robot's final round): a title line, then what to do there; the address block below is the only hex. */}
              {withdrawFrom.ok && <div className="zf-label" style={{ color: "var(--ink)" }}>Your ZeroFee address, to use in {withdrawFrom.name}</div>}
              <p className="zf-body" style={withdrawFrom.ok ? { marginTop: 8 } : undefined}>{withdrawFrom.ok
                ? `Copy it below. In ${withdrawFrom.name}, send ${withdrawFrom.coin} to it on ${chainName(withdrawFrom.chain)}, the same network as here.`
                : `ZeroFee can't take ${withdrawFrom.coin} on ${chainName(withdrawFrom.chain)} right now. Your money stays in ${withdrawFrom.name}.`}</p>
              {withdrawFrom.url && <button className="zf-link" style={{ color: "var(--ink)", fontWeight: 500 }} onClick={() => open(withdrawFrom.url)}>Open {withdrawFrom.name}</button>}
            </div>
          )}
          {tab === "receive" && !(withdrawFrom && !withdrawFrom.ok) && !(receiveFor && !receiveFor.ok) && <ReceiveScreen bridge={bridge} onAskAmount={() => setView({ kind: "request" })} onProblem={(p) => void problem(p)} {...(receiveFor ? { chain: receiveFor.chain, amount: receiveFor.amount, coin: receiveFor.tokenId } : withdrawFrom ? { chain: withdrawFrom.chain, title: "Receive", ...(withdrawFrom.asset ? { coin: withdrawFrom.asset } : {}) } : { title: "Receive" })} />}
          {tab === "send" && <Send onSend={send} onRequest={() => setView({ kind: "request" })} onScan={() => setTab("scan")} onAddMoney={async (ask) => { setReceiveFor({ ...ask, ok: await receives(ask.chain, ask.symbol) }); setTab("receive"); }} onProblem={(p) => void problem(p)} prefill={prefill} person={person} />}
          {tab === "cash" && <Cash start={cashKind} onSendTo={(t) => payTarget(t, "Send")} onProblem={(p) => void problem(p)} onOpen={open} onAwaitReturn={(e) => { pendingSell.current = e; }} />}
          {tab === "card" && <CardTab fix={fix} start={cardStart} retry={cardRetry} onWithdraw={takeOut} onMove={() => { setTab("home"); setView({ kind: "offers" }); }} onTopUp={(t, productId) => { quick(t, "Top up"); sendingTo.current = productId; toppingUp.current = productId; }} onProblem={(p) => void problem(p)} onOpen={open} onRemoved={() => setTab("home")} />}
          {tab === "voucher" && voucherId && <Checkout key={checkoutKey} id={voucherId} added={vouchers.includes(voucherId)} fix={fix} onRemoved={() => setTab("home")} onAnswer={async (yes) => { await answerArrived(bridge, voucherId, yes); if (yes) setCheckoutKey((k) => k + 1); else setView({ kind: "voucher-refund", id: voucherId }); }} onOpen={open} onPay={(t) => { quick(t, "Pay"); checkoutFor.current = voucherId; sendingTo.current = voucherId; }} onProblem={(p) => void problem(p)} />}
          {tab === "exchange" && <ExchangeTile fix={fix} exchange={savedExchange} onExchange={setSavedExchange} onSend={sendToExchange} onOpen={open} onProblem={(p) => void problem(p)} start={exchangeStart} only={countryFor(country).exchange} onWithdraw={takeOut} onAsk={(e) => setView({ kind: "exchange-arrived", amount: `${shown(e.tested ?? "0", 2)} USDC`, name: e.name })} />}
          {BANK_TILE_ON && tab === "bank" && <BankTile bank={savedBank} onBank={setSavedBank} onOpen={open} onCash={(k) => { setCashKind(k); setTab("cash"); }} onScan={() => setTab("scan")} onHome={() => setTab("home")} onProblem={(p) => void problem(p)} />}
        </PushedFrame>
      )
    );
  }
  return (
    <div className="py-app" style={{ position: "absolute", inset: 0 }}>
      {body}
      {sheet?.kind === "web" && <WebSheet url={sheet.url} onClose={() => setSheet(null)} onOpen={() => { open(sheet.url); setSheet(null); }} />}
      {sheet?.kind === "coin" && <CoinSheet c={sheet.c} onClose={() => setSheet(null)} onPick={(id) => void run(() => flow.payWith(id))} />}
      {sheet?.kind === "network" && (
        <NetworkSheet
          networks={sheet.networks}
          onClose={() => setSheet(null)}
          onPick={(network) => {
            const s = sheet.send;
            if (!s) return void run(() => flow.answer({ network }));
            setSheet(null);
            send(s, network);
          }}
        />
      )}
    </div>
  );
}

function PayRoot() {
  const { bridge } = useShell();
  return <PayProvider bridge={bridge}><PayScreens /></PayProvider>;
}

export const payApp: AppModule = { id: "pay", name: "Pay", line: "Pay anyone, anywhere", Root: PayRoot };
