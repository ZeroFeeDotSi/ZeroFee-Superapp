import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeLedger } from "../testing/fake-ledger.ts";
import { loadBank, removeBank, saveBankFrom } from "./banks.ts";

const ledger = () => new FakeLedger({ accountId: "me.near", balances: {} });

test("the IBAN the person copied in Mt Pelerin is checked and kept, spaces and all", async () => {
  const l = ledger();
  const saved = await saveBankFrom(l, "Your IBAN: CH93 0076 2011 6238 5295 7\\n");
  assert.ok("ok" in saved);
  assert.deepEqual(await loadBank(l), { partner: "mt-pelerin", iban: "CH9300762011623852957" });
});

test("nothing that is an IBAN in what was copied: a Problem with Paste it instead, nothing kept", async () => {
  const l = ledger();
  for (const text of [null, "hello", "CH93 0076 2011 6238 5295 8"]) {
    const r = await saveBankFrom(l, text);
    assert.ok("problem" in r && r.problem.code === "pay.copied.none", String(text));
  }
  assert.equal(await loadBank(l), null);
});

test("removing the bank forgets it on this phone", async () => {
  const l = ledger();
  await saveBankFrom(l, "CH9300762011623852957");
  await removeBank(l);
  assert.equal(await loadBank(l), null);
});
