// The self-host server's pure parts: .env reading, and the relay's rewrites (apps/quotes/vercel.json) on one port.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv, relayUrl, rewritesOf } from "./serve.mjs";

const rules = rewritesOf(JSON.parse(readFileSync(new URL("../../apps/quotes/vercel.json", import.meta.url), "utf8")).rewrites);
const map = (path: string) => relayUrl(new URL(path, "http://localhost:5180"), rules)?.toString();

test("every hosted relay route maps to the same /api/relay call on the self-hosted port", () => {
  assert.equal(map("/v0/quote"), "http://localhost:5180/api/relay?route=quote");
  assert.equal(map("/v0/deposit/submit"), "http://localhost:5180/api/relay?route=deposit-submit");
  assert.equal(map("/v0/agentzero/chat"), "http://localhost:5180/api/relay?route=agentzero-chat");
  const market = new URL(map("/v0/market/gt/networks/solana/trending_pools?page=1")!);
  assert.deepEqual([...market.searchParams], [["route", "market"], ["src", "gt"], ["mpath", "networks/solana/trending_pools"], ["page", "1"]]);
  assert.equal(map("/v0/pair/abc"), "http://localhost:5180/api/relay?route=pair&id=abc");
  assert.equal(map("/assets/index.js"), undefined, "control: a page file is not a relay route");
});

test(".env: KEY=value lines only, comments and blanks skipped, empty values ignored, the shell's own value wins", () => {
  const dir = mkdtempSync(join(tmpdir(), "zf-env-"));
  const file = join(dir, ".env");
  writeFileSync(file, "# a comment\n\nZF_SELFHOST_A=one\nZF_SELFHOST_B=\nZF_SELFHOST_C=\"quoted\"\nnot a line\nZF_SELFHOST_D=mine\n");
  process.env.ZF_SELFHOST_D = "shell";
  assert.deepEqual(loadEnv(file), ["ZF_SELFHOST_A", "ZF_SELFHOST_C"]);
  assert.equal(process.env.ZF_SELFHOST_A, "one");
  assert.equal(process.env.ZF_SELFHOST_B, undefined);
  assert.equal(process.env.ZF_SELFHOST_C, "quoted");
  assert.equal(process.env.ZF_SELFHOST_D, "shell");
  assert.deepEqual(loadEnv(join(dir, "missing")), [], "no .env: nothing set");
});
