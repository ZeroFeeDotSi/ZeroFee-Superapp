// Coverage audit (4 Nov): KOI, a Meteora DBC coin, was refused "Its maker runs its own code on every transfer" because its
// mint carries a TransferHook extension; but its hook names no program and no authority that could set one, so nothing can
// ever run. FUNCAT's names program FUNrSeDa…, which runs on every transfer: still refused. Both mints as read on mainnet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EXT, issuerHold, mintExtensions } from "./codec.ts";

const fx = JSON.parse(readFileSync(new URL("./fixtures/hook-mints.json", import.meta.url), "utf8"));
const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((h: string) => parseInt(h, 16)));

test("an empty transfer hook (no program, no authority) can't run: the coin isn't held back for it (control: a live hook still is)", () => {
  const koi = mintExtensions(bytes(fx.KOI.hex));
  assert.ok(koi.types.has(EXT.transferHook), "KOI carries the extension");
  assert.equal(koi.transferHookLive, false);
  assert.equal(issuerHold(koi), undefined, "KOI can be bought");
  const funcat = mintExtensions(bytes(fx.FUNCAT.hex));
  assert.equal(funcat.transferHookLive, true);
  assert.equal(issuerHold(funcat), "hooked", "control: FUNCAT's hook program runs on every transfer");
});

test("a hook with only an authority set is live (it can set a program later); a short or unread hook counts as live (controls)", () => {
  const koi = bytes(fx.KOI.hex);
  // find KOI's hook entry and set one authority byte
  let o = 166;
  while (o + 4 <= koi.length) {
    const type = koi[o]! | (koi[o + 1]! << 8), len = koi[o + 2]! | (koi[o + 3]! << 8);
    if (type === EXT.transferHook) break;
    o += 4 + len;
  }
  const withAuthority = koi.slice();
  withAuthority[o + 4] = 7;
  assert.equal(issuerHold(mintExtensions(withAuthority)), "hooked", "an authority can still install a program");
  const withProgram = koi.slice();
  withProgram[o + 4 + 40] = 1;
  assert.equal(issuerHold(mintExtensions(withProgram)), "hooked", "a program runs");
  // an older caller's figures without the field: a hook present still holds it back
  assert.equal(issuerHold({ types: new Set([EXT.transferHook]), transferFeeBps: 0, transferFeeAuthority: false }), "hooked");
});
