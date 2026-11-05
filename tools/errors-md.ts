// Writes packages/core/errors.md from the Problem catalogue, so the two never drift:
//   node tools/errors-md.ts > packages/core/errors.md
import { securityProblems } from "../packages/core/src/security-problems.ts";
import { spendingProblems } from "../packages/core/src/spending.ts";
import { perpsProblems } from "../packages/core/src/perps/service.ts";
import type { MoneyState, NextStep } from "../packages/core/src/problem.ts";

// Example arguments for the Problems that take some. The words in errors.md use them.
const examples: Record<string, unknown[]> = {
  requestInvalid: ["(what was wrong)"],
  requestNotAllowed: ["(what was asked)"],
  sendRefused: ["(why, in words)"],
  sendFailed: ["(explorer link)"],
  sendUnconfirmed: ["(explorer link)"],
  wordWrong: [7],
  wordsCount: [23],
  wordUnknown: [7],
  recoveryWaiting: ["2026-11-01T00:00:00.000Z"],
  recoveryAlready: ["2026-11-01T00:00:00.000Z"],
  methodUnknown: ["(method)"],
  chainUnreachable: ["hood"],
  bridgeNotAllowed: ["(method)"],
  partnerUnreachable: ["the swap service"],
  notEnoughCoin: ["USDC"],
  stillWaiting: ["2026-11-01T00:00:00.000Z"],
  betaCapReached: [1000],
  betaCapOver: [1000, 250],
  vaultNeedsSecondDevice: [5000],
  accountCreateLater: ["2026-11-01T00:00:00.000Z", "after 4:15 PM"],
  rearmLocked: ["2026-11-01T00:00:00.000Z"],
  paymentsMany: ["2026-11-01T00:00:00.000Z", "4:15 PM"],
  secretRefused: ["(what was refused, in words)"],
  subwalletRefused: ["(why, in words)"],
  subwalletSendFailed: ["(explorer link)"],
  subwalletUnconfirmed: ["(explorer link)"],
};
const money = (m: MoneyState) => (m.state === "not-involved" ? "not involved" : `${m.state}: ${m.where}${"etaSeconds" in m && m.etaSeconds ? ` (~${m.etaSeconds} s)` : ""}`);
const next = (n: NextStep) => `${n.label} (${n.kind}${"screen" in n ? ` → ${n.screen}` : "field" in n ? ` → ${n.field}` : ""})`;

let out = `# Security layer problems

Every Problem the security layer (packages/core) can produce. Generated from \`src/security-problems.ts\` by
\`node tools/errors-md.ts\`; a test checks that every code there is listed here. Numbers in the words are examples.

| Code | What happened | Money | Next step |
|---|---|---|---|
`;
for (const [name, make] of Object.entries(securityProblems)) {
  const p = (make as (...a: unknown[]) => ReturnType<typeof securityProblems.unexpected>)(...(examples[name] ?? []));
  out += `| \`${p.code}\` | ${p.whatHappened} | ${money(p.money)} | ${next(p.next)} |\n`;
}
// Spending's own Problems, from the same source of words (copy rewrite, 2 Nov: a hand-kept table drifts).
const spendingExamples: Record<string, unknown[]> = { overCap: [180, 500], overBand: [500], oneCoin: [300, "NEAR"], readyShort: [40], networkClosed: ["BNB Chain"] };
out += `
## Spending (\`src/spending.ts\`, D52)

Spending's own Problems (\`spendingProblems\`), checked before any sheet. A test checks that every code there is listed
here. Numbers in the words are examples.

| Code | What happened | Money | Next step |
|---|---|---|---|
`;
for (const [name, make] of Object.entries(spendingProblems)) {
  const p = (make as (...a: unknown[]) => ReturnType<typeof spendingProblems.tooSmall>)(...(spendingExamples[name] ?? []));
  out += `| \`${p.code}\` | ${p.whatHappened} | ${money(p.money)} | ${next(p.next)} |\n`;
}
// Perps' own Problems (D119, Hyperliquid's test network only): each names Hyperliquid and says where the money is.
const perpsExamples: Record<string, unknown[]> = { refused: ["(Hyperliquid's own words)"], input: ["BTC goes up to 40× on Hyperliquid."], noPosition: ["ETH"] };
out += `
## Perps (\`src/perps/service.ts\`, D119)

Perps' own Problems (\`perpsProblems\`, Hyperliquid's test network only). Words in the examples are examples; Hyperliquid's
own words, when it gave some, are behind More.

| Code | What happened | Money | Next step |
|---|---|---|---|
`;
for (const [name, make] of Object.entries(perpsProblems)) {
  const p = (make as (...a: unknown[]) => ReturnType<typeof perpsProblems.unreachable>)(...(perpsExamples[name] ?? []));
  out += `| \`${p.code}\` | ${p.whatHappened} | ${money(p.money)} | ${next(p.next)} |\n`;
}
process.stdout.write(out);
