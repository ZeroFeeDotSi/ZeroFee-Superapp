import { test } from "node:test";
import assert from "node:assert/strict";
import { relayBase } from "./relay.ts";

test("the relay setting: unset is Private not set up; set is one https origin, nothing else", () => {
  for (const off of [undefined, "", "  ", 42, null]) assert.equal(relayBase(off), undefined, String(off));
  assert.equal(relayBase("https://zf-quotes.example.app"), "https://zf-quotes.example.app");
  assert.equal(relayBase(" https://zf-quotes.example.app/ "), "https://zf-quotes.example.app");
  for (const bad of ["http://zf-quotes.example.app", "https://zf-quotes.example.app/v0", "https://u:p@zf-quotes.example.app", "https://zf-quotes.example.app/?x=1", "https://zf-quotes.example.app/#a", "zf-quotes.example.app", "javascript:alert(1)"]) {
    assert.equal(relayBase(bad), undefined, bad);
  }
});
