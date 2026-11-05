// The speed budget (2 Nov), so the app can't quietly get slow again. It builds the real app (the same vite config as the
// phone's build, nothing written) and checks what a cold open loads before its first screen and before Home:
// - the JS the lock screen needs, and the JS Home needs, stay under their budgets (bytes, minified);
// - the apps that aren't on screen, the sample-money demo, the screens gallery, the laptop page, Agent's robot (and the
//   Anthropic SDK) and the chart library are never in either;
// - the quadratic base58 code (base58-js) is not in the bundle (an ML-DSA key took a 200 ms task at a phone's speed).
// The numbers are in $ZEROFEE_HOME/SPEED-2026-11-02.md. A change that needs more must raise a budget here, on purpose.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { build, type Rollup } from "vite";

/** Before the 2 Nov speed work: 1,957 KB to the lock screen, 2,028 KB to Home. Home raised 1,600 → 1,605 KB on purpose
 *  (2 Nov, the test release-4 account): 1,598.4 → 1,602.7 KB for account.rules and Security's update card, Top up's
 *  "Update my protection" step, the real wait in its over-band words, the details line of "went wrong", Settings' address.
 *  1,616 → 1,620 KB (UX walk 2 Nov): Top up names rules already saved and opens them in place, before any quote; Top up
 *  starts within the Face ID band; the Waiting screen's Back.
 *  1,620 → 1,624 KB (2 Nov): Make your key's two keys. 1,624 → 1,628 KB (J3 part 2, 2 Nov): the core's Chat name note and NEAR
 *  rooms (chat-keys.ts, chat-near.ts, in the web's own core) and Send's own NEAR-name check; Chat's NEAR reads load later.
 *  1,628 → 1,632 KB (Job 1, part d): Home paints from the coins last read on this device, a read that fails is one line
 *  with Retry (ReadLine), a slow launch opens Home from the account last read, and Send's person and amount share one screen.
 *  1,632 → 1,636 KB (Job 3, 2 Nov): each site's own wallet in the web's own core (site-wallets.ts, its key path, the binding
 *  to its site, Spending's site rows); the site app's window and settings load later.
 *  1,636 → 1,640 KB (Home redesign, 2 Nov): Home's Safe | Spending toggle and its four actions, the account's rows behind
 *  the menu glyph, and Swap's sheet (one more money sheet, in Home's first load as Send's is).
 *  1,640 → 1,650 KB (Social trading, 2 Nov): in the web's own core, Move back (a site wallet's two confidential legs and
 *  the grant for one move), the plain sign-in allow-list, and Spending's Add for a site (the engine's move on, after its
 *  gap); Social trading's screens, its two money sheets and the site wallets' set-up load later.
 *  1,650 → 1,660 KB (Job 2, onboarding, 2 Nov): in the web's own core, words first (the check before the money and its
 *  mark), the deposit watcher (each coin read on its own chain) and the swap's ETA; set-up's honest timing words. The
 *  money screens themselves still load later.
 *  1,660 → 1,675 KB (B28/B30, never blocked, 2 Nov, with TN1 landed beside it): the ledger keeps the coin list and the bridge table apart and on the
 *  device (the shipped snapshot loads only when both services fail and nothing is kept), the named service lines and the
 *  status banner over every screen.
 *  1,675 → 1,684 KB (TN2, NEAR coins in Trade, 2 Nov): in the web's own core, the swap inside Spending (a confidential quote from and into
 *  Spending, its read-back checks, its fair floor, its sheet's words, the Trade session's cover, and its security review's
 *  fixes: one swap at a time, the price's type and deadline pinned, plain coin names): 9.4 KB measured; Trade's NEAR
 *  engine, its words and NEAR's market reader load later.
 *  1,684 → 1,686 KB (ST10/ST11, 2 Nov): Social trading's site window, its own money: the auto move from the window's ask, its
 *  lines and AgentZero's receipts (SiteApp, MoneyHost, SiteMoney): under 1 KB measured, over the line by a fraction.
 *  1,686 → 1,687 KB (AgentZero pre-switch, 2 Nov): the core's account.agent.cancelWaiting entry (a stopped job's looser
 *  budget never lands later; security review M4), its plan loaded later in agent-private.ts with the rest of AgentZero's
 *  payments: 0.27 KB measured (1,685.89 → 1,686.16), over the line by a fraction.
 *  1,687 → 1,689 KB (B27 D85, 2 Nov): Chat's sends from Private only, in the one money sheet (SendSheet's guards,
 *  the short line with its one tap, chat-private.ts) and the engine's privateOnly: Home measured 1,689 KB.
 *  Chat itself loads later.
 *  1,689 → 1,691 KB (B33, 3 Nov): the core's history reads say what failed (FastNEAR named, each failure logged, a
 *  failed batch keeps its rows, the key list fallback): Home measured 1,690.15 KB, over the line by a fraction.
 *  B27, AgentZero's chip in Chat (3 Nov): the one lazy import that sets AgentZero's payer (agentzero-start.ts, its engine on
 *  first use): a few hundred bytes, inside the line above.
 *  1,691 → 1,693 KB (AgentZero on a computer, D101, and D103's web check, 3 Nov): the core's account.agent.pairComputer
 *  entry, the agent methods' loosening gate, and the web's lazy userVerified hook (its passkey code loads only when asked);
 *  the pairing itself (ML-KEM-768, scrypt words, the seal) loads later with AgentZero's payments. Measured with a real
 *  install: main 1,690.43 KB, this change 1,692.98 KB. Correction: the 1,686 → 1,687
 *  raise above was measured in a worktree whose node_modules were symlinks to main's (~0.26 KB heavier than main);
 *  that raise was likely not needed.
 *  1,693 → 1,694 KB (ST7, the buy sheet sooner, 3 Nov): the core's signing reads run side by side (the blockhash check
 *  beside the test run, SOL's price asked once per 30 s) and a transaction whose accounts can't be read is never covered.
 *  Measured with a real install: main 1,692.99 KB, this change 1,693.72 KB (+0.72 KB); the core is in Home's load, and
 *  nothing there was spare to trim.
 *  1,694 → 1,696 KB (B36 and D109, 3 Nov): the core's signing path, not words (S1's sheet words load with the sheet,
 *  sol/trade-words.ts): the test run's account read in tens on its own node list, a buy one server checked bounded by its
 *  own bytes, the coin's decimals read from its mint, the decoder's own-wSOL check. Measured with a real install on main
 *  3 Nov: 1,692.96 KB; with B36 and its words in the first load 1,697.94 KB; with the words loaded with the sheet
 *  1,695.94 KB (+2.98 KB).
 *  1,696 → 1,698 KB (P3, AgentZero's pocket day, D107, 3 Nov): the core's account.agent.pocket* doors and SubWallets' part
 *  of the day, which can't load later: the Stop count, the synchronous end (Stop and pause end the day at once, before
 *  NEAR is asked), and the narrow host that lends the day only the pocket's own wallet, its checks and its key. The day's
 *  rules, words and state load later (core/agent-pocket.ts). Measured with a real install: main 1,695.94 KB, this change
 *  first 1,700.86 KB (+4.92), with the day moved out 1,697.66 KB (+1.72 KB); main had 0.06 KB of room.
 *  1,698 → 1,700 KB (Home V4 rows, FLOW-V4 piece 2, 3 Nov): Home's number is one formula with the total kept for the next
 *  cold open (trading.ts: Spending, a closed chain's money, NEAR coins, site wallets; partial means "updating…"), the
 *  native coin amount through the engine (coinAmount), and the read-only trade.positions for each row's held coins.
 *  Trimmed first: the Safe sheet loads on its first tap (-1.4 KB) and one sub-row element serves both kinds. Measured on
 *  main e3e3a1cb 1,695.94 KB, with this change 1,697.27 KB (+1.33 KB, worktree links); on top of P3's 1,697.66 KB that is
 *  about 1,699 KB.
 *  1,700 → 1,702 KB (V4 Send, Hidden / Plain, 3 Nov): the toggle, the can't-carry line and its Plain offer, the review's
 *  guards. Trimmed first: Send loaded on first ask (fails the never-blocked rows: the sheet must paint at once). Measured
 *  in the worktree: without Send's change 1,699.89 KB, with it 1,701.69 KB (+1.80 KB).
 *  1,702 → 1,705 KB (V4 Move put-in, 3 Nov): the core's Move legs (spending.topUp reads them strictly: a row once, $2
 *  each, adding to the whole) and the engine's legs going on to each row's own wallet after the private gap; the Move
 *  sheet itself loads on its first tap (it can't go lazier: the legs' check and the engine's legs are the core's, which
 *  is in Home's load). Measured with a real install: main ad61eac7 1,699.90 KB, with Move 1,702.18 KB (+2.28 KB).
 *  1,705 → 1,707 KB (V4 Move take-out, 3 Nov): the engine's take-out from the rows picked (each its amount or All, one
 *  move in each, then one move home) and the core's check of those legs, merged with put-in's into one function; the
 *  sheet loads on its first tap. Measured on the Move branch 1,702.18 KB, with this change 1,703.66 KB (+1.48 KB). *  1,707 → 1,709 KB (V4 Move, every site wallet under one sheet, 3 Nov): the core's subwallet.site.moveBackAll (each leg
 *  checked as one move back, the one sheet listing every leg, each leg run after the one yes); trimmed first by sharing
 *  that leg check with the single move back (-0.83 KB). Measured in the worktree: without 1,705.66 KB, with 1,707.67 KB.
 *  1,709 → 1,711 KB (V4 Send FROM a row, Plain, 3 Nov): the rows in the coin picker and the row's own send on the core's
 *  sheet. Trimmed first: the rows' pieces load with the sheet's first read (-0.3 KB). Measured in the worktree on main
 *  670a525d: without 1,708.78 KB, with 1,710.28 KB (+1.50 KB).
 *  1,711 → 1,713 KB (V4 Add on its way, 3 Nov): the core's read of an Add 1Click has seen (its own outside addresses,
 *  the signed figures, ended ones never asked again) and Home's hook for it. Trimmed first: the line's words and its
 *  20 s watch load after Home's first paint (-0.35 KB). Measured with a real install: main 1,710.28 KB, with this 1,712.07 KB (+1.79 KB).
 *  1,713 → 1,715 KB (S-1, the Safe's guard, 3 Nov): the core's first-load hooks only: what this phone placed or added is
 *  recorded (so its own changes aren't news to it), the second device's alerts door and the lazy imports; the guard
 *  itself (key words, the diff, the second device's poll) loads later in guard-dog.ts. Measured with a real install on
 *  main 3d503a4f: without 1,712.07 KB, with 1,713.64 KB (+1.57 KB).
 *  1,715 → 1,716 KB (AgentZero chat L2-L6, D122, 3 Nov): one line in App.tsx that hands the Browser app's bridge to
 *  AgentZero's live card (the lazy chat never imports the shell's core: doing so split the core into its own chunk,
 *  +3.9 KB, trimmed). Measured with a real install: main 1,714.96 KB, this change 1,715.15 KB (+0.19 KB). 
 *  1,716 → 1,725 KB (V4 Send: Hidden from the SOL row under one Approve, 3 Nov): the core's two-leg sheet and its checks
 *  (subwallets hiddenFromRow), the ledger's leg-by-leg follow, the three lines, the demo's answer. Core and ledger code
 *  runs in the first load and can't be split off the signing path. Measured in the worktree on bf0546ba: without
 *  1,712.39 KB, with 1,720.94 KB (+8.55 KB).
 *  1,725 → 1,723 KB (the same, trimmed, 3 Nov): the ledger's part (leg 2's submit and its watch, hidden-row.ts) loads with
 *  its first use (-1.73 KB: 1,724.30 → 1,722.57 KB). What stays is the core's two-leg check and sheet (subwallets.ts: the
 *  phone's core is one bundle that JavaScriptCore loads whole, so it isn't split) and the demo's answer.
 *  1,723 → 1,724 KB (V4 Send: Hidden from the ETH on Robinhood row, 3 Nov): the core's leg 1 on Robinhood Chain (its gas
 *  room read before the sheet, the fee cap, the transfer through payPlain held to that room) and the row's coin as a
 *  parameter; the ledger's part still loads with its first use, and Send's row line went; Send's "On Robinhood Chain"
 *  for an EVM address on that row. Measured with a real install on main 6fc12cd2: without 1,722.46 KB, with 1,723.38 KB
 *  (+0.92 KB).
 *  1,724 → 1,725 KB (D119 perps, landing 2, 3 Nov): the core's one lazy door to perps.* (demo-core.ts, one line) and
 *  perps as a Trade-only core family in the bridge (CORE_NAMES, APP_EXTRA, the app stamp). Everything of perps itself
 *  (Hyperliquid's signing, the rules, the service, the tab) loads later. The cost is the bundler's: the modules the lazy
 *  perps code shares with the core move into one shared chunk (+0.46 KB of import lists). Trimmed first: perps' entry
 *  checks moved into the lazy chunk (1,716.18 → under 1,716 before main moved), and a dependency-free door module saved
 *  only 0.04 KB (dropped). Measured with a real install on main 61a70bf2 rebased: without 1,723.38 KB, with 1,724.37 KB
 *  (+0.99 KB).
 *  1,725 → 1,726 KB (H-3 statement + the pulse's kept line, 3 Nov): the iPhone bridge's Wallet-only check for
 *  device.shareFile (host/ios.ts, its security review's L7: +0.07 KB), Activity's Statement row and the sheet's lazy
 *  loader, and Home's pulse line kept one line high from the first paint. The statement itself (statement.ts, its sheet)
 *  loads on its first tap. Trimmed first (1,725.43 → 1,724.995 before the check): the row is the shared NavRow, one state
 *  for the sheet, the line's height in CSS (no text), no test id in the build, the coin rule kept out of format.ts.
 *  Measured with a real install on main bdedde57: without 1,724.37 KB, with 1,725.06 KB (+0.69 KB).
 *  1,726 -> 1,727 KB (Hidden from a row, review Lows 4-5, 3 Nov): leg 1's network fee named on the core's one sheet (with
 *  dollars at the core's own price) and a leg 1 never handed to a node coming off the list of moves into Hidden. The
 *  core's sheet is in the phone's one bundle. Measured with a real install: main 26cbbe41 about 1,725.90 KB, with this
 *  1,726.32 KB (+0.42 KB).
 *  ST3 (3 Nov) fits inside 1,727 KB: the core's subwallet.site.addCost entry and the one method that loads
 *  site-add-cost.ts with the first ask (the price code itself is not in the first load; trimmed from +0.81 KB): +0.43 KB.
 *  1,727 -> 1,728 KB (one EVM wallet, one send at a time, 3 Nov): the core's keyed turns, the held number and its check
 *  at prepare and at signing (sendCall, payPlain, Trade's and sessions' signing). Measured with a real install: main
 *  058f43e7 1,726.75 KB, with this 1,727.63 KB (+0.88 KB).
 *  1,728 -> 1,729 KB (H-5 Scan to pay, 3 Nov): the scan glyph at the end of Send's "where to" field (Pay's TrayScan),
 *  a fresh form for each scan (one key), the memo shown beside the address, a request's reference sent with it, and
 *  the sheet's lazy loader with its preload list. The camera sheet and
 *  the code reader (ScanSheet.tsx, scan.ts, 7.3 KB) load on the glyph's first tap (NEVER_FIRST below). Trimmed first:
 *  no test id in the build, the bank code's Pay hand-off inside the lazy sheet, the form's own resets replaced by the key,
 *  the sheet's own setMode as the reset. Measured with a real install: main
 *  96113b22 1,727.63 KB, with this 1,728.86 KB (+1.23 KB, with the security review's fixes).
 *  1,729 -> 1,731 KB (ST fixes, 3 Nov: QA's two Highs, F4/F5 and their review's M1/M2/L3/L5): Spending's one Top up at a
 *  time with its move key and a 5-minute end (two calls never raise two Approves), the Add's own row when its leg 2 is
 *  refused at once or later, and the core's mark on AgentZero's act door moves (the person's own Add is never credited to
 *  AgentZero). Trimmed first (the leg-2 check folded into one catch). Measured with a real install: main 3f791104
 *  1,727.63 KB, with these 1,729.48 KB (+1.85 KB); rebased on afce5757, 1,730.80 KB.
 *  1,731 -> 1,653 KB (trim, 3 Nov, room for onboarding): Send's sheet loads when Send is asked for, as Add and Swap do
 *  (MoneyHost's SendLater: "Send" and one line until its code is here). With it, Pay's engine, its Confirm and Send's
 *  form, guard hooks and link readers left the first load. Measured with a real install on main: 1,730.83 -> 1,651.99 KB
 *  (-78.8 KB); the budget is that plus 1 KB.
 *  1,653 -> 1,654 KB (A-4 Siri and Shortcuts, 3 Nov): the shell's hook that takes an intent on the phone; its reader
 *  (host/intent.ts) loads after the paint, so what stays is the lazy import's loader. Trimmed first (the reader and its
 *  pay imports moved out of the first load: 1,653.33 -> 1,653.19). Measured with a real install on main b439d38c:
 *  1,652.90 -> 1,653.19 KB (+0.29 KB).
 *  1,654 -> 1,322 KB (D134, an instant Home, 3 Nov): the page's own core (DemoCore, SecondDeviceCore: the phone runs its
 *  core in Swift's context) loads on its first use (host/later-bridge.ts), and the protection constants two screens
 *  read moved to core/protection-bands.ts. Measured with a real install: this change 1,320.73 KB in 31 chunks (main last 1,653.19 KB, 54
 *  chunks); the budget is that plus 1 KB.
 */
