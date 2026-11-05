// Review M4 (D143): paying from Hidden in Pay has no Face ID after it, so Confirm's act is a deliberate Hold (Home's Send's
// own HoldButton and timing), and no line says Face ID. Paying from the Safe keeps its pill and "Face ID next.".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PHONE_WORDS, WEB_WORDS } from "@zerofee/shell-api/approval-words.ts";
import { HOLD_MS } from "@zerofee/wallet/app/money/hold.ts";
import { PayFlow, type Confirm, type Step } from "../pay.ts";
import { FakeLedger, USDC_NEAR } from "../testing/fake-ledger.ts";
import { SAFE_WAIT, confirmFloor, payingText } from "./format.ts";

const SHOP_SOL = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const SOL_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const CODE = `solana:${SHOP_SOL}?amount=4.2&spl-token=${SOL_USDC_MINT}`;
const POCKET = { available: true, ready: true, balances: { [USDC_NEAR]: "40" } };

const kind = <K extends Step["kind"]>(s: Step, k: K) => {
  assert.equal(s.kind, k, JSON.stringify(s));
  return s as Extract<Step, { kind: K }>;
};
async function confirmFor(o: { pocket?: typeof POCKET & { defaultOn?: boolean } }): Promise<Confirm> {
  const ledger = new FakeLedger({ accountId: "me.near", balances: { [USDC_NEAR]: "100" }, ...(o.pocket ? { pocket: o.pocket } : {}) });
  return kind(await new PayFlow({ bridge: ledger, anyCoin: true }).read(CODE), "confirm").confirm;
}
const FACE = /Face ID/;

test("from Hidden: Confirm's act is a Hold, and nothing on it says Face ID (phone or web words)", async () => {
  const c = await confirmFor({ pocket: { ...POCKET, defaultOn: true } });
  assert.deepEqual(c.privacy, { on: true }, "it pays from Hidden");
  for (const w of [PHONE_WORDS, WEB_WORDS]) {
    const floor = confirmFloor(c, "Pay", w);
    assert.equal(floor.hold, true);
    assert.match(floor.label, /^Hold to pay \$4\.20$/);
    assert.equal(floor.line, null, "no 'Face ID next.' under it");
    assert.doesNotMatch(JSON.stringify(floor), FACE);
  }
  assert.equal(confirmFloor(c, "Top up", PHONE_WORDS).label, "Hold to top up $4.20");
  assert.equal(payingText(c), "Paying from Private");
  assert.doesNotMatch(payingText(c), FACE);
});

test("control, from the Safe: the pill and 'Face ID next.', as before (switch off, or no pocket at all)", async () => {
  const off = await confirmFor({ pocket: POCKET });
  assert.deepEqual(off.privacy, { on: false });
  const none = await confirmFor({});
  assert.equal(none.privacy, undefined);
  for (const c of [off, none]) {
    const floor = confirmFloor(c, "Pay", PHONE_WORDS);
    assert.deepEqual(floor, { hold: false, label: "Pay $4.20", line: "Face ID next." });
    assert.equal(payingText(c), SAFE_WAIT);
    assert.match(payingText(c), FACE, "the Safe's sheet is Face ID");
  }
});

const confirmView = readFileSync(new URL("./screens/Confirm.tsx", import.meta.url), "utf8");
const payApp = readFileSync(new URL("./PayApp.tsx", import.meta.url), "utf8");
const code = (src: string) => src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("Confirm shows Home's own Hold for it (same component, same timing) and a tap alone pays only from the Safe", () => {
  assert.equal(HOLD_MS, 600, "Home's Send's hold");
  assert.match(confirmView, /import \{ HoldButton \} from "@zerofee\/wallet\/app\/money\/HoldButton\.tsx";/);
  assert.match(confirmView, /import "@zerofee\/wallet\/app\/money\/send\.css";/, "the ring's own styles load with it");
  assert.match(confirmView, /\{floor\.hold\n\s+\? <HoldButton label=\{floor\.label\} disabled=\{false\} onDone=\{onPay\} bridge=\{bridge\} testId="pay-hold" \/>\n\s+: <button className="zf-btn" onClick=\{onPay\}>\{floor\.label\}<\/button>\}/);
  assert.equal(code(confirmView).match(/onClick=\{onPay\}/g)?.length, 1, "one tap-to-pay, the Safe's, behind floor.hold");
  assert.doesNotMatch(code(confirmView), /approvalWords|Face ID/, "the floor's words come from confirmFloor only");
  // control: the reader sees the old floor as it was, which these checks fail
  const old = `<button className="zf-btn" onClick={onPay}>{reviewAction(c, verb)}</button>\n<p className="zf-small">{approvalWords().next}</p>`;
  assert.match(old, /approvalWords/);
});

test("PayApp: the wait says Face ID only for the Safe, and On its way says where the money left", () => {
  assert.match(payApp, /onPay=\{\(\) => void run\(\(\) => flow\.confirm\(\), payingText\(c\)\)\}/);
  assert.match(payApp, /bridge=\{bridge\} \/>/, "the Hold's buzz goes through Pay's own bridge");
  assert.doesNotMatch(code(payApp), /"Waiting for Face ID"/, "never hard-coded: SAFE_WAIT, only once the Safe's sheet is next");
  assert.match(payApp, /flow\.sendAtOnce\(t, payWith, \(\) => setView\(\{ kind: "wait", text: SAFE_WAIT \}\)\)/);
  assert.match(payApp, /\{view\.hidden \? "It has left Private\." : "It has left your Safe\."\}/);
});

test("a one-tap repeat Hidden can pay stops on Confirm (its Hold) and never says Face ID; control: the Safe's goes on to its sheet", async () => {
  const target = (flow: PayFlow) => ({ to: { kind: "chain" as const, chain: "sol", address: SHOP_SOL }, token: flow.tokens!.find("sol", { symbol: "USDC" })!, amount: "4", notes: [] });
  const pocket = new FakeLedger({ accountId: "me.near", balances: { [USDC_NEAR]: "100" }, pocket: { ...POCKET, defaultOn: true } });
  const a = new PayFlow({ bridge: pocket, anyCoin: true });
  await a.warm();
  let asked = 0;
  const c = kind(await a.sendAtOnce(target(a), USDC_NEAR, () => asked++), "confirm").confirm;
  assert.deepEqual(c.privacy, { on: true });
  assert.equal(asked, 0, "no 'Waiting for Face ID'");
  assert.equal(pocket.calls.some((x) => x.method === "ledger.pay"), false, "nothing paid before the Hold");

  const safe = new FakeLedger({ accountId: "me.near", balances: { [USDC_NEAR]: "100" } });
  const b = new PayFlow({ bridge: safe, anyCoin: true });
  await b.warm();
  let paidBefore: boolean | null = null;
  const step = await b.sendAtOnce(target(b), USDC_NEAR, () => { paidBefore = safe.calls.some((x) => x.method === "ledger.pay"); });
  assert.notEqual(step.kind, "confirm", JSON.stringify(step));
  assert.equal(paidBefore, false, "said once the Safe's sheet is next, before anything is paid");
  assert.ok(safe.calls.some((x) => x.method === "ledger.pay"));
});
