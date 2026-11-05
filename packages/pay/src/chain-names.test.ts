// A network is named for a person on every screen ("On Robinhood Chain", "BNB Chain", "Solana"), never by its raw id
// ("hood", "bsc", "sol"). The C-4 walk caught Send's "On hood"; QA asked for the rule at its source (chains.ts chainName)
// and a check that no screen builds a name from a chain's list entry with the raw id as its fallback.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHAINS, chainName } from "./chains.ts";
import { EVM_CHAINS as WALLET_EVM } from "@zerofee/wallet/addresses.ts";

test("every chain id the app knows has a person's name, never itself", () => {
  assert.equal(chainName("hood"), "Robinhood Chain");
  assert.equal(chainName("bsc"), "BNB Chain");
  assert.equal(chainName("sol"), "Solana");
  assert.equal(chainName("xmr"), "Monero");
  for (const id of new Set([...CHAINS.map((c) => c.id), ...WALLET_EVM, "hood", "xmr"])) {
    const name = chainName(id);
    assert.notEqual(name, id, `${id} is shown as its raw id`);
    assert.ok(/[A-Z]/.test(name), `${id}: "${name}" reads like an id`);
  }
  // control: an id with no name at all is still never shown lower case as it is
  assert.equal(chainName("zzz"), "ZZZ");
});

test("Robinhood Chain is offered, never guessed: a bare 0x address lists it among several networks, so the person picks (C-4 review M1, the Home plan §1.3)", async () => {
  const { chainsForAddress, chain, chainByEvmId } = await import("./chains.ts");
  const nets = chainsForAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed");
  assert.ok(nets.includes("hood"), "Pay pays out on Robinhood Chain now");
  assert.ok(nets.includes("bsc") && nets.includes("eth") && nets.includes("base"), "control: the other EVM networks still are");
  assert.ok(nets.length > 1, "never one network alone: the person is asked which");
  assert.deepEqual([chain("hood")?.evmChainId, chainByEvmId(4663)?.id], [4663, "hood"], "a payment code naming chain 4663 is Robinhood Chain");
});

/** A screen naming a network from the list's entry, falling back to the raw id: `chain(x)?.name ?? x`. */
const RAW_FALLBACK = /\b(?:chain|chainInfo)\([^()]*\)\?\.name\b(?!\s*\?\?\s*")/;
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  if (statSync(p).isDirectory()) return f === "node_modules" || f === "testing" ? [] : files(p);
  return /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
});

test("no screen or line names a network as `chain(x)?.name ?? x`: chainName only", () => {
  const packages = fileURLToPath(new URL("../../", import.meta.url));
  const bad: string[] = [];
  for (const pkg of ["pay", "wallet", "chat"]) {
    for (const f of files(join(packages, pkg, "src"))) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => { if (RAW_FALLBACK.test(line)) bad.push(`${f.slice(packages.length)}:${i + 1}`); });
    }
  }
  assert.deepEqual(bad, []);
  // controls: the old shapes are caught; chainName and a words fallback are not
  assert.ok(RAW_FALLBACK.test("`On ${chain(c.source.balance.chain)?.name ?? c.source.balance.chain}`"));
  assert.ok(RAW_FALLBACK.test("return `On ${chainInfo(r.chain)?.name ?? r.chain}`;"));
  assert.ok(!RAW_FALLBACK.test("`On ${chainName(r.chain)}`"));
});
