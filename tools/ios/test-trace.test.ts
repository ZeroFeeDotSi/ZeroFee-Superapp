// iOS audit finding 4: the phone build (apps/ios/build-web.sh) clears the test flight-recorder flags before it builds,
// as apps/web/deploy-app.sh does, and stops if one is still set, in the shell or in a Vite .env file under apps/web.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const sh = readFileSync(fileURLToPath(new URL("../../apps/ios/build-web.sh", import.meta.url)), "utf8");
const guard = /^# test-trace guard \(iOS audit finding 4\)[\s\S]*?^# test-trace guard: end$/m.exec(sh)?.[0] ?? "";

/** Runs only the guard, against a stand-in repo, with `env` added; its exit code. */
function runGuard(env: Record<string, string>, dotEnv?: string): number {
  const repo = mkdtempSync(join(tmpdir(), "zf-trace-"));
  try {
    mkdirSync(join(repo, "apps/web"), { recursive: true });
    if (dotEnv) writeFileSync(join(repo, "apps/web/.env.local"), dotEnv);
    const r = spawnSync("/bin/sh", ["-c", `set -eu\nrepo="$1"\n${guard}\nenv | grep -q '^VITE_TEST_TRACE' && exit 3\nexit 0`, "guard", repo], { env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...env } });
    return r.status ?? -1;
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

test("build-web.sh never sets VITE_TEST_TRACE, and its guard runs before the web build", () => {
  assert.ok(guard, "the guard is in build-web.sh");
  assert.ok(!/VITE_TEST_TRACE[A-Z_]*=/.test(sh), "it never sets it");
  assert.ok(sh.indexOf(guard) < sh.indexOf("npm run -w @zerofee/web build"), "before the build");
  assert.match(sh, /TEST-PHONE-ONLY/, "a test-phone bundle is marked inside itself");
});

test("without ZF_TEST_PHONE_BUILD=1, any flight-recorder flag stops the build; nothing is cleared silently", () => {
  assert.equal(runGuard({ VITE_TEST_TRACE: "1", VITE_TEST_TRACE_KEY: "k", VITE_TEST_TRACE_ID: "i" }), 1, "set in the shell: the build stops");
  assert.equal(runGuard({ VITE_TEST_TRACE_EXTRA: "1" }), 1, "any VITE_TEST_TRACE flag: the build stops");
  assert.equal(runGuard({ VITE_TEST_TRACE: "1", ZF_TEST_PHONE_BUILD: "yes" }), 1, "only exactly 1 counts as the product flag");
  assert.equal(runGuard({}, "VITE_TEST_TRACE=1\n"), 1, "apps/web/.env.local sets it: the build stops");
  assert.equal(runGuard({}, "VITE_HOME_PROOF=1\n"), 0, "a .env without it (control)");
  assert.equal(runGuard({}), 0, "nothing set (control)");
});

test("with ZF_TEST_PHONE_BUILD=1 the test phone may carry it, flags kept", () => {
  assert.equal(runGuard({ ZF_TEST_PHONE_BUILD: "1", VITE_TEST_TRACE: "1", VITE_TEST_TRACE_KEY: "k", VITE_TEST_TRACE_ID: "i" }), 3, "goes on, flags still set for the web build");
  assert.equal(runGuard({ ZF_TEST_PHONE_BUILD: "1" }, "VITE_TEST_TRACE=1\n"), 0, "a .env setting it is allowed on the test phone");
});
