// Pins the extension's id (D157): reads ONLY the operator's public key (one base64 DER line at
// $ZEROFEE_HOME/extension-key/public.der.b64, or the path given), puts it in public/manifest.json as `key`, and writes the
// id it gives into src/extension-id.ts and INSTALL.md. It never makes, reads or asks for a private key.
//   node apps/extension/tools/pin-id.ts [path-to-public.der.b64]
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { extensionIdOf } from "../src/manifest-gen.ts";

const here = fileURLToPath(new URL("..", import.meta.url));
const path = process.argv[2] ?? join(process.env.ZEROFEE_HOME ?? join(homedir(), ".config", "zerofee"), "extension-key/public.der.b64");
const key = readFileSync(path, "utf8").trim();
if (key.includes("PRIVATE") || key.includes("-----")) throw new Error("that is not the one-line public key");
const id = extensionIdOf(key);
// the id is permanent (product decision, 4 Nov): a different key is refused, never written over the pinned one
const pinnedNow = /export const EXTENSION_ID: string = "([a-p]{32})";/.exec(readFileSync(join(here, "src/extension-id.ts"), "utf8"))?.[1];
if (pinnedNow && pinnedNow !== id) throw new Error(`STOP: this key gives ${id}, but the pinned id is ${pinnedNow}. The id never changes.`);
const mPath = join(here, "public/manifest.json");
// the key as its own line after "version" (the file keeps its layout); an old key is replaced
const text = readFileSync(mPath, "utf8").replace(/^  "key": .*\n/m, "");
const pinned = text.replace(/^(  "version": "[^"]*",\n)/m, `$1  "key": ${JSON.stringify(key)},\n`);
if (pinned === text || JSON.parse(pinned).key !== key) throw new Error("public/manifest.json: couldn't place the key");
writeFileSync(mPath, pinned);
const idPath = join(here, "src/extension-id.ts");
writeFileSync(idPath, readFileSync(idPath, "utf8").replace(/export const EXTENSION_ID: string(?: \| null)? = .*;/, `export const EXTENSION_ID: string = ${JSON.stringify(id)};`));
const docPath = join(here, "INSTALL.md");
writeFileSync(docPath, readFileSync(docPath, "utf8").replace(/^Extension id: .*$/m, `Extension id: \`${id}\``));
console.log(`pinned: ${id}`);