/**
 * Headroom (3 Nov): Settings and the account's own parts (SecurityApp: its rows, places, holds and record, with the
 * guardian's QR code, Protection, email alerts) load when first drawn (App.tsx later()), fetched once Home is up so
 * their first tap is as quick as before. Measured on main eed3563b: 1,223.65 KB with this (about 98 KB out). The budget
 * keeps room for the three changes queued (prefill, reads, the Activity centre: about 17 KB together) and 4 KB more.
 */
/**
 * 1,245 -> 1,248 KB (data stream slice 2, 3 Nov: node-health.ts): every free node scored per chain, so a screen's read
 * goes to the healthiest one and a 429 means the next node answers; the core's Solana token read asks the node that
 * serves it. It sits in the chain readers Home reads with. Trimmed first (the soak's counters left out): measured with a
 * real install, main 9139da20 1,244.9 KB, with this 1,247.8 KB (+2.9 KB).
 */
/**
 * 1,248 -> 1,256 KB (the web wallet, product decision, 4 Nov: release today, web first): the start must know at once whether
 * this browser holds a password wallet (mode.ts, UnlockGate's password, web-start, the core's web allowlist), so that
 * part sits in the first load. Trimmed first: the web Add and Settings' key rows load on first use (AddSheet.tsx,
 * SettingsPanel.tsx). Measured on this branch: 1,251.5 KB; the rest is room for the trains landing with it.
 */
