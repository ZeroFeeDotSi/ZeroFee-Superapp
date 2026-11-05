// The partner window's rules on a Mac, no simulator needed (Security's D29 §A): the recipe's shape, exact hosts, and a
// child's phone getting no modes, read from the core's own account record. Run by partner.sh; exit 0 = all passed.
import Foundation

var failed = 0
func check(_ ok: Bool, _ what: String) {
  print(ok ? "ok   " : "FAIL ", what)
  if !ok { failed += 1 }
}

let raw: [String: Any] = ["partner": "mt-pelerin", "hosts": ["app.mtpelerin.com"], "modes": ["wallet", "robot"], "chains": ["base"], "walletKind": "browser", "slots": ["{{profile.email}}", "{{login.password}}", "{{login.new}}"], "login": ["host": "app.mtpelerin.com", "create": true], "commitButtons": ["Send"]]
let r = PartnerRecipe(raw)
check(r != nil, "a compiled recipe is read")
check(PartnerRecipe(raw.merging(["hosts": ["*.mtpelerin.com"]]) { _, b in b }) == nil, "a wildcard host is refused")
check(PartnerRecipe(raw.merging(["hosts": ["app.mtpelerin.com:8443"]]) { _, b in b }) == nil, "a host with a port is refused")
check(PartnerRecipe(raw.merging(["modes": ["robot", "god"]]) { _, b in b }) == nil, "an unknown mode is refused")
check(PartnerRecipe(raw.merging(["slots": ["{{keys.seed}}"]]) { _, b in b }) == nil, "an unknown slot is refused")
check(PartnerRecipe(raw.merging(["walletKind": "account"]) { _, b in b }) == nil, "a wallet that isn't browser or pay is refused")
check(r!.active(.robot, host: "app.mtpelerin.com", kid: false), "robot mode is on on its own host")
check(!r!.active(.robot, host: "mtpelerin.com", kid: false) && !r!.active(.wallet, host: "evil.app.mtpelerin.com", kid: false), "and off on any other host, even a parent or child name")

// §A3: the child flag comes from the core's own account record.
let childRecord = try! JSONSerialization.data(withJSONObject: ["accountId": "kid.testnet", "stage": "ready", "kid": true])
let adultRecord = try! JSONSerialization.data(withJSONObject: ["accountId": "me.testnet", "stage": "ready"])
check(ChildPhone.fromCoreState(childRecord), "the core's record with kid: true is a child's phone")
check(!ChildPhone.fromCoreState(adultRecord), "the core's record without kid is not (the control)")
check(!ChildPhone.fromCoreState(nil) && !ChildPhone.fromCoreState(Data("not json".utf8)), "no record, or an unreadable one, is not a child's")
let kid = ChildPhone.isChild(shellSaid: false, coreState: childRecord)
check(kid, "the page saying 'not a child' can't override the core")
check(!r!.active(.robot, host: "app.mtpelerin.com", kid: kid) && !r!.active(.wallet, host: "app.mtpelerin.com", kid: kid), "on a child's phone neither robot nor wallet mode is on, even on the recipe's host")
check(ChildPhone.isChild(shellSaid: true, coreState: adultRecord), "the shell's flag can only add to it")
check(ChildPhone.isChild(shellSaid: false, accountState: ["ok": ["stage": "ready", "kid": true]], coreState: nil), "the isolated core's account.state kid: true is a child's phone")
check(!ChildPhone.isChild(shellSaid: false, accountState: ["ok": ["stage": "ready"]], coreState: adultRecord), "an adult's account.state is not (the control)")
check(!ChildPhone.fromAccountState(["problem": ["code": "x", "kid": true]]), "a Problem is never read as a child's flag")

// MUST 1: a password ZeroFee copied is never read back by an app.
check(!ConcealedClipboard.mayRead(types: ["public.utf8-plain-text", "si.zerofee.logins.concealed"]), "the clipboard holding a ZeroFee-copied password reads as nothing")
check(ConcealedClipboard.mayRead(types: ["public.utf8-plain-text"]), "an ordinary clipboard is read (the control)")

// MUST 2: {{login.new}} twice in one run = one password, one saved item.
var run = RunPasswords()
var saved = 0
let first = run.password(for: "app.mtpelerin.com") { saved += 1; return "first-\(saved)" }
let second = run.password(for: "app.mtpelerin.com") { saved += 1; return "second-\(saved)" }
check(first == second && saved == 1, "two {{login.new}} fills in a run give the same password and save one item")
let other = run.password(for: "other.example") { saved += 1; return "other-\(saved)" }
check(other != first && saved == 2, "another host gets its own")
run.clear()
let next = run.password(for: "app.mtpelerin.com") { saved += 1; return "next-\(saved)" }
check(next != first && saved == 3, "a new run makes a new one (the run's memory is cleared at its end)")

// SHOULD 1 and the wallet-only site rules: the pinned table.
check(PinnedRecipes.pay.count == 2 && PinnedRecipes.presets.count == 9, "the pinned table reads: 2 Pay recipes, 9 presets")
check(PinnedRecipes.acceptForPay(PinnedRecipes.pay[1]), "Pay's own recipe is accepted for openUrl")
var widened = raw
widened["slots"] = ["{{profile.email}}", "{{login.password}}", "{{login.new}}", "{{profile.phone}}"]
check(!PinnedRecipes.acceptForPay(PartnerRecipe(widened)!), "a recipe that isn't exactly Pay's is refused for openUrl")
func site(_ hosts: [String], _ chains: [String], kind: String = "browser", modes: [String] = ["wallet"], extra: [String: Any] = [:]) -> PartnerRecipe? {
  PartnerRecipe(["partner": "site", "hosts": hosts, "modes": modes, "chains": chains, "walletKind": kind, "slots": [String](), "commitButtons": [String]()].merging(extra) { _, b in b })
}
check(PinnedRecipes.acceptForSite(site(["example.com"], ["eth", "sol"])!, openedHost: "example.com"), "(1) a typed site: one host = the opened page's, the Browser wallet's chains: accepted")
check(!PinnedRecipes.acceptForSite(site(["example.com", "evil.example"], ["eth"])!, openedHost: "example.com"), "(1) a typed site with a second host is refused")
check(!PinnedRecipes.acceptForSite(site(["example.com"], ["bsc"])!, openedHost: "example.com"), "(1) a chain outside the Browser wallet's own is refused")
check(!PinnedRecipes.acceptForSite(site(["example.com"], ["eth"], extra: ["commitButtons": ["Buy"]])!, openedHost: "example.com"), "(1) commit words on a typed site are refused")
check(!PinnedRecipes.acceptForSite(site(["example.com"], ["eth"], modes: ["wallet", "robot"])!, openedHost: "example.com"), "a typed site never gets the robot")
check(!PinnedRecipes.acceptForSite(site(["app.gnosispay.com"], ["gnosis"], kind: "pay")!, openedHost: "app.gnosispay.com"), "(SHOULD 3) openSite never gets the card's pay wallet")
check(PinnedRecipes.acceptForSite(site(["fomo.family"], ["sol", "base"])!, openedHost: "fomo.family"), "a preset's exact hosts and chains are accepted")
check(!PinnedRecipes.acceptForPay(site(["example.com"], ["eth"])!), "(2) a typed site's recipe is never accepted on Pay's openUrl")
check(PinnedRecipes.known("app.mtpelerin.com") && PinnedRecipes.known("pump.fun") && !PinnedRecipes.known("example.com"), "(3) known is the pinned table's word: a typed site is unknown")
check(WalletGate.precheck(method: "eth_accounts", connected: false, gated: true) == .noAccounts && WalletGate.precheck(method: "personal_sign", connected: false, gated: true) == .notConnected && WalletGate.precheck(method: "eth_requestAccounts", connected: false, gated: true) == .relay, "(4) a typed site isn't pre-approved: no accounts and no signature until the connect sheet")
check(WalletGate.precheck(method: "personal_sign", connected: true, gated: true) == .relay, "(4) after the sheet's yes it goes on (the control)")

// SHOULD 4: the second lock.
check(RobotWords.isDeclaration("Are you a politically exposed person?") && RobotWords.isDeclaration("Source of funds") && RobotWords.isDeclaration("FATCA status") && RobotWords.isDeclaration("Tax identification number"), "declarations are the person's")
check(!RobotWords.isDeclaration("Email address"), "an email box is not (the control)")
check(RobotWords.englishPage("en") && RobotWords.englishPage("en-GB") && !RobotWords.englishPage("de") && !RobotWords.englishPage(""), "only English pages; none declared is the person's turn")
// Security's note: a half-filled password pair is the person's turn in a new run.
check(RobotWords.halfFilledPair([true, false]) && !RobotWords.halfFilledPair([false, false]) && !RobotWords.halfFilledPair([true, true]) && !RobotWords.halfFilledPair([true]), "a half-filled password pair (and only that) is the person's turn")

// device.wallet.forget: Disconnect clears the host's own yes, so a typed site goes through the connect sheet again.
let d = UserDefaults(suiteName: "zf.check.\(UUID().uuidString)")!
WalletConnections.set("example.com", kind: "browser", true, in: d)
WalletConnections.set("example.com", kind: "pay", true, in: d)
check(WalletConnections.isConnected("example.com", kind: "browser", in: d), "a yes on the connect sheet is remembered (the control)")
WalletConnections.forget(WalletConnections.forgetHost("User@Example.COM")!, in: d)
check(!WalletConnections.isConnected("example.com", kind: "browser", in: d) && WalletGate.precheck(method: "personal_sign", connected: WalletConnections.isConnected("example.com", kind: "browser", in: d), gated: true) == .notConnected, "device.wallet.forget clears it: the typed site gets nothing until the sheet again")
check(WalletConnections.isConnected("example.com", kind: "pay", in: d), "it forgets the Browser wallet's yes only")
check(WalletConnections.forgetHost("") == nil && WalletConnections.forgetHost("a b.com") == nil, "a forget naming no host is refused")

