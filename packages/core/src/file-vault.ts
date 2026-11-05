// A Vault in a private file, for running the demo core from Node (testnet tools). Node only: the web build never
// imports this file. The file is created with mode 600 under $ZEROFEE_HOME/, like the other testnet
// secrets, and its contents are never printed.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Vault } from "./vault.ts";

export class FileVault implements Vault {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  get lockScope(): string { return `file:${this.path}`; }

  private read(): Record<string, string> {
    return existsSync(this.path) ? JSON.parse(readFileSync(this.path, "utf8")) : {};
  }

  private write(items: Record<string, string>) {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, JSON.stringify(items, null, 2), { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, this.path);
  }

  async get(name: string): Promise<Uint8Array | null> {
    const v = this.read()[name];
    return v === undefined ? null : new Uint8Array(Buffer.from(v, "base64"));
  }

  async put(name: string, bytes: Uint8Array): Promise<void> {
    this.write({ ...this.read(), [name]: Buffer.from(bytes).toString("base64") });
  }

  async delete(name: string): Promise<void> {
    const items = this.read();
    delete items[name];
    this.write(items);
  }
}
