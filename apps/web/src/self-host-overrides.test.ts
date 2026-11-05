// Self-host overrides (public repo): a build can point at its own relay, phone page and laptop host; with none set, each
// keeps ZeroFee's own default. Only the address's source changes here, never what is done with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { relayOrigin } from "./hosting.ts";
import { relayUrl } from "../../extension/src/manifest-gen.ts";
import { secondDeviceSite, SECOND_DEVICE_SITE } from "./mode.ts";
import { phoneAppUrl, PHONE_APP_URL } from "../../../packages/shell-api/src/web-wallet-words.ts";
import { laptopHref } from "./top-note-words.ts";

const file = readFileSync(new URL("../../ios/relay-url.txt", import.meta.url), "utf8").trim();

test("ZEROFEE_RELAY_URL wins over apps/ios/relay-url.txt for the CSP and the extension; unset, the file is read (control)", () => {
  const before = process.env.ZEROFEE_RELAY_URL;
  try {
    delete process.env.ZEROFEE_RELAY_URL;
    assert.equal(relayUrl(), file.replace(/\s+/g, ""));
    assert.equal(relayOrigin(), file ? new URL(file).origin : null);
    process.env.ZEROFEE_RELAY_URL = "https://relay.example.org";
    assert.equal(relayUrl(), "https://relay.example.org");
    assert.equal(relayOrigin(), "https://relay.example.org");
    process.env.ZEROFEE_RELAY_URL = "";
    assert.equal(relayUrl(), "");
    assert.equal(relayOrigin(), null);
    process.env.ZEROFEE_RELAY_URL = "http://relay.example.org";
    assert.throws(() => relayUrl());
  } finally {
    if (before === undefined) delete process.env.ZEROFEE_RELAY_URL; else process.env.ZEROFEE_RELAY_URL = before;
  }
});

test("the iPhone build script reads ZEROFEE_RELAY_URL first, an empty one meaning no relay; else the file (control)", () => {
  const sh = readFileSync(new URL("../../ios/build-web.sh", import.meta.url), "utf8");
  const head = sh.slice(0, sh.indexOf("case \"$RELAY\""));
  const run = (env: Record<string, string>) => execFileSync("/bin/sh", ["-c", `here="$1"; ${head.split("\n").filter((l) => /RELAY|^fi$|else$/.test(l) && !l.startsWith("#")).join("\n")}\nprintf %s "$RELAY"`, "sh", new URL("../../ios", import.meta.url).pathname], { env: { PATH: process.env.PATH ?? "", ...env } }).toString();
  assert.equal(run({}), file.replace(/\s+/g, ""));
  assert.equal(run({ ZEROFEE_RELAY_URL: "https://relay.example.org" }), "https://relay.example.org");
  assert.equal(run({ ZEROFEE_RELAY_URL: "" }), "");
});

test("VITE_PHONE_APP_URL and VITE_SECOND_DEVICE_SITE: an https address and a bare host are taken, anything else is ours", () => {
  assert.equal(PHONE_APP_URL, "https://zerofee.si");
  assert.equal(phoneAppUrl("https://wallet.example.org/get"), "https://wallet.example.org/get");
  for (const bad of [undefined, "", "http://x.org", "javascript:alert(1)", "https://x.org/\"><b>"]) assert.equal(phoneAppUrl(bad), "https://zerofee.si");
  assert.equal(SECOND_DEVICE_SITE, "laptop.zerofee.si");
  assert.equal(secondDeviceSite("Laptop.Example.org"), "laptop.example.org");
  for (const bad of [undefined, "", "localhost", "https://laptop.example.org", "a.org/x", "a..org"]) assert.equal(secondDeviceSite(bad), "laptop.zerofee.si");
});

test("the web note's laptop link follows VITE_SECOND_DEVICE_SITE; unset or bad, it is ours (control)", () => {
  assert.equal(laptopHref(undefined), "https://laptop.zerofee.si");
  assert.equal(laptopHref("Laptop.Example.org"), "https://laptop.example.org");
  for (const bad of ["", "localhost", "https://laptop.example.org", "a.org/x"]) assert.equal(laptopHref(bad), "https://laptop.zerofee.si");
});
