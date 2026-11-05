// The laptop extension's side of linking, by its own code (apps/extension/src/vault/link.ts sealForLink): seals a
// throwaway 32-byte seed for the phone's one-time code and prints the QR text. For core-watch's subwallet.import step
// only: the seed is random, made here and thrown away, and the phone's sheet for it is answered no.
//   node seal-link.ts <the phone's code, e.g. ABCDE-FGHJK>
import { randomBytes } from "node:crypto";
import { sealForLink } from "../../../extension/src/vault/link.ts";

const qr = await sealForLink(new Uint8Array(randomBytes(32)), String(process.argv[2] ?? ""));
if (!qr) throw new Error("usage: seal-link.ts <the phone's 10-character code>");
process.stdout.write(qr);
