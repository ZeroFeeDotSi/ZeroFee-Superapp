# Coin logos

Vendored once, never fetched at run time. Shown only as `<img src>` (CoinIcon.tsx), so nothing inside an SVG can run;
`../logos.test.ts` refuses any file with a script, an event handler or a link outside itself.

- Package: `cryptocurrency-icons@0.18.1` (licence CC0-1.0, see LICENSE.md)
- Fetched with `npm pack cryptocurrency-icons@0.18.1 --ignore-scripts`
- Integrity (npm registry, checked against the downloaded tarball):
  `sha512-dvR5O8JOmav3559Yb0Igpkia+3vpt/aeNvMu5ZIVUG2Bzpq9wNcOJRIQas49XJrPjtZ98GAEn3aDQO+w7uhS2w==`
- Files: `svg/color/<key>.svg` for eth, usdc, usdt, btc, sol, xrp, bnb, trx, xlm, matic; and (26 Oct 2026, the networks
  Wallet lists) bch, dash, doge, ltc, zec, ada (Cardano), avax (Avalanche).

Networks and coins without a logo here (Berachain, Fogo, Abstract, EURe, GBPe, …) show CoinIcon's monogram until a
logo from a source as clean as these is added the same way.

- `near.svg`: drawn by ZeroFee after NEAR's mark (the N), black circle, white mark; not from the icon set.

## Network marks, from each network's own brand kit (26 Oct 2026)

Downloaded once from the network's own site or GitHub org (never a third-party icon set or a redraw), checked by
`../logos.test.ts`, and kept byte for byte, except that a file with no `viewBox` got one (so it scales); its sha256 is of
the file as downloaded. Bare marks (no background of their own) are drawn whole on a white disc by CoinIcon, never
cropped (logos.ts `ON_DISC`). The terms are as each kit states them; all are trademarks of their owners, shown only to
name their network.

