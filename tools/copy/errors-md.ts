// Keeps each layer's errors.md table in step with its problem table (B28 R5: the words changed; the docs said the old
// ones). For every row `| \`code\` | words | money | next |`, the words, money and next step are written from the
// factory that makes that code, called with its own parameter names as placeholders ("{chainName}"). A code with no
// factory, or a factory that throws, keeps its row as it is.
//
//   node tools/copy/errors-md.ts          rewrite the tables
//   node tools/copy/errors-md.ts --check  exit 1 if any table is behind (errors-md.test.ts runs this)
import { readFileSync, writeFileSync } from "node:fs";
import type { Problem } from "@zerofee/core/problem";

const ROOT = new URL("../../", import.meta.url);
const TABLES: [string, string, string][] = [
  ["packages/core/errors.md", "packages/core/src/security-problems.ts", "securityProblems"],
  ["packages/wallet/errors.md", "packages/wallet/src/wallet-problems.ts", "walletProblems"],
  ["packages/trade/errors.md", "packages/trade/src/trade-problems.ts", "tradeProblems"],
  ["packages/pay/errors.md", "packages/pay/src/pay-problems.ts", "payProblems"],
  ["packages/browser/errors.md", "packages/browser/src/browser-problems.ts", "browserProblems"],
  ["packages/earn/errors.md", "packages/earn/src/earn-problems.ts", "earnProblems"],
];

const params = (fn: Function): string[] => {
  const m = fn.toString().match(/^\s*(?:async\s*)?\(([^)]*)\)/);
  return (m?.[1] ?? "").split(",").map((p) => p.replace(/[=:].*$/s, "").trim()).filter(Boolean);
};
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export async function rewrite(): Promise<{ file: string; changed: number }[]> {
  const out: { file: string; changed: number }[] = [];
  for (const [md, src, name] of TABLES) {
    const mod = (await import(new URL(src, ROOT).href)) as Record<string, Record<string, Function>>;
    const table = mod[name];
    if (!table) continue;
    const byCode = new Map<string, Problem>();
    for (const make of Object.values(table)) {
      try {
        const p = make(...params(make).map((n) => `{${n}}`)) as Problem;
        // a factory that does sums on its values (a dollar figure) says "$NaN" with placeholders: it needs real values too
        if (p?.code && !byCode.has(p.code) && !/NaN/.test(p.whatHappened)) byCode.set(p.code, p);
      } catch {
        // a factory that needs real values keeps its row
      }
    }
    const path = new URL(md, ROOT);
    const text = readFileSync(path, "utf8");
    let changed = 0;
    const next_ = text.replace(/^\| `([a-z0-9.-]+)` \| ((?:[^|\\]|\\.)*?) \|(.*)$/gm, (row, code: string, words: string, rest: string) => {
      const p = byCode.get(code);
      if (!p) return row;
      // the table's own example names ("BONK", "Solana") stand where the code fills a value in: such a row is current
      const shape = new RegExp(`^${cell(p.whatHappened).replace(/[.*+?^$()[\]\\|]/g, "\\$&").replace(/\{[^}]+\}/g, ".+?")}$`);
      if (shape.test(words)) return row;
      changed++;
      return `| \`${code}\` | ${cell(p.whatHappened)} |${rest}`;
    });
    if (process.argv.includes("--check")) out.push({ file: md, changed });
    else {
      if (changed) writeFileSync(path, next_);
      out.push({ file: md, changed });
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await rewrite();
  for (const x of r) console.log(`${x.changed ? (process.argv.includes("--check") ? "BEHIND" : "rewrote") : "ok"} ${x.file}${x.changed ? ` (${x.changed} rows)` : ""}`);
  if (process.argv.includes("--check") && r.some((x) => x.changed)) process.exit(1);
}
