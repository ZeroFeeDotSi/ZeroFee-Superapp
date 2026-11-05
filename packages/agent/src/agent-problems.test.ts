import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Problem } from "@zerofee/core/problem";
import { agentProblems } from "./agent-problems.ts";

const catalogue = readFileSync(new URL("../errors.md", import.meta.url), "utf8");
const all = (): Problem[] => Object.values(agentProblems).map((make) => (make as () => Problem)());

test("every AgentZero Problem has a unique code, the three parts, and a row in errors.md, and errors.md lists nothing else", () => {
  const codes = new Set<string>();
  for (const p of all()) {
    assert.match(p.code, /^agent(\.[a-z-]+)+$/);
    assert.ok(!codes.has(p.code), `${p.code} is used twice`);
    codes.add(p.code);
    assert.ok(p.whatHappened.length > 0 && p.whatHappened.length < 140, `${p.code}: one or two short sentences`);
    assert.ok(p.money && p.next?.label, `${p.code}: where the money is, and one next step`);
    assert.ok(catalogue.includes(`\`${p.code}\``), `${p.code} is missing from errors.md`);
  }
  for (const row of catalogue.matchAll(/^\| `(agent\.[a-z.-]+)`/gm)) assert.ok(codes.has(row[1]), `errors.md lists ${row[1]}, which AgentZero never produces`);
});

test("the words never promise what nobody can, never advise, and never say the old name 'Agent' alone", () => {
  for (const p of all()) {
    const words = `${p.whatHappened} ${p.more ?? ""} ${p.next.label} ${"where" in p.money ? p.money.where : ""}`;
    assert.doesNotMatch(words.replace(/\byour Safe\b/g, "your S"), /\b(safe|safely|guarantee[ds]?|unhackable|anonymous|risk-free|yet|you should (buy|sell))\b/i, p.code);
    assert.doesNotMatch(words, /\bAgent\b(?!Zero)/, `${p.code}: AgentZero, never "Agent"`);
    assert.notEqual(p.money.state, "not-involved", `${p.code}: every Problem says where the money is`);
  }
});

test("D110: the table holds exactly what the Sign-up Robot's planner uses, and nothing outside packages/agent's tests reaches the old Agent app's files", () => {
  const think = readFileSync(new URL("./robot/think.ts", import.meta.url), "utf8");
  const used = new Set([...think.matchAll(/agentProblems\.([a-zA-Z]+)/g)].map((m) => m[1]));
  assert.deepEqual([...used].sort(), Object.keys(agentProblems).sort(), "every entry used, none missing");
  assert.doesNotMatch(think, /from "\.\.\/(service|prompt|plan|model|compile|words|types)\.ts"/, "the planner no longer pulls in the old service");
});

test("D110: nothing outside packages/agent reaches the old Agent app's deleted files", async () => {
  const { readdirSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = new URL("../../../", import.meta.url).pathname;
  const gone = /(?:@zerofee\/agent|agent\/src)\/(app\/screens\/|local-answer|network|robot\/demo|robot\/driver|service|prompt|plan|model|compile|words|types|testing\/sample)(\.tsx?)?["']/;
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      if (f === "node_modules" || f.startsWith(".") || f === "web" || f === "dist") continue;
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|mjs)$/.test(f) && gone.test(readFileSync(p, "utf8"))) hits.push(p.slice(root.length));
    }
  };
  for (const top of ["apps", "packages", "tools"]) walk(join(root, top));
  assert.deepEqual(hits.filter((h) => !h.startsWith("packages/agent/src/agent-problems.test.ts")), []);
});