| File | Kit | File as downloaded | Terms (the kit's words, short) | sha256 (as downloaded) |
|---|---|---|---|---|
| base.svg | github.com/base/brand-kit, brand.base.org | raw.githubusercontent.com/base/brand-kit/14eef1393ddc00c6b388565234a79e84be5b2c04/logo/in-product/Base_Network_Logo.svg (30 Oct 2026: the kit's own in-product network logo, a full round badge, so it reads as Base at 32 px; the current kit's bare blue Square read as a plain square) | Use as given; don't distort, recolour or make your own. | 79dee8a2a0c684d51a958f708ec8960aaee5eb25351bdac9aac3b6694489210e |
| arb.svg | Arbitrum One brand guidelines (arbitrumfoundation.notion.site, linked from arbitrum.foundation) | 0923_One_Logos_Logomark_RGB.svg (the guidelines' file) | Use the primary variation whenever possible; never below 12 px. | a550983ee9b330548b15dce37d24e2744803da60789cee72e223cc917ca3ba96 |
| op.svg | optimism.io/brand | optimism.io/files/05dee11fbd0f605cc307d301daf68e2192297e50.svg (the round OP token icon) | The round icon is for avatars and tokens; use only to refer to the Optimism network. `viewBox` added. | 8c40fc5760b35315b91aaf45500943e583b184adce301321f945dcb0a99b162a |
| gnosis.svg | github.com/gnosischain/media-kit | raw.githubusercontent.com/gnosischain/media-kit/main/Logos/Owl_Logo%20-%20Mark.svg | Do not alter the brand assets. The 2022 mark; gnosis.io/brand v4 offers lockups only. | 831176a8b2885778c9ce4e567022c32532c0a0b9dd4b4e3baf230311a97ed3fe |
| ton.svg | ton.org/media | ton.org/assets/media/gram_circular_badge.zip → `Gram Circular Badge/Gram Circular Badge.svg` | "A round format for wallets." (ton.org now names the token Gram.) `viewBox` added. | f49a6525978d8d39a12106f1eefb84b4d18fff99efb846830765ea11b3fda6e6 |
| sui.svg | sui.io/media-kit | 01_Sui_Logo.zip → `01_Sui_Logo/Sui_Droplet/SVG/Logo_Sui_Droplet_Black.svg` | Do's and don'ts in the kit; no written licence. | 09b2e97ad531eb8938897df29b2a40d2d3875c6b1e0e98f2f42f22ac0dcde36f |
| aptos.svg | aptosnetwork.com/media-kit, aptosfoundation.org brandbook | aptosfoundation.org/brandbook/logomark/SVG/Aptos_mark_BLK.svg, read through the Wayback Machine's 30 May 2025 copy (the live site refuses scripted downloads): check against the live file | Black on light, white on dark; don't alter colours or proportions. | b930b0a5b100e0ecd63f385b1c0df717979551f64135131f34b326c3971e2249 |
| monad.svg | monad.xyz/brand-and-media-kit | monad.xyz/brand-page-assets/Token.svg | No terms on the page. | 5ad0b4aa249fa5c3034dd4656195db01c9f0a95320f4aace24309a705d96ea28 |
| plasma.svg | plasma.org/brand | plasma.org/brand/token/xpl-mark.svg | No terms on the page. | 8a40a233210bb1539c77a41fdd681d02d4bc75f8be69495f8153d7cb66a48fc3 |
| scroll.svg | scroll.io/brand-kit (its files live in github.com/scroll-tech/frontends) | scroll-tech/frontends @89393fc `src/assets/images/brandkit/Scroll_Logomark/Scroll_Logomark.svg` | The beige 1:1 version is the profile picture. | e84914170aea6f4fd742f7c795d1d1828b0614d79659784e4db3a6b19541f274 |
| starknet.svg | starknet.io/media-kit | starknet.io/assets/starknet-logos-svg.zip → `Starknet-logos-svg/Symbol/SN-Symbol-Flat colour.svg` | Brand Book in the kit. | 53dc8a62c51b4064e0a4bbb980dd9f100d8b803441edc12146142baa75ffa094 |
| xlayer.svg | github.com/okx/xlayer-docs `media-kit/` | XLayer-logo-kit.zip @0c2a6b87 → `XL/PROFILE ICON W- BACKGROUND/SVG/XLayer_Profile_WhenLessThan40px_White.svg` | The kit's file for under 40 px; terms in its guideline PDF. | f837468b7de4079c832bcd8d410d0c4cb90002f9e8f331e32a2e2b72a399eb88 |
| hood.svg | docs.robinhood.com/chain/brand-guidelines | cdn.robinhood.com/assets/generated_assets/hoodchain_docsite/feather-dark.svg (the guidelines page's own file; the kit zip has the feather as JPG only) | Use exactly as provided; don't alter, recolour or crop the feather (it's shown whole, on the disc). | 82ef124f9e1446c480bdc6a8569df83f547cd3312ed231854dafd4c21610ae7d |
| hypercore.svg | hyperliquid.gitbook.io/hyperliquid-docs/brand-kit | Hyperliquid SVG format.zip → `SVG/Hyperliquid_Blob_Dark.svg` | No terms on the page. | 393d7db6117c0a5ab0a8c6bf8b2212e047a1a079f207bc84f3bc1e0d4d639531 |
| movement.svg | movementnetwork.xyz/brand-kit | movementnetwork.xyz/brand-kit/logos/Mark_Movement_Black.svg | Keep the marks clear and unmodified. | af51aea18f4803a07598bca4af436bbc1ddf620d289188fc11f9fb1a9720752e |
| aleo.svg | aleo.org/brand | aleo.org/aleo-logos.zip → `aleo-logos/SVG/secondary-icon-dark.svg` | See Aleo's Brand Book. | 36abe6f3c374a74691c8dbbf4d8cf937264cfbcbebed5aeb2f318b60ca3a83ea |

Still to add by hand (no scripted download possible): Berachain (berachain.com/brand answers 429 to scripts), Abstract
(an Air.inc board linked from abs.xyz), Fogo (no official kit found).
