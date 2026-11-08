// the copy review's item 1 (7 Nov), on the mounted receipt (packages/wallet money/JobMade.tsx JobReceipt): "Job created." (the owner's
// word), then what happened to the person, "It goes through NEAR Confidential." (his rule), the time left and "You can
// close this. It keeps going.". Control: a receipt given no line draws none and leaves no gap.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer;
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; settle: () => Promise<number>; unmount: () => void; text: () => string };
let JobReceipt: FunctionComponent<Record<string, unknown>>;

before(async () => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};
  const fake = fileURLToPath(new URL("../testing/fake-react.ts", import.meta.url));
  server = await createServer({ configFile: false, root: fileURLToPath(new URL("..", import.meta.url)), logLevel: "silent", resolve: { alias: [{ find: /^react$/, replacement: fake }] }, server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  runtime = (await server.ssrLoadModule(fake)) as typeof runtime;
  ({ JobReceipt } = await server.ssrLoadModule("@zerofee/wallet/app/money/JobMade.tsx"));
});
after(async () => {
  runtime?.unmount();
  await server?.close();
  setTimeout(() => process.exit(process.exitCode ?? 0), 3_000).unref();
});

const shown = async (props: Record<string, unknown>): Promise<string> => {
  await runtime.mount(createElement(JobReceipt, { icon: null, onDone() {}, ...props }), { limit: 40 });
  await runtime.settle();
  return runtime.text();
};

test("a Send's receipt: $25.00, Job created., who got it, NEAR Confidential, the time left, It keeps going., Done (control: no line given, none drawn)", async () => {
  try {
    const text = await shown({ amount: "$25.00", testid: "send-sent", etaSec: 9, said: "Sending $25.00 to bob.near.", landedSaid: "Sent $25.00 to bob.near." });
    assert.match(text, /^\$25\.00\nJob created\.\nSending \$25\.00 to bob\.near\.\nIt goes through NEAR Confidential\.\nAbout 9 seconds left\.\nYou can close this\. It keeps going\.\nDone\n?$/);
    assert.doesNotMatch(text, /Started\.|Landed early/);
  } finally { runtime.unmount(); }
  try {
    const text = await shown({ amount: "$25.00", testid: "trade-add-made", etaSec: 60 });
    assert.match(text, /^\$25\.00\nJob created\.\nIt goes through NEAR Confidential\.\nAbout 1 min left\.\nYou can close this\. It keeps going\.\nDone\n?$/, "control: no said line, no gap");
  } finally { runtime.unmount(); }
});

test("a Swap's receipt says \"Swapping\" while its job goes, \"swapped: about … is in\" only once its rows landed (control: going, never the landed words)", async () => {
  const { taskStore } = await server.ssrLoadModule("@zerofee/shell-api/tasks.ts");
  const tasks = (taskStore() as { forApp: (a: string) => { publish: (t: Record<string, unknown>) => void; end: (id: string, s: string) => void } }).forApp("wallet");
  try {
    const going = await shown({ amount: "$10.00", testid: "swap-made", etaSec: 60, said: "Swapping $10.00 of USDC for SOL.", landedSaid: "$10.00 swapped: about 0.0952 SOL is in your SOL wallet." });
    assert.match(going, /^\$10\.00\nJob created\.\nSwapping \$10\.00 of USDC for SOL\.\nIt goes through NEAR Confidential\.\nAbout 1 min left\./);
    assert.doesNotMatch(going, /is in your SOL wallet/, "control: going");
    tasks.publish({ id: "move:swap-1", title: "Swap $10.00 of USDC for SOL", steps: [{ label: "NEAR Intents", state: "doing" }], startedAt: Date.now() });
    tasks.end("move:swap-1", "done");
    await runtime.settle();
    const landed = runtime.text();
    assert.match(landed, /^\$10\.00\nDone\.\n\$10\.00 swapped: about 0\.0952 SOL is in your SOL wallet\.\nIt went there through NEAR Confidential\.\nTook (?:under a second|\d+ s)\.\nDone\n?$/, "landed (M12-1): Done., the landed words, the past and how long it took, whatever the machine's speed");
  } finally { runtime.unmount(); }
});

