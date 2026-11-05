// What the phone's own sheet checks against the bytes it signs (iOS audit, finding 1). The sheet's words come from here,
// in JavaScript, so on their own the native side can't tell them from a lie. With each signature the core also hands it
// this structured summary: the receiver and every step (a NEAR payment's amount, a call's method, deposit and gas, a key
// added or taken off) and, for the account's own execute()/execute_many(), each inner receiver and its steps. Swift
// decodes the bytes itself (apps/ios/ZeroFee/NearTx.swift NearTx.decode), refuses to sign unless they say exactly this,
// and shows the receiver and amount it read from the bytes, not from these words.
//
// Amounts and gas are whole numbers as text (no leading zeros), so both sides compare them as text.
import { sha256 } from "@noble/hashes/sha2.js";
import type { CoreAction, UnsignedTx } from "./tx-build.ts";

export type SheetStep =
  | { kind: "transfer"; deposit: string }
  | { kind: "call"; method: string; deposit: string; gas: string }
  | { kind: "add-key"; publicKey: string; permission: "full" | { receiver: string; methods: string[]; allowance: string | null } }
  | { kind: "delete-key"; publicKey: string }
  | { kind: "deploy"; codeSha256: string }
  | { kind: "use-global"; codeHash: string };

export interface SheetSummary {
  receiver: string;
  actions: SheetStep[];
  /** For a call to the account's own execute() or execute_many(): each receiver inside it and its steps. */
  inner?: { receiver: string; steps: SheetStep[] }[];
}

const hex = (b: Uint8Array) => Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("");

function step(a: CoreAction): SheetStep {
  switch (a.kind) {
    case "transfer":
      return { kind: "transfer", deposit: a.yocto.toString() };
    case "call":
      return { kind: "call", method: a.method, deposit: a.depositYocto.toString(), gas: a.gas.toString() };
    case "add-key":
      return {
        kind: "add-key",
        publicKey: a.publicKey,
        permission:
          a.permission.kind === "full"
            ? "full"
            : { receiver: a.permission.receiverId, methods: [...a.permission.methods], allowance: a.permission.allowanceYocto === null ? null : a.permission.allowanceYocto.toString() },
      };
    case "delete-key":
      return { kind: "delete-key", publicKey: a.publicKey };
    case "deploy":
      return { kind: "deploy", codeSha256: hex(sha256(a.code)) };
    case "use-global":
      return { kind: "use-global", codeHash: hex(a.codeHash) };
  }
}

/** One group of execute()'s JSON ({ receiver_id, steps: [{Transfer}|{FunctionCall}] }) as the sheet's inner steps. */
function innerGroup(g: any): { receiver: string; steps: SheetStep[] } {
  if (typeof g?.receiver_id !== "string" || !Array.isArray(g.steps)) throw new Error("execute's steps can't be read");
  const steps = g.steps.map((s: any): SheetStep => {
    if (s?.Transfer) return { kind: "transfer", deposit: String(s.Transfer.deposit) };
    if (s?.FunctionCall) return { kind: "call", method: String(s.FunctionCall.method_name), deposit: String(s.FunctionCall.deposit), gas: String(s.FunctionCall.gas) };
    throw new Error("execute's steps can't be read");
  });
  return { receiver: g.receiver_id, steps };
}

/** The summary of an unsigned transaction, for the native sheet's check. */
export function sheetSummary(tx: UnsignedTx): SheetSummary {
  const out: SheetSummary = { receiver: tx.receiverId, actions: tx.actions.map(step) };
  const call = tx.actions[0];
  if (tx.actions.length === 1 && call.kind === "call" && tx.receiverId === tx.signerId && (call.method === "execute" || call.method === "execute_many")) {
    const args = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(call.args));
    out.inner = call.method === "execute" ? [innerGroup(args)] : (Array.isArray(args?.groups) ? args.groups : []).map(innerGroup);
  }
  return out;
}
