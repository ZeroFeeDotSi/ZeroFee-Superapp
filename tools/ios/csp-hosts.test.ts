// The phone CSP's websocket origins (apps/ios/build-web.sh WSS_HOSTS) must equal Trade's WS_HOSTS, every chain, so the
// phone CSP, the extension CSP and the engine come from one list and a swapped host can't pass unnoticed (Security, 27 Oct).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WS_HOSTS } from "../../packages/trade/src/market/ws-hosts.ts";

test("build-web.sh WSS_HOSTS equals Trade's WS_HOSTS across every chain", () => {
  const sh = readFileSync(fileURLToPath(new URL("../../apps/ios/build-web.sh", import.meta.url)), "utf8");
  const m = sh.match(/^WSS_HOSTS="([^"]*)"$/m);
  assert.ok(m, "WSS_HOSTS line not found in build-web.sh");
  const phone = m[1].trim().split(/\s+/).sort();
  const engine = Object.values(WS_HOSTS).flat().sort();
  assert.deepEqual(phone, engine);
  for (const h of phone) assert.match(h, /^wss:\/\/[a-z0-9.-]+$/);
});
