// Audit 16's G4 (8 Nov): every down sheet (Send, Swap, Move, the Safe's Buy and Sell) said "Try again when it's back."
// where nothing could be tried; Send offline and the site Add already said "It checks again by itself.". Now the core's
// one line says it, and it is true: an open sheet reads the services again by itself (useHealth, every 30 s), so its
// line goes and its button comes back on with no tap. Fails on main: waitsLine ended "Try again when it's back.".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CHECKS_AGAIN, waitsLine } from "@zerofee/core/services";
import { SERVICES_EVERY_MS, servicesLine } from "./services.ts";

test("G4: a down sheet's line says it checks again by itself, never Try again", () => {
  for (const s of ["near", "oneclick", "relay", "confidential", "solana", "hood"] as const) {
    const line = waitsLine(s, "down", "Swap");
    assert.ok(line.endsWith(` ${CHECKS_AGAIN}`), line);
    assert.doesNotMatch(line, /Try again|tap/i, line);
  }
  assert.equal(waitsLine("confidential", "down", "Buy"), "NEAR Confidential is down, so this can't go now. Your money stays in your Safe. It checks again by itself.");
  assert.equal(servicesLine([{ service: "relay", state: "down", seen: "both" }], ["relay"], "Move", false).line, "ZeroFee's server is down, so this can't go now. Your money stays in your Safe. It checks again by itself.");
});

test("G4: it is true: an open sheet asks for the services again by itself, within a minute, while it shows", () => {
  const src = readFileSync(new URL("./services.ts", import.meta.url), "utf8");
  const health = src.slice(src.indexOf("export function useHealth"), src.indexOf("/** R4: how long"));
  assert.match(health, /timer = setTimeout\(look, SERVICES_EVERY_MS\)/, "read again after each answer");
  assert.ok(SERVICES_EVERY_MS > 0 && SERVICES_EVERY_MS <= 60_000);
  // and once the row is up again, the same rows give no line and the button is on
  assert.deepEqual(servicesLine([{ service: "relay", state: "up" }], ["relay"], "Move", false), { line: null, down: false });
});
