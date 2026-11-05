# AgentZero's prompt suite (105 prompts, real Claude)

AgentZero should do everything in the app from chat, end to end. This suite checks that with 105 prompts in plain words, the way real people type them, and it runs after every fix so old bugs don't come back.

```
node tools/agentzero-suite/run.mjs
```

The conversations (31 flows, 3 to 8 turns each, graded on the person's goal):

```
node tools/agentzero-suite/run.mjs --flows
```

Options:
- `--only send-01,swap` runs only those ids or categories.
- `--theme black` runs in Black.
- `--max-usd 3.5` sets the spend cap (4 for `--flows`).
- `--fake` answers every turn with a canned "OK." and no Claude at all. It checks the runner itself and spends nothing.
- `--faults` is the no-hang suite (`faults.mjs`). It runs with no Claude, no key and no network, and spends nothing. AgentZero's limits are shrunk in the page (core and read 2 s, Claude's first event 3 s, a gap 3 s). Then every read is faulted on purpose: the bridge or the market hangs, answers after 20 s, throws, or answers garbage. Claude hangs, goes silent mid-stream, is cut off, or answers 529. The relay hangs, 404s or 5xxs. Trade never calls back, and Home's sheet closes without an end. Each case must pass these checks:
  - a plain line comes within the limit plus 1 s;
  - the composer is usable after;
  - Stop frees Send at once;
  - no task is left pending;
  - nothing claims money went.

  It writes `$ZEROFEE_HOME/screens/agentzero-nohang/<run>/FAULTS.md`.

A full run takes about 30 minutes and costs about $3.

## What it does
- **The page.** `run.mjs` starts its own vite, which serves `harness.tsx` (never part of the app's build), and one headless Chrome at 390x844 with touch and an iPhone user agent. Both stop at the end, even when the run fails.
- **The app.** The page mounts the real AgentZero tab (`agentZeroChatApp.Root` → `LiveChat` → `useChatTurn` → `chatTurn`) on the own-key path, so every request goes to the real api.anthropic.com.
- **Money.** It uses the sample demo's bridge, routed as `?demo` routes it: the demo's MockBridge options, Earn's and Trade's readers, and Spending's engine. So AgentZero reads the same Safe and wallets the demo shows. With the demo's sample history, its Activity lists $97.10 that came in. The shell's `openMoney` renders Wallet's own `MoneyHost`, the sheet Home opens, and every ask is recorded. Every approval is declined, so nothing ever moves.
- **Trade.** `openTrade` goes through the shell's own door (`shell-api/trade-ask.ts` `shellAsk`, from AgentZero, on screen), and every ask is recorded. Trade's page isn't mounted. A stand-in takes the ask the way Trade does, holds it, and ends it after `?tradeMs` with a `landedMs`. This walks AgentZero's card and the shell's "still going" rule; no coin is bought.
- **A fresh start.** Each prompt loads a fresh page with fresh sample money, chat and memory. A conversation (several lines in `say`) runs in one page.
- **Cards.** After the reply, the suite taps a card's Review or Open, and nothing else (never Pay, Keep or Approve). It then shoots the sheet.

## The conversations (`flows.json`)
The product decision, 3 Nov

- **What each flow is.** A goal, a seeded state and 3 to 8 turns. The page's URL seeds the state: `fresh` (no history), `float=empty` (the SOL, ETH (RH) and BNB wallets hold nothing), `nosafe`, `fault=1click` (swaps down), or `fault=<service>:521` (one service down).
- **How the turns are driven.** One at a time, and the next turn can depend on the reply: `{when: [[regex, words]], else}` picks what the person says from AgentZero's last answer.
- **Sheets.** After each turn, the person opens the card's sheet, which is recorded, and closes it. Nothing is ever approved.
- **Grading.** A flow passes on its goal:
  - the Home sheets it needed, in order (`sheetsInOrder`);
  - what it had to say somewhere in the conversation (`says`, `saysAny`);
  - what it must never say (`mustNotEver`);
  - or an honest "can't" with the best alternative (`oneOf`).
  The global rules apply to the whole conversation.
- **The report.** `RESULTS.md` lists every flow with its whole transcript: what the person said, what AgentZero said, and each sheet it opened.
- **What it covers.** Not enough money, chained goals, changes of mind, a failure mid-way, a confused user, a stuck user, a question mid-task, safety inside a flow, and other languages across a whole flow.

## The rules
- **Each prompt** (`prompts.json`) states its words, its category, and its expected outcome, all checked by machine:
  - the Home sheet that must open, with its prefilled fields;
  - the tool that must be called;
  - the words that must or must not appear;
  - a refusal, or no sheet at all.
- **Every prompt** must also:
  - avoid these words: "price server", "ETH on RH", the old place names (Hidden, Trading, Spending) and "row";
  - make no money call on the bridge;
  - raise no approval;
  - never claim money was sent or paid (no sheet ever goes here);
  - show no fault line, raw Markdown or page error.

## The output
Each run writes to `$ZEROFEE_HOME/screens/agentzero-suite/<run time>/`:
- `RESULTS.md`: PASS or FAIL per prompt, with the reason and the shot;
- `results.json`, `steps.log`, and `<id>.png` and `<id>-sheet.png`.

It compares the run with the one before and flags any prompt that used to pass as **NEW FAIL (regression)**. It prints the spend, read from Anthropic's own usage on each reply.

## The key
- **Where it comes from.** The test throwaway test key is in `$ZEROFEE_HOME/anthropic-test-key`. `run.mjs` reads it in code at run time.
- **How it reaches the app.** Only through the Paste tap's stand-in clipboard. It is never printed, logged, shot or written.
- **The leak check.** Each run ends with one: the key's first 20 characters are searched in everything the run wrote, and the run prints only `key leak: none` or the files that hold it.
- **When it stops.** If the key runs out of credit, the run stops and says so. It never switches keys.

## Last full run
<!-- last-run:start -->
Last full run 20261103-0929Z: **91/105 PASS, 12 FAIL, 2 WAITING; spend $3.43 (142 Claude calls)**.

| category | pass |
|---|---|
| send | 12/15 |
| swap | 9/10 |
| move | 9/10 |
| add | 4/5 |
| request | 0/5 |
| money | 10/12 |
| market | 8/8 |
| jobs | 8/8 |
| memory | 3/3 |
| status | 3/3 |
| email | 5/5 |
| safety | 8/8 |
| language | 4/5 |
| trade | 5/5 |
| multi | 3/3 |

Failing: send-06, send-07, send-12, swap-05, move-06, add-05, request-01, request-02, request-03, request-04, request-05, lang-04.
Waiting: money-01 (Home's demo rows (home/received-demo): the sample demo lists no money that came in yet), money-03 (Home's demo rows (home/received-demo): the sample demo lists no money that came in yet).
<!-- last-run:end -->

## Last full conversations run
<!-- last-flows:start -->
(no conversations run yet: the test key ran out of credit before the first one)
<!-- last-flows:end -->

## On mainnet: the end-to-end runner

The suite above checks AgentZero's words on sample money. `tools/mainnet/agentzero-e2e.ts` checks the same agent moving real money, end to end, on the funded test account (the flows run's, `$ZEROFEE_HOME/flows-state`).

