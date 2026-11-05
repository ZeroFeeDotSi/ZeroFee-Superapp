// Self-host from a phone (product decision, 5 Nov): a fork imported into Vercel with nothing typed builds the web wallet. The repo
// root's vercel.json is the generated one (hosting.ts), its build sets every switch itself and names no relay, and the
// README's steps and Deploy button match it. Each check has its control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SELF_HOST_BUILD, selfHostVercelConfig, selfHostVercelJson, vercelConfig } from "./hosting.ts";

const root = (p: string) => readFileSync(fileURLToPath(new URL(`../../../${p}`, import.meta.url)), "utf8");

test("the repo root's vercel.json is the generated one (run: node apps/web/src/hosting.ts)", () => {
  assert.equal(root("vercel.json"), selfHostVercelJson());
});

test("Vercel needs no typed setting: install at the root, build the web app, serve its dist", () => {
  const c = JSON.parse(root("vercel.json"));
  assert.equal(c.installCommand, "npm ci --ignore-scripts --no-audit --no-fund");
  assert.equal(c.outputDirectory, "apps/web/dist");
  assert.equal(c.framework, null);
  // every switch is in the command itself (Vercel's vercel.json can't set env vars)
  for (const on of ["VITE_ZEROFEE_PUBLIC=1", "VITE_HOME_PROOF=1", "VITE_WEB_TRADE=1"]) assert.ok(c.buildCommand.includes(on), on);
  assert.match(c.buildCommand, /npm run -s -w @zerofee\/web build$/);
  // no relay baked in: ours refuses other origins; a self-hoster adds their own as VITE_ZEROFEE_RELAY
  assert.ok(!/VITE_ZEROFEE_RELAY|https?:\/\//.test(c.buildCommand));
  // control: a build command missing a switch fails the same check
  assert.ok(!"VITE_HOME_PROOF=1 npm run build".includes("VITE_ZEROFEE_PUBLIC=1"));
});

test("the self-host site keeps every header and rewrite of ours", () => {
  const { framework, installCommand, buildCommand, outputDirectory, ...rest } = selfHostVercelConfig();
  assert.deepEqual({ framework, installCommand, buildCommand, outputDirectory }, SELF_HOST_BUILD);
  assert.deepEqual(rest, vercelConfig());
});

test("the README leads with the iPhone steps, then the web one, and its Deploy button names no root directory", () => {
  const md = root("README.md");
  const ios = md.indexOf("### A. The iPhone app");
  const web = md.indexOf("### B. A web wallet");
  assert.ok(ios > 0 && web > ios, "iPhone first");
  assert.ok(ios < md.indexOf("## Release, 3 Nov 2026"), "at the top");
  assert.ok(md.includes("https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FOWNER%2FREPO"));
  assert.ok(!/vercel\.com\/new\/clone[^)\s]*root-directory/.test(md), "the root vercel.json needs no Root Directory");
  for (const step of ["bash apps/ios/build-web.sh", "apps/ios/ZeroFee.xcodeproj", "apps/ios/relay-url.txt", "7 days"]) assert.ok(md.includes(step), step);
});
