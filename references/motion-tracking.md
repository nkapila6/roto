# Motion tracking

The plates move. Camera drift, panel zooms, cards sliding into place - all of it survives clearing,
because clearing only removes glyphs. Your replacement text has to move with it, exactly, or it
slides against a background that is otherwise perfect. That mismatch is the single most visible
failure mode of this workflow: a viewer who cannot say what is wrong will still see that the text
is not attached to the surface.

Hand-authored positions do not survive this. A camera move that is 3px per frame accumulates 80px
over a band, and easing means it is not linear. Measure the motion out of the source frames.

## Reading a band table

Before tracking, get the bands right. A band is a stretch of frames over which one description of
the motion holds. Good boundaries:

- A hard cut or scene change.
- The moment an element enters or leaves.
- A change in what is moving, even without a cut: a panel that zooms then holds is two bands.

`analyze_reference.py` proposes cuts from inter-frame difference spikes. It finds hard cuts reliably
and misses smooth transitions entirely, because a gentle zoom produces no spike. Look at the contact
sheet and add the boundaries it missed. Over-splitting is cheap - two bands with the same trackers
cost nothing. Under-splitting is expensive, because one tracker will be wrong for half its range.

## Trackers

All trackers read the **original** frame, before clearing, in the same pass. This is why the builder
does both phases at once: the edge you lock onto is often adjacent to the text you are about to
remove, and on the cleared plate it is gone.

### `dark-column` - a vertical border

Darkest pixel along one row, within a search range.

```json
{"name": "promptLeft", "type": "dark-column", "row": 570, "search": [200, 1000]}
```

The workhorse for panel and input borders on light backgrounds. Pick `row` on a stretch of the
border with nothing crossing it: no corner radius, no icon, no text, no cursor. `search` bounds the
answer to the region the element can actually be in, which stops it locking onto a darker element
elsewhere on the row.

### `colored-column` - a coloured border

Largest separation between two channels along a row.

```json
{"name": "left", "type": "colored-column", "row": 555, "search": [300, 1000], "channels": [0, 2]}
```

`channels` are BGR indices; `[0, 2]` is blue minus red, which finds a blue focus ring or accent
border. Use this when the border is coloured rather than dark - a blue line on white is not a
brightness minimum, and `dark-column` will find something else entirely.

For other hues: green minus red is `[1, 2]`, red minus green is `[2, 1]`.

### `top-edge` - a horizontal edge

First row along a column that crosses a brightness threshold.

```json
{"name": "resultOffset", "type": "top-edge", "column": 1850, "search": [80, 350],
 "threshold": 249, "above": true, "offset": -125, "fallback": 125}
```

For a card or panel sliding vertically. `above: true` finds the first row brighter than `threshold`
(a white card arriving over a tinted field); `above: false` finds the first row darker than it.
Choose a column that the card crosses cleanly and that nothing else occupies - well to the side of
any content.

`fallback` is returned when nothing crosses the threshold, which happens on the frames before the
card enters. It must be a sensible resting value, not zero, or the first frames of the band jump.

### `bbox` - the original text's bounds

Threshold a region and take the extremes of what is dark enough.

```json
{"name": "heading", "type": "bbox", "rect": [455, 160, 1200, 243], "limit": 225}
```

Emits `[x0, y0, x1, y1]`. Use it when your replacement copy should sit exactly where the original
sat - same baseline, same left edge - and that position moves. Read `heading[0]` for the left edge
and `heading[3]` for the baseline in the draw loop.

`limit` is the brightness ceiling counted as text. Raise it if antialiased edges are being missed,
lower it if background texture is being counted. Always set `fallback` for the frames where the
text has not appeared yet.

### `keyframe` - values with no edge

```json
{"name": "promptScale", "type": "keyframe", "frames": [45, 50, 53, 60, 66, 71],
 "values": [0.72, 0.8, 0.91, 1.0, 1.02, 1.025], "round": false}
```

Linear interpolation between hand-measured points. This is the honest fallback for anything with no
trackable feature: a scale factor, a baseline that drifts inside a zoom, an opacity ramp.

Measure the values, do not guess them. Open two or three frames per band in an image editor, read
the actual pixel positions, and put those in. Add more keyframes wherever the motion has easing -
the reference is not moving linearly, and four points across an eased move is much better than two.

Set `"round": false` for scales and other fractional values; integer rounding on a 0.72 scale is
catastrophic.

### `constant`

```json
{"name": "baseline", "type": "constant", "value": 513}
```

For a value the draw loop wants uniformly across a band. Keeps the position out of the JavaScript,
so all the measured geometry lives in one file.

## Post-processing

Every numeric tracker accepts, applied in this order:

- `scale` - multiply
- `offset` - add
- `clamp: [lo, hi]` - bound the result
- `round: false` - keep it fractional

`offset` is the useful one: converting an absolute measurement into a delta from a resting position,
so the draw loop reads `y + track.resultOffset` instead of subtracting a magic constant itself.

`clamp` is a safety net for a tracker that occasionally locks onto the wrong feature. It bounds the
damage, but it does not fix the tracker - if it is firing, the scanline is wrong.

## Sanity-checking a track

The tracks file is JSON. Read it:

```bash
python3 -c "
import json, re
raw = open('assets/tracks.js').read().strip()
data = json.loads(re.sub(r'^window\.\w+=|;$', '', raw))
name = 'promptLeft'
series = [(f['frame'], f[name]) for f in data if name in f]
for (a, x), (b, y) in zip(series, series[1:]):
    if abs(y - x) > 12:
        print(f'jump at frame {b}: {x} -> {y}')
print(f'{len(series)} tracked frames, range {min(v for _, v in series)}..{max(v for _, v in series)}')
"
```

What you are looking for:

- **Jumps.** A single-frame spike of tens of pixels means the tracker locked onto a different
  feature on that frame. Almost always the scanline crosses something transient - a cursor, an
  icon fading in, a spinner. Move the scanline.
- **A flat stretch inside a move.** The tracker hit its `search` bound and is pinned. Widen the
  range.
- **Jitter of one or two pixels.** Usually real - compression noise on a soft edge. It is small
  enough to ignore, and smoothing it would fight the plate underneath, which has the same noise.
  Only smooth a track if the text visibly shimmers against a background that does not.

The strongest check is the composite one: build the composition, render the band, and watch whether
the text sits still relative to the panel. Nothing in a number series shows that as clearly.

## When there is nothing to track

Some references move in ways no scanline captures - a rotating element, a perspective shift, a
morphing shape. Three ways out, in order:

1. **Keyframe it.** Most moves in commercial motion design are simple enough that six measured
   points reproduce them within a pixel.
2. **Put the text somewhere still.** Not every replacement has to occupy the same position as the
   original. A headline that sits in a static part of the frame needs no tracking at all.
3. **Reconsider the band.** If a band is genuinely too complex to track, it may be better to cover
   it with a designed element of your own, or to let the reference's own visuals carry it with no
   replacement text.