test("QA's MUST on the mounted receipt: a job whose row stops keeps the present and says its stop words, never \"Sent\" (control: the same receipt landed says \"Sent\")", async () => {
  const { taskStore } = await server.ssrLoadModule("@zerofee/shell-api/tasks.ts");
  const tasks = (taskStore() as { forApp: (a: string) => { publish: (t: Record<string, unknown>) => void; end: (id: string, s: string, d?: string) => void } }).forApp("wallet");
  try {
    await shown({ amount: "$25.00", testid: "send-sent", etaSec: 9, said: "Sending $25.00 to bob.near.", landedSaid: "Sent $25.00 to bob.near." });
    tasks.publish({ id: "send:stop-1", title: "Send $25.00 to bob.near", steps: [{ label: "NEAR Confidential", state: "doing" }], startedAt: Date.now() });
    tasks.end("send:stop-1", "failed", "NEAR said no. Your money is in your Safe.");
    await runtime.settle();
    const stopped = runtime.text();
    assert.match(stopped, /\nSending \$25\.00 to bob\.near\. NEAR said no\. Your money is in your Safe\.\n/);
    assert.doesNotMatch(stopped, /Sent \$25/);
  } finally { runtime.unmount(); }
});

// QA's finding, made a MUST by QA (7 Nov): two jobs on different money started within the slack (a hot
// wallet's and the Safe's). Each receipt follows its own job's rows (its `job`), never the other's stop words or landing.
test("the audit's MUST, mounted: a going job's receipt keeps \"Sending\" while another job, started in the same seconds, stops and lands; the stopped one says its own stop words (control: its own row lands, \"Sent\")", async () => {
  const { taskStore } = await server.ssrLoadModule("@zerofee/shell-api/tasks.ts");
  const { startJob } = await server.ssrLoadModule("@zerofee/shell-api/job-start.ts");
  type W = { publish: (t: Record<string, unknown>) => void; end: (id: string, s: string, d?: string) => void };
  type H = { id: string; made: (ids: string[]) => void };
  const tasks = (taskStore() as { forApp: (a: string) => W }).forApp("wallet");
  const start = (title: string) => startJob(tasks, { title }) as H;
  const row = (id: string, title: string) => tasks.publish({ id, title, steps: [{ label: "NEAR Confidential", state: "doing" }], startedAt: Date.now() });
  const stop = "NEAR said no. Your money is in your Safe.";
  const a = start("Send $25.00 to bob.near"), b = start("Send $30.00 to carol.near"), c = start("Move $5.00 to your SOL wallet");
  try {
    await shown({ amount: "$25.00", testid: "send-sent", etaSec: 60, said: "Sending $25.00 to bob.near.", landedSaid: "Sent $25.00 to bob.near.", job: a.id });
    // B (the Safe's) stops and C (a hot wallet's) lands while A's call hasn't answered yet
    row("send:b83-1", "Send $30.00 to carol.near"); b.made(["send:b83-1"]); tasks.end("send:b83-1", "failed", stop);
    row("move:c83-1", "Move $5.00 to your SOL wallet"); c.made(["move:c83-1"]); tasks.end("move:c83-1", "done");
    await runtime.settle();
    const early = runtime.text();
    assert.match(early, /\nSending \$25\.00 to bob\.near\.\nIt goes through NEAR Confidential\.\nAbout 1 min left\.\nYou can close this\. It keeps going\.\n/, "A: its own words, going");
    assert.doesNotMatch(early, /NEAR said no|Sent \$25|Done in|Took /, "never B's stop words, never C's landing");
    // A answered, its row going, still nothing of B's or C's
    row("send:a83-1", "Send $25.00 to bob.near"); a.made(["send:a83-1"]);
    await runtime.settle();
    assert.doesNotMatch(runtime.text(), /NEAR said no|Sent \$25|Done in|Took /);
    // control: A's own row lands
    tasks.end("send:a83-1", "done");
    await runtime.settle();
    assert.match(runtime.text(), /\nSent \$25\.00 to bob\.near\.\n[\s\S]*Took (?:under a second|\d+ s)\./, "control: its own landing says Sent");
  } finally { runtime.unmount(); }
  try {
    const stopped = await shown({ amount: "$30.00", testid: "send-sent", etaSec: 60, said: "Sending $30.00 to carol.near.", landedSaid: "Sent $30.00 to carol.near.", job: b.id });
    assert.match(stopped, /\nSending \$30\.00 to carol\.near\. NEAR said no\. Your money is in your Safe\.\n/, "B: its own stop words");
    assert.doesNotMatch(stopped, /Sent \$30/);
  } finally { runtime.unmount(); }
});
