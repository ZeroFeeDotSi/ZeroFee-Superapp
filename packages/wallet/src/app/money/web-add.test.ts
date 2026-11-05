// The web wallet's Add (product decision, 4 Nov): each wallet's OWN address, never a 1Click deposit address, and the
// address copied is the one shown.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webAddRows } from "./web-add.ts";

const SOL = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const ETH = "0x7D06e272b5305a4b9D40e872C7950D3437547e3D";
const NEAR = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9";
const list = [
  { id: "s0", kind: "trade", chain: "sol", address: "OldSo1Address1111111111111111111111111111111", current: false },
  { id: "s1", kind: "trade", chain: "sol", address: SOL, current: true },
  { id: "p1", kind: "site", chain: "sol", address: "SiteSo1Address111111111111111111111111111111", site: "pump", current: true },
  { id: "h1", kind: "trade", chain: "hood", address: ETH, current: true },
  { id: "b1", kind: "trade", chain: "bsc", address: "0x1111111111111111111111111111111111111111", current: true },
  { id: "n1", kind: "trade", chain: "near", address: NEAR },
];

test("web Add: SOL, ETH (RH) and NEAR, each its wallet's own current address; never a site's, an old one, or BNB", () => {
  const rows = webAddRows(list);
  assert.deepEqual(rows.map((r) => [r.row.chain, r.address]), [["sol", SOL], ["hood", ETH], ["near", NEAR]]);
  assert.deepEqual(rows.map((r) => r.row.name), ["SOL", "ETH (RH)", "NEAR"]);
});

test("web Add: a chain with no wallet yet has no row (never a made-up address); control: nothing, nothing", () => {
  assert.deepEqual(webAddRows(list.filter((w) => w.chain !== "hood")).map((r) => r.row.chain), ["sol", "near"]);
  assert.deepEqual(webAddRows([]), []);
  assert.deepEqual(webAddRows([{ chain: "sol", current: true, kind: "trade", address: "" }]), [], "an empty address is no address");
});

test("web Add copies exactly the address it shows, and never asks 1Click for one", () => {
  const sheet = readFileSync(new URL("./WebAddSheet.tsx", import.meta.url), "utf8");
  // the row: the tap copies x.address, and the same x.address is what's shown (short) and on the QR page (whole)
  assert.match(sheet, /onClick=\{\(\) => copy\(x\.address, x\)\}/);
  assert.match(sheet, /<QrCode value=\{addressQr\(qr\.address, qr\.row\.chain\)\}/);
  assert.match(sheet, /\{groupAddress\(qr\.address\)\}/);
  assert.match(sheet, /onClick=\{\(\) => copy\(qr\.address\)\}/);
  assert.match(sheet, /bridge\.call<ListedWallet\[\]>\("subwallet\.list"\)/);
  assert.doesNotMatch(sheet, /depositAddress|subwallet\.add|1Click quote|add\.quote/, "no 1Click deposit address on the web");
  const add = readFileSync(new URL("./AddSheet.tsx", import.meta.url), "utf8");
  // loaded on first use (Home's JS budget): the sheet is wrapped in Suspense, still before the proof gate
  assert.match(add, /if \(web\) return <Suspense fallback=\{null\}><WebAddSheet /, "Add on the web is this sheet, before the proof gate");
  assert.match(add, /const WebAddSheet = lazy\(\(\) => import\("\.\/WebAddSheet\.tsx"\)/);
  assert.ok(add.indexOf("if (web) return <Suspense fallback={null}><WebAddSheet") < add.indexOf("if (!proof) return"));
});
