// A throwaway TLS key and certificate for the STARTTLS tests, made at RUN time by openssl in a fresh temp dir and
// deleted after. Nothing is stored in the repo. Without openssl on PATH the TLS tests skip, saying why; they never
// fall back to a stored key.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TestTls {
  key: Buffer;
  cert: Buffer;
  /** Deletes the temp dir and its files. */
  remove(): void;
}

/** A fresh P-256 pair for CN=localhost, valid one day; or the reason it couldn't be made. */
export function makeTestTls(): TestTls | { skip: string } {
  const dir = mkdtempSync(join(tmpdir(), "zf-mail-tls-"));
  const remove = () => rmSync(dir, { recursive: true, force: true });
  try {
    execFileSync(
      "openssl",
      ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-subj", "/CN=localhost", "-days", "1", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem")],
      { stdio: "ignore", timeout: 20_000 },
    );
    return { key: readFileSync(join(dir, "k.pem")), cert: readFileSync(join(dir, "c.pem")), remove };
  } catch (err) {
    remove();
    const code = (err as { code?: string }).code;
    return { skip: code === "ENOENT" ? "openssl is not on PATH, so no throwaway TLS certificate can be made" : `openssl could not make a throwaway certificate (${code ?? "failed"})` };
  }
}
