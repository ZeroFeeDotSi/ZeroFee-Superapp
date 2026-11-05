// The live feed's sockets are exact wss:// origins: no wildcard, no path, no query, no key (Security's rule, 27 Oct 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { WS_HOSTS } from "./ws-hosts.ts";

test("every live-feed socket is an exact wss:// origin with nothing after the host", () => {
  for (const [chain, hosts] of Object.entries(WS_HOSTS)) {
    assert.ok(hosts.length > 0, chain);
    for (const h of hosts) {
      const u = new URL(h);
      assert.equal(u.protocol, "wss:", h);
      assert.equal(u.origin, h, `${h}: an origin only (no path, query, port or trailing slash)`);
      assert.ok(!h.includes("*") && !u.username && !u.password, h);
    }
  }
  assert.deepEqual(Object.keys(WS_HOSTS).sort(), ["bsc", "hood", "sol"]);
});
