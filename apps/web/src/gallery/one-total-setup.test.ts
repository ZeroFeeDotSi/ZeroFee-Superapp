// the copy review's A2-3 (8 Nov, the Sim's set-up): its total is Home's (balance-parts.ts, the one sum), with Private named inside it;
// the bar reads "Step 4 of 5 · Money in"; the 24-word card fades at its bottom and scrolls with momentum.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { demoMoneyParts, demoMoneySteps, demoMoneyThread } from "./demo-money-in.ts";
import { dollars } from "@zerofee/wallet/app/format.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("set-up's total is Home's one total, its parts said under it with Private named (controls: Private empty, Hot not read)", () => {
  const src = read("./DemoMoneyIn.tsx");
  assert.match(src, /const parts = useBalanceParts\(bridge\);\s*const total = parts\?\.usd \?\? null;/, "the same read as Home's figure (balance-parts.ts)");
  // the copy review's B+ (8 Nov): "Safe" is Home's Safe figure, Private named inside it
  assert.equal(demoMoneyParts({ safeUsd: "5288.01", privateUsd: "33.86", hotUsd: "227.48" }, dollars), "Safe $5,288.01, Private $33.86 of it · Hot $227.48");
  assert.equal((5288.01 + 227.48).toFixed(2), "5515.49", "the parts add up to the figure");
  assert.equal(demoMoneyParts({ safeUsd: "5288.01", privateUsd: "0.00", hotUsd: "227.48" }, dollars), "Safe $5,288.01 · Hot $227.48", "control: Private empty, not named");
  assert.equal(demoMoneyParts({ safeUsd: "5288.01", privateUsd: "33.86", hotUsd: null }, dollars), null, "control: Hot not read, no line");
});

test("the bar reads \"Step 4 of 5 · Money in\" on the money screen: the 4th segment lit, its name Money in (control: the thread's own steps unchanged)", () => {
  const t = demoMoneyThread("5515.49");
  const steps = demoMoneySteps(t);
  const now = steps.findIndex((s) => s.state === "now");
  assert.equal(now + 1, 4, "Step 4 of 5 (thread.css counts the lit segment)");
  assert.equal(steps[now]!.label, "Money in");
  assert.equal(t.steps[now]!.label, "Second device", "control: Home's thread keeps its own name");
  assert.deepEqual(steps.map((s) => s.state), t.steps.map((s) => s.state), "the same segments");
  assert.match(read("./DemoMoneyIn.tsx"), /<ThreadBar steps=\{demoMoneySteps\(t\)\} line="" \/>/);
});

test("the 24-word card: a 24 px bottom fade, momentum, its end clears the fade; the warning stays pinned above the scroll", () => {
  const css = read("../screens/onboarding.css");
  const rule = css.slice(css.indexOf("/* A2-3"), css.indexOf("}", css.indexOf("/* A2-3")) + 1);
  assert.match(rule, /mask-image: linear-gradient\(to bottom, #000 calc\(100% - 24px\), transparent\)/);
  assert.match(rule, /-webkit-overflow-scrolling: touch/);
  assert.match(rule, /padding-bottom: 24px/);
  const words = read("../screens/Onboarding.tsx");
  const sub = words.indexOf("{t.sub}"), scroll = words.indexOf('<div className="ob-scroll">');
  assert.ok(sub > 0 && scroll > sub, "control: the warning line sits above the scroll, so it never scrolls away");
});
