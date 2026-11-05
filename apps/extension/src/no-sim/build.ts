// Row 35 (product decision, 3 Nov): the extension is the real app, never a Sim. The extension's build (vite.app.config.ts) swaps
// every Sim module the web app reaches for the extension's own stand-in here (STANDINS), then refuses to finish if any
// built chunk still holds a Sim, demo or mock module (NEVER), or if the real core isn't in it (MUST). The gate reads the
// bundler's own module lists, so a renamed string or a minified name can't slip past it. Pure: node tests it.
import { fileURLToPath } from "node:url";

const here = (f: string) => fileURLToPath(new URL(`./${f}`, import.meta.url));

/** Each Sim module the web app imports, and the extension's stand-in for it (same exports, never a sample path). */
export const STANDINS: readonly { module: RegExp; standin: string }[] = [
  { module: /\/apps\/web\/src\/sim-storage\.ts$/, standin: here("sim-storage.ts") },
  { module: /\/apps\/web\/src\/demo-line\.ts$/, standin: here("demo-line.ts") },
  { module: /\/apps\/web\/src\/gallery\/screens\.css$/, standin: here("screens.css") },
  { module: /\/apps\/web\/src\/agentzero\/SimChat\.tsx$/, standin: here("SimChat.tsx") },
  { module: /\/packages\/agent\/src\/chat\/sim\.ts$/, standin: here("agent-sim.ts") },
  { module: /\/packages\/trade\/src\/demo-engine\.ts$/, standin: here("demo-engine.ts") },
  { module: /\/packages\/browser\/src\/sim\/sites-data\.ts$/, standin: here("sites-data.ts") },
  { module: /\/packages\/browser\/src\/sim\/SimSitePage\.tsx$/, standin: here("SimSitePage.tsx") },
  { module: /\/packages\/earn\/src\/app\/demo\.ts$/, standin: here("earn-demo.ts") },
];

/** What the extension's build must never contain: the Sim, the sample demo and its mock bridge, sample data, fakes. */
export const NEVER: readonly RegExp[] = [
  /\/packages\/shell-api\/src\/(MockBridge|mock-float)\.ts$/,
  /\/apps\/web\/src\/gallery\//,
  /\/apps\/web\/src\/(sim-storage|demo-line)\.ts$/,
  /\/apps\/web\/src\/agentzero\/(SimChat\.tsx|sim-chat\.ts)$/,
  /\/packages\/agent\/src\/chat\/sim\.ts$/,
  /\/packages\/trade\/src\/(demo-engine|perps\/sample|market\/(demo-samples|recorded|recorded-data))\.ts$/,
  /\/packages\/browser\/src\/sim\//,
  /\/packages\/earn\/src\/app\/demo\.ts$/,
  /\/src\/testing\//,
];

/** What the extension's build must contain: the real core (the same DemoCore class the iPhone's isolated core runs; its
 *  name is historical), its two-node chain reader and its vault. */
export const MUST: readonly RegExp[] = [
  /\/packages\/core\/src\/demo-core\.ts$/,
  /\/packages\/core\/src\/chain\.ts$/,
  /\/packages\/core\/src\/vault\.ts$/,
];

/** The stand-in for `id`, or null when it isn't a Sim module. */
export function standinFor(id: string): string | null {
  return STANDINS.find((s) => s.module.test(id))?.standin ?? null;
}

/** What's wrong with a build whose chunks hold `ids` (empty: nothing). */
export function simProblems(ids: Iterable<string>): string[] {
  const all = [...ids].map((id) => id.split("?")[0]!);
  const bad = all.filter((id) => NEVER.some((re) => re.test(id))).map((id) => `a Sim module is in the build: ${id}`);
  const missing = MUST.filter((re) => !all.some((id) => re.test(id))).map((re) => `the real core isn't in the build: ${re}`);
  return [...bad, ...missing];
}
