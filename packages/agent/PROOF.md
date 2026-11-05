# Agent's mainnet proof

Run by the operator in the app on `/?mainnet` (or the phone), with dust. No tool runs any step: Claude never signs.
After each step, `node packages/agent/tools/mainnet-check.ts <name>.near` reads what the account's own rules now say
about Agent, on two nodes, and signs nothing. Its last line says PASS only while those rules stay inside the proof's
caps: 0.05 NEAR per order and 5 USDC in 24 hours. Rules set up bigger than that read as FAIL.

**What it proves:**
1. the person's own Claude key is checked by Anthropic, kept on the device, and plans a payment from plain words;
2. a standing order is set up with one approval, and Agent's own key pays it on its date with no sheet;
3. Agent keeps a coin at an amount: what's above it is swapped inside the account's own balance, with no sheet, at
   most what the budget allows;
4. pause stops it at once, and stopping Agent deletes its key, with the account refusing it from then on.

**Cost:** 0.02 NEAR goes to your own second account (step 2). About 1 USDC is swapped into NEAR inside your own
balance (step 3), with 1Click's fee, about 1%. Network fees were about 0.0014 NEAR per Agent call on testnet. Claude:
a few cents on your Anthropic account. Well under $1 of the $150 test budget.

**Before:** your account on `/?mainnet` exists, holds about 0.5 NEAR, and has about 5 USDC in your vault (Wallet's
PROOF.md, step 3). You have an Anthropic account in your own name with a little credit, and a second NEAR account of
your own to receive 0.01 NEAR. Replace `<name>` with your account name and `<second>` with that second account. Send
Agent every line that starts with `RESULT`, and anything that reads differently from these steps.

## 0. Nothing yet

```
! node packages/agent/tools/mainnet-check.ts <name>.near
```
Expect `account contract version: 4` (3 or later is enough), `agent key: none`, and FAIL ("no Agent on this account
yet").

## 1. Your Claude key

Agent → **Set up now** → copy your key from Anthropic's console (**Get a key from Anthropic** opens it) → **Paste key**.
Ask says "Agent is ready. … This check spent nothing." Reload: Ask still has your key and asks for nothing.

## 2. A standing order, paid by Agent's own key

Ask: `Send 0.01 NEAR to <second> every Friday, 2 times` → the card shows two dates and "Exactly 0.01 NEAR each
Friday, only to <second>" → **Approve plan** → the sheet → Face ID. If your protection holds it, the Waiting screen
says when; send it from there when the wait is over. Then run the check: one order, `0 of 2 paid`, PASS.

On the first Friday, open Agent. Activity shows "Paid 0.01 NEAR to <second>", and `<second>` received exactly 0.01 NEAR.
No sheet appears. The check shows `1 of 2 paid` and the agent key's fee allowance a little under 0.5 NEAR.

## 3. Keep 4 USDC

Ask: `Keep 4 USDC. Convert anything above it to NEAR` → the card says "At most 4 USDC in 24 hours" → approve. Open Agent
again. Activity shows "Converted 1 USDC to NEAR" (the part above 4), and your balance shows 4 USDC and a little more
NEAR. No sheet appears. The check shows `budget per day … 4000000` and PASS.

If 1Click refuses so small a swap, Activity stays quiet and Agent tries again an hour later. Send Agent that RESULT
line: the proof then needs 2 to 3 USDC above the kept amount.

## 4. Pause, then stop

Rules → the switch off → Face ID. Rules says "Agent is paused", and nothing runs on open. The check shows
`paused: true`. Then **Stop Agent and remove its key** → Face ID. The check shows `agent key: none` and FAIL ("no Agent
on this account yet"). Any later attempt with that key is refused by NEAR itself, as the testnet proof showed
(packages/agent/tools/limits-testnet.ts).
