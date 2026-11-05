// Instant open: the start page asks for pump.fun's and GMGN's windows once, after a good read, each with its wallet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { warmAsks } from "./warm.ts";
import type { HubRow } from "./hub-state.ts";

const listed = [{ id: "pump", preset: { url: "https://pump.fun/" } }, { id: "gmgn", preset: { url: "https://gmgn.ai/" } }];
const rows: HubRow[] = [{ site: "pump", name: "pump.fun", usd: 2.5, wallet: "w1" }, { site: "gmgn", name: "GMGN", usd: 0, wallet: "w2" }];
const pill = (r: HubRow) => (r.usd === null ? undefined : `$${r.usd.toFixed(2)}`);

test("after a good read: both sites, each with its pill (control)", () => {
  assert.deepEqual(warmAsks(rows, "ok", listed, pill, new Set()), [{ url: "https://pump.fun/", pill: "$2.50" }, { url: "https://gmgn.ai/", pill: "$0.00" }]);
});

test("nothing before the first read or after a failed one; a site with no wallet yet is skipped; each only once", () => {
  assert.deepEqual(warmAsks(rows, "first", listed, pill, new Set()), []);
  assert.deepEqual(warmAsks(rows, "failed", listed, pill, new Set()), []);
  assert.deepEqual(warmAsks([{ ...rows[0]!, wallet: undefined }, rows[1]!], "ok", listed, pill, new Set()).map((a) => a.url), ["https://gmgn.ai/"]);
  assert.deepEqual(warmAsks(rows, "ok", listed, pill, new Set(["pump", "gmgn"])), []);
});