/**
 * 1,256 -> 1,260 KB (bug report, 4 Nov: the bar like YouTube's, and the shared motion): the tab bar is on Home's first
 * screen, so its capsule, its sliding pill and the motion it springs with (packages/design motion, bar-scroll.ts) load
 * with it. Measured on main 35da4900c plus this branch: 1,258.0 KB.
 */
/**
 * 1,260 -> 1,262 KB (security core, audit finding 2): the old wallets' money counts in Private's total on Home's first
 * screen while it moves to the new backup words' wallets (format.ts privateAllUsd and its line, the ledger's old rows).
 * Measured on main 902d0b104 plus this branch: 1,260.4 KB.
 */
/**
 * 1,262 -> 1,263 KB (product decision, 4 Nov: the public website opens black): the first script reads the build's mode to pick the
 * theme, and keeps only a pick (shell/theme.ts). Main d01d07bce + the passkey branch measured 1,262.0 KB; with this, 1,262.2.
 */
/**
 * 1,263 -> 1,264 KB (product decision, 4 Nov: no "busy"/"slow" banner unless our paid door fails): the paid door is asked twice
 * more before a free node, and the banner shows busy only when the relay's own check agrees. Main measured 1,262.4 KB;
 * with this branch, 1,263.0.
 * 1,264 -> 1,265 KB (a bug report and QA's mainnet crawl, 4 Nov): one pool per coin in Trade's market (the list,
 * the page and the live price on the deepest pool: 0.8 KB), the figures read again after a landing (float-core), the
 * core's one-server sale rule. Main a4f074ecc: 1,263.1 KB; with this, 1,264.1. The Buy sheet's gas line loads with the
 * sheet (app/gas-after.ts), never here.
 * 1,265 -> 1,267 KB (the Sim's D grade, 4 Nov): a tab keeps its own Sim or Real across a reload (mode.ts pinTabMode),
 * Send and Swap open on Private (D70), Move's Safe row says what leaves the Safe, the total read once for the Sim's
 * AgentZero. Main d3289beb8: 1,264.1 KB; with this, 1,265.7.
 * Inside 1,267 KB (bug report, 5 Nov): the engine answers once a job is saved
 * and counts a saved job against its money (float-core), the bell's one pulse per job (TaskBell, tasks.ts). Main
 * 974119ab6: 1,264.8 KB, with this 1,265.7 (+0.9); on bebcec7d9 with the Sim D bloc, 1,266.6. The job's sheet, its row and Move's run load with Move (job-start.ts, move-run.ts).
 */
