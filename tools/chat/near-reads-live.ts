// ZeroFee Chat's NEAR reads (core chat-reads.ts), live and read-only, on two nodes at one block: a Sputnik DAO's roles
// (mainnet and testnet), the DAOs a testnet account is in, a near.social profile, and whether a key is on an account.
//
//   node tools/chat/near-reads-live.ts [testnet-account-with-a-dao] [account public-key]
import { RpcChain } from "../../packages/core/src/chain.ts";
import { daoPolicy, daosOf, keyOnAccount, nearProfile } from "../../packages/core/src/chat-reads.ts";

const main = new RpcChain("mainnet");
const test = new RpcChain("testnet");
const member = process.argv[2] ?? "zf-sample424201.testnet";
const t0 = Date.now();
const lap = () => `${Date.now() - t0} ms`;
console.log("marketing.sputnik-dao.near roles:", JSON.stringify(await daoPolicy(main, "marketing.sputnik-dao.near")), lap());
console.log("root.near (not a DAO):", JSON.stringify(await daoPolicy(main, "root.near")), lap());
console.log("zf-chat-room.sputnik-v2.testnet roles:", JSON.stringify(await daoPolicy(test, "zf-chat-room.sputnik-v2.testnet")), lap());
console.log(`DAOs of ${member}:`, JSON.stringify(await daosOf(test, member)), lap());
console.log("profile root.near:", JSON.stringify(await nearProfile(main, "root.near")), lap());
if (process.argv[3]) console.log(`profile ${process.argv[3]}:`, JSON.stringify(await nearProfile(process.argv[3].endsWith(".testnet") ? test : main, process.argv[3])), lap());
if (process.argv[3] && process.argv[4]) console.log(`key on ${process.argv[3]}:`, await keyOnAccount(process.argv[3].endsWith(".testnet") ? test : main, process.argv[3], process.argv[4]), lap());
