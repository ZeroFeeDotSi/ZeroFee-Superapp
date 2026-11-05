// Display-only security flags: Solana's mint and freeze authority (a coin whose freeze authority is set can stop a sell). Never a gate by itself.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readSolMint, securityNotes, securityOfInfo } from "./security.ts";
import { fx } from "./testing.ts";

describe("securityOfInfo", () => {
  it("reads yes / no from the token info of a real Solana coin (authorities renounced)", () => {
    assert.deepEqual(securityOfInfo(fx("info-sol").data.attributes), { mintAuthority: false, freezeAuthority: false });
  });
  it("a freeze authority that is set is exposed as true", () => {
    assert.deepEqual(securityOfInfo({ mint_authority: "no", freeze_authority: "yes" }), { mintAuthority: false, freezeAuthority: true });
  });
  it("unknown stays unknown, never false", () => {
    assert.equal(securityOfInfo({ mint_authority: "unknown", freeze_authority: "unknown" }), undefined);
    assert.deepEqual(securityOfInfo({ mint_authority: "yes" }), { mintAuthority: true });
    assert.equal(securityOfInfo(undefined), undefined);
  });
});

describe("readSolMint (a node read when the market data does not say)", () => {
  const mint = (info: object) => async () => ({ value: { data: { parsed: { type: "mint", info } } } });
  it("a mint with a freeze authority", async () => assert.deepEqual(await readSolMint(mint({ mintAuthority: null, freezeAuthority: "Abc" }), "M"), { mintAuthority: false, freezeAuthority: true }));
  it("a mint with none", async () => assert.deepEqual(await readSolMint(mint({ mintAuthority: null, freezeAuthority: null }), "M"), { mintAuthority: false, freezeAuthority: false }));
  it("not a mint, or a node that fails: undefined, not a verdict", async () => {
    assert.equal(await readSolMint(async () => ({ value: null }), "M"), undefined);
    assert.equal(await readSolMint(async () => { throw new Error("node"); }, "M"), undefined);
  });
});

describe("securityNotes", () => {
  it("plain words, never 'safe'", () => {
    const all = [...securityNotes({ mintAuthority: true, freezeAuthority: true }), ...securityNotes({ mintAuthority: false, freezeAuthority: false })].join(" ");
    assert.match(all, /freeze coins, which can stop a sale/);
    assert.doesNotMatch(all, /\bsafe\b|guaranteed|unhackable/i);
    assert.deepEqual(securityNotes(undefined), []);
  });
});
