# Plate clearing

A plate is one reference frame with the original lettering gone and everything else untouched. The
whole workflow rests on these: if a plate is wrong, no amount of good typography saves the frame.

Clearing is not inpainting. You are not reconstructing unknown content - you are extending a
background that is *locally continuous* through a rectangle you chose because it is locally
continuous. When that assumption fails, no strategy here helps, and the answer is to change the
layout rather than to fight it.

## Choosing a strategy

Look at the background under the text, ignoring the text itself. Ask what it does vertically across
the rectangle you want to clear.

| It does this | Use | Cost |
| --- | --- | --- |
| Nothing - one flat colour | `row-copy` | One row read |
| Changes at a constant rate | `linear-blend` | Two rows |
| Changes with visible curvature, or is a soft radial or diagonal gradient | `cubic-hermite` | Four rows |
| Is textured, but an identical clean patch exists elsewhere in frame | `patch-copy` | One block copy |
| Is a known brand colour you can name exactly | `solid` | Nothing |

Start with the cheapest one that survives inspection. `cubic-hermite` on a flat field is harmless
but tells you nothing; `linear-blend` on a curve produces a seam that you will chase for an hour
before realising the strategy was wrong.

### `row-copy`

Broadcasts one scanline across the whole rectangle.

```json
{"strategy": "row-copy", "rect": [300, 498, 1500, 582], "sourceRow": 583}
```

`sourceRow` defaults to `y1`, the first clean row below the rectangle. Point it at a row you have
verified is free of glyphs, antialiasing, and any UI element that crosses the region. The classic
failure is choosing a row that passes through the descender of a `g`.

Use this for text sitting inside a panel of flat fill, which is most product-UI references.

### `linear-blend`

Interpolates between the row above the rectangle and the row below it.

```json
{"strategy": "linear-blend", "rect": [785, 330, 1770, 452]}
```

Correct whenever the background's vertical change is a straight ramp over the height of the
rectangle. Cheap, and exact for the common case of a card with a subtle top-to-bottom tint.

It fails on curvature. A blend across a 270px tall region of a radial gradient will be visibly
straight where the source is bowed - a faint horizontal lens across the frame that moves with the
camera and strobes at playback speed.

### `cubic-hermite`

Matches both value and slope at the top and bottom edges, so the fill leaves the surrounding
gradient's curvature intact.

```json
{"strategy": "cubic-hermite", "rect": [300, 418, 1600, 692], "reach": 30}
```

`reach` is how far outside the rectangle the slope is measured, in pixels. 30 is a good default.
Too small and the slope estimate picks up noise and compression blocking; too large and it averages
across a real feature - another UI element, the edge of a card - and bends the fill toward it.

This is the strategy for full-bleed animated gradients, which is what a title card usually sits on.

### `patch-copy`

Copies an equivalent block from elsewhere in the same frame.

```json
{"strategy": "patch-copy", "rect": [20, 18, 310, 104], "from": [20, 108]}
```

The right tool for a static logo or badge over a background with structure - a faint grid, a noise
texture, a repeating pattern - where a synthetic fill would read as a suspiciously smooth hole. Take
the source block from a region with the same structure, usually directly above or below at the same
x, so any horizontal gradient still lines up.

The source block moves with the frame, so this stays correct through a camera move as long as the
source and destination are the same distance apart in every frame.

### `solid`

```json
{"strategy": "solid", "rect": [0, 0, 1920, 200], "color": [8, 102, 245]}
```

Colour is RGB. Only correct when you have confirmed the region really is one value - sample it,
do not assume, because most "flat" brand fields carry a slight gradient or dithering.

## Rectangles

Pad generously. A rectangle tight to the glyph bounding box leaves a rim of antialiased pixels that
reads as a grey ghost of the original word. Four to eight pixels past the visible extent is usually
enough; check the corners of round letters, which extend further than they look.

Do not pad *into* something you need. Every strategy reads pixels just outside the rectangle as its
source, so a rectangle whose edge sits on a border, a card edge, or another element will smear that
element down through the fill. Clear up to a border, not across it.

