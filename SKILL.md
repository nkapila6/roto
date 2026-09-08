---
name: roto
description: >
  Adapt an existing reference video into an editable HyperFrames composition by preserving its
  original motion. Use when the user supplies a video and wants their own text, brand, or product
  in it: "recreate this ad with our copy", "swap the text in this animation", "make our version of
  this motion design", "reproduce this reference frame-accurately", "I have an MP4, put our
  headlines on it". The reference's real gradients, camera moves, cursor, and UI animation are kept
  as text-cleared background plates; only the typography is re-authored in JavaScript, so it stays
  editable and re-renders deterministically. Not for animating from scratch (use /motion-graphics or
  /general-video), not for captioning untouched footage (/embedded-captions), and not for overlaying
  graphics on talking-head video (/talking-head-recut).
---

# Reference-plate adaptation

Some motion design is not worth re-deriving. When a reference video already has the exact gradient
ramp, camera drift, cursor path, and easing the user wants, re-animating it from scratch produces a
worse approximation at ten times the cost. This workflow keeps the reference's pixels as the moving
background and replaces only the lettering.

**The trade:** you inherit the reference's motion exactly, and you give up the ability to change it.
Timing, camera, and layout are frozen at the reference's frame grid. Only what you clear can be
re-authored. If the user wants different pacing or a different layout, this is the wrong workflow -
route to `/general-video`.

## When this workflow applies

| Situation | Use this? |
| --- | --- |
| User supplies a reference MP4 and wants their own copy in it | Yes |
| Reference motion is complex (gradients, 2.5D camera, cursor, spinners) and worth preserving | Yes |
| Text sits on backgrounds that are locally continuous, so it can be cleared cleanly | Yes |
| Text sits on busy photographic detail that would need real inpainting | Marginal - see `references/plate-clearing.md` § Hard cases |
| User wants new timing, new layout, or new scenes | No - `/general-video` |
| User wants captions burned onto footage they keep as-is | No - `/embedded-captions` |
| Nothing to preserve; the idea is described in words | No - `/motion-graphics` or `/faceless-explainer` |

## Phase 0 - Rights gate (blocking)

Run this **before decoding a single frame**. The output of this workflow is derived from someone
else's artwork, and the derivation is visible in every frame.

Establish, and record the answers in `THIRD_PARTY.md`:

1. **Who made the reference**, and how the user obtained it. A public tweet is not a license.
2. **What permission exists.** The user owns it, commissioned it, licensed it, or has the author's
   explicit go-ahead. "It's for internal use" and "it's just a study" are not permission to publish.
3. **The soundtrack, separately.** Audio is almost never covered by permission to adapt the
   visuals: the original designer licensed that track for their piece, not for yours. This is a
   decision to put to the user, not one to make silently in either direction - a silent render is
   as much a surprise as an unlicensed one. See § Choosing the soundtrack below.
4. **Fonts.** Reference fonts are not redistributable. See Phase 5's font policy.
5. **Trademarks in the reference.** Remove the original brand identity; do not silently transplant it.

If any answer is missing, say so plainly and stop. Offer the alternative: build an original
composition in the same *style* through `/general-video`, which needs no rights to the reference.

If the user confirms permission, proceed and write `THIRD_PARTY.md` from the template in
`references/attribution.md`. Credit the original designer in the README even when permission is
explicit - the motion is theirs.

## Project layout

The scripts are project-local, so a published adaptation carries the exact code that built it.
Copy them in once:

```bash
mkdir -p <project>/{scripts,assets,docs,reference}
cp <skill>/scripts/*        <project>/scripts/
cp <skill>/templates/regions.example.json <project>/regions.json
cp <skill>/templates/adapt.example.json   <project>/adapt.json
cp <skill>/templates/index.template.html  <project>/index.html
cp <skill>/templates/film.template.js     <project>/film.js
```

Then the project looks like this, and every command below runs from its root:

