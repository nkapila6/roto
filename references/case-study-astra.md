# Case study: the ChatGPT adaptation

This workflow was extracted from
[Tejashmakwana/astra-chatgpt-hyperframes](https://github.com/Tejashmakwana/astra-chatgpt-hyperframes),
which adapts a reference animation by Rajmoni (@Nexaabyraj) into a ChatGPT-themed 15-second piece.
Repository code is MIT; the reference media in it is not redistributable and is not vendored here.
Read it alongside this document - it is a complete, runnable instance of every phase.

Numbers below are that project's, and are useful mainly as a sense of scale.

## Shape of the job

15 seconds at 24 fps, 1920x1080, 360 frames. The visual is **two identical 7.5-second loops**, so
only 180 frames were ever authored; the draw loop takes `frame % 180`. The audio runs to 15.0613 s,
slightly past the visuals, and is carried as a single clip at its true duration.

Detecting that loop halved the work. Mean absolute RGB difference between the two cycles was
0.125/255 - the residue of lossy compression, not of different content. That is the number
`analyze_reference.py` reports, and 0.125 against a 2.0 threshold is not a close call.

## Bands

Seven bands over the 180 authored frames:

| Frames | Reference behavior |
| --- | --- |
| 0-21 | Moving blue gradient, left-to-right title reveal, title settling from an overshoot |
| 22-44 | Flat brand blue; original title builds in stages |
| 45-71 | Prompt panel wipes in, zooms gently, drifts right, blurs out |
| 72-106 | Close-up; character-by-character typing, blue caret, focus outline |
| 107-133 | Send button; cursor approaches, clicks, exits |
| 134-160 | Results card settles upward; spinners resolve into checks in sequence |
| 161-179 | Small centred title, soft edge gradient, drifting grid squares |

Two of those bands - 107-133 and 22-44 - carry no replacement text at all. In 107-133 that is the
workflow at its best: the plates play untouched, and the cursor approach, the click, and the
staggered spinner-to-check animation come through exactly as the reference had them. Reproducing
that procedurally is a day's work; here it costs nothing.

Band 22-44 is the same mechanism producing the opposite result, and it is the most useful thing in
this case study. Nothing clears it and nothing draws over it, so for 23 frames - just under a second
of a fifteen-second piece - the delivered video shows the reference designer's own "Ai - powered"
title, in their font, unaltered. Extract frame 30 of `examples/chatgpt-blue.mp4` and it is right
there.

A softer version of the same gap sits in 72-106. That band clears the input row and redraws the
typed line, but never touches the heading above it, so the reference's original heading renders
through. It goes unnoticed because the replacement copy chosen for the neighbouring band happens to
read the same, so the frame looks intentional.

Neither is visible in a contact sheet, because uncleared source lettering looks exactly like
finished design. This is why `build_plates.py` prints a coverage audit and why the guardrail in
SKILL.md asks you to account for every frame. Run the builder against this config and it reports
the 50 unbanded frames immediately.

## Clearing

Four strategies, one per background type:

- **`cubic-hermite`** across `[300, 418, 1600, 692]` with `reach: 30`, for the title over the moving
  2D gradient. This is the band where nothing cheaper works: the gradient has curvature in both
  axes, and a linear blend across 274 pixels of it leaves a visible band.
- **`row-copy`** for the prompt panel's heading and body rows, sourcing from a clean row just
  outside each rectangle. The panel interior is flat, so one scanline is exact.
- **`linear-blend`** for the results card rows and the end-card title, where the card has a gentle
  vertical tint.
- **`patch-copy`** for the corner identity, taking an 86px-tall block from 90 pixels lower at the
  same x. The background there carries a faint grid, which a synthetic fill would flatten into an
  obvious smooth rectangle.

## Tracking

Four trackers, each chosen because the previous one would have failed:

- **`dark-column`** on row 570 for the prompt panel's left border during the zoom. The border is the
  darkest thing on that row within `[200, 1000]`.
- **`colored-column`** on row 555 during the typing close-up, blue minus red. Same element, but at
  this scale the border renders blue rather than dark, and a brightness minimum finds the text
  instead.
- **`top-edge`** on column 1850 for the results card, thresholded at 249 with `offset: -125` so the
  draw loop reads a delta from the resting position rather than an absolute row.
- **`keyframe`** for the panel's scale and heading baseline through the zoom - six measured points
  each, because a zoom has no edge that reports a scale factor.

Plus a **`bbox`** over the original results heading, so the replacement heading lands on the same
baseline as the card settles.

## Composition

One canvas, five draw branches, roughly 40 lines of JavaScript. Techniques used, all covered in
`composition-pattern.md`:

- An animated four-stop linear gradient as the title's fill, its stop positions derived from the
  frame index.
- An off-screen layer with `destination-in` for the left-to-right wipe on frames 0-6.
- `1 + 0.10 * Math.exp(-frame / 3)` for the title's settle.
- `slice(0, floor((frame - 72) * 0.67))` with `measureText` placing the caret, for the typing.
- Blur ramps in and out of the transitions, matching the reference's focus pull.
- A four-entry plate LRU.

## Render and verification

The full deterministic chain: hashed assets, pinned CLI, single worker, GPU off, PNG sequence,
`-crf 16` with explicit BT.709 tagging, audio packets copied. Verification asserts 360 frames at
1920x1080/24, a complete decode, and an unchanged audio stream hash.

One flag in that chain does not do what it appears to. The encode passes
`-color_primaries bt709 -color_trc bt709`, but those do not reach the H.264 VUI through libx264:
probe the delivered file and both fields read back as `unknown`, so two of the four colour
descriptors are still left for a player to guess. `render.mjs` adds `-x264-params` to write them
properly. The tags describe the frames rather than changing them, so this does not alter the
decoded-frame hash and the project's own comparison still holds.

A fresh install and render on the recorded macOS environment reproduced the delivered MP4
**byte for byte**. The project does not claim that for other platforms, and explicitly lists browser
version, OS font rasterization, the system monospace font used in one prompt, and FFmpeg build as
things that legitimately move pixels. That is the right shape for the claim.

## Attribution handling

Worth reading the repository's `THIRD_PARTY.md` directly - it is the model for the template in
`attribution.md`. Four things it gets right:

- Names the original designer and links the source, in the README's second paragraph rather than a
  footer.
- States plainly that this is "a reference-based adaptation, not original motion invented from
  scratch."
- Downloads the font behind an explicit license-acceptance flag and does not commit it.
- Says that attribution does not grant anyone else a license to the reference or its soundtrack.

It also notes that the delivered MP4 is a comparison artifact and is never an input to the render -
the distinction that separates an adaptation from a transcode.

The uncleared bands are worth weighing against that record. The project's attribution is careful and
its provenance story is accurate, and it still ships a second of the reference's own typography
because two bands fell between the clearing config and the draw loop. Good attribution does not
substitute for clearing the frame; they are separate obligations.