/**
 * 1,267 -> 1,268 KB (QA's crawl, 5 Nov): the service notice keeps one spell and one clock (status-spell.ts), and
 * Activity and Settings opened from Your account carry their way back. Main d21e2ac76 measured 1,266.64 KB; with this, 1,267.53.
 * 1,268 -> 1,269 KB (bug report, 5 Nov: the pump.fun top-up): a site's Add is one Activity row, done only once its move on
 * landed (spending.ts, float-core's leg fold), and a site's wallet is its own row on Home that opens its page (safe-hot.ts siteSections).
 * Main a5a80b6d8 plus this branch: 1,268.3 KB (+0.8).
 * 1,269 -> 1,270 KB (review, 5 Nov): a parked remainder under $2 goes home from its Activity row (activity-rows.ts,
 * spending.ts putAway {parked}); fix/site-topup-retry's Take out row already near the line.
 */
/**
 * 1,268 -> 1,271 KB (budget check, one raise for the queued train, 5 Nov): main e2556a99e measured 1,267.8 KB. Measured adds
 * of the branches waiting to land, each on main: the sheet's spring +0.56 (fix/app-feel), the approval id for "Job created"
 * +0.5 (fix/instant-jobs-2), Send's coins and strict addresses +0.46 (feat/send-any, send-chains), Swap's door +0.2,
 * the door score +1.16 (fix/resilient-reads), Move's job journal +1.86 (fix/move-steps): 1,272.5 if all were eager; 1,271.
 */