```
reference/original.mp4     the supplied reference, never a render input
regions.json               Phase 2 + 3 config: clear regions and trackers
adapt.json                 Phase 5 config: dimensions, fps, audio, output
assets/plates/*.png        text-cleared frames, one per authored frame
assets/tracks.js           measured per-frame positions
soundtrack.json            which track, under which licence, with what credit
index.html  film.js        the composition
assets-manifest.json       pinned asset hashes
docs/                      frame-analysis.md, contact-sheet.jpg, analysis.json
```

The Python scripts declare their own dependencies inline, so `uv run` needs no environment setup.

## Choosing the soundtrack

Ask the user, once, before Phase 5. Never default silently.

```bash
node scripts/soundtrack.mjs list
```

That prints two things. First a catalogue of sources - Musopen, Incompetech, Pixabay, Free Music
Archive, ccMixter, Freesound, the Internet Archive, Uppbeat, Openverse - with each one's licence,
whether attribution is required, and whether the licence is set per track. Then a shortlist of
**ready-to-fetch tracks**, each already verified and hash-pinned:

| Track | Licence | Length |
| --- | --- | --- |
| `odyssey` - Odyssey, Kevin MacLeod | CC BY 3.0, credit required | 5:06 |
| `lucid-coma` - Lucid Coma, Kevin Hartnell | CC BY 4.0, credit required | 2:53 |
| `cha-cha-loop` - 126 cha cha loop, Bauchamp | CC0 | 0:27 |
| `clair-de-lune` - Clair de Lune, Debussy 1905 roll | Public domain | 4:36 |
| `casio-mt40` - Casio MT-40 drum pattern | Public domain | 0:19 |

```bash
node scripts/soundtrack.mjs fetch odyssey
```

downloads it, checks it against the pinned SHA-256, transcodes to AAC if needed, trims it to the
composition duration, wires the clip, and writes the credit. Present the realistic options and let
the user pick:

| Option | When it fits |
| --- | --- |
| A track from the catalogue | The usual answer. Confirm the specific track's licence on its page. |
| Generated for this project | No licence hunt; route through `/media-use`. |
| The user's own or separately licensed track | They already hold rights that cover the platforms they will publish on. |
| Silent | Rights unclear, or the piece works without music. Always available, never wrong. |
| The reference's own soundtrack | Only where rights are genuinely established, or for a local artifact that will not be published. Flagged by the tool. |

For anything not on that shortlist, wire it with one command, which copies the file into `assets/`,
probes its true duration, sets the clip in `index.html` and `audioDuration` in `adapt.json`, and
writes the attribution record:

```bash
node scripts/soundtrack.mjs use <source> --file <path> --title "..." --artist "..." --url "..."
node scripts/soundtrack.mjs use silent
node scripts/soundtrack.mjs status
```

It refuses a per-track-licensed source without the track URL you read the licence on, and refuses an
attribution-required source without the credit details - attribution you cannot reconstruct later is
attribution you will not give. Paste the printed line into `THIRD_PARTY.md`.

Three things bite if you wire audio by hand instead:

- **Codec.** FFmpeg will mux Vorbis or Opus into an MP4 without complaint, and the result plays in
  neither Safari nor QuickTime. `-c:a copy` succeeding is not evidence the audio is usable. Anything
  that is not already AAC or MP3 should be transcoded once, into the asset.
- **Length.** A five-minute track under a fifteen-second piece leaves the container running long
  after the last video frame. Trim the asset rather than passing `-shortest` at encode time, so the
  asset and the output's audio stay identical and the packet-hash check still means something.
- **Ownership.** The audio must be a declared clip the framework plays, never something `film.js`
  calls `play()` on; and the clip duration must be the real stream duration, which routinely
  outruns the visual loop by a fraction of a second.

## Phase 1 - Analyze the reference

```bash
uv run scripts/analyze_reference.py reference/original.mp4 --out docs/
```

This decodes every frame, reports dimensions and fps, searches for a loop point by mean absolute
RGB difference, and emits:

- `docs/frame-analysis.md` - a scene-band table: frame range, timecode, and what the reference does
  in that range. Fill in the behavior column yourself after looking at the contact sheet; the script
  proposes cut points from inter-frame difference spikes, it does not understand the content.
