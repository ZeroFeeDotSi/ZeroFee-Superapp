// The ZeroFee extension's one id (product decision, 3 Nov, D157): pinned by the public `key` in public/manifest.json, so every
// Load-unpacked install and every update is the same extension. Its passkeys are made for chrome-extension://<this id>
// and its vault is this origin's IndexedDB: another id would find neither. Pinned 4 Nov from the operator's public key
// (tools/pin-id.ts, $ZEROFEE_HOME/extension-key/public.der.b64; the private key never leaves the operator). Permanent.
export const EXTENSION_ID: string = "hfnbcflhfpceemgoglhbonngemobhffd";