Where the text sits inside a moving panel, hang the rectangle off the tracked value rather than
fixing it:

```json
{"strategy": "row-copy", "rect": ["promptLeft + 30", 498, "min(1919, promptLeft + 1200)", 582]}
```

Trackers are measured before any clearing in the same frame, so a clear rectangle can reference a
tracker declared in the same band. See `motion-tracking.md`.

## Order

Within a frame the builder applies band clears in config order, then the `global` clears. Later
rectangles overwrite earlier ones. Every strategy reads its source pixels from the **original**
frame, not from the partially cleared plate, so two overlapping rectangles cannot compound each
other's error - but the second one still wins on the overlap. Put the fix you want to survive last.

## Verifying

```bash
uv run scripts/build_plates.py --config regions.json --frames 45:72 --contact-sheet
```

Work one band at a time with `--frames`; a full rebuild to check one rectangle wastes minutes. The
subset limits which plates are rewritten, not which frames are tracked - `assets/tracks.js` is
always regenerated in full, so iterating on one band cannot blank another band's positions.

Then actually look at the output. Three things to look for, in order of how often they bite:

1. **Ghosting** - a faint outline of the original word. The rectangle is too tight. Widen it.
2. **Seams** - a horizontal edge where the fill meets the real background. Wrong strategy for the
   curvature, or `reach` is too small.
3. **Strobing** - invisible in a still, obvious in motion. Play the plates back. A fill that is
   slightly wrong in a way that *changes* frame to frame is far more visible than one that is
   consistently wrong, because the eye tracks the flicker.

The third one is why the contact sheet is not sufficient on its own. Render a quick plates-only
video before building the composition on top:

```bash
ffmpeg -framerate 24 -i assets/plates/%03d.png -c:v libx264 -crf 18 -pix_fmt yuv420p /tmp/plates.mp4
```

## Hard cases

**Text over photographic or video content.** None of these strategies apply - there is no continuous
background to extend. Options, in order of preference: move the replacement copy to a different part
of the frame and clear an easier region; cover the original text with an opaque designed element
(a card, a bar, a shape) that belongs to your design rather than hiding a mistake; or accept that
this reference is not adaptable and say so.

**Text crossing a hard edge.** Split it into two rectangles, one per side, each clearing up to the
edge. Never span the edge with one rectangle.

**Text with a drop shadow or glow.** The shadow extends well past the glyphs and is often too faint
to see at 100% but clearly visible once the background is clean. Pad much harder than feels
necessary, and check on a band where the background is darkest.

**Semi-transparent text.** The background shows through, so clearing removes a tint the rest of the
frame still has. Usually the surrounding element needs clearing wholesale rather than just the
glyphs.

**Text baked into compression artifacts.** On heavily compressed source, the blocking around high
contrast text extends beyond the glyphs and does not disappear with padding alone. Pad to the block
grid - 8 or 16 pixels - rather than to the glyph.

## The band nobody cleared

The worst failure in this phase is not a bad fill. It is a band with no clear regions at all, whose
plates keep the reference's own lettering, and whose draw loop has no branch either. The source
typography renders straight into your output.

Nothing catches this on its own. It does not error, the plates look correct in a contact sheet
because finished design looks like finished design, and it survives review by anyone who did not
watch the reference and the output side by side. The case study in `case-study-astra.md` documents a
published project that ships a second of the original designer's title this way.

So the builder prints a coverage audit - bands with no clear regions, and frames matching no band -
and you check each one against the contact sheet. Two legitimate reasons for a band to clear
nothing: it genuinely has no lettering (a pure animation beat, a cursor move), or it is fully
covered by an opaque element of your own. Anything else is a gap.

## The two-attempt rule

If a region has not cleared cleanly after two honest attempts, stop tuning. The remaining options
are layout changes, not parameter changes, and they need the user's input. Threshold-fiddling past
this point produces plates that look acceptable in stills and fall apart in motion.
