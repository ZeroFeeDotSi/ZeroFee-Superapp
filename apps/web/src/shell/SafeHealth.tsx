// S-2 on the Safe sheet: the health check's lines (safe-health.ts), from the reads that already exist, on the shell's
// full bridge: the account (account.state: the words and their check, the keys, the recovery wait), its rules
// (account.protection.get, the shared known.ts), its second devices (account.secondDevices), the phone's own Face ID
// check (device.phoneCheck, iPhone only) and Spending's wallets (spending.wallets: old words holding money). A read that
// fails leaves its line out (never a tick or a fix from a guess). It loads with the Safe sheet's first open. The rules'
// fact comes in from the shell (`rules`: known.ts's readProtection and useKnown), never imported here: known.ts sits in
// Home's first load, and sharing it with this lazy chunk split that load into more chunks (+3 KB on Home, measured); the
// iPhone host comes in the same way (`phone`, +0.5 KB). Each line's fix is mapped in this chunk (safe-health.ts openFix),
// so Home carries only the loader.
import { useEffect, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import type { AccountInfo } from "@zerofee/core/signer";
import { Check } from "@zerofee/design/icons.tsx";
import type { IosHost } from "../host/ios.ts";
import "./safe-health.css";
import { faceIdOn, healthLines, oldWordsHoldMoney, openFix, type HealthFacts, type HealthGo, type WalletMoney } from "./safe-health.ts";

type Read = Omit<HealthFacts, "rules">;
const NOTHING: Read = { wordsChecked: null, secondDevice: null, waitSeconds: null, faceId: null, oldWordsMoney: null };

/** The rules' fact, from the shell's shared facts (known.ts): read it again, and use what is known. */
export interface RulesFact { read: (bridge: Bridge) => Promise<void>; use: () => boolean | null }

export async function readHealth(bridge: Bridge, account: AccountInfo, rules: RulesFact, phone: IosHost | null): Promise<Read> {
  const [state, devices, wallets, face] = await Promise.all([
    bridge.call<{ account?: AccountInfo; wordsCheckDue?: boolean }>("account.state"),
    bridge.call<unknown[]>("account.secondDevices"),
    bridge.call<WalletMoney[]>("spending.wallets"),
    phone ? phone.call<{ blocker: string | null }>("device.phoneCheck") : Promise.resolve(null),
    rules.read(bridge),
  ]);
  const acct = "ok" in state ? (state.ok.account ?? account) : null;
  const keys = acct?.keys ?? [];
  return {
    wordsChecked: "ok" in state ? keys.some((k) => k.role === "recovery") && state.ok.wordsCheckDue !== true : null,
    secondDevice: "ok" in devices && Array.isArray(devices.ok) ? devices.ok.length > 0 || keys.some((k) => k.role === "second-device") : keys.some((k) => k.role === "second-device") ? true : null,
    waitSeconds: acct ? (acct.recovery?.delaySeconds ?? 0) : null,
    faceId: face && "ok" in face ? faceIdOn(face.ok.blocker) : null,
    oldWordsMoney: "ok" in wallets && Array.isArray(wallets.ok) ? oldWordsHoldMoney(wallets.ok) : null,
  };
}

export function SafeHealth({ bridge, account, rules, phone, go }: { bridge: Bridge; account: AccountInfo; rules: RulesFact; phone: IosHost | null; go: HealthGo }) {
  const protection = rules.use();
  const [read, setRead] = useState<Read>(NOTHING);
  useEffect(() => {
    let live = true;
    void readHealth(bridge, account, rules, phone).then((r) => live && setRead(r), () => undefined);
    return () => { live = false; };
  }, [bridge, account]);
  const lines = healthLines({ ...read, rules: protection });
  if (!lines.length) return null;
  return (
    <section className="wl-health" aria-label="Health check">
      <p className="zf-small wl-health__head">Health check</p>
      <div className="wl-rows">
        {lines.map((l) => {
          const inside = (
            <>
              <span className={`zf-tick ${l.done ? "on" : "off"}`} aria-hidden="true">{l.done ? <Check /> : null}</span>
              <div className="t">{l.text}</div>
              <div className="r">{l.fix ? <span className="vd" aria-hidden="true">›</span> : null}</div>
            </>
          );
          return l.fix ? <button key={l.key} className="wl-row wl-pick" data-health={l.key} onClick={() => openFix(l.fix!, go)}>{inside}</button> : <div key={l.key} className="wl-row" data-health={l.key}>{inside}</div>;
        })}
      </div>
    </section>
  );
}
