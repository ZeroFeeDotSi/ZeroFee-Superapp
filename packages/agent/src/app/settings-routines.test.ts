// Jobs and limits lists the routines the person approved, each with Stop (real-Claude walk, 3 Nov: a routine approved
// in the chat was on no screen and couldn't be stopped). They come from the engine's snapshot (the phone's store).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { doWords, whenWords } from "../zero/routines.ts";

const src = readFileSync(new URL("./AgentApp.tsx", import.meta.url), "utf8");

test("the settings list each routine that's on, in words, with a Stop that calls stopRoutine; control: words for a price routine and a Friday one differ", () => {
  const block = src.slice(src.indexOf('<div className="zf-label ag-section">Routines</div>') - 200, src.indexOf('<div className="zf-label ag-section">Pocket money</div>'));
  assert.ok(block.length > 300, "the Routines section is there, before Pocket money");
  assert.match(block, /\(snap\.routines \?\? \[\]\)\.filter\(\(r\) => r\.on\)/);
  assert.match(block, /whenWords\(r\.when\)/);
  assert.match(block, /doWords\(r\.do, r\.limitUsd\)/);
  assert.match(block, /onClick=\{\(\) => void engine\.stopRoutine\(r\.id\)\}>Stop</);
  assert.equal(`${whenWords({ price: "SOL", dropPct: 20 })}: ${doWords({ act: "tell" }, 0)}`, "When SOL falls 20%: AgentZero tells you. Nothing moves.");
  assert.notEqual(whenWords({ every: "week", day: 5 }), whenWords({ price: "SOL", dropPct: 20 }));
});
