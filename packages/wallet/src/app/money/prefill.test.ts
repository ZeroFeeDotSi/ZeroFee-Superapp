// AgentZero does what Home does by opening Home's own sheets filled in (product decision, 3 Nov): MoneyAsk prefill. Each field
// only fills in what a person could type; the sheet the agent app opened says so first; its destination is read exactly
// as if typed; and nothing skips a step or Face ID.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AGENT_FILLED, askFrom, filledNote, prefilled, type MoneyAsk } from "@zerofee/shell-api/money.ts";
import { ADD_OPEN } from "@zerofee/core/add-outside";
import { SWAP_PLACES } from "./swap-corridor.ts";
import { PLACES, withLeg } from "../screens/move-split.ts";

const here = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const host = here("./MoneyHost.tsx"), send = here("./SendSheet.tsx"), form = here("./SendForm.tsx"), swap = here("./SwapSheet.tsx");
const move = here("../screens/MoveSheet.tsx"), add = here("./AddSheet.tsx"), request = here("./RequestSheet.tsx");
const sheet = here("../../../../design/src/Sheet.tsx"), shell = here("../../../../../apps/web/src/shell/AppHost.tsx"), money = here("../../../../shell-api/src/money.ts");

test("the line: a sheet the agent app opened filled in says \"AgentZero filled this in. Check it before you approve.\" (controls: another app, or nothing filled in, says nothing)", () => {
  assert.equal(AGENT_FILLED, "AgentZero filled this in. Check it before you approve.");
  const filled: MoneyAsk[] = [
    { kind: "send", to: "0x7D06e272b5305a4b9D40e872C7950D3437547e3D", usd: "5" },
    { kind: "send", wallet: "sol" },
    { kind: "swap", from: "sol", to: "safe-usdc", usd: "20" },
    { kind: "move", from: "safe", to: "sol", usd: "10" },
    { kind: "receive", coin: "sol" },
    { kind: "request", usd: "20", coin: "hood", note: "Dinner" },
    { kind: "request" },
  ];
  for (const a of filled) assert.equal(filledNote(a, "agent"), AGENT_FILLED, JSON.stringify(a));
  for (const a of filled) assert.equal(filledNote(a, "wallet"), null, `control, Home's own: ${JSON.stringify(a)}`);
  for (const a of [{ kind: "send" }, { kind: "swap" }, { kind: "move", usd: "" }] as MoneyAsk[]) assert.equal(filledNote(a, "agent"), null, `control, nothing filled: ${JSON.stringify(a)}`);
  assert.equal(prefilled({ kind: "send", to: undefined } as MoneyAsk), false);
  // who opened it is the shell's to say (the app on screen when openMoney was called), never a field the app sets
  assert.match(shell, /<MoneyHost key=\{money\.seq\} ask=\{money\.ask\} asker=\{apps\[money\.at\]\?\.id\} onEnd=/);
  assert.doesNotMatch(money, /asker\?: |by\?: "agent"|fromAgent/, "control: no ask field can claim or hide who opened it");
  assert.match(host, /const note = same \? filledNote\(taken, asker\) : null;/);
  assert.match(host, /<SheetNote\.Provider value=\{note\}><Host ask=\{taken\}/, "every sheet the host shows");
  assert.match(host, /useEffect\(\(\) => onSame\(ask === first\), \[ask, first\]\);/, "only on the sheet that was filled in, not one the person goes on to");
  // the sheet says it first, above all it says, and a sheet opened inside it doesn't repeat it
  assert.match(sheet, /\{note && <p className="zf-small zf-sheet__note" role="note" data-testid="sheet-note">\{note\}<\/p>\}\n\s+<SheetNote\.Provider value=\{null\}>\{children\}<\/SheetNote\.Provider>/);
});

