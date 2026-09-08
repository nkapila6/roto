# Composition pattern

The composition is one canvas the size of the reference, inside a HyperFrames project. `film.js`
owns every pixel in it. Read `/hyperframes-core` for the `data-*` timing contract; this document
covers only what is specific to drawing over plates.

`templates/index.template.html` and `templates/film.template.js` are the starting point.

## The one rule

**Every frame is a pure function of its index.** The renderer seeks to arbitrary times, out of
order, possibly in parallel across workers. It does not play the composition forward.

So: no variables mutated between frames, no counters, no "previous position", no `requestAnimationFrame`,
no `setTimeout`, no `Date.now()`, no `Math.random()` unless seeded from the frame index. A typing
effect is `Math.floor((frame - start) * rate)` characters, never a character appended per call.

This is the rule that separates a composition that previews correctly from one that renders
correctly. Everything below is a consequence of it.

## `hf-seek` and `waitUntil`

```js
window.addEventListener('hf-seek', event => {
  const promise = drawFrame(event.detail.time);
  event.detail.waitUntil?.(promise);
});
```

`drawFrame` is async - it awaits fonts and plate decoding. Without `waitUntil`, the renderer
captures the canvas as soon as the handler returns, which is before anything has been drawn. The
symptom is a render where frames are blank, or lag the correct content by one, while preview looks
perfect because preview is slow enough for the promise to settle on its own.

The optional-call `?.` matters: the same file runs under `hyperframes preview`, where the detail may
not carry `waitUntil`.

Call `drawFrame(0)` once at the end of the file so the canvas is not blank before the first seek.

## The plate cache

```js
const cache = new Map();
async function plate(frame) {
  if (cache.has(frame)) return cache.get(frame);
  const img = new Image();
  img.src = `assets/plates/${String(frame).padStart(3, '0')}.png`;
  await img.decode();
  cache.set(frame, img);
  if (cache.size > 4) cache.delete(cache.keys().next().value);
  return img;
}
```

Bounded, deliberately. A 1920x1080 decoded bitmap is about 8 MB; 180 of them is 1.5 GB, which will
take the render worker down partway through a sequence, usually with an unhelpful error. Four is
enough to absorb the renderer's small out-of-order jitter without holding memory.

`await img.decode()` rather than an `onload` handler: `decode()` resolves when the bitmap is ready
to draw, `load` resolves earlier, and drawing between the two produces an empty frame.

## Plate first, always

```js
ctx.setTransform(1, 0, 0, 1, 0, 0);
ctx.clearRect(0, 0, WIDTH, HEIGHT);
ctx.drawImage(img, 0, 0);
```

Reset the transform explicitly at the top of every frame. A `ctx.scale()` left over from a `save()`
without a matching `restore()` in one branch will silently corrupt every subsequent frame, and
because the renderer reuses the context across seeks, the corruption is order-dependent and
maddening to reproduce.

`clearRect` before the plate, even though the plate is opaque and covers everything: it costs
nothing and it makes the frame genuinely independent of what was there before.

Never scale the plate. Canvas backing store, CSS size, and `data-width`/`data-height` must all be
the reference's native dimensions. Any mismatch resamples the plate, which softens the exact detail
you went to this trouble to preserve.

## Masks need their own layer

Wipes, reveals, and gradient-masked text use `globalCompositeOperation`, which affects the entire
context. Applying `destination-in` to the main context erases the plate.

```js
const layer = document.createElement('canvas');
layer.width = WIDTH;
layer.height = HEIGHT;

// inside drawFrame, for a band that needs a mask:
const main = ctx;
ctx = layer.getContext('2d');
ctx.setTransform(1, 0, 0, 1, 0, 0);
ctx.clearRect(0, 0, WIDTH, HEIGHT);

type('Your headline', 0, 91, 237, fill, 'center', 600);

ctx.save();
ctx.globalCompositeOperation = 'destination-in';
const edge = 580 + frame * 185;
const mask = ctx.createLinearGradient(edge - 180, 0, edge + 150, 0);
mask.addColorStop(0, 'black');
mask.addColorStop(1, 'rgba(0,0,0,0)');
ctx.fillStyle = mask;
ctx.fillRect(0, 0, WIDTH, HEIGHT);
ctx.restore();

ctx = main;
ctx.drawImage(layer, 0, 0);
```

