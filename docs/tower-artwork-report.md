# TOWER Artwork Report

How the TOWER OF THE DARTS scenery got from the delivered files into the app, and where the numbers
the code relies on came from. Anyone replacing the artwork should be able to work from this page
alone.

## What was delivered

Six PNGs, supplied by the repository owner and committed to `main` as
`web/public/tower/<Japanese name>.png`:

| Delivered file | Subject | Size |
|---|---|---|
| `石壁・松明の暖色.png` | Stone and torchlight, floors 1–20 | 1448×1086 |
| `苔むした緑.png` | Mossed stone, floors 21–40 | 1448×1086 |
| `青い回廊.png` | Blue gallery, floors 41–60 | 1448×1086 |
| `紫の高層.png` | Violet upper storeys, floors 61–80 | 1448×1086 |
| `頂上・夜明けの藍と金.png` | The summit at dawn, floors 81–100 | 1448×1086 |
| `塔_ゲージ.png` | The gauge tower, for beside the board | 724×2172, transparent |

The five scenes share one camera and one composition — a round tower interior, a flight of stairs
entering from the lower left, a lit shaft rising to a dome — which is why a single crop and a single
scrim work across all of them.

## What ships, and why it is not the PNGs

The PNGs total **14.06 MB**. n02 serves GitHub Pages from tracked files at the repository root, so
every byte in `web/public/` is committed twice: once as source and once again as a build artifact
under `/tower/`. Shipping the PNGs would have added roughly 28 MB to the repository and put a 2.5 MB
download in front of a player opening the first floor.

They were re-encoded to WebP at quality 82 (`method=6`), which is visually indistinguishable at the
sizes the app draws them and **10.8× smaller in total**. The gauge was additionally cropped to the
tower itself: the delivered file is 724 px wide but the tower occupies only x 285–428, so three
quarters of it was transparent margin that would have thrown off the gauge's layout.

| Source | SHA-256 | Shipped | SHA-256 | Bytes |
|---|---|---|---|---|
| `石壁・松明の暖色.png` | `20cf3945c80260ffad694edd7625593be46f425d8b8d208d986d9713f75ea027` | `tower-stage-001-020.webp` | `6336f627b468b561b3158d25915fbcc0308be89cb7b19e6ac4d738f3d7915a7e` | 2538848 → 191452 |
| `苔むした緑.png` | `f7d2907f9073a1e1cecdd0ff486a794ae3ccfbaa286167cf51576a3c09969be0` | `tower-stage-021-040.webp` | `c0a96167762a2657cf177eee8de06425bc4d0b4bb3f10a49926d1e66ef5c0f3e` | 3016139 → 335086 |
| `青い回廊.png` | `ab8367636efb9e049b5fc91f9c3829351af332c68ca61b225a663abd848636e8` | `tower-stage-041-060.webp` | `7ab6583135d9c3feccb73ac4219bffcf658d448bd24426d3a42de9a561e6bce9` | 2621393 → 197572 |
| `紫の高層.png` | `b482c10cf12c55504c8841939926ba554386d61e1c4d8fb407dd656ffd4c8d15` | `tower-stage-061-080.webp` | `155ad0ed9ad7fc8297aa9420b791774d95833170fa6d8b08c772d7f142b746d1` | 2724000 → 241990 |
| `頂上・夜明けの藍と金.png` | `09747baf956cbe11ef320577617f0a8e8ec17738da8e558bbcc5d1d0be4f6319` | `tower-stage-081-100.webp` | `cc55e343bfabcab546380f9edc9f55ddbcf15a887a33a074cf9e420770ec7c22` | 2722927 → 253962 |
| `塔_ゲージ.png` | `dd991acba14813314740cd5440c18e72f46d5d12b03d577ffcbe1e22667601c3` | `tower-gauge.webp` | `5154e31dac1ed36b338102f269c731df4eaaa22b9dc5c21393fa9ad149d3293f` | 440906 → 77400 |

The originals remain in `main`'s history at the commits above, so nothing is lost.

Names were changed to ASCII at the same time, matching `web/public/awards/`. The delivered names are
valid on this server, but they have to be percent-encoded in a URL, and one of them contains `・`
(U+30FB); an ASCII path is one less thing to go wrong on a static host. The mapping from band to
file lives in `src/domain/practice/towerAssets.ts`.

## Reproducing the encode

Pillow, in a scratch environment — there is no image dependency in `package.json`, and adding one
for a one-time conversion would tax every install and every CI run:

```python
from PIL import Image

# Scenes: straight re-encode, no resize.
Image.open(src).convert('RGB').save(out, 'WEBP', quality=82, method=6)

# Gauge: crop to the tower, keep the alpha channel.
Image.open(src).convert('RGBA').crop((281, 0, 432, 2172)).save(out, 'WEBP', quality=88, method=6, exact=True)
```

## Where the gauge numbers came from

`TOWER_GAUGE_ART` in `src/domain/practice/towerAssets.ts` carries four percentages. They are not
design choices — they are measurements off `tower-gauge.webp`, and the lit fill and the player
markers are wrong if they drift from it.

They were taken by walking the alpha channel row by row and watching where the silhouette's width
changes. The shaft holds a steady 75 px; the crown and the plinth are wider.

| Landmark | Delivered pixels | Cropped image | Constant |
|---|---|---|---|
| Top of the shaft (under the crown) | y = 130 | 5.99 % | `shaftTopPct` |
| Top of the plinth | y = 2048 | 94.29 % | `shaftBottomPct` |
| Left face of the shaft | x = 320 | 25.83 % | `shaftLeftPct` |
| Right face of the shaft | x = 394 | 74.83 % | `shaftRightPct` |

The climb is mapped linearly onto the span between the plinth and the crown, so 0 floors beaten
lights only the base and a finished climb lights the crown as well. The artwork draws about 48
storeys and the tower has 100 floors; they are deliberately **not** aligned, because a floor is half
a drawn storey and a fill that snapped to stonework would sit still for every other dart.

Replacing the gauge artwork means re-measuring these four numbers. `towerAssets.test.ts` checks they
stay inside the image and in order, but it cannot tell whether they match a new picture.

## How a missing file behaves

Both consumers draw their own fallback, and both are covered by tests:

- `TowerScene` keeps the drawn stairwell underneath the artwork at all times. The photo fades in on
  `load` and is dropped on `error`.
- `TowerGauge` swaps to a stack of storey blocks if the artwork 404s.

This is not only a deploy safety net. The scenery is deliberately **excluded from the service
worker precache** (`globIgnores: ['**/tower/**']` in `vite.config.ts`): 1.2 MB is too much to hold up
an install for every player, including those who never open TOWER. A runtime `CacheFirst` rule
stores each file the first time it is really shown. So a first offline run legitimately has no
artwork, and the drawn fallback is what TOWER looks like then.
