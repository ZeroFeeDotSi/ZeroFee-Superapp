import { test } from "node:test";
import assert from "node:assert/strict";
import type { BridgeResult } from "@zerofee/core/bridge";
import { SoftwareKey } from "@zerofee/core/device-key";
import { DevSigner } from "@zerofee/core/dev-signer";
import { FakeChain } from "@zerofee/core/testing/fake-chain";
import { HostKey, hostDeviceKeys } from "../../host/vault.ts";
import type { IosHost } from "../../host/ios.ts";
import { deviceKeyWords } from "./device-key-words.ts";

const approve = async () => true;

test("a browser key says where it is: kept in this browser, encrypted; a chip key says it is in the secure chip", () => {
  assert.equal(deviceKeyWords("development"), "Browser key · kept here, encrypted");
  assert.equal(deviceKeyWords(undefined), "Browser key · kept here, encrypted");
  assert.equal(deviceKeyWords("secure-chip"), "Phone key · in the secure chip");
});

test("on the iPhone host the account's own key list reports the chip key, and the Overview row reads the chip words", async () => {
  // A stand-in phone whose chip makes this key (the simulator can't; a real iPhone does).
  const made = SoftwareKey.generate();
  const host: IosHost = {
    async call<T>() {
      return { ok: { publicKey: made.publicKey } } as BridgeResult<T>;
    },
    on: () => () => {},
  };
  const chipKey = await hostDeviceKeys(host).make();
  assert.ok(chipKey instanceof HostKey);
  const chain = new FakeChain();
  chain.fund("alice.testnet", chipKey.publicKey);
  const onPhone = (await new DevSigner({ accountId: "alice.testnet", chain, key: chipKey, approve }).account()).keys.find((k) => k.current);
  assert.equal(onPhone?.kind, "secure-chip");
  assert.equal(deviceKeyWords(onPhone?.kind), "Phone key · in the secure chip");

  // The same account in a browser: a software key signs, and the words stay as they were.
  const inBrowser = (await new DevSigner({ accountId: "alice.testnet", chain, key: { publicKey: chipKey.publicKey, signHash: (h) => made.signHash(h) }, approve }).account()).keys.find((k) => k.current);
  assert.equal(inBrowser?.kind, "development");
  assert.equal(deviceKeyWords(inBrowser?.kind), "Browser key · kept here, encrypted");
});