/**
 * 1,271 -> 1,274 KB (budget check, the second measured raise of 5 Nov): the branches queued after 981591540, each measured on
 * its rebased tree: Move's private route 1,272.1 (fix/move-private on move-cuts: ledger +1.0, float-core +0.7), lap fails +0.4,
 * the chart's own units +0.11 (fix/trade-pnl-chart), the reads' kept line and focus read (S4, S5) under 1,270.2. About 1,273.3
 * if all land together; 1,274.
 */
/**
 * 1,274 -> 1,277 KB (budget check, the third measured raise of 5 Nov): Move's private route with its old-words guard and
 * one-leg fill (fix/move-private + fix/fill-intents, 1,273.99 on their rebased tree), the take-out resumer (fix/parked-home
 * +1.82) and the site top-up's one exit (fix/topup-direct-2 +0.38): 1,276.19 measured on 04b77d580; 1,277.
 */
export const BUDGET = { lockKB: 700, homeKB: 1_277 };
/** Never in the first load (lock screen or Home): code for screens that aren't on it. */
const NEVER_FIRST = [
  // D134: the page's own core (the phone's runs in Swift's context): a browser loads it as the app first asks
  /\/packages\/core\/src\/demo-core\.ts$/,
  /\/packages\/core\/src\/second-device\.ts$/,
  // home/reads on D134: Home's part-by-part readers and another app's Add money on a network load after the first paint
  /\/packages\/wallet\/src\/app\/(home-reads\.ts|money\/AddMoney\.tsx|screens\/Sheets\.tsx)$/,
  // smooth (product decision, 3 Nov): the compositor's flights and the Waiting screen load with the shell's neighbours
  /\/apps\/web\/src\/shell\/(slide\.ts|WaitingView\.tsx)$/,
  // set-up's coins and steps (7.6 KB): Home reads only its switch (fund-every-chain.ts). It joined Home's first chunk or
  // not depending on the folder's path (rolldown's chunking); now no first-load module imports it, on any path
  /\/packages\/core\/src\/fund-start\.ts$/,
  // the 5 Nov diet (1,275.5 -> 1,220.7 KB): set-up's, recovery's and the terms' screens and the 2,048 backup words load
  // beside the boot when no account is open here, or once Home is up (App.tsx setupScreens); Home keeps only Working.tsx
  /\/apps\/web\/src\/screens\/(Onboarding|Recovery|Terms|WordCheck)\.tsx$/,
  /\/apps\/web\/src\/screens\/(word-entry|renew-move)\.ts$/,
  /\/apps\/web\/src\/terms\.ts$/,
  /node_modules\/@scure\/bip39\//,
  // the 3 Nov trim: Send's sheet and its form load when Send is asked for
  /\/packages\/wallet\/src\/app\/money\/SendSheet\.tsx$/,
  /\/packages\/wallet\/src\/app\/money\/SendForm\.tsx$/,
  // D137: the live cards, their tracker and the steps' logic load after Home's first paint; Move's Safe ↔ NEAR wallet
  // sheets and the cap's load when asked for (money/pots.ts is all the host reads of them)
  /\/packages\/wallet\/src\/app\/money\/(LiveTrack\.tsx|live-steps\.ts)$/,
  /\/packages\/wallet\/src\/app\/screens\/Spending\.tsx$/,
  // D144: the Activity centre's sheet loads on the icon's first tap
  /\/packages\/shell-api\/src\/TaskCentre\.tsx$/,
  // headroom (3 Nov): Settings and the account's own parts (its rows, places, holds; the guardian's QR code with them)
  // load when first drawn, fetched once Home is up (App.tsx later())
  /\/apps\/web\/src\/apps\/security\/(SecurityApp|GuardianSide|Protection)\.tsx$/,
  /\/apps\/web\/src\/shell\/SettingsPanel\.tsx$/,
  /node_modules\/qrcode-generator\//,
  // V4 Send: Hidden from a row, the ledger's part: loads with its first use
  /\/packages\/wallet\/src\/hidden-row\.ts$/,
  // ST3: a site Add's price (two dry quotes): loads with the Browser's money sheet's first ask
  /\/packages\/core\/src\/site-add-cost\.ts$/,
  // H-5 Scan to pay: the camera sheet and the code reader load on the first tap of Send's scan glyph
  /\/packages\/wallet\/src\/app\/money\/(ScanSheet\.tsx|scan\.ts)$/,
  // the tray's locked apps (product decision, 3 Nov): their tiles and "Coming soon." sheet load after the first paint
  /\/apps\/web\/src\/shell\/locked-apps\.tsx$/,
  /\/packages\/trade\/src\/app\//,
  /\/packages\/(agent|earn|extension-app|chat)\/src\/app\/.*\.tsx$/,
  /\/packages\/browser\/src\/(app\/BrowserApp|social\/SocialApp)\.tsx$/,
  /\/packages\/agent\/src\/robot\//,
  /node_modules\/@anthropic-ai\/sdk\//,
  /node_modules\/lightweight-charts\//,
  /\/apps\/web\/src\/gallery\/.*\.tsx?$/,
  /\/apps\/web\/src\/laptop\/Laptop\.tsx$/,
  /\/packages\/shell-api\/src\/MockBridge\.ts$/,
];
/** Never on the lock screen: the account's core and its set-up screens (they load after the unlock, or on a new device). */
const NEVER_LOCK = [/\/packages\/core\/src\/demo-core\.ts$/, /\/apps\/web\/src\/screens\/Onboarding\.tsx$/, /\/apps\/web\/src\/App\.tsx$/];

