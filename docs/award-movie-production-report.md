# n02 Award Movie Production Report

## Series design

All six movies use a shared premium tournament-broadcast language: a deep-black field, precision metallic rings, restrained optical glow, sparse particles, and a protected central clear zone for HTML award typography. No text, score, player name, logo, watermark, sound, voice, music, physical dart, or real tournament identity is embedded.

## Award differentiation

- **LOW TON:** Emerald and brushed silver; restrained hairline trails and sparse particles.
- **HIGH TON:** Royal blue, platinum and subtle violet; controlled radial energy.
- **TON80:** Black and champagne gold; three precision trajectories and a white-hot hero glint.
- **HAT TRICK:** Crimson, garnet and warm gold; three measured concentric pulses.
- **THREE IN THE BLACK:** Obsidian, cool silver and cyan; three precise paths terminate around a dark aperture.
- **BIG FISH:** Deep navy, cobalt and champagne gold; subtle caustics and an abstract large-fish streamline.

## Motion timeline

- 0.000–0.300 s: fade up from black and motif preview.
- 0.300–1.000 s: controlled energy gathering.
- 1.000–1.850 s: hero state.
- 1.850–2.450 s: slow shimmer or secondary pulse.
- 2.450–3.000 s: smooth fade to black.

## Render and encode

AI-generated, text-free key visuals were motion-composited through a deterministic Python/Pillow/NumPy renderer. Exactly 90 RGB frames per award were piped to FFmpeg and encoded as H.264/AVC High Profile, yuv420p, CFR 30 fps, no audio, with `+faststart`. Posters are the 1.600 s hero frame encoded as WebP.

Tools: image generation, Python 3, Pillow, NumPy, FFmpeg 6.1.1, ffprobe, SHA-256.

## Mechanical verification

| Award | MP4 | Poster | Codec / pixel format | FPS | Frames | Duration | Audio |
|---|---:|---:|---|---:|---:|---:|---:|
| LOW TON | 420.0 KiB | 43.0 KiB | H.264 / yuv420p | 30/1 | 90 | 3.000 s | 0 |
| HIGH TON | 454.0 KiB | 85.7 KiB | H.264 / yuv420p | 30/1 | 90 | 3.000 s | 0 |
| TON80 | 454.1 KiB | 81.5 KiB | H.264 / yuv420p | 30/1 | 90 | 3.000 s | 0 |
| HAT TRICK | 438.6 KiB | 67.6 KiB | H.264 / yuv420p | 30/1 | 90 | 3.000 s | 0 |
| THREE IN THE BLACK | 446.2 KiB | 69.1 KiB | H.264 / yuv420p | 30/1 | 90 | 3.000 s | 0 |
| BIG FISH | 463.9 KiB | 68.8 KiB | H.264 / yuv420p | 30/1 | 90 | 3.000 s | 0 |

Total MP4 size: 2676.7 KiB (2740977 bytes).

## Visual QA

Every encoded movie was decoded at frames 0, 15, 30, 48, 72, and 87, corresponding to 0.000, 0.500, 1.000, 1.600, 2.400, and 2.900 seconds. The contact sheet was assembled from these decoded frames (not from source artwork). Inspection confirmed distinct identities, a readable central clear zone, edge-safe composition, restrained flashes, and an elegant final fade.

## Accessibility

Motion uses continuous easing rather than abrupt cuts. There are no strong full-screen flashes; periodic pulses remain below three per second. Award identity is conveyed by palette and geometry together, so color is not the only differentiator. The central zone remains low-detail for overlaid HTML text.

## Known constraints

The movies are opaque MP4 assets and therefore fade to black rather than transparency. They are designed for n02's dark overlay. H.264 chroma subsampling can slightly soften very fine cyan or gold lines; posters retain higher local detail. Award trigger logic (including BIG FISH checkout semantics and Separate/Fat Bull selection) is intentionally outside these media assets and must remain in application code.

## SHA-256

| File | SHA-256 |
|---|---|
| `award-low-ton.mp4` | `36db78da76bf4645c8de9ba0a9fab101b3b997278da89a56843a0bef085e772c` |
| `award-low-ton-poster.webp` | `cac9d68481a8b385f8eab93f7828f851998976975bed1f994c008a2458255cdc` |
| `award-high-ton.mp4` | `def1a0a79f01b5de4ed4e47c7931c3d24979cb4771f2f2f7162765cc70a37c5f` |
| `award-high-ton-poster.webp` | `7e1b6a489786c25aefd4a0acbff82f2d535938680b4c74b739205ee766a959fa` |
| `award-ton80.mp4` | `5e0a8bffebc401082c548c10dc03d6380e0b0888eb056f70cf390f05e9154c36` |
| `award-ton80-poster.webp` | `a78e7ad66dc5057705819fe82b3cf93045660a0c827eaef24668143eb5ee9eb1` |
| `award-hat-trick.mp4` | `511a3ccdcee67c772a258c74643de7b1a9b8a5f079e7a130961956a5636ff57c` |
| `award-hat-trick-poster.webp` | `d84dde905e3bc0def68af8f0a8d8d4a2f077cbeec7b424d5333cc72b8d1e6e24` |
| `award-three-in-the-black.mp4` | `8429d1894e52bf491bd91eaa8c000fa303a8b6242f6d6d151753aff20c26c0a0` |
| `award-three-in-the-black-poster.webp` | `920adc261153f0ffc46484bf6ee2f962013cfe3b46a1f4aa721a46861972cd99` |
| `award-big-fish.mp4` | `dc63380246a0272825c030fa0eb9a5ee20cca7a61099a34b87c3e6a823547810` |
| `award-big-fish-poster.webp` | `28e0ca4c2bec1b0140358c8d7cc62f8fd5fdc7b1437f7afe61206ca212a6e3f8` |
