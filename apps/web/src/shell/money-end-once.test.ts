// UI's no-hang audit (3 Nov): a money sheet replaced by a newer one tells its asker it ended (never a wait for ever), and
// an asker hears its end once however the sheet goes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const host = readFileSync(new URL("./AppHost.tsx", import.meta.url), "utf8");

test("every money sheet is set through replaceMoney, which ends the one it replaces and tells each asker once", () => {
  assert.equal((host.match(/setMoney\(\{ ask/g) ?? []).length, 0, "no sheet is set straight over another");
  assert.equal((host.match(/setMoney\(\{ \.\.\.next/g) ?? []).length, 1, "only replaceMoney sets a new money sheet");
  assert.match(host, /const replaceMoney = [\s\S]{0,300}old\?\.onEnd\?\.\(\{ went: false \}\)/, "the replaced sheet's asker hears 'not now'");
  assert.match(host, /if \(told\) return; told = true; f\(end\);/, "each asker hears its end once");
  assert.equal((host.match(/replaceMoney\(\{ ask/g) ?? []).length, 2, "both ways a sheet opens (an ask, a parked sheet back up)");
  // control: the old code set a new sheet straight over a waiting one
  assert.doesNotMatch("setMoney({ ask, at: i, seq: 1 }); setMoney({ ask: p.ask, at: j, seq: 2 });", /old\?\.onEnd/);
});
