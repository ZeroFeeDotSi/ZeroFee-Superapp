// Add money on a network: its name and "Change network", a big QR, the address, the memo on its own line where a network
// needs one, which coins it takes, the minimum (and about how many dollars), and one pill: copy the address. Receiving
// waits for the backup words (the ledger answers security.backup.needed, which the shell shows). It reads only through
// the bridge it is given, so Pay shows it too (ReceiveScreen.tsx, D29), with "Ask for an amount" leading to Pay's Request.
import { Fragment, useEffect, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { Copy } from "@zerofee/design/icons.tsx";
import { Waiting } from "../Waiting.tsx";
import { QrCode } from "@zerofee/design/QrCode.tsx";
import { EVM_CHAINS } from "../../addresses.ts";
import { fromUnits, toUnits, usdOf } from "../../amount.ts";
import { payCode } from "../../pay-code.ts";
import type { Chain, DepositAddress, Token } from "../../types.ts";
import { exactOf, minimumLine, receiveExtras } from "../format.ts";
import { arrives } from "../runtime.tsx";

import { copyText } from "../copy-text.ts";
const copy = copyText;

export function Receive({ bridge, tokens, chain, chains, onChange, onProblem, onAddress, onAskAmount, ask, coin: wanted, title = "Add money" }: {
  /** The address was read (B28: a line about a failed read clears). */
  onAddress?: () => void;
  bridge: Bridge;
  tokens: Map<string, Token>;
  chain: Chain;
  /** Every network the screen lists; the ones with Ethereum's kind of address are named as sharing this one. */
  chains?: Chain[];
  onChange: () => void;
  onProblem: (p: Problem) => void;
  /** A link to Pay's Request, where the person asks for an amount; none when not given. */
  onAskAmount?: () => void;
  /** The screen's verb: "Add money on NEAR" in Wallet; Pay's tray says "Receive on NEAR". */
  title?: string;
  /** An amount to ask for, in one coin (Pay's "Add 2.00 USDC on Base"): said on screen, and in the code where the network has a standard. */
  ask?: { amount: string; coin: string };
  /** A coin the person came for (Pay's "Take money out"): the address and the minimum are for it, never the network's own coin. */
  coin?: string;
}) {
  const [address, setAddress] = useState<DepositAddress | null>(null);
  const [copied, setCopied] = useState<"address" | "memo" | null>(null);

  useEffect(() => {
    let live = true;
    setAddress(null);
    void bridge.call<DepositAddress>("ledger.depositAddress", { chain: chain.id, ...(ask ?? wanted ? { token: ask?.coin ?? wanted } : {}) }).then((r) => {
      if (!live) return;
      if ("ok" in r) {
        setAddress(r.ok);
        onAddress?.();
      } else onProblem(r.problem);
    });
    return () => {
      live = false;
    };
  }, [bridge, chain.id, ask?.coin, wanted]);

  const did = (what: "address" | "memo", text: string) => {
    void copy(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };
  const sharing = (chains ?? [chain]).filter((c) => EVM_CHAINS.has(c.id)).map((c) => c.name);
  const near = chain.id === "near";
  const token = address ? tokens.get(address.token ?? "") : undefined;
  const minUsd = address && address.minAmount !== "0" ? usdOf(address.minAmount, token?.priceUsd) : undefined;
  // For a coin asked for, only that coin's own minimum on this network (in that coin); none known = no line, never another coin's.
  const want = ask?.coin ?? wanted;
  const minimum = address && address.minAmount !== "0" && (!want || (address.token === want && token))
    ? minimumLine({ amount: address.minAmount, symbol: token?.symbol ?? chain.nativeSymbol, usd: minUsd })
    : null;
  // An ask is never below the bridge's minimum for that coin (less would be lost, not credited).
  const coin = ask ? tokens.get(ask.coin) : undefined;
  const askUnits = ask && coin ? toUnits(ask.amount, coin.decimals) : null;
  const minUnits = address && coin ? (toUnits(address.minAmount, coin.decimals) ?? 0n) : 0n;
  const asked = coin && askUnits !== null && askUnits > 0n ? fromUnits(askUnits > minUnits ? askUnits : minUnits, coin.decimals) : null;
  const code = address && coin && asked ? payCode({ chain: chain.id, address: address.address, contract: coin.contract, decimals: coin.decimals, amount: asked }) : null;
  const listed = (chain.coins ?? []).map((id) => (id === "near" ? "NEAR" : tokens.get(id)?.symbol)).filter((t): t is string => !!t);

  return (
    <div className="wl wl-receive">
      <div className="wl-recv-head">
        <CoinIcon symbol={chain.name} icon={chain.icon} size={28} />
        <h2 className="wl-recv-title">{title} on {chain.name}</h2>
        {(chains?.length ?? 2) > 1 && <button className="wl-inline wl-recv-change" onClick={onChange}>Change network</button>}
      </div>

      {!address ? (
        <Waiting size={44} text="Getting your address…" />
      ) : (
        <div className="zf-enter">
          {asked && coin && (
            <p className="wl-asking">Asking for {exactOf(asked, coin.symbol)} {coin.symbol}{code ? "" : ". Type it in your wallet"}</p>
          )}
          <div className="wl-qr-big"><QrCode value={code ?? address.qr} size={320} label={code ? `QR code asking for ${asked} ${coin?.symbol} on ${chain.name}` : `QR code of your ${chain.name} address`} /></div>
          <div className="zf-label wl-gap">{near ? "Your NEAR account" : `Your ${chain.name} address`}</div>
          <p className="wl-addr">{address.address}</p>
          {address.memo && (
            <>
              {/* A memo network loses money sent without it, so its memo keeps a copy of its own. */}
              <div className="zf-label wl-gap">Memo (required)</div>
              <div className="wl-addr-row">
                <span className="wl-addr">{address.memo}</span>
                <button className="wl-copy" onClick={() => did("memo", address.memo!)} aria-label="Copy memo"><Copy /></button>
              </div>
            </>
          )}
          <p className="zf-small wl-recv-note">
            {/* Asking for one coin: the words name it, so a wallet that misreads the code is still told (Security's note). */}
            {asked && coin && !address.memo ? `Send only ${coin.symbol} on ${chain.name}.` : address.note} {arrives(chain.id)}
            {minimum && <><br />{minimum}</>}
            {receiveExtras({ coin: want ? (tokens.get(want)?.symbol ?? "it") : undefined, said: Boolean(asked && coin && !address.memo), sharing: EVM_CHAINS.has(chain.id) ? sharing : [], taken: address.address.endsWith(".testnet") ? [] : listed }).map((l) => <Fragment key={l}><br />{l}</Fragment>)}
          </p>
          {onAskAmount && !asked && <button className="wl-btn2 wl-ask" onClick={onAskAmount}>Ask for an amount</button>}
        </div>
      )}
      <div className="zf-fill" />
      <div className="zf-floor">
        <button className="zf-btn" disabled={!address} onClick={() => address && did("address", address.address)}>{copied === "address" ? "Copied" : copied === "memo" ? "Memo copied" : near ? "Copy account" : "Copy address"}</button>
      </div>
    </div>
  );
}
