// Builder QA's item 7, audit 16's S16-4 (SB-4 stands, o-browser): offline, the Browser (the hub with the address bar, the
// screen the Browser tile opens) said nothing while no site could open. Now its status line, under the address bar, says
// what is wrong, where the money is and when sites come back; back online it goes. Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BROWSER_OFFLINE } from "./offline.ts";

const hub = readFileSync(new URL("./SocialHub.tsx", import.meta.url), "utf8");

test("S16-4: offline, the hub's one line says so; online it is the hub's own line", () => {
  assert.equal(BROWSER_OFFLINE, "You're offline. Your money is safe. Sites open again when you're back.");
  assert.ok(hub.includes('data-testid="sh-line">{online ? line : BROWSER_OFFLINE}</p>'));
  assert.ok(hub.indexOf("const online = useOnline();") > 0);
  assert.ok(hub.indexOf("const online = useOnline();") < hub.indexOf("if (history && browser) return"), "a hook before any early return");
});

test("S16-4: it follows the phone's own online and offline events", () => {
  const src = readFileSync(new URL("./offline.ts", import.meta.url), "utf8");
  assert.match(src, /addEventListener\("offline", down\)/);
  assert.match(src, /addEventListener\("online", up\)/);
});
