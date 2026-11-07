// turn.ts's own-key gate (audit, 7 Nov): own-claude.ts (the Anthropic SDK, the person's own key) is built in only with the
// developer switch, never the public web, and stays on in a node test. The gate must stay inline for Vite to fold it, so
// this evaluates turn.ts's own text of it under each build's import.meta.env (as Vite gives it: MODE always set).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const turn = readFileSync(new URL("./turn.ts", import.meta.url), "utf8");
const gateOf = (src: string): string => {
  const m = src.match(/async function ownClaude\(\): Promise<OwnClaude> \{\n  if \((.+)\) return \(ownLoaded \?\?= await import\("\.\/own-claude\.ts"\)\);/);
  assert.ok(m, "ownClaude's inline gate");
  return m[1];
};
const run = (gate: string, env: Record<string, string> | undefined): boolean =>
  new Function("M", `return ${gate.replaceAll("import.meta", "M")};`)(env === undefined ? {} : { env }) as boolean;

const vite = (flags: Record<string, string>) => ({ MODE: "production", PROD: "true", ...flags });
const BUILDS: Array<[string, Record<string, string> | undefined, boolean]> = [
  ["a node test (no import.meta.env)", undefined, true],
  ["the test phone bundle", vite({ VITE_HOME_PROOF: "1", VITE_NATIVE_COINS: "1", VITE_SAFE_FILL_OPEN: "1", VITE_AGENT_BROWSER: "1" }), false],
  ["the Sim", vite({ VITE_HOME_PROOF: "1", VITE_NATIVE_COINS: "1" }), false],
  ["the free build", vite({ VITE_ZEROFEE_FREE: "1" }), false],
  ["the public web", vite({ VITE_ZEROFEE_PUBLIC: "1", VITE_HOME_PROOF: "1", VITE_WEB_TRADE: "1" }), false],
  ["the public web with the switch", vite({ VITE_ZEROFEE_PUBLIC: "1", VITE_AGENTZERO_OWN_KEY: "1" }), false],
  ["a developer build (the switch)", vite({ VITE_AGENTZERO_OWN_KEY: "1" }), true],
  ["a dev server with the switch", { MODE: "development", VITE_AGENTZERO_OWN_KEY: "1" }, true],
];

test("own-claude.ts is loaded only in a developer build or a node test (table; control: the old gate let every non-public build have it)", () => {
  const gate = gateOf(turn);
  for (const [name, env, on] of BUILDS) assert.equal(run(gate, env), on, name);
  // chatTurn uses a key only behind the very same gate
  assert.ok(turn.includes(`const own = ${gate} ? o.ownKey?.trim() || null : null;`));
  // control: the gate before 7 Nov (the public flag alone) was on for the test phone bundle, the Sim and the free build
  const old = 'import.meta.env?.VITE_ZEROFEE_PUBLIC !== "1"';
  assert.deepEqual(BUILDS.filter(([, env, on]) => run(old, env) !== on).map(([n]) => n), ["the test phone bundle", "the Sim", "the free build"]);
});
