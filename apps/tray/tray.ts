// "AgentZero on this computer" (D100, D101): the tray. Run by hand:
//   node apps/tray/tray.ts pair --relay https://<ZeroFee's relay>   pair with the phone; keeps AgentZero's key in the Keychain
//   node apps/tray/tray.ts serve [--port 7811]                     AgentZero's MCP server on 127.0.0.1 for Claude Code
// AgentZero's seed and this computer's pairing secret are never taken on a command line or put in another program's
// (they go to `security` on stdin). The bearer token is printed for Claude Code, so it does end up in the `claude mcp
// add` command line, the shell's history and ~/.claude.json; the server answers only this computer (127.0.0.1).
// Any program running as you, including Claude Code itself, can read these Keychain items and pay without the tray's own
// limits; only your account's on-chain limits then hold. Logs counts and error names only.
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { trayBearer } from "@zerofee/core/pair";
import { RpcChain } from "@zerofee/core/chain";
import { oneClickQuote } from "@zerofee/core/intents";
import { PORT, runPair } from "./src/pair-flow.ts";
import { keychainStore } from "./src/store.ts";
import { createTools } from "./src/tools.ts";
import { createMcpHandler, startMcpServer } from "./src/server.ts";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { relay: { type: "string" }, port: { type: "string" } } });
const say = (line: string) => process.stdout.write(`${line}\n`);
const fail = (line: string): never => {
  process.stderr.write(`${line}\n`);
  process.exit(1);
};
const port = values.port ? Number(values.port) : PORT;
if (!Number.isInteger(port) || port < 1024 || port > 65535) fail("Give a port from 1024 to 65535.");
if (process.platform !== "darwin") fail("The tray keeps AgentZero's key in the macOS Keychain, so it runs on a Mac only.");
const store = keychainStore();
/** NEAR as the app reads it (two nodes): a .testnet account on testnet, any other on mainnet. */
const chainFor = (accountId: string) => new RpcChain(accountId.endsWith(".testnet") ? "testnet" : "mainnet");

if (positionals[0] === "pair") {
  if (!values.relay) fail("Say where ZeroFee's relay is: node apps/tray/tray.ts pair --relay https://…");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ok = await runPair({ relay: values.relay!, store, chainFor, print: say, ask: (q) => rl.question(q), port }).finally(() => rl.close());
  process.exit(ok ? 0 : 1);
} else if (positionals[0] === "serve") {
  const held = await store.load();
  if (!held) fail("AgentZero isn't paired on this computer. Run: node apps/tray/tray.ts pair --relay https://…");
  const { accountId, stopHash, dayLimitUsd } = held!;
  const bearer = trayBearer(held!.secret);
  held!.secret.fill(0);
  held!.seed.fill(0);
  const chain = chainFor(accountId);
  const log = (line: string) => process.stdout.write(`${line}\n`);
  const tools = createTools({
    chain,
    accountId,
    quoter: oneClickQuote,
    stopHash,
    log,
    // D104: this computer's own day limit, its rolling count kept in the Keychain.
    dayLimitUsd,
    spent: () => store.spent(),
    setSpent: (list) => store.setSpent(list),
    // AgentZero's seed comes out of the Keychain for one payment at a time.
    loadSeed: async () => {
      const h = await store.load();
      if (!h) return null;
      h.secret.fill(0);
      if (h.accountId !== accountId) return h.seed.fill(0), null;
      return h.seed;
    },
    forget: () => store.remove(),
  });
  let server: Awaited<ReturnType<typeof startMcpServer>> | null = null;
  const handle = createMcpHandler({
    bearer,
    port,
    tools,
    log,
    onStop: () => {
      say("AgentZero stopped. Its key is gone from this computer.");
      server?.close();
      process.exit(0);
    },
  });
  server = await startMcpServer(handle, port).catch((e: NodeJS.ErrnoException) => fail(e.code === "EADDRINUSE" ? `Port ${port} is taken. Try --port 7812.` : "The tray couldn't start."));
  say(`AgentZero is listening on http://127.0.0.1:${port}/mcp (this computer only).`);
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => (server?.close(), process.exit(0)));
} else {
  fail("Use: node apps/tray/tray.ts pair --relay https://…   or   node apps/tray/tray.ts serve");
}
