# Deterministic render

Two renders of the same composition on the same machine must produce the same file. That is not
perfectionism - it is what makes the adaptation checkable. Anyone who doubts that your output came
from the plates and the composition rather than from re-encoding someone's video can run the render
and compare. It is also the only reliable way to notice that a plate changed under you.

## The chain

```bash
node scripts/hashes.mjs fonts --accept-font-license   # once, after reading the license
node scripts/hashes.mjs make                          # once, when assets are final
node scripts/render.mjs
```

`render.mjs` runs, in order: verify asset hashes, check FFmpeg is present, lint the composition,
render a PNG sequence into a fresh temporary directory, encode, verify the result, and compare
against the delivered reference if one is configured. Any step failing stops the chain.

Settings live in `adapt.json` (see `templates/adapt.example.json`).

## Why each flag

The render call is deliberately slow:

```
--format png-sequence --quality high --workers 1 --low-memory-mode
--frames-cache-dir off --no-browser-gpu --no-best-effort
```

- **`png-sequence`** - lossless intermediate. Encoding straight to H.264 from the renderer folds
  compression into the capture and makes frame-level comparison meaningless.
- **`--workers 1`** - parallel workers each hold their own browser and their own plate cache. The
  output is usually identical and is not guaranteed to be, and debugging a one-frame difference
  across workers is not worth the minutes saved.
- **`--no-browser-gpu`** - GPU rasterization differs by driver. Software rasterization is the same
  everywhere the browser build is the same.
- **`--frames-cache-dir off`** - a cache hit from a previous version of the composition is the
  quietest possible way to ship a wrong frame.
- **`--no-best-effort`** - fail on a frame that cannot be captured rather than emitting whatever was
  on the canvas. A silent partial render is worse than a stopped one.
- **`--low-memory-mode`** - the plate cache already lives in the page; this keeps the renderer from
  competing with it.

The environment matters too. `PRODUCER_FORCE_SCREENSHOT=true` and
`PRODUCER_EXPERIMENTAL_FAST_CAPTURE=false` keep the capture path on the deterministic branch;
`HYPERFRAMES_NO_TELEMETRY=1` keeps a network call out of the render loop. `render.mjs` sets all
three.

## Fresh work directory

Every render writes frames into a new `mkdtemp` directory and removes it on success. A stale
`frame_000137.png` from an abandoned run silently entering the sequence produces a video with one
wrong frame, which nothing downstream will catch and no one will notice until it ships.

The frame count check exists for the same reason: `frames` in `adapt.json` is asserted against what
the renderer produced, before encoding.

## Encoding

```
-vf scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p
-c:v libx264 -crf 16 -preset medium
-color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709
-x264-params colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv
-movflags +faststart
```

The PNG sequence is full-range RGB. H.264 delivery is limited-range BT.709 YUV. Stating both the
conversion and the resulting tags means no player has to guess, which is what causes the classic
"my render looks washed out compared to the reference" report. Without the explicit `-color_range tv`
and `-colorspace bt709` tags, a correctly converted file can still be displayed wrongly.

The `-x264-params` line is not redundant with the flags above it. FFmpeg's `-color_primaries` and
`-color_trc` do not survive into the H.264 VUI through libx264: probe a file encoded with those
flags alone and both fields read back as `unknown`, leaving two of the four descriptors for a player
to guess after all. Setting them on the encoder writes them. Check your own output rather than
trusting the command line:

```bash
ffprobe -v error -select_streams v:0 \
  -show_entries stream=color_range,color_space,color_primaries,color_transfer \
  -of default=nw=1 output/video.mp4
```

All four should name a value. These tags describe the frames rather than changing them, so adding
them leaves the decoded-frame hash identical - a render made before this line was added still
compares equal to one made after it.

`-crf 16` is visually lossless for graphics content. Flat gradients and hard-edged type are exactly
what H.264 handles worst, so do not economise here; banding in a gradient you spent Phase 2
preserving is a poor trade.

## Audio

```
-c:a copy
```

Never re-encode the reference soundtrack. Copying the packets means the audio in your output is
bit-identical to the audio you started with, which is both better quality and a much clearer
provenance story. `render.mjs` asserts this after the fact by hashing the audio stream of the
output and of the source and requiring them to match.

If the reference audio is not yours to use, do not paper over it - render silent, or bring in a
licensed track through `/media-use`. See `attribution.md`.

Note that the audio stream frequently runs slightly longer than the visual loop. Put the real stream
duration in the composition's `data-duration` for the audio clip and in `audioDuration` in
`adapt.json`; rounding it to the visual duration truncates the tail.

## Verification

`render.mjs verify` asserts:

- dimensions and frame rate match the configuration
- the frame count is exactly what was expected
- the file decodes completely under `ffmpeg -xerror` (catches truncation and corrupt packets)
- the audio stream hash equals the source audio stream hash
- and records the decoded video hash and the file hash in `output/verification.json`

The **decoded video hash** is the useful one to publish. It is computed from decoded frames, so it
is invariant to container details and encoder version, and it still changes if a single pixel
changes. `render.mjs compare` uses it to check a fresh render against a delivered file.

## Asset hashing

```bash
node scripts/hashes.mjs make
node scripts/hashes.mjs check
```

`make` walks the project's assets and pins every file's SHA-256 into `assets-manifest.json`. `check`
verifies them and runs at the top of every render.

The plates are the point. Regenerating them with a different OpenCV or libpng build changes PNG
bytes without changing anything visible, and then a comparison against the delivered video fails for
a reason that has nothing to do with the composition. **The committed plates are the baseline.** A
hash mismatch is the detector working. Rebuild deliberately, look at the result, then re-run `make`
and say in the commit that the baseline moved.

## Fonts

Fonts are declared in the manifest, not committed:

```json
{
  "fonts": {
    "assets/Replacement-Variable.woff2": {
      "sha256": "d1bf80...",
      "source": "https://cdn.example.com/wf/.../file.woff2",
      "license": "https://www.example.com/licenses/..."
    }
  }
}
```

`node scripts/hashes.mjs fonts --accept-font-license` downloads them, verifies the hash, and refuses
to write a file whose bytes changed upstream. Three properties matter:

1. **You are not redistributing the font.** Most webfont licenses permit use and prohibit
   redistribution, and committing a `.woff2` to a public repository is redistribution.
2. **The license is acknowledged explicitly.** The flag is not ceremony - it forces a human decision
   that the terms are acceptable, and it names the license URL when it is missing.
3. **A hash mismatch fails the build.** A substituted font changes every glyph in the render, and it
   does so without any error. This is the one asset where silent fallback is catastrophic rather
   than cosmetic.

Do not add the font to the `files` map. `make` skips declared font paths when walking, so a clean
checkout - where the font is absent by design - still produces a valid manifest.

## What determinism does not promise

Pinned dependencies, hashed assets, and a fixed encode make the render reproducible **on the machine
and browser you recorded**. Across machines, three things still move pixels:

- **Browser version.** Text rasterization and gradient interpolation change between Chrome releases.
- **OS font rasterization.** The same font at the same size hints differently on macOS and Linux.
  Any system fallback font in the composition - a `monospace` in a code sample, for instance -
  varies far more.
- **FFmpeg build.** Different libx264 builds and configurations produce different bytes from
  identical input.

So publish honestly. Ship the verification report and the delivered file, state the environment the
delivered render came from, and say that other platforms may differ. Promise a reproducible
*process*, not a byte-identical MP4 everywhere. A claim of universal byte-identity is one that a
reader can trivially disprove, and it undermines the parts of the provenance story that are true.
