// Sim's Browser never opens a new tab (product decision, 3 Nov): the address bar,
// a listed site's tile and a site app's window show our own sample site or our own page instead. Off Sim (the phone, the
// real web) the paths are as before: openTab still opens a tab (control). The pages themselves: sim/sim-sites.test.ts.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer, type ViteDevServer } from "vite";

const here = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
const servers: ViteDevServer[] = [];
async function addressDepsIn(sim: boolean) {
  const server = await createServer({
    configFile: false, root: fileURLToPath(new URL("../../../..", import.meta.url)), logLevel: "silent",
    define: { "import.meta.env.VITE_ZEROFEE_PUBLIC": JSON.stringify(sim ? "1" : "") },
    server: { middlewareMode: true, hmr: false, ws: false },
  });
  servers.push(server);
  return (await server.ssrLoadModule("/packages/browser/src/social/AddressBar.tsx")) as { addressDeps: (...a: unknown[]) => { openTab: (url: string) => void }; SIM_WEB_EVENT: string };
}

const opened: string[] = [];
const events: string[] = [];
before(() => {
  const g = globalThis as Record<string, unknown>;
  g.window = { open: (u: string) => void opened.push(u) };
  g.dispatchEvent = (e: CustomEvent) => (events.push(String(e.detail)), true);
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};
  g.document = { documentElement: { dataset: { public: "sim" } } };
});
after(async () => { for (const s of servers) await s.close(); });

test("Sim: an address that isn't listed shows our own page, never window.open; control: off Sim it still opens a tab", async () => {
  const sim = await addressDepsIn(true);
  sim.addressDeps(undefined, [], () => {}, () => {}).openTab("https://example.com/");
  assert.deepEqual(opened, [], "no new tab in Sim");
  assert.deepEqual(events, ["https://example.com/"], "the in-app page was asked for");
  const real = await addressDepsIn(false);
  real.addressDeps(undefined, [], () => {}, () => {}).openTab("https://example.com/");
  assert.deepEqual(opened, ["https://example.com/"], "control: off Sim, the tab as before");
});

test("a site app's window and a listed tile branch to our sample site in Sim; the sample site itself opens nothing", () => {
  assert.match(here("./SiteApp.tsx"), /if \(simSitesOn\(\)\) return <SimSitePage kind=\{simSiteKind\(site\)\} site=\{site\} name=\{name\} onClose=\{\(\) => closed\("close"\)\} \/>;/);
  assert.match(here("./SocialApp.tsx"), /if \(simSitesOn\(\)\) return shell\.openApp\("social", site\.id\);\n    if \(!onPhone\(\)\) \{/);
  for (const f of ["../sim/SimSitePage.tsx", "../sim/sites-data.ts"]) assert.doesNotMatch(here(f), /window\.open|_blank|href=|device\.openSite/, f);
});
