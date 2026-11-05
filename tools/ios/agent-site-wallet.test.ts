// Bug report (5 Nov): neither AgentZero nor the person could sign in to pump.fun or GMGN from AgentZero's site window
// (PartnerRecipe agent(site:) was robot mode only, and PartnerView puts provider.js in only with wallet mode). The
// recipe now has wallet mode on the sign-in sites, under QA's ruling (a)–(d). Swift has no test target, so this
// reads the Swift source (as wallet-methods.test.ts does) and holds its lists to the engine's and the core's; the
// recipe's own behaviour runs on a Mac in apps/ios/check/partner.swift (partner.sh).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AGENT_SIGN_IN_HOSTS } from "../../packages/core/src/site-wallets.ts";
import { AGENT_METHODS, AGENT_ONLY_SIGNS_IN, AGENT_SITES } from "../../packages/browser/src/engine/engine.ts";

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");
const recipe = read("apps/ios/ZeroFee/PartnerRecipe.swift");
const view = read("apps/ios/ZeroFee/PartnerView.swift");
const wallet = read("apps/ios/ZeroFee/PartnerWallet.swift");
const isolated = read("apps/ios/ZeroFee/IsolatedCore.swift");
const robot = read("apps/ios/ZeroFee/PartnerRobot.swift");
const check = read("apps/ios/check/partner.swift");
const strings = (src: string) => [...src.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
/** The body of one Swift init/func, from its line to the next one at the same indent. */
const body = (src: string, head: string) => {
  const at = src.indexOf(head);
  assert.ok(at >= 0, `${head} not found`);
  return src.slice(at, src.indexOf("\n  }\n", at) + 4);
};

test("a: AgentZero's sign-in sites are one list in Swift, the engine and the core: pump.fun and GMGN, exact hosts", () => {
  const swift = /static let agentWalletHosts = \[([^\]]*)\]/.exec(recipe);
  assert.ok(swift, "agentWalletHosts");
  assert.deepEqual(strings(swift![1]!), ["pump.fun", "gmgn.ai"]);
  assert.deepEqual([...AGENT_SITES], ["pump.fun", "gmgn.ai"]);
  assert.deepEqual([...AGENT_SIGN_IN_HOSTS], ["pump.fun", "gmgn.ai"]);
});

test("a: the wallet recipe never rides on any host; the any-host recipe has no wallet (control: both are AgentZero's)", () => {
  const wallet = body(recipe, "private init(agentWalletSites:");
  assert.match(wallet, /anyHost = false/);
  assert.match(wallet, /modes = \[\.robot, \.wallet\]/);
  assert.match(wallet, /chains = \["solana"\]/);
  assert.match(wallet, /agent = true/);
  const any = body(recipe, "private init(agentSite:");
  assert.match(any, /anyHost = true/);
  assert.match(any, /modes = \[\.robot\]/);
  assert.match(any, /agent = true/);
  // the agent(site:) door: wallet only for a listed sign-in site
  assert.match(recipe, /agentWalletHosts\.contains\(site\) \? PartnerRecipe\(agentWalletSites: agentWalletHosts\) : PartnerRecipe\(agentSite: site\)/);
  // kept for a window only when the scope holds (walletScopeOK: never anyHost with a wallet)
  assert.match(recipe, /var walletScopeOK: Bool \{ !\(anyHost && modes\.contains\(\.wallet\)\)/);
  assert.match(recipe, /\$0\.walletScopeOK && \$0\.covers\(host\)/);
  // JSON can't make AgentZero's window
  assert.match(recipe, /partner != "agentzero"/);
  assert.match(recipe, /self\.agent = false/);
});

test("the product break is gone: provider.js goes in with wallet mode, which AgentZero's sign-in recipe now has (control: the rule itself is unchanged)", () => {
  assert.match(view, /if let r = self\.recipe, r\.modes\.contains\(\.wallet\) \{ providerScript = PartnerScripts\.providerScript\(\) \}/);
  assert.match(view, /let want = recipe\.active\(\.wallet, host: target, kid: kid\)/, "only on a host the recipe covers: an unlisted host gets no provider");
});

test("b: AgentZero's window keeps its own store, its own forHost door, and tells the engine and the core it is AgentZero's (host's word)", () => {
  assert.match(view, /dataStore\(forHost: url\.host \?\? "", privately: privately, agent: self\.recipe\?\.agent == true && self\.recipe\?\.modes\.contains\(\.wallet\) == true\)/);
  assert.match(recipe, /agent \? "zerofee-agent"/);
  assert.match(isolated, /openHosts: askingSiteHosts\(agent: false\)/, "forHost never answers for a host only AgentZero's window asks");
  assert.match(isolated, /method == "subwallet\.site\.forAgent"[\s\S]{0,300}askingSiteHosts\(agent: true\)/);
  assert.match(isolated, /let agentWindow = waiting\?\.recipe\.agent == true/);
  assert.match(isolated, /SignInTap\.words\(agent: agentWindow/);
  assert.ok(wallet.includes(`"agent": recipe.agent, "tap": view.touchedRecently, "load": view.pageLoad])`), "the engine hears the host's words");
  assert.match(robot, /var agentMode: Bool \{ recipe\.agent \}/, "the robot's agent mode follows AgentZero's window, not any-host");
});

test("c: a page in AgentZero's window asks connect and the sign-in only: the Swift list is the engine's, the refusal line the same, the core gate refuses any other signature", () => {
  const m = /static let agentMethods: Set<String> = \[([^\]]*)\]/.exec(recipe);
  assert.ok(m);
  assert.deepEqual(new Set(strings(m![1]!)), new Set([...AGENT_METHODS].filter((x) => x !== "zerofee_left")));
  assert.ok(recipe.includes(`static let agentOnlySignsIn = "${AGENT_ONLY_SIGNS_IN}"`));
  assert.match(wallet, /if agent, !PartnerRecipe\.agentMethods\.contains\(method\) \{ return \(4200, PartnerRecipe\.agentOnlySignsIn\) \}/);
  assert.match(wallet, /Self\.screen\(method, params: params, agent: recipe\.agent\)/);
  assert.match(isolated, /guard TabRules\.agentWindowMay\(method, agentWindow: agentWindow\)/);
});

test("the Mac check runs the recipe's rules, with controls (partner.sh)", () => {
  for (const line of ["a: exact hosts only, never any host with a wallet", "a: no provider on", "c: AgentZero's window asks connect and sign-in only", "b: AgentZero's window keeps its own store", "a, control: an unlisted site's AgentZero window has no wallet", "JSON can't make AgentZero's window"]) {
    assert.ok(check.includes(line), line);
  }
});