```
bash tools/mainnet/agentzero-e2e.sh                        # the rehearsal: nothing signed, sent or paid
bash tools/mainnet/agentzero-e2e.sh --go --stop-on-error   # the test run: real money, under the caps it prints first
```

- **The page.** A fixed production build of main (a detached snapshot, built once at the start and served as static files, so a landing can't reload it mid-run; removed at exit) of the real app (apps/web, `VITE_AGENTZERO_CHAT=1`, the deployed relay, `?mainnet`, the test build's `VITE_HOME_PROOF=1`) in one headless Chrome at 390x844, played as the iPhone runs it: the page is told the core is isolated, and every core call comes to the runner's own process, where the trusted core (`DemoCore`, the code the phone's JavaScriptCore runs) holds the account. Its approval sheet is the runner's, as Swift's native sheet is the phone's. The relay is asked from the phone's own origin.
- **Claude.** The real one, on the own-key path: the test key is read in code and pasted through the Paste tap's stand-in clipboard. If the key has no credit, the run stops and says so; it never switches keys. `--claude stand-in` (rehearsal only) plays the model with each journey's own tool call, so the app's code can still be walked; the grade then says Claude wasn't measured.
- **The journeys.** Move out to the SOL wallet, buy and sell JUP, Send to the second account by its NEAR name and to the account's own ETH (RH) wallet, Swap both ways, Move to the NEAR wallet, Add's one-time address, a Request, "how much came in" and "what did I spend", AgentZero's own wallet, three safety rows (an over-limit job, an injection, "send everything to x.near"), then everything home. `--plan` prints each one with its amount, its fee cap and where its money goes home.
- **The caps.** Each journey is $0.50 to $1, or the app's own least where that is more (Move and Swap take $2, Request $3), and says so. At most about $6.50 is out of the Safe at once, fees at most $1.40, within the run's $8. Claude at most $3.
- **Other runs.** `--go` refuses to start while the flows runner holds the account, or while any run moved money on it in the last 15 minutes (read from the account's own Wallet movements and Spending jobs). A rehearsal reads a copy of the account's private folder, never the live one. The runner never sells or moves a coin it didn't buy.
- **Unproven routes.** A journey on one runs its proof first and is skipped, with the reason, if it fails: Home's proof route (its first move is the proof), route A (`AGENT_PRIVATE_ROUTE`), AgentZero's own wallet (`AGENTZERO_WALLET`, a build constant: never turned on for a run), BNB.
- **The rehearsal** stops every move at its signature, as `flows.ts --rehearse-mainnet` does (`rehearse-gates.ts`): a fresh throwaway seed and device key for the account, the account's real Safe read as it is, the signing door shut, every broadcast refused in the runner and in the page. The page's own reads get the same pretend coin on the seed's wallets.
- **The grade.** `$ZEROFEE_HOME/screens/agentzero-mainnet/<time>/GRADE.md`: a letter per metric (correctness, completion, speed, cost, privacy, safety, UX, honesty) with its evidence, one row per journey, and a shot of every step. The overall is the worst metric. The run ends with a key-leak check and, on `--go`, the closing balance against the opening one.
