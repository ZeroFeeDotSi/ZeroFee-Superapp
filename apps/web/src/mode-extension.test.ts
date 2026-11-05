// D157: the extension's build is the real app on mainnet, whatever the address says; Sim stays the website.
import assert from "node:assert/strict";
import test from "node:test";
import { parseMode } from "./mode.ts";

test("D157: the extension build is the app on mainnet for any address, even one asking for Sim, the laptop or testnet", () => {
  for (const [q, path] of [["", "/app.html"], ["?demo", "/app.html"], ["?screens", "/app.html"], ["?laptop", "/laptop"], ["?mainnet", "/"]] as const) {
    for (const kept of ["sim", "real", "web"] as const) assert.deepEqual(parseMode(q, true, false, path, kept, true), { page: "app", mainnet: true });
  }
  // control: the public website is the Sim only (D157), whatever its kept choice says
  assert.deepEqual(parseMode("", true, false, "/", "sim"), { page: "demo", mainnet: false });
  assert.deepEqual(parseMode("", true, false, "/", "real"), { page: "demo", mainnet: false });
});
