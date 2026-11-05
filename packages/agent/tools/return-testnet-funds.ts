// Give back the testnet NEAR a proof account holds: delete it, with the funder it came from as beneficiary.
//
//   node packages/agent/tools/return-testnet-funds.ts <zf-agent-….testnet> <funder>.testnet
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as near from "@fastnear/api";
import { encodeSignature } from "@fastnear/ml-dsa-65";
import { serializeSignedTransaction, serializeTransaction } from "@fastnear/utils";
import { sha256 } from "@noble/hashes/sha2.js";
import { SoftwareKey } from "../../core/src/device-key.ts";
const [accountId, beneficiaryId] = process.argv.slice(2);
const network = "testnet" as const;
near.config({ networkId: network });
const body = (r: any) => r?.result ?? r;
const s = JSON.parse(readFileSync(join(process.env.ZEROFEE_HOME ?? join(homedir(), ".config", "zerofee"), network, `agent-limits-${accountId}.json`), "utf8"));
const key = SoftwareKey.fromSeed(new Uint8Array(Buffer.from(s.deviceSeedBase64, "base64")), "development");
const ak = body(await near.queryAccessKey({ accountId, publicKey: key.publicKey, blockId: "final", network }));
const block = body(await near.queryBlock({ blockId: "final", network } as any));
const tx = { signerId: accountId, publicKey: key.publicKey as any, nonce: BigInt(ak.nonce) + 1n, receiverId: accountId, blockHash: block.header.hash, actions: [near.actions.deleteAccount({ beneficiaryId })] };
const sig = encodeSignature(await key.signHash(sha256(serializeTransaction(tx))));
const out = body(await near.sendRpc("send_tx", { signed_tx_base64: Buffer.from(serializeSignedTransaction(tx, sig)).toString("base64"), wait_until: "FINAL" }, { network }));
key.destroy();
console.log(out?.status?.SuccessValue !== undefined ? `deleted ${accountId}; NEAR returned to ${beneficiaryId}: https://testnet.nearblocks.io/txns/${out.transaction.hash}` : `failed: ${JSON.stringify(out?.status)}`);
