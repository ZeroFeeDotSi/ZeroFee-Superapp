import { test } from "node:test";
import assert from "node:assert/strict";
import { sharingFetch } from "./shared-get.ts";

const LIST = "https://1click.chaindefuser.com/v0/tokens";

function counting(status = 200) {
  const asked: string[] = [];
  const plain = (async (input: RequestInfo | URL, init?: RequestInit) => {
    asked.push(`${init?.method ?? "GET"} ${String(input)}`);
    await new Promise((r) => setTimeout(r, 5));
    return new Response(JSON.stringify([{ assetId: "x", n: asked.length }]), { status });
  }) as typeof fetch;
  return { plain, asked };
}

test("the token list is read once for callers at once and for a few seconds after, each getting its own copy", async () => {
  let t = 1_000;
  const { plain, asked } = counting();
  const f = sharingFetch(plain, [LIST], 10_000, () => t);
  const [a, b] = await Promise.all([f(LIST), f(LIST, { signal: AbortSignal.timeout(5000) })]);
  assert.deepEqual(await a.json(), await b.json());
  t += 9_000;
  assert.equal((await (await f(LIST)).json())[0].n, 1);
  assert.equal(asked.length, 1);
  t += 2_000;
  assert.equal((await (await f(LIST)).json())[0].n, 2, "older than the share: read again");
  assert.equal(asked.length, 2);
});

test("anything else goes straight through, and a failed read is never kept", async () => {
  const { plain, asked } = counting(503);
  const f = sharingFetch(plain, [LIST], 10_000);
  await f("https://example.org/a");
  await f(LIST, { method: "POST", body: "{}" });
  await assert.rejects(f(LIST));
  await assert.rejects(f(LIST));
  assert.deepEqual(asked, ["GET https://example.org/a", `POST ${LIST}`, `GET ${LIST}`, `GET ${LIST}`]);
});

test("a caller's own abort ends its wait only", async () => {
  const { plain } = counting();
  const f = sharingFetch(plain, [LIST], 10_000);
  const ctl = new AbortController();
  const mine = f(LIST, { signal: ctl.signal });
  const other = f(LIST);
  ctl.abort();
  await assert.rejects(mine);
  assert.equal((await other).status, 200);
});
