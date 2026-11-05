// ZeroFee's wallet provider: what a site sees as "a wallet" inside ZeroFee's wallet mode (Security's backlog, section C).
//
// The iPhone host injects this one file, hash-pinned (pin.ts), into the PAGE world of the MAIN frame at document start,
// and only while wallet mode is on for the committed host. It is the site's side only: it holds no key, no address book
// and no rule. Every request goes to the host's `zerofeeWallet` handler as { id, method, params }; the host adds the
// origin and frame from WebKit itself, and the Browser engine (packages/browser/src/engine) answers through the core,
// whose native sheet asks the person. Nothing here decides anything a page could not also fake for itself.
//
// It offers what sites look for, in their standard shapes:
// - EIP-1193 (`window.ethereum`, only if no other wallet set it) and EIP-6963 (announced as "ZeroFee", si.zerofee);
// - the Solana Wallet Standard (registered as "ZeroFee": connect, disconnect, events, signMessage, signTransaction,
//   signAndSendTransaction). It never poses as Phantom, MetaMask or any other wallet.
//
// Events (accountsChanged, chainChanged, connect, disconnect, Solana's change) arrive as a "zerofee-wallet:event"
// CustomEvent the host dispatches. A page can dispatch that too, but only to mislead itself: every request is still
// checked by the engine against the connection it holds.
//
// Self-contained on purpose: no imports, no globals besides window.ethereum, plain ES2020 that WebKit runs as is.
(() => {
  "use strict";
  const handlers = window.webkit && window.webkit.messageHandlers;
  const handler = handlers && handlers.zerofeeWallet;
  if (!handler || window.top !== window) return;
  // Taken now, at document start, before any page script runs, so a page that later replaces postMessage changes nothing.
  const post = handler.postMessage.bind(handler);

  const ICON =
    "data:image/svg+xml;base64," +
    btoa(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#0b0b0c"/>' +
        '<circle cx="12" cy="12" r="6.6" fill="none" stroke="#fff" stroke-width="1.3"/>' +
        '<path d="M7.4 16.6 16.6 7.4" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/></svg>',
    );
  const NAME = "ZeroFee";

  // ── Talking to the host ───────────────────────────────────────────────────────────────────────────────────────

  const providerError = (code, message) => Object.assign(new Error(message), { code });
  const plain = (value) => {
    try {
      return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    } catch {
      throw providerError(-32602, "The request has values ZeroFee can't read.");
    }
  };
  let nextId = 1;
  const call = async (method, params) => {
    const id = nextId++;
    const message = { id, method, params: plain(params) };
    let reply;
    try {
      reply = await post(message);
    } catch {
      throw providerError(4900, "ZeroFee isn't answering this page.");
    }
    if (!reply || typeof reply !== "object") throw providerError(-32603, "ZeroFee gave no answer.");
    if (reply.error) throw providerError(Number(reply.error.code) || -32603, String(reply.error.message || "Refused."));
    return reply.result;
  };

  const b64 = (bytes) => {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  const bytesOf = (value, what) => {
    if (value instanceof Uint8Array) return value;
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw providerError(-32602, `${what} must be bytes.`);
  };

  // ── EIP-1193 ───────────────────────────────────────────────────────────────────────────────────────────────────

  const listeners = new Map();
  const emit = (event, value) => {
    for (const fn of [...(listeners.get(event) || [])]) {
      try {
        fn(value);
      } catch (e) {
        setTimeout(() => {
          throw e;
        });
      }
    }
  };
  let accounts = [];
  let chainId = null;
  const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const setAccounts = (next) => {
    const list = Array.isArray(next) ? next.filter((x) => typeof x === "string") : [];
    if (sameList(list, accounts)) return;
    accounts = list;
    emit("accountsChanged", list.slice());
  };
  const setChain = (next) => {
    if (typeof next !== "string" || next === chainId) return;
    const first = chainId === null;
    chainId = next;
    if (first) emit("connect", { chainId: next });
    else emit("chainChanged", next);
  };

  const ethereum = {
    isZeroFee: true,
    async request(args) {
      if (!args || typeof args !== "object" || typeof args.method !== "string") throw providerError(-32602, "A request needs a method.");
      const params = args.params === undefined ? [] : args.params;
      if (typeof params !== "object" || params === null) throw providerError(-32602, "params must be an array or an object.");
      const result = await call(args.method, params);
      if (args.method === "eth_requestAccounts" || args.method === "eth_accounts") setAccounts(result);
      if (args.method === "eth_chainId") setChain(result);
      return result;
    },
    on(event, fn) {
      if (typeof fn !== "function") return ethereum;
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return ethereum;
    },
    once(event, fn) {
      const wrapped = (value) => {
        ethereum.removeListener(event, wrapped);
        fn(value);
      };
      return ethereum.on(event, wrapped);
    },
    removeListener(event, fn) {
      const set = listeners.get(event);
      if (set) set.delete(fn);
      return ethereum;
    },
    removeAllListeners(event) {
      if (event === undefined) listeners.clear();
      else listeners.delete(event);
      return ethereum;
    },
    isConnected: () => true,
    // Older sites: enable() and sendAsync() are the same requests.
    enable: () => ethereum.request({ method: "eth_requestAccounts" }),
    sendAsync(payload, callback) {
      ethereum.request(payload).then(
        (result) => callback(null, { id: payload && payload.id, jsonrpc: "2.0", result }),
        (error) => callback(error, { id: payload && payload.id, jsonrpc: "2.0", error: { code: error.code, message: error.message } }),
      );
    },
    get chainId() {
      return chainId;
    },
    get selectedAddress() {
      return accounts[0] || null;
    },
  };
  ethereum.addListener = ethereum.on;
  ethereum.off = ethereum.removeListener;
  Object.freeze(ethereum);

  if (!("ethereum" in window)) Object.defineProperty(window, "ethereum", { value: ethereum, configurable: true, writable: true });

  // ── EIP-6963 ───────────────────────────────────────────────────────────────────────────────────────────────────

  const uuid = (() => {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  })();
  const announcement = Object.freeze({ info: Object.freeze({ uuid, name: NAME, icon: ICON, rdns: "si.zerofee" }), provider: ethereum });
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: announcement }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();

  // ── Solana Wallet Standard ─────────────────────────────────────────────────────────────────────────────────────

  const SOLANA = "solana:mainnet";
  const solListeners = new Set();
  let solAccount = null;
  const SOL_FEATURES = ["solana:signMessage", "solana:signTransaction", "solana:signAndSendTransaction"];
  const setSolAccount = (next) => {
    const address = next && typeof next.address === "string" ? next.address : null;
    if ((solAccount && solAccount.address) === address) return;
    solAccount = address
      ? Object.freeze({ address, publicKey: unb64(next.publicKey), chains: Object.freeze([SOLANA]), features: Object.freeze(SOL_FEATURES.slice()) })
      : null;
    for (const fn of [...solListeners]) {
      try {
        fn({ accounts: wallet.accounts });
      } catch (e) {
        setTimeout(() => {
          throw e;
        });
      }
    }
  };
  const ownAddress = (account) => {
    const address = account && account.address;
    if (!solAccount || address !== solAccount.address) throw providerError(4100, "Connect ZeroFee to this site first.");
    return address;
  };
  const chainOf = (input) => {
    if (input.chain !== undefined && input.chain !== SOLANA) throw providerError(4901, "ZeroFee's Browser wallet is on Solana mainnet only.");
    return SOLANA;
  };
  // Each input is asked for on its own, one after the other: one sheet each, never a batch the person can't read.
  const each = async (inputs, one) => {
    const out = [];
    for (const input of inputs) out.push(await one(input || {}));
    return out;
  };

  const wallet = {
    version: "1.0.0",
    name: NAME,
    icon: ICON,
    chains: Object.freeze([SOLANA]),
    get accounts() {
      return solAccount ? [solAccount] : [];
    },
    features: Object.freeze({
      "standard:connect": {
        version: "1.0.0",
        async connect(input) {
          setSolAccount(await call("solana:connect", { silent: Boolean(input && input.silent) }));
          return { accounts: wallet.accounts };
        },
      },
      "standard:disconnect": {
        version: "1.0.0",
        async disconnect() {
          await call("solana:disconnect", {});
          setSolAccount(null);
        },
      },
      "standard:events": {
        version: "1.0.0",
        on(event, fn) {
          if (event !== "change" || typeof fn !== "function") return () => {};
          solListeners.add(fn);
          return () => solListeners.delete(fn);
        },
      },
      "solana:signMessage": {
        version: "1.1.0",
        signMessage: (...inputs) =>
          each(inputs, async (input) => {
            const message = bytesOf(input.message, "message");
            const r = await call("solana:signMessage", { address: ownAddress(input.account), message: b64(message) });
            return { signedMessage: message, signature: unb64(r.signature), signatureType: "ed25519" };
          }),
      },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: Object.freeze(["legacy", 0]),
        signTransaction: (...inputs) =>
          each(inputs, async (input) => {
            const transaction = b64(bytesOf(input.transaction, "transaction"));
            const r = await call("solana:signTransaction", { address: ownAddress(input.account), transaction, chain: chainOf(input) });
            return { signedTransaction: unb64(r.signedTransaction) };
          }),
      },
      "solana:signAndSendTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: Object.freeze(["legacy", 0]),
        signAndSendTransaction: (...inputs) =>
          each(inputs, async (input) => {
            const transaction = b64(bytesOf(input.transaction, "transaction"));
            const r = await call("solana:signAndSendTransaction", { address: ownAddress(input.account), transaction, chain: chainOf(input) });
            return { signature: unb64(r.signature) };
          }),
      },
    }),
  };
  Object.freeze(wallet);

  // The Wallet Standard's own handshake: announce now, and again to any app that says it is ready later.
  class RegisterWalletEvent extends Event {
    #detail;
    constructor(callback) {
      super("wallet-standard:register-wallet", { bubbles: false, cancelable: false, composed: false });
      this.#detail = callback;
    }
    get detail() {
      return this.#detail;
    }
    get type() {
      return "wallet-standard:register-wallet";
    }
    preventDefault() {
      throw new Error("preventDefault cannot be called");
    }
    stopImmediatePropagation() {
      throw new Error("stopImmediatePropagation cannot be called");
    }
    stopPropagation() {
      throw new Error("stopPropagation cannot be called");
    }
  }
  const register = ({ register: add }) => add(wallet);
  try {
    window.dispatchEvent(new RegisterWalletEvent(register));
  } catch {}
  window.addEventListener("wallet-standard:app-ready", (event) => {
    if (event.detail && typeof event.detail.register === "function") register(event.detail);
  });

  // ── Events from the host ───────────────────────────────────────────────────────────────────────────────────────

  window.addEventListener("zerofee-wallet:event", (event) => {
    const detail = event.detail || {};
    switch (detail.event) {
      case "accountsChanged":
        return setAccounts(detail.data);
      case "chainChanged":
        return setChain(detail.data);
      case "disconnect":
        setAccounts([]);
        return emit("disconnect", providerError(4900, "ZeroFee disconnected this site."));
      case "solana:change":
        return setSolAccount(detail.data);
    }
  });
})();
