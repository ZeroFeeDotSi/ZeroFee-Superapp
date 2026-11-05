// A real AgentZero NEAR key for the relay's tests (QA, 4 Nov): its implicit account (the ed25519 public key as
// 64 hex) and its proof that a sign-up's id is its own (BIND_PREFIX + the id, signed). Made fresh each run; no network.
import { generateKeyPairSync, sign } from "node:crypto";
import { BIND_PREFIX } from "../agentzero-pay.mjs";

export function agentKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const x = publicKey.export({ format: "jwk" }).x!;
  const account = Buffer.from(x, "base64url").toString("hex");
  /** The proof for a token's id ("az1.<id>.<mac>"); "" for anything else. */
  const bindFor = (token: string): string => {
    const id = /^az1\.([A-Za-z0-9_-]{22})\./.exec(token)?.[1];
    return id ? sign(null, Buffer.from(`${BIND_PREFIX}${id}`, "utf8"), privateKey).toString("hex") : "";
  };
  return { account, bindFor };
}
