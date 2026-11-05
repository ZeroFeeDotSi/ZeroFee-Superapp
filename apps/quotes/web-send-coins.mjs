// The tokens the web wallet's Send may pay privately (case (h), W4 "every coin held", 5 Nov): exactly the core's pinned
// list, packages/core/src/hidden-coins.ts HIDDEN_COINS (its mint or contract the core's own). The relay deploys from
// apps/quotes alone (deploy.sh: Vercel's root is this folder), so it can't import the core; web-send-coins.test.ts holds
// this list equal to the core's, both ways, so it can't drift.
export const WEB_SEND_TOKENS = Object.freeze([
  "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
  "nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near",
  "nep141:sol-b9c68f94ec8fd160137af8cdfe5e61cd68e2afba.omft.near",
  "nep141:sol-57d087fd8c460f612f8701f5499ad8b2eec5ab68.omft.near",
  "nep141:sol-c58e6539c2f2e097c251f8edf11f9c03e581f8d4.omft.near",
  "nep141:sol-91914f13d3b54f8126a2824d71632d4b078d7403.omft.near",
  "nep141:sol-df27d7abcc1c656d4ac3b1399bbfbba1994e6d8c.omft.near",
  "nep141:sol-1f00bb36e75cfc8e1274c1507cc3054f5b3f3ce1.omft.near",
  "nep141:sol-c634d063ceff771aff0c972ec396fd915a6bbd0e.omft.near",
  "nep141:sol-d600e625449a4d9380eaf5e3265e54c90d34e260.omft.near",
  "nep141:sol-bb27241c87aa401cc963c360c175dd7ca7035873.omft.near",
  "nep141:hood-0x5fc5360d0400a0fd4f2af552add042d716f1d168.omft.near",
  "nep141:hood-0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34.omft.near",
  "nep141:hood-0x0bd7d308f8e1639fab988df18a8011f41eacad73.omft.near",
  "nep141:hood-0x39dbed3a2bd333467115de45665cc57f813c4571.omft.near",
  "nep141:hood-0x020bfc650a365f8bb26819deaabf3e21291018b4.omft.near",
]);