Swapping the module-level `ctx` binding rather than threading a context parameter through every
helper keeps `type()` and friends unchanged. Reset the layer's transform and clear it every frame -
it is as stateful as the main canvas.

Create the layer once at module scope. Allocating a 1920x1080 canvas per frame is slow enough to
matter across a few hundred frames.

## Fonts

```js
const ready = Promise.all([
  document.fonts.load('400 100px Replacement'),
  document.fonts.load('600 100px Replacement'),
]);
```

Load every weight you draw with, and `await ready` at the top of `drawFrame`. A frame drawn before
the face resolves falls back to a system font, at different metrics, and the failure appears on a
handful of early frames rather than throwing.

Always give `ctx.font` a fallback family (`'Replacement, Arial'`). It does not save a frame drawn
too early, but it makes the failure look like a font problem instead of invisible text.

## Techniques over plates

**Gradient fills that animate.** Build the gradient per frame from the frame index. A colour stop
whose position derives from `frame` gives you a sweep across the letterforms without any mask.

```js
const g = ctx.createLinearGradient(-655, 0, 655, 0);
const blueAt = clamp(0.56 + frame * 0.031);
g.addColorStop(0, '#010409');
g.addColorStop(Math.max(0.01, blueAt - 0.35), '#081628');
g.addColorStop(Math.min(0.99, blueAt), '#146cb2');
g.addColorStop(1, '#184c68');
```

Clamp every computed stop position into `(0, 1)` and keep them monotonic - an out-of-order stop
throws, and it will throw on exactly one frame in the middle of a render.

**Blur-in.** `ctx.filter = 'blur(Npx)'` with N derived from the frame index. Cheap, and it matches
the focus-pull most references open on. Note that `filter` is not reset by `fillStyle` changes -
set it inside the same `save()`/`restore()` as everything else.

**Per-character reveal.** `text.slice(0, Math.floor((frame - start) * rate))`. Measure the drawn
substring with `ctx.measureText()` to place a caret after it, so the caret tracks the real advance
width rather than an estimate.

**Settling scale.** `1 + amplitude * Math.exp(-frame / tau)` reproduces the overshoot-and-settle of
most title entrances in a single expression, and it is a pure function of the frame index.

**Alpha ramps.** `clamp((frame - start) / length)` for a fade in. Set `globalAlpha` inside a
`save()`/`restore()` pair, never bare.

## Matching the plate's look

The replacement text has to sit in the same image as the reference, which was encoded, compressed,
and colour-graded. Freshly drawn canvas text is cleaner than everything around it, and that reads
as pasted on.

Three things usually close the gap:

- **Sample real colours from the plate.** Do not use your brand's hex. Open a plate, sample the
  colour the original text actually was, and use that. The reference's grade is already baked into
  that value.
- **Match the weight, not the family.** You will not have the reference's font, and you should not
  try to. Match its optical weight and width at the size it appears; a lighter face at the same
  nominal weight will read as a different design.
- **Blur slightly on the frames where the reference is blurred.** A focus pull that affects the
  background but not the text is immediately wrong.

For type and palette decisions on the replacement copy itself, use `/hyperframes-creative`.

## Checking the composition

```bash
npx hyperframes lint .          # structure and timing contract
npx hyperframes preview .       # scrub it by hand
```

Scrub, do not play. Playing hides exactly the bugs this pattern exists to prevent, because playing
walks frames in order and lets stale state look correct. Jump to a frame in the middle of a band,
then jump backwards, and check the frame is identical both times.

See `/hyperframes-cli` for the rest of the CLI.