- `docs/contact-sheet.jpg` - a grid of sampled frames.
- `docs/analysis.json` - machine-readable bands, loop length, and per-frame difference series.

**Loops are the big win.** Many social-format references are one visual loop repeated. If the
analyzer reports a loop, you build and clear only the first cycle and modulo the frame index at
draw time - half the plates, half the tracking, identical output.

The scene bands you settle on here become the branches of your draw function in Phase 4 and the
region sets in Phase 2. Get them right before moving on. Read `references/motion-tracking.md`
§ Reading a band table for what makes a good band boundary.

## Phase 2 - Clear the text into plates

A **plate** is one reference frame with the original lettering removed and everything else intact.
Plates are PNG, lossless, one per frame of the loop.

Author `regions.json`: for each scene band, the rectangles to clear and the strategy for each.
Start from `templates/regions.example.json`. Then:

```bash
uv run scripts/build_plates.py --config regions.json --out assets/plates/
```

Strategy choice is the whole craft of this phase. The four that cover almost everything:

| Background under the text | Strategy | Why |
| --- | --- | --- |
| Flat or near-flat colour | `row-copy` | Copy one clean scanline across the region. Cheapest, exact. |
| Linear vertical ramp | `linear-blend` | Interpolate between the rows just above and just below. |
| Smooth 2D gradient with curvature | `cubic-hermite` | Match value *and* slope at both edges, so no visible seam. |
| Static logo or badge over texture | `patch-copy` | Copy an equivalent clean region from elsewhere in the frame. |

Full decision procedure, parameters, and the hard cases are in `references/plate-clearing.md`.

The builder also reports a **coverage audit**: bands that declare no clear regions, and frames that
match no band at all. Read it. A band nobody cleared keeps the reference's own typography, and since
the draw loop has no branch for it either, that lettering renders into your output looking like
finished design that simply is not yours. The audit cannot know whether a band legitimately has no
text, so confirm each one against the contact sheet rather than dismissing it.

**Verify every plate before trusting it.** Run the builder with `--contact-sheet` and look. A seam
you cannot see at 100% will strobe at 24 fps because it moves with the camera. Common tells: a
horizontal band edge where `linear-blend` met a curved gradient, and ghosting where the cleared
rectangle was too tight and left antialiased text pixels at the border. Pad clear rectangles by
several pixels beyond the visible glyph bounds.

## Phase 3 - Measure the motion

The plates move. Your text has to move with them, and eyeballing per-frame positions does not
survive a camera drift. Measure them from the source frames instead.

Trackers are declared per band in the same `regions.json` and emitted by the same builder into
`assets/tracks.js` as `window.referenceTracks` - one object per frame, keyed by frame index.

| What you need to follow | Tracker |
| --- | --- |
| A vertical border or panel edge | `dark-column` / `colored-column` - argmin/argmax along one scanline |
| A card or panel that slides vertically | `top-edge` - first row crossing a brightness threshold |
| The bounds of the original text itself | `bbox` - threshold the region, take the extremes |
| A scale or value with no visual edge to lock to | `keyframe` - hand-set values at band ends, interpolated |

Scan on a row or column that stays *inside* the element for the whole band, and away from the text
you are about to clear. Measure on the **original** frame, never the cleared plate - clearing
destroys the thing you are tracking. `references/motion-tracking.md` has the scanline selection
procedure and how to sanity-check a track for jitter.

## Phase 4 - Compose

One canvas, sized to the reference, sitting in a HyperFrames composition. Read `/hyperframes-core`
for the `data-*` timing contract before writing the HTML; `templates/index.template.html` is a
minimal conforming shell.

`templates/film.template.js` is the draw loop. Its shape:

```js
async function drawFrame(time) {
  await ready;                                   // fonts resolved before first paint
  const f = Math.round(time * FPS) % LOOP;       // modulo the loop
  const track = window.referenceTracks[f];
  ctx.drawImage(await plate(f), 0, 0);           // plate first, always
  if (f < 22)        { /* band 1 typography */ }
  else if (f < 72)   { /* band 2 */ }
  // ...
}
window.addEventListener('hf-seek', e => e.detail.waitUntil?.(drawFrame(e.detail.time)));
```

