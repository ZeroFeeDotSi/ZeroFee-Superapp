// Audit NF-11 (network and supply chain, 28 Oct 2026; FIXED): the versioned commit hooks refuse secrets by their shape
// as well as the author's details. Runs tools/hooks/pre-commit in a throwaway repo (nothing in this repo is touched)
// with made-up keys built at run time from random bytes, so this file holds no secret-shaped text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const hook = fileURLToPath(new URL("./pre-commit", import.meta.url));
const msgHook = fileURLToPath(new URL("./commit-msg", import.meta.url));
const rnd = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789"[b % 57]).join("");
const env = { ...process.env, GIT_AUTHOR_NAME: "ZeroFee", GIT_AUTHOR_EMAIL: "dev@zerofee.si", GIT_COMMITTER_NAME: "ZeroFee", GIT_COMMITTER_EMAIL: "dev@zerofee.si", GIT_AUTHOR_DATE: "2026-01-01T00:00:00+0000", GIT_COMMITTER_DATE: "2026-01-01T00:00:00+0000" };

function staged(content: string): { ok: boolean; said: string } {
  const dir = mkdtempSync(join(tmpdir(), "zf-hooks-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    writeFileSync(join(dir, "config.ts"), content);
    execFileSync("git", ["add", "config.ts"], { cwd: dir });
    const r = spawnSync("sh", [hook], { cwd: dir, env, encoding: "utf8" });
    return { ok: r.status === 0, said: r.stdout + r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("NF-11: the pre-commit hook refuses each key shape this project uses, and names it without printing it", () => {
  const words = ["abandon", "ability", "able", "about", "above", "absent", "absorb", "abstract", "absurd", "abuse", "access", "accident"];
  const cases: [string, string][] = [
    ["an Anthropic API key", `const K = "sk-ant-api03-${rnd(93)}AA";`],
    ["api-key", `const RPC = "https://mainnet.helius-rpc.com/?api-key=${crypto.randomUUID()}";`],
    ["a CoinGecko key", `const CG = "CG-${rnd(24)}";`],
    ["a JWT", `TOKEN=eyJ${rnd(30)}.eyJ${rnd(60)}.${rnd(43)}`],
    ["a private key (PEM)", `-----BEGIN ${"PRIVATE"} KEY-----`],
    ["an ed25519 private key", `"private_key": "ed25519:${rnd(88)}"`],
    ["backup words", `const words = "${words.join(" ")}";`],
  ];
  for (const [what, line] of cases) {
    const r = staged(line + "\n");
    assert.equal(r.ok, false, `${what} went through`);
    assert.match(r.said, /leak-guard: config\.ts:1 holds/);
    assert.ok(!r.said.includes(line.slice(-20)), `${what}: the hook printed the secret`);
  }
});

test("NF-11 (control): ordinary code, a signature and a fake short test key pass; a marked test vector passes", () => {
  assert.equal(staged(`export const add = (a: number, b: number) => a + b;\nconst sig = "ed25519:${rnd(88)}";\nconst key = "sk-ant-api03-test-0000";\n`).ok, true);
  assert.equal(staged(`const v = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"; // zerofee-allow-secret-shape: BIP-39's test vector\n`).ok, true);
});

test("NF-11: the commit message is checked too", () => {
  const dir = mkdtempSync(join(tmpdir(), "zf-hooks-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    writeFileSync(join(dir, "MSG"), `Add the RPC\n\nhttps://x.example/?api-key=${crypto.randomUUID()}\n`);
    assert.notEqual(spawnSync("sh", [msgHook, "MSG"], { cwd: dir, env, encoding: "utf8" }).status, 0);
    writeFileSync(join(dir, "MSG"), "Add the RPC\n");
    assert.equal(spawnSync("sh", [msgHook, "MSG"], { cwd: dir, env, encoding: "utf8" }).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
