// Round 4c (the audit's defence in depth): the account contract measures an ft_withdraw on intents.near only with the
// arguments token, receiver_id, amount, memo and msg; any other (intents.near's own storage_deposit, which pays NEAR out
// of the ledger, included) puts the request on the strictest band. So no app path may build one with anything else:
// this reads every app source (packages/*/src, apps/*/src, apps/quotes; tests left out) for an ft_withdraw it builds
// and checks every argument name in it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../../", import.meta.url).pathname;
const ALLOWED = new Set(["token", "receiver_id", "amount", "memo", "msg"]);

function sources(): string[] {
  const roots: string[] = [join(ROOT, "apps/quotes")];
  for (const top of ["packages", "apps"]) {
    for (const name of readdirSync(join(ROOT, top))) {
      const src = join(ROOT, top, name, "src");
      try {
        if (statSync(src).isDirectory()) roots.push(src);
      } catch {}
    }
  }
  const out: string[] = [];
  for (const root of roots) {
    for (const rel of readdirSync(root, { recursive: true }) as string[]) {
      if (rel.includes("node_modules") || rel.split("/").includes("dist")) continue;
      if (!/\.(ts|tsx|mjs|js)$/.test(rel) || /\.test\.(ts|tsx|mjs|js)$/.test(rel)) continue;
      out.push(join(root, rel));
    }
  }
  return [...new Set(out)];
}

/** The object literal that opens at `src[open]` ("{"), braces balanced, strings and template literals skipped. */
function objectAt(src: string, open: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error("unbalanced object");
}

/** Every key the literal can set, at any depth (a spread's `{ memo: ... }` included), strings blanked out first. */
function keys(obj: string): string[] {
  const bare = obj.replace(/`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
  return [...bare.matchAll(/[{,]\s*([A-Za-z_$][\w$]*)\s*:/g)].map((m) => m[1]);
}

/** Each ft_withdraw an app builds: `call("ft_withdraw", { ... })` or `method: "ft_withdraw", args: { ... }`. */
function builtWithdrawals(): { at: string; keys: string[] }[] {
  const found: { at: string; keys: string[] }[] = [];
  for (const file of sources()) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/(["'`])ft_withdraw\1/g)) {
      const after = src.slice(m.index! + m[0].length, m.index! + m[0].length + 200);
      const before = src.slice(Math.max(0, m.index! - 40), m.index!);
      const at = `${file.slice(ROOT.length)}:${src.slice(0, m.index).split("\n").length}`;
      const asCall = /^\s*,\s*\{/.exec(after);
      const asArgs = /^\s*,\s*args\s*:\s*(?:enc\(|utf8\(JSON\.stringify\()?\s*\{/.exec(after);
      if (asCall || asArgs) {
        const open = m.index! + m[0].length + (asCall ?? asArgs)![0].length - 1;
        found.push({ at, keys: keys(objectAt(src, open)) });
      } else if (/method\s*:\s*$/.test(before) || /call\(\s*$/.test(before)) {
        // An ft_withdraw built some other way (args from a variable) can't be read here: name it, so it is looked at.
        found.push({ at, keys: ["<args not a literal>"] });
      }
    }
  }
  return found;
}

test("no app path builds an intents.near ft_withdraw with an argument the contract won't measure", () => {
  const built = builtWithdrawals();
  // The three builders today: staking's ledger withdrawal and the wallet's two sends out of the ledger.
  for (const at of ["packages/earn/src/staking.ts", "packages/wallet/src/moves.ts"]) assert.ok(built.some((b) => b.at.startsWith(at)), `${at}: found`);
  assert.ok(built.length >= 3, JSON.stringify(built));
  for (const b of built) {
    const bad = b.keys.filter((k) => !ALLOWED.has(k));
    assert.deepEqual(bad, [], `${b.at}: ft_withdraw with ${bad.join(", ")} (only ${[...ALLOWED].join(", ")})`);
  }
});

test("the reader itself: a storage_deposit or any other argument is caught, the allowed ones are not", () => {
  const src = `call("ft_withdraw", { token: t, receiver_id: r, amount: a.toString(), storage_deposit: "1" })`;
  assert.deepEqual(keys(objectAt(src, src.indexOf("{"))), ["token", "receiver_id", "amount", "storage_deposit"]);
  const spread = `{ token: o.contract, amount: \`\${x}:\${y}\`, ...(o.memo ? { memo: o.memo } : {}) }`;
  assert.deepEqual(keys(objectAt(spread, 0)), ["token", "amount", "memo"]);
});
