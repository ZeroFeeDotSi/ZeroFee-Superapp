// QA (5 Nov): with AgentZero's own wallet on, the core grants no agent_pay key on the Safe (agent-door.ts
// SAFE_KEY_DOORS), so the screen offers no Safe pocket money, no Turn on, and a job never asks for that key first.
// Controls: the Sim's sample money, or the wallet off, keep pocket money as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { safeKeyOffered } from "../zero/jobs.ts";

const app = readFileSync(new URL("./AgentApp.tsx", import.meta.url), "utf8");

test("Safe pocket money is offered only where the core grants its key (controls: the Sim, or the wallet off)", () => {
  assert.equal(safeKeyOffered(false, true), false, "a real account with AgentZero's own wallet on");
  assert.equal(safeKeyOffered(true, true), true, "control: the Sim's sample money");
  assert.equal(safeKeyOffered(false, false), true, "control: the wallet off");
});

test("the screen hides the Pocket money section and Turn on, and a job skips the Safe key, where it isn't offered", () => {
  assert.match(app, /const pocketHere = safeKeyOffered\(agent\?\.sample === true\);/);
  assert.match(app, /\{!noPocket && pocketHere && \(<>\n\s*<div className="zf-label ag-section">Wallet<\/div>/);
  // test: where the Safe's key isn't offered, the Fund button opens the own wallet's fill (fillOwn), never Turn on
  assert.match(app, /\) : !offersTurnOn\(pocket\) \? null : !pocketHere \? \(\n[^\n]*\n\s*<button className="zf-btn" disabled=\{busy\} data-testid="ag-fund-own"/);
  assert.match(app, /\{pocketHere \? \(\n\s*<button className="zf-btn" disabled=\{busy \|\| !\(choice > \(on \? pocketUsd : 0\)\) \|\| agent\?\.waiting\?\.usd === choice\} onClick=\{\(\) => void setPocket\(choice, runningList\(jobs\), needsAnyAddress\(jobs\), true\)/, "the Safe-key Add only where it is offered");
  assert.match(app, /\} else if \(!on && pocketHere && terms\.kind !== "sign-in" && !\(await setPocket\(choice\)\)\) return;/);
});