Four rules that make it render correctly rather than merely look right in preview:

- **Every frame is drawn from scratch.** No state carried between frames, no accumulation. The
  renderer seeks; it does not play. A frame must be reproducible from its index alone.
- **`waitUntil` is mandatory.** Plate loading and font loading are async. Without handing the
  promise back to the seek event, the renderer captures a blank or stale canvas.
- **Cache plates, but bounded.** An LRU of about four entries. Holding 180 decoded 1920x1080
  bitmaps exhausts memory mid-render; holding none re-decodes every frame.
- **Composite text off-screen when it needs its own mask.** Gradient-masked reveals and wipes need
  `destination-in` on a scratch canvas, not on the main context, or you erase the plate.

`references/composition-pattern.md` covers the cache, the off-screen mask pattern, gradient text
fills, per-character typing reveals, and blur-in transitions.

## Phase 5 - Render deterministically

Two renders of the same composition must produce the same file. That is what makes the adaptation
checkable by someone else, and it is what catches an accidental edit.

```bash
node scripts/hashes.mjs make          # after assets are final
node scripts/render.mjs               # check -> lint -> render -> encode -> verify
```

`render.mjs` runs the full chain: verify asset hashes, lint the composition, render a PNG sequence
single-worker with GPU off, encode H.264 with an explicit BT.709 conversion, copy the audio packets
rather than re-encoding, then probe the result for frame count, dimensions, rate, full decode, and
an unchanged audio hash. See `/hyperframes-cli` for the render flags themselves.

**Font policy.** Never commit a font you did not license for redistribution. Pin its SHA-256 in the
manifest and download it at setup time behind an explicit `--accept-font-license` flag, the way
`references/deterministic-render.md` § Fonts describes. A font hash mismatch must fail the build,
not silently substitute - a substituted font changes every glyph in the render.

**What determinism does and does not promise.** Pinned dependencies and hashed assets make the
composition reproducible. Browser version, OS font rasterization, and FFmpeg build still move
individual pixels across machines. Promise a reproducible *process* and ship the verification
report; do not promise a byte-identical MP4 on every platform.

## Guardrails

- **Do not use the reference video as render input.** It is the source for plates and the artifact
  you compare against. If it ends up in the render path, you have transcoded someone's video and
  called it your own.
- **Do not regenerate plates casually once the manifest is written.** Different OpenCV or libpng
  versions change PNG bytes. The committed plates are the baseline; hash mismatch is the detector
  working, not a bug to paper over.
- **Do not claim procedural recreation.** The output preserves source pixels. Say so in the README.
  Changed typography also means the frame can never be pixel-identical to the reference - do not set
  that as the success bar.
- **Account for every frame.** Before rendering, check each band either clears something or
  demonstrably has no source lettering. The failure is silent in both directions: nothing errors,
  and the frames look designed.
- **Stop after two failed clears of the same region.** If a region will not clear cleanly, the
  honest options are to move the new text elsewhere, cover the region with an opaque designed
  element, or tell the user this reference is not adaptable. Do not keep tuning thresholds.

## Delegation

| Need | Skill |
| --- | --- |
| Composition contract, `data-*` timing, tracks, validation | `/hyperframes-core` |
| Render, lint, preview, publish flags and failure diagnosis | `/hyperframes-cli` |
| Generating a track, TTS, colour grade | `/media-use` |
| Typography and palette decisions for the replacement copy | `/hyperframes-creative` |
| Motion for elements you add on top of the plates | `/hyperframes-animation` |
| User wants different timing or layout after all | `/general-video` |

## Worked example

`references/case-study-astra.md` walks the ChatGPT adaptation this workflow was extracted from:
180 plates from a 7.5-second loop, four clearing strategies, four trackers, five draw bands, and a
byte-identical re-render on the recorded environment.