type Chunk = Rollup.OutputChunk;
let chunks: Map<string, Chunk>;

before(async () => {
  // the release build: never the mainnet copy (VITE_FORK=1, packages/core/src/fork.ts), whatever this shell says
  delete process.env.VITE_FORK;
  const root = fileURLToPath(new URL("..", import.meta.url));
  const out = (await build({ root, configFile: `${root}/vite.config.ts`, logLevel: "silent", mode: "production", build: { write: false, reportCompressedSize: false } })) as Rollup.RollupOutput | Rollup.RollupOutput[];
  const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => o.output);
  chunks = new Map(outputs.filter((o): o is Chunk => o.type === "chunk").map((c) => [c.fileName, c]));
});

/** A chunk and everything it imports statically (what the browser loads before running it). */
function closure(names: string[]): Set<string> {
  const seen = new Set<string>();
  const go = (n: string) => {
    if (seen.has(n) || !chunks.has(n)) return;
    seen.add(n);
    chunks.get(n)!.imports.forEach(go);
  };
  names.forEach(go);
  return seen;
}
const named = (re: RegExp) => [...chunks.values()].find((c) => c.facadeModuleId && re.test(c.facadeModuleId))?.fileName;
const kb = (set: Set<string>) => [...set].reduce((n, f) => n + chunks.get(f)!.code.length, 0) / 1024;
const modules = (set: Set<string>) => [...set].flatMap((f) => Object.keys(chunks.get(f)!.modules));

function firstLoads() {
  const entry = [...chunks.values()].find((c) => c.isEntry)!.fileName;
  const fullApp = named(/\/apps\/web\/src\/full-app\.tsx$/);
  const app = named(/\/apps\/web\/src\/App\.tsx$/);
  assert.ok(fullApp && app, "the build has the full app and the App chunk");
  return { lock: closure([entry, fullApp]), home: closure([entry, fullApp, app]) };
}

test("the lock screen and Home load within their JS budgets", () => {
  const { lock, home } = firstLoads();
  assert.ok(kb(lock) <= BUDGET.lockKB, `the lock screen loads ${kb(lock).toFixed(0)} KB of JS (budget ${BUDGET.lockKB} KB)`);
  if (process.env.ZF_SHOW_KB) console.log(`lock ${kb(lock).toFixed(1)} KB, home ${kb(home).toFixed(1)} KB`);
  assert.ok(kb(home) <= BUDGET.homeKB, `Home loads ${kb(home).toFixed(0)} KB of JS (budget ${BUDGET.homeKB} KB)`);
});

test("apps that aren't on screen, the demo, the gallery and Agent's robot are never in the first load", () => {
  const { lock, home } = firstLoads();
  const homeMods = modules(home);
  for (const re of NEVER_FIRST) assert.deepEqual(homeMods.filter((m) => re.test(m)), [], `${re} is in Home's first load`);
  const lockMods = modules(lock);
  for (const re of NEVER_LOCK) assert.deepEqual(lockMods.filter((m) => re.test(m)), [], `${re} is on the lock screen's first load`);
});

