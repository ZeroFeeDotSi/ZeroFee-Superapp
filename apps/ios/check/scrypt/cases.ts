// Cases for ../scrypt.sh: random passwords and salts, each with @noble/hashes' scrypt (the core's own, subwallets.ts) as
// the answer the native one must give. The first is the link's: a 10-character code, a 16-byte salt, N=2^17, r=8, p=1.
import { randomBytes } from "node:crypto";
import { scrypt } from "@noble/hashes/scrypt.js";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const cases = [
  { N: 2 ** 17, r: 8, p: 1, dkLen: 32, password: randomBytes(10), salt: randomBytes(16) },
  { N: 2 ** 10, r: 3, p: 2, dkLen: 77, password: randomBytes(33), salt: randomBytes(5) },
  { N: 2, r: 1, p: 3, dkLen: 1, password: randomBytes(0), salt: randomBytes(64) },
].map((c) => ({ ...c, password: hex(c.password), salt: hex(c.salt), key: hex(scrypt(c.password, c.salt, { N: c.N, r: c.r, p: c.p, dkLen: c.dkLen })) }));
process.stdout.write(JSON.stringify(cases));
