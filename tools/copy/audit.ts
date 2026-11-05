// The copy audit: every user-visible string with its place, its grade and its problems (the house style).
//   node tools/copy/audit.ts tsv [path-prefix]     every string, tab-separated: place, grade, text, problems
//   node tools/copy/audit.ts banned [path-prefix]  only the strings with a banned word (what the guard test fails on)
//   node tools/copy/audit.ts counts [path-prefix]  how many strings at each grade
import { readFileSync } from "node:fs";
import { allStrings } from "./strings.ts";
import { bannedIn, grade } from "./voice.ts";

//   node tools/copy/audit.ts md <before.tsv>       the audit as markdown: counts before and after, every string before
//                                                  with its grade, problems and whether it was rewritten, and what is still below B
const [mode = "counts", prefix = ""] = process.argv.slice(2);
const found = allStrings().filter((f) => (mode === "md" ? true : f.file.startsWith(prefix)));
if (mode === "md") {
  const before = readFileSync(prefix, "utf8").trim().split("\n").map((l) => l.split("\t")).map(([place, g, text, problems]) => ({ place, g, text, problems: problems ?? "" }));
  const after = found.map((f) => ({ place: `${f.file}:${f.line}`, text: f.text, ...grade(f.file, f.text) }));
  const nowTexts = new Set(after.map((a) => `${a.place.split(":")[0]}\t${a.text}`));
  const tally = (gs: string[]) => ["A", "B", "C", "D", "F"].map((k) => gs.filter((g) => g === k).length);
  const area = (p: string) => p.split("/").slice(0, p.startsWith("apps/ios") ? 2 : 3).join("/");
  const areas = [...new Set([...before.map((b) => area(b.place)), ...after.map((a) => area(a.place))])].sort();
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/`/g, "'");
  const out: string[] = [];
  const [bA, bB, bC, bD, bF] = tally(before.map((b) => b.g));
  const [aA, aB, aC, aD, aF] = tally(after.map((a) => a.grade));
  out.push(`| | Strings | A | B | C | D | F |`, `|---|---|---|---|---|---|---|`, `| **Before** | ${before.length} | ${bA} | ${bB} | ${bC} | ${bD} | ${bF} |`, `| **After** | ${after.length} | ${aA} | ${aB} | ${aC} | ${aD} | ${aF} |`, "");
  out.push(`### By area (before → after)`, "", `| Area | Strings | A | B | C | D | F | Rewritten |`, `|---|---|---|---|---|---|---|---|`);
  for (const ar of areas) {
    const b = before.filter((x) => area(x.place) === ar), a = after.filter((x) => area(x.place) === ar);
    const tb = tally(b.map((x) => x.g)), ta = tally(a.map((x) => x.grade));
    const rewritten = b.filter((x) => !nowTexts.has(`${x.place.split(":")[0]}\t${x.text}`)).length;
    out.push(`| ${ar} | ${b.length} → ${a.length} | ${tb.map((n, i) => `${n} → ${ta[i]}`).join(" | ")} | ${rewritten} |`);
  }
  out.push("", `## Still below B after the rewrite`, "", `| Where | Grade | Text | Problem |`, `|---|---|---|---|`);
  for (const a of after.filter((x) => "CDF".includes(x.grade))) out.push(`| ${a.place} | ${a.grade} | ${cell(a.text)} | ${cell(a.problems.join("; "))} |`);
  out.push("", `## Every string before the rewrite`, "", "Grade and problem as the audit found them. **Now** says whether the string still reads the same (kept) or was rewritten.", "");
  let file = "";
  for (const b of before) {
    const f = b.place.split(":")[0];
    if (f !== file) out.push("", `### ${(file = f)}`, "", `| Line | Grade | Text | Problem | Now |`, `|---|---|---|---|---|`);
    out.push(`| ${b.place.split(":")[1]} | ${b.g} | ${cell(b.text)} | ${cell(b.problems)} | ${nowTexts.has(`${f}\t${b.text}`) ? "kept" : "**rewritten**"} |`);
  }
  console.log(out.join("\n"));
} else if (mode === "counts") {
  const n: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const f of found) n[grade(f.file, f.text).grade]++;
  console.log(JSON.stringify({ strings: found.length, ...n }));
} else {
  for (const f of found) {
    if (mode === "banned" && bannedIn(f.file, f.text).length === 0) continue;
    const g = grade(f.file, f.text);
    console.log([`${f.file}:${f.line}`, g.grade, f.text, g.problems.join("; ")].join("\t"));
  }
}