/** AgentZero's own code (product decision, 3 Nov: nothing AgentZero adds sits in Home's first load, and no raises for it): the agent
 *  package, AgentZero's screens, and the core's AgentZero files (its door, its swap checks, its pocket, wallet, credit,
 *  identity, mailbox and the rest). Each loads with AgentZero, never with Home. */
const AGENTZERO_ONLY = [
  /\/packages\/agent\/src\//,
  /\/apps\/web\/src\/agentzero\//,
  /\/packages\/core\/src\/(?:agent-[a-z-]+|mailbox|mail-keys|guard-dog)\.ts$/,
];

test("nothing of AgentZero's own is in Home's first load (control: each family is in the build, so the check can find it)", () => {
  const { home } = firstLoads();
  const homeMods = modules(home);
  for (const re of AGENTZERO_ONLY) assert.deepEqual(homeMods.filter((m) => re.test(m)), [], `${re} is in Home's first load: load it with AgentZero`);
  const all = [...chunks.values()].flatMap((c) => Object.keys(c.modules));
  for (const re of AGENTZERO_ONLY) assert.ok(all.some((m) => re.test(m)), `control: ${re} matches a module of the build`);
  for (const f of ["agent-door", "agent-convert", "agent-pocket", "agent-route"]) assert.ok(all.some((m) => m.endsWith(`/packages/core/src/${f}.ts`)), `control: ${f}.ts is in the build`);
});

test("the web words held until the lock (web-words-held.ts) are one module in one chunk, in Home's first load, and the start's chunk imports that same chunk (control: the start is a chunk of its own)", () => {
  const isHeld = (m: string) => /\/apps\/web\/src\/screens\/web-words-held\.ts$/.test(m);
  const holders = [...chunks.values()].filter((c) => Object.entries(c.modules).some(([m, info]) => isHeld(m) && info.renderedLength > 0));
  assert.equal(holders.length, 1, `web-words-held.ts is in ${holders.map((c) => c.fileName).join(", ")}: two copies would be two memories`);
  const { home } = firstLoads();
  assert.ok(home.has(holders[0]!.fileName), "the App's take is in Home's first load");
  const start = [...chunks.values()].filter((c) => Object.keys(c.modules).some((m) => /\/apps\/web\/src\/screens\/web-start\.ts$/.test(m)));
  assert.equal(start.length, 1, "control: web-start.ts is in the build once");
  assert.ok(!home.has(start[0]!.fileName), "control: the start (with the word list) loads later");
  assert.ok(closure([start[0]!.fileName]).has(holders[0]!.fileName), "the start's keep is the held chunk's own");
});

test("D134: the page's own core is out of Home's first load but still in the build, for the browser (control)", () => {
  const all = [...chunks.values()].flatMap((c) => Object.keys(c.modules));
  for (const f of ["demo-core", "second-device"]) assert.ok(all.some((m) => m.endsWith(`/packages/core/src/${f}.ts`)), `control: ${f}.ts is in the build`);
});

test("they still load when shown: each app has its own chunk", () => {
  for (const re of [/TradeApp\.tsx$/, /SocialApp\.tsx$/, /AgentApp\.tsx$/, /EarnApp\.tsx$/, /BrowserApp\.tsx$/, /ExtensionApp\.tsx$/, /Screens\.tsx$/, /Demo\.tsx$/, /LaptopGate\.tsx$/]) {
    assert.ok(named(re), `no chunk of its own for ${re}`);
  }
});

/** Every chunk a chunk can ever load, static or later (dynamic imports too), not looking past `stop` (the page's entry
 *  and full-app.tsx, which pick Sim or Real: their own later loads are the other mode's, never the page's). */
function reach(names: string[], stop: ReadonlySet<string> = new Set()): Set<string> {
  const seen = new Set<string>();
  const go = (n: string) => {
    if (seen.has(n) || !chunks.has(n) || stop.has(n)) return;
    seen.add(n);
    const c = chunks.get(n)!;
    c.imports.forEach(go);
    c.dynamicImports.forEach(go);
  };
  names.forEach(go);
  return seen;
}

// (demo-core.ts itself is in Sim's reach: MockBridge borrows its pure helpers, the recovery choices and the bands; the core
// that holds a key is built only by the page's core.ts, below.)
test("Sim never reaches the real core: nothing the demo page can ever load holds the page's core, the App or a vault (control: the App's does)", () => {
  const demo = named(/\/apps\/web\/src\/gallery\/Demo\.tsx$/);
  const app = named(/\/apps\/web\/src\/App\.tsx$/);
  assert.ok(demo && app);
  const REAL = [/\/apps\/web\/src\/core\.ts$/, /\/packages\/core\/src\/vault\.ts$/, /\/apps\/web\/src\/unlock\/UnlockGate\.tsx$/];
  const pickers = new Set([[...chunks.values()].find((c) => c.isEntry)!.fileName, named(/\/apps\/web\/src\/full-app\.tsx$/)!]);
  const simMods = [...reach([demo], pickers)].flatMap((f) => Object.keys(chunks.get(f)!.modules));
  for (const re of REAL) assert.deepEqual(simMods.filter((m) => re.test(m)), [], `${re} is reachable from Sim's page`);
  const appMods = [...reach([app], pickers)].flatMap((f) => Object.keys(chunks.get(f)!.modules));
  for (const re of REAL.slice(0, 2)) assert.ok(appMods.some((m) => re.test(m)), `control: ${re} is reachable from the real app`);
});

