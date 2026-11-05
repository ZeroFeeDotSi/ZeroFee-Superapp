// D119 landing 1, the network proof (Hyperliquid TESTNET only; testnet funds are not real money). The operator runs it
// ONCE, because Hyperliquid's testnet faucet only pays an address that has deposited on mainnet
// (Hyperliquid's own "Testnet faucet" docs page, read 3 Nov 2026), and only the operator has one:
//
//   1. claim the faucet's mock USDC on Hyperliquid's testnet app (its "Drip" page) with that address;
//   2. HL_MAIN_KEY_FILE=<a file holding that address's 0x private key, mode 600> node tools/perps/testnet-proof.ts
//
// The key is read from the file, used in memory, never printed or written anywhere. What it does, on testnet only:
//   a. approves a NEW agent key made here (approveAgent, signed by the main key, 30-day end date);
//   b. control: the agent signs a cancel of an order that doesn't exist: Hyperliquid must ACCEPT the agent's signature
//      (it answers "ok" with the cancel's own error), so a refusal below isn't just a bad signature;
//   c. the agent signs withdraw3 and usdSend to the main address DELIBERATELY: this script signs them straight with the
//      agent's key (hl-sign.ts), going round our own pre-sign refusal (PerpsAgent.signTrade, one guard), so the result
//      is Hyperliquid's own; it must REFUSE both;
//   d. (landing 2) turning perps off REVOKES the agent on Hyperliquid: the main key approves, under the same name, a
//      throwaway address whose key is zeroed at once (revokeAgentAction); the agent's cancel, accepted in (b), must now
//      be REFUSED (Hyperliquid no longer knows the agent);
// and exits 0 only if (b) is accepted, both (c) are refused and (d)'s cancel is refused. Nothing can move: a refused action moves nothing, and
// the destination is the main address itself.
import { readFileSync, statSync } from "node:fs";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { approveAgentAction, HL_TESTNET, revokeAgentAction, signApproveAgent } from "../../packages/core/src/perps/agent.ts";
import { HL_TYPES, hlAddress, l1Digest, signDigest, userSignedDigest } from "../../packages/core/src/perps/hl-sign.ts";
import { fromHex } from "../../packages/core/src/evm/wire.ts";

const file = process.env.HL_MAIN_KEY_FILE;
if (!file) throw new Error("Set HL_MAIN_KEY_FILE to a file holding the testnet address's private key (mode 600).");
if ((statSync(file).mode & 0o077) !== 0) throw new Error("The key file must be mode 600 (chmod 600 it).");
const raw = readFileSync(file, "utf8").trim();
if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) throw new Error("The key file must hold one 0x private key.");
const main = fromHex(raw.toLowerCase());
const mainAddress = hlAddress(main);
const EXCHANGE = `${HL_TESTNET.api}/exchange`, INFO = `${HL_TESTNET.api}/info`;
const post = async (url: string, body: unknown) => {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await r.text();
  try { return { http: r.status, body: JSON.parse(text) }; } catch { return { http: r.status, body: text }; }
};
/** Only result lines go out: never the key, never an address in full (any 0x… of 40+ hex is cut to its ends). */
const say = (s: string) => console.log(s.replace(/0x[0-9a-fA-F]{40,}/g, (h) => `${h.slice(0, 6)}…${h.slice(-4)}`));
const short = (body: unknown) => JSON.stringify(body).slice(0, 160);

const agent = secp256k1.utils.randomSecretKey();
let code = 1;
try {
const state = await post(INFO, { type: "clearinghouseState", user: mainAddress });
const value = Number(state.body?.marginSummary?.accountValue ?? NaN);
say(`main address ${mainAddress.slice(0, 6)}…${mainAddress.slice(-4)} on testnet: account value ${Number.isFinite(value) ? value : "unread"}`);
if (!(value > 0)) { say("STOP: no testnet funds on this address. Claim the faucet first (it needs a mainnet deposit from the same address)."); code = 2; throw new Error("stop"); }

// a. a new agent, approved once by the main key
const agentAddress = hlAddress(agent);
const nonce = Date.now();
const approve = approveAgentAction(agentAddress, nonce + 30 * 86_400_000, nonce);
const approved = await post(EXCHANGE, { action: approve, nonce, signature: signApproveAgent(approve, main) });
say(`approveAgent: ${approved.body?.status === "ok" ? "accepted" : `refused ${short(approved.body)}`}`);
if (approved.body?.status !== "ok") { say("STOP: the approval was refused."); code = 3; throw new Error("stop"); }

// b. control: the agent's signature on a trading action is accepted (a cancel of an order that never existed)
const cancel = { type: "cancel", cancels: [{ a: 0, o: 1 }] };
const n2 = Date.now();
const ctl = await post(EXCHANGE, { action: cancel, nonce: n2, signature: signDigest(l1Digest(cancel, n2, true), agent) });
const accepted = ctl.body?.status === "ok";
say(`control, agent-signed cancel: ${accepted ? "ACCEPTED (the agent's signature is good)" : `not accepted ${short(ctl.body)}`}`);

// c. the agent tries to move money out: both must be refused
const refusedBy = async (type: "withdraw3" | "usdSend") => {
  const time = Date.now();
  const action = { type, hyperliquidChain: HL_TESTNET.chain, signatureChainId: HL_TESTNET.signatureChainId, destination: mainAddress, amount: "1", time };
  const t = HL_TYPES[type];
  const r = await post(EXCHANGE, { action, nonce: time, signature: signDigest(userSignedDigest(action, t.primaryType, [...t.fields]), agent) });
  const refused = r.body?.status !== "ok";
  say(`agent-signed ${type}: ${refused ? `REFUSED by Hyperliquid ${short(r.body)}` : "ACCEPTED (!)"}`);
  return refused;
};
const w = await refusedBy("withdraw3");
const u = await refusedBy("usdSend");
// d. turn off: revoke on Hyperliquid, then the agent's cancel must be refused
const n3 = Date.now() + 1;
const revoke = revokeAgentAction(n3);
const revoked = await post(EXCHANGE, { action: revoke, nonce: n3, signature: signApproveAgent(revoke, main) });
say(`revoke (same name, throwaway address): ${revoked.body?.status === "ok" ? "accepted" : `refused ${short(revoked.body)}`}`);
const n4 = Date.now() + 2;
const after = await post(EXCHANGE, { action: cancel, nonce: n4, signature: signDigest(l1Digest(cancel, n4, true), agent) });
const gone = revoked.body?.status === "ok" && after.body?.status !== "ok";
say(`agent-signed cancel after the revoke: ${gone ? `REFUSED (the agent is revoked) ${short(after.body)}` : `not refused ${short(after.body)}`}`);
const pass = accepted && w && u && gone;
say(pass ? "PASS: the agent trades, Hyperliquid testnet itself refuses its withdraw3 and usdSend, and turning off revokes it." : "FAIL: see the lines above.");
code = pass ? 0 : 1;
} catch (e) {
  if (String((e as Error)?.message) !== "stop") say(`ERROR: ${String((e as Error)?.message ?? e).slice(0, 160)}`);
} finally {
  main.fill(0);
  agent.fill(0);
}
process.exit(code);
