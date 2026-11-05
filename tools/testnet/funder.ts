// Make testnet accounts without the faucet: a funded testnet account pays testnet's account registrar
// (`testnet` runs `create_account`). The faucet limits each IP address, and a busy machine hits that limit.
//
// The funder is one of our own testnet accounts whose key is in $ZEROFEE_HOME/testnet/ (mode 600).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Chain } from "../../packages/core/src/chain.ts";
import { SoftwareKey } from "../../packages/core/src/device-key.ts";
import { DevSigner } from "../../packages/core/src/dev-signer.ts";

const NEAR = 10n ** 24n;

/** Our own funded testnet accounts, tried in order. Each is used only while it can pay without touching its storage. */
export const FUNDERS = ["zf-49915cee18.testnet", "zf-5a09dbd737.testnet", "zf-dca4c3feaa.testnet"];
/** What each funder keeps back for its own fees. */
export const FUNDER_SPARE = NEAR / 2n;

/** What each funder could still give, in yocto (two nodes): its balance less its storage and its spare. */
export async function funderBudgets(chain: Chain, funders = FUNDERS): Promise<Map<string, bigint>> {
  const block = await chain.commonBlock();
  const out = new Map<string, bigint>();
  for (const id of funders) {
    const a = await chain.account(id, block);
    const free = a ? a.balanceYocto - a.storageBytes * 10n ** 19n - FUNDER_SPARE : 0n;
    out.set(id, free > 0n ? free : 0n);
  }
  return out;
}

/**
 * A createAccount for DemoCore: the first funder that can afford it creates `accountId` with `publicKey` as its key and
 * `amount / scale` NEAR in it (e.g. 45n, 10n = 4.5 NEAR; the account contract v3's storage takes about 3.4).
 */
export function registrarCreator(chain: Chain, amount = 45n, scale = 10n, funders = FUNDERS) {
  const deposit = (amount * NEAR) / scale;
  return async (accountId: string, publicKey: string) => {
    const block = await chain.commonBlock();
    for (const funderId of funders) {
      const acct = await chain.account(funderId, block);
      // Spendable = balance - storage lock; keep 0.5 NEAR for fees.
      if (!acct || acct.balanceYocto - acct.storageBytes * 10n ** 19n < deposit + FUNDER_SPARE) continue;
      const secrets = JSON.parse(readFileSync(join(process.env.ZEROFEE_HOME ?? join(homedir(), ".config", "zerofee"), "testnet", `${funderId}.json`), "utf8"));
      const key = SoftwareKey.fromSeed(new Uint8Array(Buffer.from(secrets.deviceSeedBase64, "base64")), "development");
      const funder = new DevSigner({ accountId: funderId, chain, key, approve: async () => true });
      const args = new TextEncoder().encode(JSON.stringify({ new_account_id: accountId, new_public_key: publicKey }));
      const out = await funder.run("testnet", [{ kind: "call", method: "create_account", args, gas: 100_000_000_000_000n, depositYocto: deposit }]);
      key.destroy();
      if (out.status !== "done") throw new Error(`the registrar didn't create ${accountId}: ${JSON.stringify(out)}`);
      return;
    }
    throw new Error("none of our testnet accounts has enough NEAR left to fund a new one");
  };
}
