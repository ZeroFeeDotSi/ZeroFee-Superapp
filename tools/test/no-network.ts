// The unit suite is hermetic (B28, 2 Nov: 1Click answered 521 and four core tests failed, blocking every landing):
// no unit test opens a network connection to anything but this machine. Loaded before every test file (package.json
// "test": node --import ./tools/test/no-network.ts --test …). A connection to any other host is refused at the socket,
// and the file fails at exit naming the host, even when the code under test swallowed the error. Recorded answers
// (fixtures) go through the same seams the fault injection uses (a fetch passed in, replayFetch, FakeChain).
// A test that must reach a live service is marked live: its file is named *.live.test.ts, or the run sets ZF_LIVE=1.
import net from "node:net";

const file = process.argv[1] ?? "";
const live = process.env.ZF_LIVE === "1" || /\.live\.test\.[cm]?tsx?$/.test(file);

/** This machine: loopback, a unix socket, or no host at all (an IPC pipe). */
export const local = (host: unknown): boolean => {
  if (host === undefined || host === null || host === "") return true;
  const h = String(host).replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "::1" || h.startsWith("127.") || h === "0.0.0.0" || h.endsWith(".localhost");
};

export const refused: string[] = [];

if (!live) {
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
    const first = args[0] as { host?: string; path?: string } | number | string | unknown[];
    const opts = Array.isArray(first) ? (first[0] as { host?: string; path?: string }) : first;
    const host = typeof opts === "object" && opts !== null ? (opts.path ? "" : opts.host ?? "localhost") : typeof opts === "number" ? (typeof args[1] === "string" ? args[1] : "localhost") : "";
    if (!local(host)) {
      refused.push(String(host));
      const err = Object.assign(new Error(`a unit test tried to reach ${host}: unit tests use recorded answers, never a live service (mark the file *.live.test.ts to allow it)`), { code: "ZF_NO_NETWORK" });
      process.nextTick(() => this.destroy(err));
      return this;
    }
    return (connect as (...a: unknown[]) => net.Socket).apply(this, args);
  } as typeof net.Socket.prototype.connect;

  process.on("exit", (code) => {
    if (refused.length === 0) return;
    const hosts = [...new Set(refused)].join(", ");
    process.stderr.write(`\nno-network: ${file.replace(/^.*\/(packages|apps|tools)\//, "$1/")} tried to reach ${hosts}. Use recorded answers, or name the file *.live.test.ts.\n`);
    if (code === 0) process.exitCode = 1;
  });
}
