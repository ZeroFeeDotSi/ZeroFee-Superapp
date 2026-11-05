// Self-host (public repo): apps/quotes/.env.example names every setting the relay reads, so a fresh clone can set its own
// keys; and it holds names only, never a value (control: a name the relay reads that the file lacks fails here).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
const sources = (d: string): string[] => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  if (statSync(p).isDirectory()) return f === "testing" || f === "node_modules" ? [] : sources(p);
  return /\.mjs$/.test(f) && !/\.test\.|harness|\.poc\./.test(f) ? [p] : [];
});
const read = new Set(sources(dir).flatMap((p) => [...readFileSync(p, "utf8").matchAll(/\benv\.([A-Z][A-Z0-9_]{2,})/g)].map((m) => m[1]!)));
const example = readFileSync(join(dir, ".env.example"), "utf8");
const listed = new Set([...example.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]!));
const hostSet = new Set(["VERCEL", "VERCEL_ENV", "VERCEL_REGION"]);

test("every setting the relay reads is in apps/quotes/.env.example (the host's own VERCEL* named in a comment)", () => {
  assert.ok(read.has("ONECLICK_JWT") && read.size > 30, "control: the scan finds the relay's settings");
  const missing = [...read].filter((k) => !listed.has(k) && !(hostSet.has(k) && example.includes(k)));
  assert.deepEqual(missing, []);
});

test("apps/quotes/.env.example holds names only: every line is a comment, blank, or NAME= with no value", () => {
  for (const line of example.split("\n")) assert.ok(line === "" || line.startsWith("#") || /^[A-Z][A-Z0-9_]+=$/.test(line), line.slice(0, 40));
});