test("Send filled in: the address or name goes in exactly as if typed (lookup, grouped, \"New address\", the look-alike stop), the dollars once its price is known, the note (control: a link's own recipient path is never used for it)", () => {
  assert.match(host, /<SendLater link=\{ask\.link\} wallet=\{ask\.wallet\} to=\{ask\.to\} chain=\{ask\.chain\} usd=\{ask\.usd\} note=\{ask\.note\}/);
  assert.match(send, /history=\{history\} \{\.\.\.\(refill \? \{ typed: refill \} : typed && formKey === 0 \? \{ typed \} : \{\}\)\}/, "the first form only: a scan afterwards is the person's own (the one other fill: \"Send $Y\" over the day limit, the copy review's refill)");
  assert.match(form, /const \[text, setText\] = useState\(filled\?\.to \?\? ""\);/, "the To field's own text: every check on a typed address runs");
  assert.match(form, /if \(!filled\?\.usd \|\| usdFilled\.current \|\| !source \|\| perCoin === null\) return;\n\s+usdFilled\.current = true;\n\s+setPreset\(true\);\n\s+type\(filled\.usd\);/, "dollars, typed once the price is here");
  const effects = form.slice(form.indexOf("const usdFilled"), form.indexOf("const chainFilled"));
  assert.doesNotMatch(effects, /setWho|setPicked|setExact|onSend|go\(/, "control: it never sets who or the network itself, and never sends");
  assert.match(form, /<button type="button" className="zf-btn wl-hold" disabled=\{!ready\} onClick=\{go\} data-testid="send-go">\{floor\.label\}<\/button>/, "the only way to send is the tap (no hold: product decision, 5 Nov)");
  assert.match(form, /const ready = !!source && !!who && !!network && !why && !waits && !busy/, "with every check on");
});

test("Swap, Move, Add and Request filled in: each read once into the sheet's own first state, and nothing asked of the core by it (control: the sheets' own buttons still do the asking)", () => {
  assert.deepEqual([...SWAP_PLACES].sort(), ["bsc", "hood", "near", "safe-near", "safe-usdc", "sol"], "MoneyAsk's SwapCoin is Swap's own list");
  assert.match(money, /export type SwapCoin = "sol" \| "hood" \| "bsc" \| "near" \| "safe-usdc" \| "safe-near";/);
  assert.deepEqual(Object.keys(ADD_OPEN).sort(), ["bsc", "hood", "near", "sol"]);
  assert.match(money, /export type AddCoin = "sol" \| "hood" \| "near" \| "bsc";/);
  assert.deepEqual([...PLACES].sort(), ["bsc", "hood", "near", "private", "safe", "sol"], "Move's places are Home's wallets and Private (its own row, the pair-private walk)");
  assert.match(swap, /useState<SwapPlace \| null>\(prefill\?\.from \?\? null\)/);
  assert.match(swap, /useState<SwapPlace \| null>\(prefill\?\.to \?\? null\)/);
  assert.match(swap, /const \[usd, setUsd\] = useState\(prefill\?\.usd \?\? ""\);/);
  assert.match(move, /const lead = \(s: Split\): Split => \(p\.prefill \? withLeg\(s, p\.prefill\.from, p\.prefill\.to, p\.prefill\.all \? s\[p\.prefill\.from\] \?\? 0 : p\.prefill\.usd \?\? 0\) : s\);/, "an amount, or all of the source (move-done.test.ts)");
  assert.match(move, /const base = useMemo\(\(\) => lead\(today\(now\)\), \[nowKey\]\);[\s\S]*?const split = useMemo\(\(\) => planSplit\(now, base, ops, HOME_PROOF\), \[nowKey, base, ops\]\);/, "it follows the money, the figures the person set worked out on it again (finding 65)");
  assert.match(add, /const \[asking, setAsking\] = useState\(!!request\);/, "Request opens straight inside Add");
  assert.match(add, /const safeRow = \(wallet === "safe" && coin \? addRows\(\)\.find\(\(r\) => r\.chain === coin\) : undefined\) \?\? order\.safe;/, "the Safe's row in that coin");
  assert.match(host, /wallet: ask\.wallet \?\? ask\.coin/, "a coin alone opens on its own wallet's address");
  assert.match(request, /useState\(start\?\.usd \?\? ""\)/, "finding 12: its own dollars, else none (never a made-up $20)");
  assert.match(request, /useState\(start\?\.note \?\? ""\)/);
  for (const [name, src, from, to] of [["Swap", swap, "useState<SwapPlace | null>(prefill", "const [line, setLine]"], ["Move", move, "const lead", "const nowKey"], ["Request", request, "const [usd, setUsd]", "const [line, setLine]"]] as const) {
    const part = src.slice(src.indexOf(from), src.indexOf(to));
    assert.ok(part.length > 0, name);
    assert.doesNotMatch(part, /bridge\.call|onDone\(|make\(/, `${name}: filling in asks nothing of the core`);
  }
  assert.match(request, /onClick=\{\(\) => void make\(r\)\}/, "control: a Request is still made by the person's own tap on its coin");
});

test("a Move filled in sets the sliders to that one move, never more than the place holds (controls: the same place, nothing, or a place not on screen leave it as it is)", () => {
  const s = { safe: 100, sol: 20, near: 5 };
  assert.deepEqual(withLeg(s, "safe", "sol", 10), { safe: 90, sol: 30, near: 5 });
  assert.deepEqual(withLeg(s, "sol", "safe", 50), { safe: 120, sol: 0, near: 5 }, "never more than the SOL wallet holds");
  assert.deepEqual(withLeg(s, "safe", "safe", 10), s);
  assert.deepEqual(withLeg(s, "safe", "sol", 0), s);
  assert.deepEqual(withLeg(s, "safe", "hood", 10), s, "a wallet not on screen");
});

test("prefill never skips a step: an agent's site move is never automatic (control: the site window's own stays), and a movement's id comes back for the agent to follow", () => {
  const auto = { kind: "siteadd", wallet: "w", name: "pump.fun", usd: "5", auto: true } as MoneyAsk;
  assert.equal("auto" in askFrom(auto, "agent"), false, "the agent's: its sheet comes first");
  assert.equal(askFrom(auto, "social"), auto, "control: the site window's own ask is as it was");
  assert.match(host, /const taken = useMemo\(\(\) => askFrom\(ask, asker\), \[ask, asker\]\);/);
  assert.match(host, /onEnd\(\{ went: true, \.\.\.\(follow\?\.id \? \{ movementId: follow\.id \} : \{\}\) \}\);/, "a swap's");
  assert.match(host, /onDone=\{\(l, id\) => done\(l, id\)\}/, "a move's");
  assert.match(move, /: "Moved\.", follow\?\.\[0\]\?\.id\);/);
  assert.match(host, /onClose=\{\(went, id\) => \(went \? done\("", id\) : close\(\)\)\}/, "a send's, as before");
});
