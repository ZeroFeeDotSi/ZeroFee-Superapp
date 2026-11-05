// D157: the extension's id is pinned: the manifest's public key gives exactly the documented id (src/extension-id.ts and
// INSTALL.md). The id is permanent (product decision, 4 Nov): never regenerated.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { EXTENSION_ID } from "./extension-id.ts";
import { extensionIdOf } from "./manifest-gen.ts";

const here = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, "public/manifest.json"), "utf8")) as { key?: string };
const install = readFileSync(join(here, "INSTALL.md"), "utf8");

test("the id is Chrome's: SHA-256 of the key's DER, its first 32 hex digits written a-p", () => {
  const der = Buffer.alloc(294, 7); // any bytes: the rule doesn't parse the key
  const hex = createHash("sha256").update(der).digest("hex").slice(0, 32);
  const id = extensionIdOf(der.toString("base64"));
  assert.match(id, /^[a-p]{32}$/);
  assert.equal([...id].map((c) => (c.charCodeAt(0) - 97).toString(16)).join(""), hex);
  assert.throws(() => extensionIdOf("not base64 !"));
  assert.throws(() => extensionIdOf(Buffer.alloc(8).toString("base64"))); // too short to be a key
});

test("D157: the manifest's key gives the documented id, in src/extension-id.ts and INSTALL.md (pinned 4 Nov, permanent)", () => {
  assert.ok(manifest.key, "public/manifest.json has no key: the id isn't pinned");
  assert.ok(EXTENSION_ID, "src/extension-id.ts has no id");
  assert.equal(extensionIdOf(manifest.key!), EXTENSION_ID);
  assert.ok(install.includes(`Extension id: \`${EXTENSION_ID}\``), "INSTALL.md names another id");
  assert.equal(EXTENSION_ID, "hfnbcflhfpceemgoglhbonngemobhffd"); // the pinned id: a new key would fail here
});

test("review B1: INSTALL.md never says to remove ZeroFee; an update replaces the files in the same folder, then Reload", () => {
  assert.doesNotMatch(install, /remove the old/i);
  for (const line of install.split("\n").filter((l) => /\bremov/i.test(l))) assert.match(line, /never remove|removing it erases/i, `a remove step: ${line}`);
  assert.match(install, /\*\*Never remove ZeroFee from Chrome\.\*\* Removing it erases this computer's keys\./);
  const update = install.slice(install.indexOf("## To update"));
  assert.ok(update.length > 20 && update.includes("same folder") && /\*\*Reload\*\*/.test(update) && /replace the files/i.test(update), "the update steps");
  assert.doesNotMatch(update, /Load unpacked/, "an update never loads a second copy");
  // control: the first install still loads it unpacked
  assert.match(install.slice(0, install.indexOf("## To update")), /Load unpacked/);
});