// The quote relay setting (build-web.sh → CoreBundle/relay.json → RelaySetting): one https origin, or Private is off.
check(RelaySetting.parse(Data(#"{"relay":""}"#.utf8)) == nil, "relay unset: Private isn't set up (no host allowed)")
check(RelaySetting.parse(nil) == nil, "no relay.json at all: the same")
check(RelaySetting.parse(Data(#"{"relay":"https://ZF-Quotes.example.app/"}"#.utf8)).map { "\($0.base) \($0.host)" } == "https://zf-quotes.example.app zf-quotes.example.app", "relay set: its base and its one host")
for bad in ["http://zf-quotes.example.app", "https://zf-quotes.example.app/v0", "https://u@zf-quotes.example.app", "https://zf-quotes.example.app:8443", "https://zf-quotes.example.app/?a=1"] {
  check(RelaySetting.parse(Data("{\"relay\":\"\(bad)\"}".utf8)) == nil, "relay \(bad) is refused")
}

// B29: the origin the host hands Browser's engine is an https origin (the engine refuses a bare host as not https),
// and a connect or sign the engine refused or didn't answer is a line on the window; the person's no and reads are not.
check(WalletGate.relayOrigin("gmgn.ai") == "https://gmgn.ai" && WalletGate.relayOrigin("pump.fun") == "https://pump.fun", "the engine gets https://<host>, never the bare host")
check(WalletGate.relayOrigin("localhost:8443") == "https://localhost:8443", "a port the strip shows is kept")
check(WalletGate.troubleLine(method: "solana:connect", code: 4100, site: "GMGN") == "ZeroFee couldn't connect your wallet to GMGN. Try again.", "a refused connect is said on the window, naming the site")
check(WalletGate.troubleLine(method: "solana:connect", code: nil, site: "GMGN") == "ZeroFee's wallet didn't answer GMGN. Try again.", "an unanswered connect is said too")
check(WalletGate.troubleLine(method: "solana:signMessage", code: 4200, site: "GMGN") == "ZeroFee couldn't sign you in to GMGN. Try again.", "a refused sign-in is said")
check(WalletGate.troubleLine(method: "solana:signAndSendTransaction", code: 4200, site: "pump.fun") == "ZeroFee couldn't finish pump.fun's request.", "a refused transaction is said, without promising what moved")
check(WalletGate.troubleLine(method: "solana:connect", code: 4001, site: "GMGN") == nil && WalletGate.troubleLine(method: "solana:signMessage", code: 4001, site: "GMGN") == nil, "the person's own no is not a problem (control)")
check(WalletGate.troubleLine(method: "eth_call", code: 4200, site: "GMGN") == nil && WalletGate.troubleLine(method: "eth_chainId", code: nil, site: "GMGN") == nil, "a read that fails says nothing on the window")

// D75: a site's own window narrates AgentZero (fixed words, the compiled name), and its sign-in trouble is AgentZero's
check(WalletGate.agentSigningIn("GMGN") == "AgentZero is signing you in to GMGN…" && WalletGate.agentSignedIn == "AgentZero signed you in.", "AgentZero's two lines")
check(WalletGate.troubleLine(method: "solana:connect", code: 4100, site: "GMGN", agent: true) == "AgentZero couldn't sign you in to GMGN. Try again.", "a site window's refused connect, in AgentZero's words")
check(WalletGate.troubleLine(method: "solana:signMessage", code: nil, site: "GMGN", agent: true) == "AgentZero couldn't sign GMGN's message. Try again.", "an unanswered message: said as a message, not a sign-in (review M1)")
check(WalletGate.troubleLine(method: "solana:signAndSendTransaction", code: 4200, site: "pump.fun", agent: true) == "ZeroFee couldn't finish pump.fun's request.", "a transaction is never AgentZero's (the person approves it)")
check(WalletGate.troubleLine(method: "solana:connect", code: 4001, site: "GMGN", agent: true) == nil, "the person's no stays silent (control)")
check(WalletGate.troubleLine(method: "eth_requestAccounts", code: 4901, site: "GMGN", agent: true) == nil, "ST6: GMGN asking for its hidden EVM side says nothing")
check(WalletGate.connectWithin == 1 && WalletGate.answerWithin == 10, "B32: a connect says so after 1 s, a sign after 10 s")
// ST10/ST11/never blank: the window's own fixed lines, and what Social trading may ask it to say
check(WalletGate.agentOpening("pump.fun") == "AgentZero is opening pump.fun…" && WalletGate.siteSlow("pump.fun") == "pump.fun is slow to open. Trying again." && WalletGate.paintWithin == 8, "never blank: the opening and slow lines")
check(WalletGate.firstAddUsd == 5, "ST11: the window's ask moves $5")
check(WalletGate.windowLine("$5.00 is on its way to pump.fun.") == "$5.00 is on its way to pump.fun.", "ST11: a move's line passes")
for bad: Any in ["", String(repeating: "a", count: 161), "line\none", "\u{202E}evil", "tab\there", 5, NSNull()] { check(WalletGate.windowLine(bad) == nil, "ST11: a window line \(bad) is refused") }
// ST2: the wallet pill is dollars and cents only
for good in ["$0.00", "$2.91", "$1,204.50", "$999,999.99", "$999,999,999.99"] { check(WalletGate.pill(good) == good, "pill \(good)") }
for bad: Any in ["$2.9", "2.91", "$2.91 ", "Free money", "$-1.00", "$1,20.00", "$9999.00", "<b>$1.00</b>", "$1,000,000,000.00", 2.91, NSNull()] { check(WalletGate.pill(bad) == nil, "pill \(bad) is refused") }

// ST13: GMGN's network from its address only; a network Spending can't fill says so, Solana says nothing
let u = { (s: String) in URL(string: s)! }
check(WalletGate.siteChain(u("https://gmgn.ai/?chain=bsc")) == "bsc" && WalletGate.siteChain(u("https://gmgn.ai/base/token/0xabc")) == "base" && WalletGate.siteChain(u("https://gmgn.ai/sol/token/So11")) == "sol", "ST13: GMGN's network from its query or its path")
check(WalletGate.siteChain(u("https://gmgn.ai/portfolio")) == nil && WalletGate.siteChain(u("https://gmgn.ai/?chain=evil")) == nil, "ST13: no network, or one it doesn't know: nil")
check(WalletGate.siteChain(u("https://evil.example/bsc/token/1?chain=bsc")) == nil && WalletGate.siteChain(u("https://pump.fun/?chain=bsc")) == nil, "ST13: only on gmgn.ai")
check(WalletGate.notCarriedLine("sol") == nil && WalletGate.notCarriedLine("bsc") == "ZeroFee can't move BNB under $1,000 yet." && WalletGate.notCarriedLine("base") == "Base isn't in ZeroFee yet.", "ST13: the not-carried lines; Solana has none")
check(WalletGate.siteNetworkName("gmgn.ai") == "Solana" && WalletGate.siteNetworkName("pump.fun") == nil, "ST13: the ask names GMGN's Solana wallet, pump.fun's one wallet plainly")
check(WalletGate.stepStuckLine(host: "gmgn.ai", step: 1) == "GMGN didn't open its log in. Tap Log in yourself." && WalletGate.stepStuckLine(host: "gmgn.ai", step: -1) == nil && WalletGate.stepStuckLine(host: "pump.fun", step: 1) == nil, "retry: the stuck lines by host and step; -1 and unknown steps say nothing")

// D114, AgentZero's browser: the built-in agent recipe and its page rules (QA).
let agentRecipe = PartnerRecipe.agent(site: PartnerRecipe.agentSite("shop.example.com"))
check(agentRecipe.anyHost && agentRecipe.active(.robot, host: "shop.example.com", kid: false), "the agent recipe acts on its task's site")
// M10: one site per task: its subdomains, never another site, a look-alike, a number or a home-network name.
check(agentRecipe.covers("shop.example.com") && agentRecipe.covers("www.shop.example.com") && agentRecipe.covers("checkout.shop.example.com"), "M10: the task's site, its www and the names under it")
check(!agentRecipe.covers("example.com") && !agentRecipe.covers("evil.example.com") && !agentRecipe.covers("evil.com") && !agentRecipe.covers("shop.example.com.evil.com") && !agentRecipe.covers("notshop.example.com"), "M10: never another site, a sibling, or one that ends in the same letters")
check(PartnerRecipe.agentSite("www.amazon.co.uk") == "amazon.co.uk" && PartnerRecipe.agentSite("booking.com") == "booking.com" && PartnerRecipe.agentSite("www.opentable.com") == "opentable.com", "M10: the host it opens, less www")
let amazon = PartnerRecipe.agent(site: PartnerRecipe.agentSite("www.amazon.co.uk"))
check(amazon.covers("www.amazon.co.uk") && amazon.covers("smile.amazon.co.uk") && !amazon.covers("evil.co.uk"), "M10: a site under a country's name, never the country's whole name")
for (opened, other) in [("me.github.io", "evil.github.io"), ("acme.zendesk.com", "evil.zendesk.com"), ("wordpress.com", "attacker.wordpress.com"), ("substack.com", "attacker.substack.com"), ("pizza.business.site", "evil.business.site"), ("svc.a.run.app", "evil.a.run.app"), ("bucket.s3.amazonaws.com", "x.bucket.s3.amazonaws.com")] {
  let r = PartnerRecipe.agent(site: PartnerRecipe.agentSite(opened))
  check(r.covers(opened) && !r.covers(other), "M10 (review M1/M2): shared hosting: \(opened) covers itself, never \(other)")
}
for bad in ["192.168.1.1", "10.0.0.1", "192.168.1.0x1", "127.0.0.0x1", "0x7f.0.0.0x1", "x.y1", "xn--pple-43d.com", "router.local", "printer.lan", "intranet.corp", "Shop.Example.com", "localhost", "127.0.0.1.nip.io", "app.lvh.me", "localtest.me", "10.0.0.1.sslip.io"] {
  check(PartnerRecipe.agentRefuses(bad) != nil && !agentRecipe.covers(bad), "M10: never opens or follows \(bad)")
}
check(!agentRecipe.active(.robot, host: "shop.example.com", kid: true), "but never on a child's phone")
check(!agentRecipe.covers("Shop.Example.com") && !agentRecipe.covers("shop.example.com:8443") && !agentRecipe.covers("localhost"), "and only on an exact lowercase host with a dot, no port")
check(agentRecipe.login == nil && agentRecipe.slots.isEmpty && !agentRecipe.modes.contains(.wallet), "with no login, no slots and no wallet: signing in is the person's turn")
check(PartnerRecipe(["partner": "agentzero", "hosts": ["a.example"], "modes": ["robot"], "anyHost": true]) == nil, "JSON can't make AgentZero's window")
check(PartnerRecipe(["partner": "shop", "hosts": ["a.example"], "modes": ["robot"], "anyHost": true])?.anyHost == false && PartnerRecipe(["partner": "shop", "hosts": ["a.example"], "modes": ["robot"]])?.agent == false, "JSON can't ask for any host, nor be AgentZero's (control: the recipe itself parses)")

// Bug report, 5 Nov (QA's ruling a–d): AgentZero's window on pump.fun and GMGN signs in with its own wallet.
for site in ["pump.fun", "gmgn.ai"] {
  let r = PartnerRecipe.agent(site: PartnerRecipe.agentSite(site))
  check(r.agent && r.modes == [.robot, .wallet] && r.chains == ["solana"] && r.walletKindRaw == "browser", "a: \(site) gets wallet mode in AgentZero's window, on Solana")
  check(!r.anyHost && r.hosts == PartnerRecipe.agentWalletHosts && r.walletScopeOK, "a: exact hosts only, never any host with a wallet (\(site))")
  check(r.active(.wallet, host: site, kid: false) && r.active(.robot, host: site, kid: false), "a: wallet and robot on \(site)")
  check(PartnerRecipe.forWindow(r, opening: site, kid: false) == r && PartnerRecipe.forWindow(r, opening: site, kid: true) == nil, "kept for its window; never on a child's phone (\(site))")
  for other in ["evil.example", "www.\(site)", "x.\(site)", "\(site).evil.com", "jup.ag"] {
    check(!r.active(.wallet, host: other, kid: false) && !r.covers(other), "a: no provider on \(other) (\(site)'s window)")
  }
}
check(PartnerRecipe.agentWalletHosts == ["pump.fun", "gmgn.ai"], "a: the sign-in sites are pump.fun and GMGN")
check(PartnerRecipe.agentOpening(URL(string: "https://www.gmgn.ai/sol/token/x")!).absoluteString == "https://gmgn.ai/sol/token/x" && PartnerRecipe.agentOpening(URL(string: "https://www.example.com/")!).absoluteString == "https://www.example.com/", "a: a sign-in site's www opens on its exact host (control: another site's www stays)")
// control: any other site is robot only, as before, with no wallet
check(!agentRecipe.modes.contains(.wallet) && agentRecipe.anyHost && agentRecipe.agent && agentRecipe.walletScopeOK, "a, control: an unlisted site's AgentZero window has no wallet")
check(!PartnerRecipe.agent(site: "jup.ag").modes.contains(.wallet), "a, control: Jupiter (a site wallet's site, not a sign-in site) gets no wallet in AgentZero's window")
// c: only connect and the sign-in; the host's core gate refuses any other signature from AgentZero's window
check(PartnerRecipe.agentMethods == ["solana:connect", "solana:disconnect", "solana:signMessage"], "c: AgentZero's window asks connect and sign-in only")
check(TabRules.agentWindowMay("subwallet.signMessage", agentWindow: true), "c: the sign-in goes to the core")
for m in ["subwallet.signTx", "subwallet.sign", "subwallet.signTypedData", "subwallet.preflight"] {
  check(!TabRules.agentWindowMay(m, agentWindow: true) && TabRules.agentWindowMay(m, agentWindow: false), "c: \(m) from AgentZero's window is refused (control: the person's window unchanged)")
}
// b: its own store, so the person's sign-in there never shows in AgentZero's window
check(SiteStore.id(forHost: "pump.fun", agent: true) != SiteStore.id(forHost: "pump.fun") && SiteStore.toForget(host: "pump.fun", among: [SiteStore.id(forHost: "pump.fun", agent: true)]).count == 1, "b: AgentZero's window keeps its own store, forgotten with the site")
check(SignInTap.words(agent: true, touchedRecently: false, load: "L1") as NSDictionary == ["agent": true, "tap": false, "load": "L1"] as NSDictionary && SignInTap.within == 5, "the host's words: AgentZero's window, the touch, the load")
let rich = String(repeating: "word ", count: 100)
let plainBox: [String: Any] = ["kind": "field", "tag": "input", "type": "email", "label": "Email"]
check(!AgentPageRules.wantsPicture(textChars: rich.count, elements: [plainBox]), "rich text: no picture")
check(AgentPageRules.wantsPicture(textChars: 40, elements: [plainBox]), "thin text with no secret box: a picture (the control)")
for secret: [String: Any] in [["kind": "field", "type": "password"], ["kind": "field", "type": "text", "autocomplete": "cc-number"], ["kind": "field", "type": "text", "autocomplete": "one-time-code"], ["kind": "field", "type": "tel", "label": "CVC"], ["kind": "field", "type": "text", "label": "Card number"], ["kind": "field", "type": "text", "label": "Enter the verification code"]] {
  check(!AgentPageRules.wantsPicture(textChars: 10, elements: [plainBox, secret]), "a secret box on screen: never a picture (\(secret["label"] ?? secret["autocomplete"] ?? secret["type"] ?? ""))")
}
check(!AgentPageRules.isSecretField(["kind": "button", "text": "Forgot password?"]), "a button about passwords isn't a box (the control)")
for bot in ["Please verify you are human", "Are you a robot?", "I'm not a robot", "Our systems have detected unusual traffic", "Checking your browser before accessing", "Press and hold to confirm"] {
  check(AgentPageRules.isBotCheck(bot), "a bot check is the person's turn: \(bot)")
}
check(!AgentPageRules.isBotCheck("Welcome to our robotics shop"), "an ordinary page isn't a bot check (the control)")
for money in ["Pay now", "Checkout", "Place order", "Buy now", "Subscribe", "Add a card", "Start free trial", "Confirm and pay"] {
  check(AgentPageRules.isMoneyStep(money), "a money step is the person's tap: \(money)")
}
check(!AgentPageRules.isMoneyStep("Read more") && !AgentPageRules.isMoneyStep("Next page"), "an ordinary button isn't a money step (the control)")

// M17: stuck after 3 steps that left the page as it was; a refusal page; both the person's turn.
let same = AgentPageRules.pagePrint(host: "shop.example.com", text: "Cart", ids: ["b1", "b2"])
let moved = AgentPageRules.pagePrint(host: "shop.example.com", text: "Cart (1)", ids: ["b1", "b2"])
check(!AgentPageRules.isStuck([same, same, same]), "the page after 2 steps unchanged isn't stuck yet")
check(AgentPageRules.isStuck([same, same, same, same]), "the page after 3 steps unchanged is stuck")
check(!AgentPageRules.isStuck([same, same, moved, moved]), "a page that changed isn't stuck (the control)")
check(AgentPageRules.pagePrint(host: "a.example", text: "x", ids: []) != AgentPageRules.pagePrint(host: "b.example", text: "x", ids: []), "another host is another page")
for refused in ["403 Forbidden", "This content is not available in your country", "Your request has been blocked"] {
  check(AgentPageRules.isRefusal(refused), "a refusal page is the person's turn: \(refused)")
}
check(!AgentPageRules.isRefusal("Welcome back"), "an ordinary page isn't a refusal (the control)")

// M12: forgetting one site removes that site's store only, never another's.
let shopStore = SiteStore.id(forHost: "shop.example.com")
let bankStore = SiteStore.id(forHost: "bank.example.com")
check(SiteStore.id(forHost: "Shop.Example.com") == shopStore, "the same host (any case) is the same store")
check(SiteStore.toForget(host: "shop.example.com", among: [bankStore, shopStore]) == [shopStore], "forgetting shop.example.com removes its store only")
check(SiteStore.toForget(host: "shop.example.com", among: [bankStore]).isEmpty, "a site with no store removes nothing (another site's stays)")
check(SiteStore.forgetTitle("shop.example.com") == "Forget shop.example.com?", "the alert names the site")

// M5: one notice per pause.
var once = OncePerPause()
check(once.shouldSend() && !once.shouldSend(), "a pause sends one notice, never a second")
once.resumed()
check(once.shouldSend(), "the next pause sends its own (the control)")
check(OncePerPause.title == "AgentZero paused" && OncePerPause.body == "Open ZeroFee to go on.", "the notice says it plainly")


// D130/D131, private browsing: tor's control lines, its command line, a store per mode, the leak guard.
check(TorControl.progress("650 STATUS_CLIENT NOTICE BOOTSTRAP PROGRESS=45 TAG=loading_descriptors SUMMARY=\"Loading\"") == 45, "Tor: bootstrap progress from a status event")
check(TorControl.progress("250-status/bootstrap-phase=NOTICE BOOTSTRAP PROGRESS=100 TAG=done SUMMARY=\"Done\"") == 100, "Tor: and from the GETINFO answer")
check(TorControl.progress("650 STATUS_CLIENT NOTICE CIRCUIT_ESTABLISHED") == nil && TorControl.progress("BOOTSTRAP PROGRESS=180") == nil, "Tor: no progress from other lines or a number out of range (the control)")
check(TorControl.socksPort("250-net/listeners/socks=\"127.0.0.1:53419\"") == 53419, "Tor: the SOCKS port on loopback")
check(TorControl.socksPort("250-net/listeners/socks=\"0.0.0.0:9050\"") == nil && TorControl.socksPort("250-net/listeners/socks=\"192.168.1.5:9050\"") == nil, "Tor: never a SOCKS port open to the network")
let torArgs = TorControl.arguments(dataDirectory: "/d")
check(torArgs.contains("127.0.0.1:auto IsolateSOCKSAuth") && torArgs.contains("--ClientOnly") && !torArgs.contains("--ControlPort") && !torArgs.joined(separator: " ").contains("0.0.0.0"), "Tor: a client on loopback, one circuit per site, no open control port")
check(SiteStore.id(forHost: "pump.fun", privately: true) != SiteStore.id(forHost: "pump.fun") && SiteStore.id(forHost: "pump.fun") == SiteStore.id(forHost: "pump.fun", privately: false), "private browsing has its own store per site; the normal one is unchanged (the control)")
let both = [SiteStore.id(forHost: "pump.fun"), SiteStore.id(forHost: "pump.fun", privately: true), SiteStore.id(forHost: "gmgn.ai", privately: true)]
check(Set(SiteStore.toForget(host: "pump.fun", among: both)) == Set(both.prefix(2)), "forgetting a site removes both its stores, never another site's")
let guardNormal = PrivateRules.guardScript(privately: false), guardPrivate = PrivateRules.guardScript(privately: true)
check(guardNormal.contains("RTCPeerConnection") && guardNormal.contains("WebTransport") && guardNormal.contains("x-dns-prefetch-control"), "both modes: no WebRTC, no WebTransport, no DNS prefetch")
check(guardPrivate.contains("navigator.credentials") && !guardNormal.contains("navigator.credentials"), "passkeys off in private browsing only (normal keeps them: the control)")
check(PrivateRules.useNormal("pump.fun") == "Use normal browsing on pump.fun" && PrivateRules.notPrivateLine == "This partner window doesn't use private browsing.", "the per-site switch and Pay's line, in plain words")
check(TorControl.arguments(dataDirectory: "/d").contains("--SafeSocks"), "Tor: a name looked up on the phone is refused, never carried (DNS stays in Tor)")
let guardIframe = PrivateRules.guardScript(privately: true)
check(guardIframe.contains("HTMLIFrameElement.prototype") && guardIframe.contains("contentWindow") && guardIframe.contains("contentDocument"), "the guard scrubs a blank frame's window the moment the page reaches it")

// D131 tabs: at most 8 open; the 9th closes the oldest that isn't on screen and has no AgentZero task.
let t = { (id: String, busy: Bool, shown: Bool) in TabRules.Tab(id: id, busy: busy, shown: shown) }
check(TabRules.toClose((1...7).map { t("t\($0)", false, $0 == 7) }) == nil, "tabs: room for an eighth, nothing closes")
check(TabRules.toClose((1...8).map { t("t\($0)", false, $0 == 8) }) == "t1", "tabs: the ninth closes the oldest")
check(TabRules.toClose([t("a", true, false), t("b", false, true)] + (3...8).map { t("t\($0)", false, false) }) == "t3", "tabs: never one with AgentZero's task, never the one on screen")
check(TabRules.toClose((1...8).map { t("t\($0)", true, false) }) == nil, "tabs: nothing closable: none closes (the control)")
check(TabRules.name(title: "  ", host: "pump.fun") == "pump.fun" && TabRules.name(title: "Pump", host: "pump.fun") == "Pump" && TabRules.name(title: String(repeating: "x", count: 99), host: "a.b").count == 60, "tabs: the page's title, else its host, never long")
check(TabRules.buttonLabel(1) == "Tabs, 1 open" && TabRules.buttonLabel(3) == "Tabs, 3 open", "tabs: the button says how many")
check(TabRules.refusesSiteless(app: "browser", hasSite: false) && !TabRules.refusesSiteless(app: "browser", hasSite: true) && !TabRules.refusesSiteless(app: "trade", hasSite: false), "review H1: a Browser-wallet signature with no page on screen is refused; with its page, or another app's, it passes (controls)")
check(TabRules.isRequestId("w-" + UUID().uuidString) && !TabRules.isRequestId("w1") && !TabRules.isRequestId("w-nope"), "review H1: wallet request ids are unique across tabs, never w1")
check(TabRules.full == "Close a page first.", "review L: a ninth page with all eight busy says so, and doesn't open")
check(TabRules.siteMatches(engine: "https://pump.fun", waiting: "https://pump.fun") && TabRules.siteMatches(engine: nil, waiting: "https://pump.fun"), "review L1: the engine's site is the on-screen tab's waiting host (or unnamed): it signs")
check(!TabRules.siteMatches(engine: "https://pump.fun", waiting: "https://gmgn.ai") && !TabRules.siteMatches(engine: "https://pump.fun", waiting: nil), "review L1: another host, or none waiting on screen: refused, never swapped")
check(!TabRules.mayLeave(walletWaiting: true, approvalOpen: false) && !TabRules.mayLeave(walletWaiting: false, approvalOpen: true) && TabRules.mayLeave(walletWaiting: false, approvalOpen: false), "review L1/L2: no switch while a wallet question or Face ID sheet waits (control: free to leave)")

// Product decision, 3 Nov: a site's own window opens where it was left, across launches; a sign-out is never a dead end.
let pf = URL(string: "https://pump.fun/")!, coin = URL(string: "https://pump.fun/coin/Abc123?tab=chart")!
var places = Places.keeping([], opened: pf, at: coin, site: true)
check(Places.place(places, for: pf) == coin, "a site opened at its front door goes where it was left")
check(Places.place(places, for: URL(string: "https://pump.fun/board")!) == URL(string: "https://pump.fun/board")!, "a link to a deeper page opens that page (control)")
check(Places.place(places, for: URL(string: "https://gmgn.ai/")!) == URL(string: "https://gmgn.ai/")!, "another site never borrows it")
check(Places.keeping([], opened: pf, at: URL(string: "https://evil.example/x")!, site: true).isEmpty && Places.keeping([], opened: pf, at: URL(string: "http://pump.fun/x")!, site: true).isEmpty, "only https, only on the host it opened")
for i in 0 ..< 25 { places = Places.keeping(places, opened: URL(string: "https://s\(i).example.com/")!, at: URL(string: "https://s\(i).example.com/p")!, site: false) }
check(places.filter { !$0.site }.count == Places.maxPages && places.contains { $0.host == "pump.fun" }, "the newest 20 pages kept; a site's own place is never pushed out")
check(Places.decode(Places.encode(places)) == places, "kept on the phone as plain strings and read back the same")
check(SiteSignOut.next(reloadedAlready: false) == .reload && SiteSignOut.next(reloadedAlready: true) == .say, "signed out: reload once, then say it")
check(SiteSignOut.line("pump.fun") == "pump.fun signed you out. Tap its Sign in to come back in with ZeroFee.", "the signed-out line names the site")
let t0 = Date(timeIntervalSince1970: 1_800_000_000)
check(SiteBar.state(loading: true, signedIn: false, signingUntil: t0.addingTimeInterval(10), signedInAt: nil, now: t0) == SiteBar.State(status: "Signing you in…", busy: true), "the bar: signing in while it loads, the line moving")
check(SiteBar.state(loading: false, signedIn: true, signingUntil: t0.addingTimeInterval(10), signedInAt: t0, now: t0.addingTimeInterval(1)) == SiteBar.State(status: "Signed in", busy: false), "then \"Signed in\" for a moment")
check(SiteBar.state(loading: false, signedIn: true, signingUntil: nil, signedInAt: t0, now: t0.addingTimeInterval(3)) == SiteBar.State(status: nil, busy: false), "then the address again, nothing moving")
check(SiteBar.state(loading: false, signedIn: false, signingUntil: t0, signedInAt: nil, now: t0.addingTimeInterval(1)) == SiteBar.State(status: nil, busy: false), "a sign-in that never comes doesn't say \"Signing you in…\" for ever (control)")

// D131, Block trackers: the bundled list, its rules, and the hosts it never blocks.
let repoRoot = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : FileManager.default.currentDirectoryPath
let trackerText = (try? String(contentsOfFile: repoRoot + "/apps/ios/ZeroFee/Trackers/trackers.txt", encoding: .utf8)) ?? ""
let trackerDomains = TrackerRules.domains(fromList: trackerText)
let trackerSet = Set(trackerDomains)
check(trackerDomains.count > 40_000 && trackerDomains.count < 150_000, "trackers: the list loads, within WebKit's rule limit (\(trackerDomains.count))")
check(trackerText.contains("Version \(TrackerRules.listVersion)"), "trackers: the list's version is the one the app compiles under")
check(trackerText.contains("The EasyList authors") && trackerText.contains("CC BY-SA 4.0"), "trackers: the list names its authors and licence")
check(TrackerRules.blocks("hotjar.com", domains: trackerSet) && TrackerRules.blocks("script.hotjar.com", domains: trackerSet) && TrackerRules.blocks("api-js.mixpanel.com", domains: trackerSet), "trackers: known trackers and their subdomains are blocked")
for keep in ["pump.fun", "frontend-api-v3.pump.fun", "gmgn.ai", "auth.privy.io", "api.mainnet-beta.solana.com", "mainnet.helius-rpc.com", "relay.walletconnect.com", "challenges.cloudflare.com", "axiom.trade", "jup.ag"] {
  check(!TrackerRules.blocks(keep, domains: trackerSet.union(["pump.fun", "privy.io", "solana.com"])), "trackers: never blocks \(keep), even if a list named it")
}
check(!TrackerRules.blocks("example.org", domains: trackerSet), "trackers: an ordinary site isn't blocked (control)")
let trackerRules = TrackerRules.rules(domains: ["tracker.example"])
check(trackerRules.count == 1 + TrackerRules.neverBlock.count, "trackers: one rule per domain, then one keep rule per never-blocked host")
check(((trackerRules[0]["trigger"] as? [String: Any])?["load-type"] as? [String]) == ["third-party"], "trackers: a site's own loads are never blocked (third-party only)")
check(((trackerRules.last?["action"] as? [String: Any])?["type"] as? String) == "ignore-previous-rules", "trackers: the keep rules come last")
check(TrackerRules.filter("a.example") == "^[^:]+://+([^:/]+\\.)?a\\.example[:/]", "trackers: the host and its subdomains, dots escaped")
check(TrackerRules.ruleJSON(domains: Array(trackerDomains.prefix(50))) != nil, "trackers: the rules encode as JSON")

// D131, the phishing guard: look-alikes of the crypto sites stop; the real sites and ordinary ones pass.
for (host, brand) in [("pump-fun-claim.xyz", "pump.fun"), ("pumpfun.io", "pump.fun"), ("pump.fan", "pump.fun"), ("purnp.fun", "pump.fun"), ("pump.fun.claim-airdrop.app", "pump.fun"),
                      ("gmgn-ai.app", "GMGN"), ("gmgn.ai.example.com", "GMGN"), ("axiomtrade.io", "Axiom"), ("photon-sol.xyz", "Photon"),
                      ("phantom-wallet.app", "Phantom"), ("jup-ag.net", "Jupiter"), ("raydiurn.io", "Raydium"), ("metamsk.io", "MetaMask"), ("uniswep.org", "Uniswap"),
                      ("xn--pmp-fun-6li.com", "pump.fun"), ("xn--metamsk-6fg.io", "MetaMask"), ("xn--gmg-qfe.ai", "GMGN")] {
  check(PhishGuard.imitates(host) == brand, "phish: \(host) imitates \(brand)")
}
for real in ["pump.fun", "frontend-api.pump.fun", "gmgn.ai", "axiom.trade", "photon-sol.tinyastro.io", "phantom.app", "phantom.com", "jup.ag", "station.jup.ag", "raydium.io", "metamask.io", "portfolio.metamask.io", "uniswap.org", "app.uniswap.org",
             "example.org", "google.com", "dexscreener.com", "solscan.io", "github.com", "x.com"] {
  check(PhishGuard.imitates(real) == nil, "phish: \(real) passes (control)")
}
check(PhishGuard.decode("xn--pple-43d") == "аpple", "phish: punycode decodes (RFC 3492)")
check(PhishGuard.oneAway("pumpfan", "pumpfun") && !PhishGuard.oneAway("pumpfun", "pumpfun") && !PhishGuard.oneAway("pumpkin", "pumpfun"), "phish: one letter away, not the same, not two")
check(PhishGuard.line("pump.fun") == "This site looks like pump.fun but isn't. ZeroFee stopped it.", "phish: the product's own words")

// Security audit L5: ZeroFee's own and the money sites it works with; the real ones (and Pay's partners) pass.
for (host, brand) in [("zerofee-wallet.app", "ZeroFee"), ("zer0fee.si", "ZeroFee"), ("superapp.zerofee.si.claim.xyz", "ZeroFee"),
                      ("near-wallet.app", "NEAR"), ("mynearwallet.co", "NEAR"), ("near-protocol.io", "NEAR"),
                      ("hyperliquid-claim.xyz", "Hyperliquid"), ("hyperliqud.xyz", "Hyperliquid"), ("binance-support.com", "Binance"), ("c0inbase.com", "Coinbase"),
                      ("coinbase.com.verify.app", "Coinbase"), ("robinhood-login.com", "Robinhood"), ("solflare-wallet.io", "Solflare"), ("backpack-exchange.io", "Backpack"),
                      ("padre-gg.app", "Padre"), ("padre-trade.com", "Padre"), ("phantom-app.io", "Phantom"), ("rnetamask.io", "MetaMask")] {
  check(PhishGuard.imitates(host) == brand, "phish (audit L5): \(host) imitates \(brand)")
}
for real in ["zerofee.si", "superapp.zerofee.si", "chat.zerofee.si", "zerofee-quotes.vercel.app", "near.org", "wallet.near.org", "app.mynearwallet.com",
             "hyperliquid.xyz", "app.hyperliquid.xyz", "app.hyperliquid-testnet.xyz", "binance.com", "www.binance.com", "www.binance.us", "www.binance.th",
             "coinbase.com", "pay.coinbase.com", "robinhood.com", "explorer.chain.robinhood.com", "robinhood.org", "solflare.com", "backpack.exchange", "backpack.app",
             "padre.gg", "trade.padre.gg", "app.gnosispay.com", "app.mtpelerin.com", "fomo.family", "www.orca.so", "kamino.com", "app.sanctum.so",
             "finance.yahoo.com", "linear.app", "nearby.com", "backpackers.com", "padres.com", "zerohedge.com", "www.kraken.com"] {
  check(PhishGuard.imitates(real) == nil, "phish (audit L5): \(real) passes (control)")
}
check(PhishGuard.brands.first { $0.name == "Binance" }?.typos == false && PhishGuard.imitates("binanse.com") == nil && PhishGuard.imitates("binance.co") == "Binance",
      "phish (audit L5): Binance by name only, never one letter away (\"finance\" is one letter away; control: binance.co stops)")

// Security audit M2: a return link counts from the page's top frame only, and never while an approval sheet is open.
check(TabRules.returnLinkCounts(isMainFrame: true) && !TabRules.returnLinkCounts(isMainFrame: false), "return link: the top frame only (control: the top frame counts)")
check(TabRules.takesReturn(app: "browser", knownApps: ["browser", "pay"], awaiting: "browser", approvalOpen: false), "return link: taken for the app that opened the window (control)")
check(!TabRules.takesReturn(app: "browser", knownApps: ["browser", "pay"], awaiting: "browser", approvalOpen: true), "return link: never while an approval sheet is open")
check(!TabRules.takesReturn(app: "pay", knownApps: ["browser", "pay"], awaiting: "browser", approvalOpen: false) && !TabRules.takesReturn(app: "evil", knownApps: ["browser"], awaiting: "evil", approvalOpen: false),
      "return link: never for another app, nor an app ZeroFee doesn't know")

// Security audit M1: a native sheet shows only with ZeroFee in front; an approval goes when ZeroFee goes to the background.
check(SheetRules.mayShow(.active) && !SheetRules.mayShow(.inactive) && !SheetRules.mayShow(.background), "sheet: shows only while ZeroFee is in front (control: active shows)")
check(SheetRules.waitsForActive(.inactive) && !SheetRules.waitsForActive(.background) && !SheetRules.waitsForActive(.active), "sheet: waits for active only when inactive (never in the background, 0 ms when active)")
check(SheetRules.activeWithinMs <= 1000, "sheet: an inactive moment waits at most 1 s, then Not now")
check(SheetRules.putAway(approval: true, wentToBackground: true) && !SheetRules.putAway(approval: false, wentToBackground: true) && !SheetRules.putAway(approval: true, wentToBackground: false),
      "sheet: an approval goes in the background (control: the words being typed stay; nothing goes while in front)")

// Instant open (product decision, 3 Nov): pump.fun and GMGN built off screen, at most two, never where it could leak or cost.
check(WarmRules.shouldWarm(siteName: "pump.fun", kid: false, privately: false, lowPower: false, warmHosts: [], host: "pump.fun"), "a site's own window warms (the control)")
check(!WarmRules.shouldWarm(siteName: nil, kid: false, privately: false, lowPower: false, warmHosts: [], host: "example.com"), "never a plain page")
check(!WarmRules.shouldWarm(siteName: "pump.fun", kid: true, privately: false, lowPower: false, warmHosts: [], host: "pump.fun"), "never on a child's phone")
check(!WarmRules.shouldWarm(siteName: "pump.fun", kid: false, privately: true, lowPower: false, warmHosts: [], host: "pump.fun"), "never a private (Tor) window")
check(!WarmRules.shouldWarm(siteName: "pump.fun", kid: false, privately: false, lowPower: true, warmHosts: [], host: "pump.fun"), "never in Low Power Mode")
check(!WarmRules.shouldWarm(siteName: "pump.fun", kid: false, privately: false, lowPower: false, warmHosts: ["pump.fun"], host: "pump.fun"), "never twice for one site")
check(!WarmRules.shouldWarm(siteName: "GMGN", kid: false, privately: false, lowPower: false, warmHosts: ["pump.fun", "x.example"], host: "gmgn.ai"), "at most two")
let builtAt = Date(timeIntervalSince1970: 1_000_000)
check(!WarmRules.isStale(builtAt: builtAt, now: builtAt.addingTimeInterval(599)) && WarmRules.isStale(builtAt: builtAt, now: builtAt.addingTimeInterval(600)), "older than 10 minutes loads again when shown (control: 9:59 doesn't)")
check(WarmRules.mayHold(held: 7) && !WarmRules.mayHold(held: 8), "a warm window holds at most 8 wallet requests")
// D131 (product decision, 3 Nov): the address typed at the top of a Browser window reads as the Browser tab's own bar does.
check(AddressRules.read("pump.fun") == .go(URL(string: "https://pump.fun")!) && AddressRules.read("https://app.rhea.finance/x") == .go(URL(string: "https://app.rhea.finance/x")!), "an address opens as https")
check(AddressRules.read("http://example.com/a") == .go(URL(string: "https://example.com/a")!) && AddressRules.read("HTTP://example.com") == .go(URL(string: "https://example.com")!), "http:// opens as https://, never in the clear")
check(AddressRules.read("best solana wallet") == .go(URL(string: "https://duckduckgo.com/?q=best%20solana%20wallet")!) && AddressRules.read("bonk") == .go(URL(string: "https://duckduckgo.com/?q=bonk")!), "words (or one word with no dot) search DuckDuckGo")
check(AddressRules.read("price of $sol & eth?") == .go(URL(string: "https://duckduckgo.com/?q=price%20of%20%24sol%20%26%20eth%3F")!), "a search is encoded as encodeURIComponent does")
for bad in ["", "   ", "ftp://example.com", "javascript:alert(1)", "https://user:pw@example.com", "https://localhost"] {
  check(AddressRules.read(bad) == .line(AddressRules.notAnAddress), "never opened: \(bad.isEmpty ? "(empty)" : bad)")
}

// The words guard (product decision, 3 Nov): a page asking for the person's secret words is named; ordinary pages pass.
for asks in ["Enter your 12-word seed phrase to restore", "Secret Recovery Phrase", "Import with private key", "Type your 24 words below",
             "BACKUP WORDS", "Your mnemonic", "Enter your passcode", "Enter your words", "12 word phrase", "Recovery\u{00a0}phrase",
             "seed-phrase", "Paste your private keys", "24–word"] {
  check(SeedGuard.asksForWords(asks), "words guard: \"\(asks)\" is named")
}
for normal in ["Read our privacy policy", "24 hours", "Word of the day", "112 words left", "Private keyboard shortcuts", "Seed phrasebook",
               "Recover your account by email", "Keyboard", "Wordle", "Back up your photos", ""] {
  check(!SeedGuard.asksForWords(normal), "words guard: \"\(normal)\" passes (control)")
}
check(SeedGuard.fakeFaceID("Confirm with Face ID to continue", overlay: true), "words guard: Face ID drawn in a page's dialog is named")
check(!SeedGuard.fakeFaceID("How to set up Face ID on your iPhone", overlay: false), "words guard: an article about Face ID passes (control)")
check(!SeedGuard.fakeFaceID("Interface identification", overlay: true), "words guard: other words in a dialog pass (control)")
check(SeedGuard.kind("words") == .words && SeedGuard.kind("faceid") == .faceid, "words guard: the script's two words are read")
check(SeedGuard.kind("my seed phrase is abandon abandon") == nil && SeedGuard.kind(["kind": "words"]) == nil && SeedGuard.kind(nil) == nil, "words guard: anything else is nothing (no page text is ever read)")
check(SeedGuard.shows(.words, shown: false, stayed: false), "words guard: the bar shows (the control)")
check(!SeedGuard.shows(.words, shown: true, stayed: false) && !SeedGuard.shows(.faceid, shown: false, stayed: true) && !SeedGuard.shows(nil, shown: false, stayed: false), "words guard: once per page, never after Stay, never for nothing")
check(SeedGuard.line == "ZeroFee never asks for your words here. This page could be fake." && SeedGuard.leave == "Leave" && SeedGuard.stay == "Stay", "words guard: the bar's words")

// Never blocks: no page within 5 s says so, names the site, and offers Try again and ✕.
check(WalletGate.openWithin <= 5 && WalletGate.slowToOpen("pump.fun") == "pump.fun is slow to open. Tap here to try again, or ✕ to close.", "a page that doesn't come in 5 s says so plainly, with Try again and Close")

// One notice at a time, at the bottom (product decision, 3 Nov): which one shows, which can be hidden with ×, what a tap does.
do {
  typealias N = PartnerNotice
  let robot = N.Item(kind: .robot, line: "Your turn · pump.fun")
  let slow = N.Item(kind: .slow, line: WalletGate.slowToOpen("pump.fun"))
  let wallet = N.Item(kind: .wallet, line: "pump.fun asked to sign in.")
  let topUp = N.Item(kind: .topUp, line: "Top up your pump.fun wallet privately here.")
  let look = N.Item(kind: .lookAlike, line: "This name uses look-alike letters.")
  let first = N.Item(kind: .firstOpen, line: "It isn't part of ZeroFee.")
  let all: [N.Item?] = [first, look, topUp, wallet, slow, robot, nil]
  check(N.pick(all, hidden: []) == robot, "notices: AgentZero at work shows first")
  check(N.pick(all, hidden: [robot.key]) == slow && N.pick([first, look, topUp, wallet, slow], hidden: []) == slow, "notices: then the slow-to-open line")
  check(N.pick([first, look, topUp, wallet], hidden: []) == wallet, "notices: then the wallet's trouble line")
  check(N.pick([first, look, topUp], hidden: []) == topUp && N.pick([first, look], hidden: []) == look, "notices: then the top-up, then the look-alike line")
  check(N.pick([first, N.Item(kind: .notPrivate, line: "x")], hidden: []) == first, "notices: first-open over the others")
  check(N.rank(.slow) > N.rank(.wallet) && N.rank(.wallet) > N.rank(.topUp) && N.rank(.topUp) > N.rank(.lookAlike) && N.rank(.lookAlike) > N.rank(.firstOpen) && N.rank(.firstOpen) > N.rank(.notPrivate), "notices: the order, step by step")
  check(Set(N.Kind.allCases.map(N.rank)).count == N.Kind.allCases.count, "notices: no two kinds tie")
  check(N.pick([], hidden: []) == nil && N.pick([nil, N.Item(kind: .wallet, line: "")], hidden: []) == nil, "notices: nothing to say shows nothing (an empty line is nothing)")
  check(N.pick([look, N.Item(kind: .lookAlike, line: "other")], hidden: []) == look, "notices: a tie goes to the first given")
  // × hides that one; the next waits its turn; the same kind saying something new shows again
  check(N.pick([look, first], hidden: [look.key]) == first, "notices: × hides the line shown, the next one shows")
  check(N.pick([look], hidden: [look.key]) == nil, "notices: a hidden line stays hidden")
  check(N.pick([N.Item(kind: .wallet, line: "pump.fun didn't answer.")], hidden: [wallet.key]) != nil, "notices: a changed line is new and shows again (control)")
  check(N.pick([wallet], hidden: [N.Item(kind: .slow, line: wallet.line).key]) == wallet, "notices: the same words of another kind are another notice (control)")
  // no × while AgentZero acts or waits for the person: Stop is the way out
  check(!N.closable(.robot), "notices: no × while AgentZero acts or waits")
  check(N.Kind.allCases.filter { $0 != .robot }.allSatisfy(N.closable), "notices: every other line has × (control)")
  check(N.tap(.slow) == .tryAgain && N.act(.slow) == "Try again", "notices: the slow line's tap is Try again")
  check(N.tap(.topUp) == .topUp && N.act(.topUp) == "Add", "notices: the top-up's tap and Add open the top-up")
  check([N.Kind.wallet, .lookAlike, .firstOpen, .robot, .robotStopped, .privacy, .notPrivate].allSatisfy { N.tap($0) == .more && N.act($0) == nil }, "notices: any other line's tap shows all of it, with no extra button (control)")

  // product decision, 4 Nov: info-only lines go by themselves after 5 s; warnings and lines with a button stay
  check(N.fades(.firstOpen) && N.fades(.notPrivate) && N.fadeAfter == 5, "notices: the first-open and not-private lines fade after 5 s")
  check(N.Kind.allCases.filter(N.fades).allSatisfy { N.act($0) == nil && N.closable($0) && N.tap($0) == .more }, "notices: a line that fades has no button and has ×")
  check(!N.fades(.lookAlike) && !N.fades(.wallet) && !N.fades(.privacy) && !N.fades(.slow) && !N.fades(.robot) && !N.fades(.robotStopped) && !N.fades(.topUp) && !N.fades(.siteWallet), "notices: warnings, the wallet's lines and lines with a button stay (control)")
}

// The window puts its notices on the one bottom line, never stacked under its bar; only the words guard stays on top.
do {
  let view = (try? String(contentsOfFile: CommandLine.arguments[1] + "/apps/ios/ZeroFee/PartnerView.swift", encoding: .utf8)) ?? ""
  check(view.contains("seedBar.topAnchor.constraint(equalTo: bar.bottomAnchor)") && view.contains("stage.topAnchor.constraint(equalTo: seedBar.bottomAnchor"), "notices: under the bar only the words guard, then the page")
  check(!view.contains("strip.topAnchor") && !view.contains("robotBar.topAnchor") && !view.contains("topUp.topAnchor"), "notices: no line, top-up or AgentZero bar stacked on top")
  check(view.contains("noticeBar.bottomAnchor.constraint(equalTo: saysNotPrivate || siteName != nil ? guide.bottomAnchor : pageBar.topAnchor"), "notices: the line sits at the bottom, above the page controls when they show")
  check(view.contains("stage.bottomAnchor.constraint(equalTo: saysNotPrivate || siteName != nil ? view.bottomAnchor : pageBar.topAnchor)") && !view.contains("noticeBar.topAnchor.constraint") && view.components(separatedBy: "\n").allSatisfy { !($0.contains("stage.") || $0.contains("web.")) || !$0.contains("noticeBar") }, "notices: the page is laid out as before, never against the line (never resized)")
  check(view.contains("PartnerNotice.pick(notices(), hidden: noticeHidden)") && view.contains("noticeClose.isHidden = !PartnerNotice.closable(next.kind)"), "notices: the window uses these same rules")
  check(view.contains("PartnerNotice.fades(next.kind), !UIAccessibility.isVoiceOverRunning") && view.contains("guard let shown = noticeShown, shown.key == key, PartnerNotice.fades(shown.kind), !noticeOpen"), "notices: the window fades only what the rules say, only the line still shown, never one opened or under VoiceOver")
  check(!view.isEmpty, "notices: the window's source was read (control)")
}

// Phone test, 3 Nov on pump.fun did nothing; a connect asks forHost with no signature waiting.
check(TabRules.forHostAllowed(app: "browser", origin: "https://pump.fun", openHosts: ["pump.fun"]), "forHost: the Browser, for a site with a window open (the connect), passes")
check(!TabRules.forHostAllowed(app: "browser", origin: "https://evil.com", openHosts: ["pump.fun"]), "forHost: never for a site whose page isn't asking")
check(!TabRules.forHostAllowed(app: "browser", origin: "https://gmgn.ai", openHosts: ["pump.fun"]) && TabRules.forHostAllowed(app: "browser", origin: "https://gmgn.ai", openHosts: ["pump.fun", "gmgn.ai"]), "forHost: host A's wallet never while only host B's page asks (control: A asking too)")
check(!TabRules.forHostAllowed(app: "trade", origin: "https://pump.fun", openHosts: ["pump.fun"]) && !TabRules.forHostAllowed(app: nil, origin: "https://pump.fun", openHosts: ["pump.fun"]), "forHost: the Browser only")
check(!TabRules.forHostAllowed(app: "browser", origin: "https://pump.fun/x", openHosts: ["pump.fun"]) && !TabRules.forHostAllowed(app: "browser", origin: "http://pump.fun", openHosts: ["pump.fun"]) && !TabRules.forHostAllowed(app: "browser", origin: nil, openHosts: ["pump.fun"]), "forHost: a plain https origin only")

// The product Browser thesis, part 1 (4 Nov): every https site in a Browser tab has the wallet, connected at once with its
// own new wallet (EverySite.swift). Which windows, which hosts, and the host's own gate.
do {
  let tab = EverySite.recipe(app: "browser", accepted: nil)
  check(tab == PartnerRecipe.browserTab && tab?.everySite == true && tab?.modes == [.wallet] && tab?.walletKindRaw == "browser" && tab?.login == nil && tab?.slots.isEmpty == true && tab?.commitButtons.isEmpty == true, "every site: a Browser tab gets the every-site recipe, wallet mode and the Browser wallet only")
  let typed = site(["example.com"], ["eth", "sol"])
  check(EverySite.recipe(app: "browser", accepted: typed) == PartnerRecipe.browserTab, "every site: a Browser tab's is never the shell's one-host recipe")
  check(EverySite.recipe(app: "social", accepted: typed) == typed && EverySite.recipe(app: "social", accepted: nil) == nil, "every site: Social trading's site windows keep their own recipe (control)")
  check(PartnerRecipe(["partner": "browser", "hosts": ["a.example"], "modes": ["wallet"], "chains": ["eth"], "everySite": true])?.everySite == false, "every site: JSON can't ask for it")
  // a typed site, a listed one, and a site the Browser never heard of: each with the wallet, in the tab it opens in
  for h in ["some-dex.example", "app.uniswap.org", "pump.fun", "jup.ag", "www.orca.so", "shop.example.co.uk"] {
    check(PartnerRecipe.browserTab.active(.wallet, host: h, kid: false) && PartnerRecipe.forWindow(PartnerRecipe.browserTab, opening: h, kid: false) != nil, "every site: \(h) has the wallet")
  }
  // a look-alike (the phishing guard's, or look-alike letters) or a name that isn't a public site's: no provider, no wallet
  for h in ["pump-fun-claim.xyz", "metamsk.io", "uniswep.org", "xn--pmp-0na.fun", "xn--80ak6aa92e.com", "192.168.1.1", "router.local", "example.com:8443", "localhost", "10-0-0-1.nip.io"] {
    check(!PartnerRecipe.browserTab.covers(h) && !PartnerRecipe.browserTab.active(.wallet, host: h, kid: false) && PartnerRecipe.forWindow(PartnerRecipe.browserTab, opening: h, kid: false) == nil, "every site: \(h) gets no provider and no wallet")
  }
  // "Open anyway" on the guard's page lets the page load, never the wallet: covers reads the guard, not the person's choice
  check(PhishGuard.imitates("pump-fun-claim.xyz") != nil && !EverySite.covers("pump-fun-claim.xyz"), "every site: a site the guard stops gets no wallet, even after Open anyway")
  check(PhishGuard.imitates("pump.fun") == nil && EverySite.covers("pump.fun"), "every site: the real site passes (control)")
  check(PartnerRecipe.forWindow(PartnerRecipe.browserTab, opening: "some-dex.example", kid: true) == nil && !PartnerRecipe.browserTab.active(.wallet, host: "some-dex.example", kid: true), "every site: never on a child's phone")
  // the host's own gate: a Browser tab connects every site at once, except one the person disconnected (until the sheet)
  let g = UserDefaults(suiteName: "zf.check.\(UUID().uuidString)")!
  let gate = { (h: String, every: Bool, kind: String) in EverySite.connected(yes: WalletConnections.isConnected(h, kind: kind, in: g), everySite: every, kind: kind, disconnected: WalletConnections.isDisconnected(h, kind: kind, in: g)) }
  check(gate("some-dex.example", true, "browser") && WalletGate.precheck(method: "eth_accounts", connected: gate("some-dex.example", true, "browser"), gated: true) == .relay, "every site: a typed site in a Browser tab is connected at once (eth_accounts goes to the engine)")
  check(!gate("some-dex.example", false, "browser") && WalletGate.precheck(method: "eth_accounts", connected: gate("some-dex.example", false, "browser"), gated: true) == .noAccounts, "every site: the same site outside a Browser tab isn't (control)")
  check(!gate("app.gnosispay.com", true, "pay"), "every site: never the card's wallet")
  WalletConnections.forget(WalletConnections.forgetHost("some-dex.example")!, in: g)
  check(!gate("some-dex.example", true, "browser") && WalletGate.precheck(method: "personal_sign", connected: gate("some-dex.example", true, "browser"), gated: true) == .notConnected && WalletGate.precheck(method: "eth_accounts", connected: gate("some-dex.example", true, "browser"), gated: true) == .noAccounts, "every site: a site the person disconnected isn't connected again silently")
  check(gate("other-dex.example", true, "browser"), "every site: disconnecting one site leaves the others (control)")
  WalletConnections.set("some-dex.example", kind: "browser", true, in: g)
  check(gate("some-dex.example", true, "browser") && !WalletConnections.isDisconnected("some-dex.example", kind: "browser", in: g), "every site: the connect sheet's yes connects it again")
  check(WalletConnections.offKey("example.com", "browser").hasPrefix("zf.partner.connected.") && WalletConnections.offKey("example.com", "browser") != WalletConnections.key("off.example.com", "browser"), "every site: the disconnect mark is wiped with the account, and never names another site's yes")
}

// The product Browser thesis, part 2 (4 Nov): Top up, right there in the Browser, for the site's own wallet (EverySite).
do {
  let tab = PartnerRecipe.browserTab
  let some = "some-dex.example"
  let yes = { (r: PartnerRecipe?, kid: Bool, name: String?, host: String, answered: Set<String>, off: Bool, hidden: Set<String>) in
    EverySite.offersTopUp(recipe: r, kid: kid, siteName: name, host: host, answered: answered, disconnected: off, hidden: hidden)
  }
  check(yes(tab, false, nil, some, [some], false, []), "top up: a Browser tab whose site's own Solana wallet answered shows it")
  check(!yes(tab, false, nil, some, [], false, []), "top up: never before the engine answered the site's wallet (an unconnected page)")
  check(!yes(tab, false, nil, some, ["other.example"], false, []) && !yes(tab, false, nil, "other.example", [some], false, []), "top up: only on the host that was answered, never after the page moved to another (control)")
  check(!yes(tab, true, nil, some, [some], false, []), "top up: never on a child's phone")
  check(!yes(tab, false, "pump.fun", "pump.fun", ["pump.fun"], false, []), "top up: never in a site's own window (it has its own Top up)")
  check(!yes(nil, false, nil, some, [some], false, []), "top up: never in a plain window")
  check(!yes(site(["app.gnosispay.com"], ["gnosis"], kind: "pay"), false, nil, "app.gnosispay.com", ["app.gnosispay.com"], false, []), "top up: never in Pay's windows")
  check(!yes(PartnerRecipe.agent(site: PartnerRecipe.agentSite("shop.example.com")), false, nil, "shop.example.com", ["shop.example.com"], false, []), "top up: never in AgentZero's window")
  check(!yes(site([some], ["sol"]), false, nil, some, [some], false, []), "top up: never on a one-host recipe outside a Browser tab (control: the same host in a tab shows it)")
  check(!yes(tab, false, nil, some, [some], true, []), "top up: never on a site the person disconnected")
  check(!yes(tab, false, nil, some, [some], false, [some]) && yes(tab, false, nil, "other.example", ["other.example"], false, [some]), "top up: × hides it for that site only (control: another site keeps it)")
  check(!yes(tab, false, nil, "pump-fun-claim.xyz", ["pump-fun-claim.xyz"], false, []) && !yes(tab, false, nil, "192.168.1.1", ["192.168.1.1"], false, []), "top up: never on a look-alike or a home-network name, whatever was answered")
  // the engine's answer, never the page's: a Solana connect with an account; a silent one that isn't connected is null
  check(EverySite.solanaAnswered(method: "solana:connect", result: ["publicKey": "x"]), "top up: the engine's Solana account counts")
  check(!EverySite.solanaAnswered(method: "solana:connect", result: NSNull()) && !EverySite.solanaAnswered(method: "solana:connect", result: nil), "top up: a silent connect that isn't connected doesn't")
  check(!EverySite.solanaAnswered(method: "eth_requestAccounts", result: ["0xabc"]) && !EverySite.solanaAnswered(method: "solana:signMessage", result: ["signature": "x"]), "top up: an Ethereum-style connect doesn't (Put money in fills the Solana wallet; control)")
  check(EverySite.topUpLine(some) == "some-dex.example has its own wallet." && EverySite.onItsWay(some) == "On its way to your some-dex.example wallet.", "top up: its words")
  typealias N = PartnerNotice
  check(N.tap(.siteWallet) == .topUpHost && N.act(.siteWallet) == "Top up" && N.closable(.siteWallet), "top up: its line's tap and button open it, × hides it")
  check(N.rank(.siteWallet) < N.rank(.firstOpen) && N.rank(.siteWallet) > N.rank(.notPrivate), "top up: the first-open warning shows before it")
  check(N.pick([N.Item(kind: .siteWallet, line: EverySite.topUpLine(some)), N.Item(kind: .wallet, line: "x")], hidden: [])?.kind == .wallet, "top up: the wallet's own line shows before it (control)")
  // the Browser tells its own tab the money went: { host, went: true } only, our own words
  let tell = { (every: Bool, name: String?, went: Any?, pill: Any?, line: Any?, host: String, tabHost: String) in EverySite.browserMayTell(everySite: every, siteName: name, went: went, pill: pill, line: line, host: host, tabHost: tabHost) }
  check(tell(true, nil, true, nil, nil, some, some), "top up: the Browser tells its own tab the money went")
  check(!tell(true, nil, true, "$5.00", nil, some, some) && !tell(true, nil, true, nil, "Send me your words", some, some), "top up: never a pill or words of the Browser's")
  check(!tell(false, "pump.fun", true, nil, nil, "pump.fun", "pump.fun") && !tell(false, nil, true, nil, nil, some, some), "top up: never a site's own window, never a window that isn't a Browser tab")
  check(!tell(true, nil, true, nil, nil, some, "other.example") && !tell(true, nil, nil, nil, nil, some, some) && !tell(true, nil, "yes", nil, nil, some, some) && !tell(true, nil, true, nil, nil, "", ""), "top up: only the tab on that host, only went: true")
  // the window and the host use these rules; the host comes from WebKit and the tab goes to the back, never closed
  let src = { (f: String) in (try? String(contentsOfFile: CommandLine.arguments[1] + "/apps/ios/ZeroFee/" + f, encoding: .utf8)) ?? "" }
  let view = src("PartnerView.swift"), wallet = src("PartnerWallet.swift"), bridge = src("PartnerBridge.swift")
  check(view.contains("let h = Self.displayHost(web.url)\n    guard EverySite.offersTopUp(") && view.contains("host.topUpHost(from: self, host: h)"), "top up: the tap reads the host from WebKit and checks the rule again")
  check(view.contains("siteWalletLine = offers ? EverySite.topUpLine(name) : nil") && view.contains("case .topUpHost: hostTopUpTapped()"), "top up: the line and its tap are these")
  check(view.contains("view.wentToBack()\n    sheet = nil\n    let app = awaitingReturn") && view.contains("self.emit(\"device.site.topupHost\", [\"host\": h, \"tab\": tab])"), "top up: the tab goes to the back (kept), then the Browser hears the host and the tab")
  check(wallet.contains("if EverySite.solanaAnswered(method: waiting.method, result: p[\"result\"]) { view.solanaAnswered(waiting.origin) }") && wallet.contains("if recipe.everySite, kind == \"browser\", let view {"), "top up: only the engine's answer in a Browser tab turns it on")
  check(bridge.contains("EverySite.browserMayTell(everySite: $0.recipe?.everySite == true"), "top up: the host's device.site.money uses the Browser's rule")
  check(!view.isEmpty && !wallet.isEmpty && !bridge.isEmpty, "top up: the sources were read (control)")
}
// iOS audit finding 3: a notification never carries money or an address, whatever the page or the core wrote
do {
  for leak in ["You sent 5 NEAR", "1.5 USDC arrived", "Got $20", "Paid 3,000 dollars", "USDC 40 in", "To bob.near", "From alice.testnet",
               "Key 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", "To 0x2527D02599Ba641c19FEa793cD0F167589a0f10D",
               "To 13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK", "20 €"] {
    check(NotifyFilter.body(leak) == "Open ZeroFee to see what changed.", "notify: dropped: \(leak)")
  }
  check(NotifyFilter.title("5 NEAR left your Safe") == "ZeroFee", "notify: a title with an amount is dropped too")
  for fine in ["Something changed on your account", "Your payment waits 2 days", "Reminder: check your Safe at 9", "A new key was added"] {
    check(NotifyFilter.body(fine) == fine && NotifyFilter.title(fine) == fine, "notify: kept as it is (control): \(fine)")
  }
  let read = { (f: String) in (try? String(contentsOfFile: CommandLine.arguments[1] + "/apps/ios/ZeroFee/" + f, encoding: .utf8)) ?? "" }
  let notify = read("Notify.swift"), alerts = read("BackgroundAlerts.swift")
  check(notify.contains("content.body = NotifyFilter.body(body)") && notify.contains("content.title = NotifyFilter.title(title)"), "notify: device.notify.schedule goes through the filter")
  check(alerts.contains("content.body = NotifyFilter.body(body)") && alerts.contains("content.title = NotifyFilter.title(title)"), "notify: the guard dog's alerts go through the filter")
}
// iOS audit finding 5: the switcher's cover over every window (partner and Browser windows are UIKit modals above the
// root's SwiftUI cover), and over the words typed to bring an account back
do {
  check(CoverRules.up(after: .willResignActive, faceIdShowing: false, wasUp: false), "cover: leaving ZeroFee puts it up")
  check(!CoverRules.up(after: .willResignActive, faceIdShowing: true, wasUp: false), "cover: not over a Face ID prompt (the approval stays seen)")
  check(CoverRules.up(after: .didEnterBackground, faceIdShowing: true, wasUp: false), "cover: in the background always, Face ID or not")
  check(!CoverRules.up(after: .didBecomeActive, faceIdShowing: false, wasUp: true), "cover: active again takes it down")
  let read = { (f: String) in (try? String(contentsOfFile: CommandLine.arguments[1] + "/apps/ios/ZeroFee/" + f, encoding: .utf8)) ?? "" }
  let app = read("ZeroFeeApp.swift"), entry = read("WordsEntry.swift")
  check(app.contains("static let level = UIWindow.Level.alert + 1") && app.contains("cover.windowLevel = Self.level") && app.contains("SwitcherShield.shared.start()"), "cover: a window of its own, above alerts, started with the app")
  check(app.contains("UIApplication.willResignActiveNotification, .willResignActive") && app.contains("CoverRules.up(after: event, faceIdShowing: FaceIdPrompt.showing"), "cover: it follows CoverRules on willResignActive")
  check(entry.contains("WordsEntryView(purpose: purpose, wordlist: wordlist, done: finish)).ignoresSafeArea().privacyCover())"), "cover: the words typed to bring an account back are covered too")
}
do {
  // The app lock (product decision, 4 Nov, decision C; AppLock.swift)
  check(LockRules.lockedOnReturn(away: .seconds(300), hasAccount: true, wasLocked: false), "lock: back after 5 minutes locks")
  check(!LockRules.lockedOnReturn(away: .seconds(299), hasAccount: true, wasLocked: false), "lock: back sooner stays open")
  check(LockRules.lockedOnReturn(away: .seconds(1), hasAccount: true, wasLocked: true), "lock: once locked it stays so until opened")
  check(!LockRules.lockedOnReturn(away: .seconds(3600), hasAccount: false, wasLocked: true), "lock: no account, nothing to lock")
  check(!LockRules.lockedOnReturn(away: nil, hasAccount: true, wasLocked: false), "lock: never away, open")
  check(LockRules.faceIdOnly(failedTries: 0, faceIdUsable: true), "lock: the first try is Face ID only")
  check(!LockRules.faceIdOnly(failedTries: 1, faceIdUsable: true), "lock: after a failed try the passcode is offered")
  check(!LockRules.faceIdOnly(failedTries: 0, faceIdUsable: false), "lock: Face ID unusable, the passcode opens it")
  let read = { (f: String) in (try? String(contentsOfFile: CommandLine.arguments[1] + "/apps/ios/ZeroFee/" + f, encoding: .utf8)) ?? "" }
  let lock = read("AppLock.swift"), app = read("ZeroFeeApp.swift"), intents = read("Intents.swift")
  // locked with a partner or Browser window (a full-screen modal) open: the lock's own window is above it, and key
  check(lock.contains("static let level = UIWindow.Level.alert + 2") && lock.contains("cover.windowLevel = Self.level") && lock.contains("cover.makeKeyAndVisible()"), "lock: a key window of its own above every modal and the switcher's cover")
  check(lock.contains("UIApplication.willEnterForegroundNotification) { $0.comingBack() }"), "lock: up before ZeroFee is seen again")
  check(app.contains("AppLock.shared.start()") && app.contains(".onOpenURL { url in AppLock.shared.whenOpen { host.handleOpen(url) } }"), "lock: links wait until it is open")
  check(intents.contains("AppLock.shared.whenOpen {") && intents.contains("guard !AppLock.shared.locked else { return nil }"), "lock: Siri's and Shortcuts' asks wait until it is open")
  let partner = read("PartnerView.swift")
  check(partner.contains("AppLock.shared.whenOpen { _ = host.handleReturn(url) }") && !partner.contains("{ _ = host.handleReturn(url) } //"), "lock: a partner page's return link waits until it is open")
  check(!lock.contains("SecAccessControl") && !lock.contains("ApprovalPass.shared"), "lock: the device's Face ID, so a changed face never strands Recovery")
}
print(failed == 0 ? "all passed" : "\(failed) FAILED")
exit(failed == 0 ? 0 : 1)