test("the quadratic base58 (base58-js) is not in the bundle: base58-fast.ts stands in", () => {
  const all = [...chunks.values()].flatMap((c) => Object.keys(c.modules));
  assert.deepEqual(all.filter((m) => /node_modules\/base58-js\//.test(m)), []);
  assert.ok(all.some((m) => /\/packages\/core\/src\/base58-fast\.ts$/.test(m)));
});

// The test flight recorder (shell/flight.ts, product decision, 4 Nov) is in the test builds only (VITE_TEST_TRACE=1 with its key
// and id): with the flag off, as here, not a byte of it is in any chunk, so it adds nothing to Home's first load.
test("the test flight recorder is in no chunk of a build without VITE_TEST_TRACE (control: its source names its route)", () => {
  assert.notEqual(process.env.VITE_TEST_TRACE, "1", "this test's build has the recorder off");
  const rendered = [...chunks.values()].flatMap((c) => Object.entries(c.modules)).filter(([m, info]) => /\/apps\/web\/src\/shell\/flight(?:-tap|-seal)?\.ts$/.test(m) && info.renderedLength > 0);
  assert.deepEqual(rendered.map(([m]) => m), []);
  assert.ok(![...chunks.values()].some((c) => c.code.includes("/v0/trace/")), "no chunk names the trace route");
  assert.match(readFileSync(fileURLToPath(new URL("./shell/flight.ts", import.meta.url)), "utf8"), /\/v0\/trace\//, "control: the recorder's source does");
});

// The web app's top note (top-note.tsx, product decision, 5 Nov) is the public build's only: full-app.tsx reads the flag inline, so
// this build (the phone's config, no VITE_ZEROFEE_PUBLIC) holds none of it. The code address itself is in Settings →
// Open source on every build (product decision, 5 Nov late: "phone app should link to the open repo"), in its own lazy chunk.
test("the web top note is in no chunk of a build without VITE_ZEROFEE_PUBLIC (control: its words file says its title); the phone's Settings links the code", async () => {
  assert.notEqual(process.env.VITE_ZEROFEE_PUBLIC, "1", "this test's build is not the public one");
  const { TOP_NOTE_TITLE, TOP_NOTE_LINE_1 } = await import("./top-note-words.ts");
  const rendered = [...chunks.values()].flatMap((c) => Object.entries(c.modules)).filter(([m, info]) => /\/apps\/web\/src\/top-note(?:-words)?\.tsx?$/.test(m) && info.renderedLength > 0);
  assert.deepEqual(rendered.map(([m]) => m), []);
  assert.deepEqual([...chunks.values()].filter((c) => c.code.includes(TOP_NOTE_TITLE) || c.code.includes(TOP_NOTE_LINE_1) || c.code.includes("zf-top-note")).map((c) => c.fileName), []);
  assert.match(readFileSync(fileURLToPath(new URL("./top-note-words.ts", import.meta.url)), "utf8"), /ZeroFee on the web/, "control: the words file does");
  const code = [...chunks.values()].filter((c) => c.code.includes("https://zerofee.si/docs/self-host")).map((c) => c.fileName);
  // and the web wallet's On iPhone page (OnIphoneSheet.tsx, its own lazy chunk: bug report, 5 Nov late), never Home's
  assert.ok(code.length > 0 && code.every((f) => /open-source|OnIphoneSheet/.test(f)), `the code link is in Settings' Open source chunk and the On iPhone page's only: ${code}`);
});

test("the test machines' sign-up token is in no chunk of a build without VITE_ZF_TEST_LANE (control: its source names the header)", () => {
  assert.notEqual(process.env.VITE_ZF_TEST_LANE, "1", "this test's build has the test lane off");
  assert.deepEqual([...chunks.values()].filter((c) => c.code.includes("x-zf-test-token") || c.code.includes("zf.test.token")).map((c) => c.fileName), []);
  assert.match(readFileSync(fileURLToPath(new URL("../../../packages/agent/src/zero/rulebox.ts", import.meta.url)), "utf8"), /"x-zf-test-token"/, "control: the sign-up's source does");
});

test("VITE_FORK off: nothing of the mainnet copy ships (no local node, no Copy words), and the seam is in the build (control)", async () => {
  const { forkTable } = await import("@zerofee/core/fork");
  const all = [...chunks.values()];
  for (const url of Object.values(forkTable())) assert.deepEqual(all.filter((c) => c.code.includes(url.slice("http://".length))).map((c) => c.fileName), [], `${url} is in the build`);
  assert.deepEqual(all.filter((c) => c.code.includes("pretend money on a copy")).map((c) => c.fileName), [], "the copy's mark is in the build");
  assert.deepEqual(all.filter((c) => /127\.0\.0\.1:\d|localhost:\d/.test(c.code)).map((c) => c.fileName), [], "a local address is in the build");
  // control: the seam itself is there (one module, in Home's first load with the node lists), off
  assert.ok(all.some((c) => Object.keys(c.modules).some((m) => m.endsWith("/packages/core/src/fork.ts"))), "control: fork.ts is in the build");
});
