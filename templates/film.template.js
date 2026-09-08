// Replacement typography over reference plates.
//
// Contract: drawFrame(time) must paint a complete frame from the time value
// alone. The renderer seeks; it never plays. Any state carried between calls
// is a bug that shows up only in the render, never in preview.
const FPS = 24;
const LOOP = 180;          // authored frames; the composition may run several cycles
const WIDTH = 1920;
const HEIGHT = 1080;

// Swap for your own family once its @font-face is uncommented in index.html.
const FACE = '"Helvetica Neue", Helvetica, Arial, sans-serif';

const canvas = document.getElementById('film');
let ctx = canvas.getContext('2d');

// Scratch layer for anything needing its own mask. Compositing a wipe with
// 'destination-in' on the main context would erase the plate under it.
const layer = document.createElement('canvas');
layer.width = WIDTH;
layer.height = HEIGHT;

const clamp = x => Math.max(0, Math.min(1, x));

// Awaited at the top of every frame. A frame drawn before the font resolves
// falls back to a system face and is silently wrong.
// Await this at the top of every frame. A frame drawn before the face resolves
// falls back to a system font at different metrics, and the failure shows up on
// a handful of early frames rather than throwing. System faces need no load, so
// this is an already-resolved promise until you add a webfont.
const ready = FACE.includes('Replacement')
  ? Promise.all([document.fonts.load(`400 100px ${FACE}`), document.fonts.load(`600 100px ${FACE}`)])
  : Promise.resolve();

// Bounded LRU. 180 decoded 1920x1080 bitmaps will not fit in the render
// worker; zero cache re-decodes a PNG on every seek.
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

function type(text, x, y, size, color = '#202020', align = 'left', weight = 400, blur = 0, maxWidth) {
  ctx.save();
  ctx.font = `${weight} ${size}px ${FACE}`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.filter = blur ? `blur(${blur}px)` : 'none';
  if (maxWidth) ctx.fillText(text, x, y, maxWidth);
  else ctx.fillText(text, x, y);
  ctx.restore();
}

function gradient(x0, x1, from, to) {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, from);
  g.addColorStop(1, to);
  return g;
}

async function drawFrame(time) {
  await ready;
  const frame = Math.max(0, Math.round(time * FPS)) % LOOP;
  const track = window.referenceTracks[frame];
  const img = await plate(frame);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.drawImage(img, 0, 0);

  // One branch per band from docs/frame-analysis.md. Positions come from
  // `track`, never from a hand-counted frame number, wherever the reference
  // element moves.
  if (frame < 22) {
    // Masked reveal: draw onto the scratch layer, mask it, then composite.
    const main = ctx;
    ctx = layer.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    type('Your headline', 960, 640, 237, '#ffffff', 'center', 600, Math.max(0, 7 - frame * 1.5), 1310);

    if (frame < 7) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-in';
      const edge = 580 + frame * 185;
      const mask = ctx.createLinearGradient(edge - 180, 0, edge + 150, 0);
      mask.addColorStop(0, 'black');
      mask.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = mask;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.restore();
    }
    ctx = main;
    ctx.drawImage(layer, 0, 0);

  } else if (frame >= 45 && frame < 72) {
    // Tracked element: every coordinate derives from the measured panel.
    const center = track.promptLeft + 660 * track.promptScale;
    ctx.save();
    ctx.globalAlpha = clamp((frame - 45) / 8);
    type('Your subheading', center, track.headingY, 54 * track.promptScale, '#171a1b', 'center');
    ctx.restore();

  } else if (frame >= 72 && frame < 107) {
    // Per-character reveal, derived from the frame index so it is seek-safe.
    const x = track.left + 85;
    const shown = Math.max(0, Math.floor((frame - 72) * 0.67));
    const text = 'Typed line of copy'.slice(0, shown);
    type(text, x, 513, 72, '#181a1b');

    ctx.save();
    ctx.font = `400 72px ${FACE}`;
    const width = ctx.measureText(text).width;
    ctx.fillStyle = '#40a2d4';
    ctx.fillRect(x + width + 12, 457, 8, 65);   // caret
    ctx.restore();
  }
}

// The renderer will capture whatever is on the canvas when the seek settles.
// waitUntil is how an async draw tells it to wait; without it, plates and
// fonts land a frame late or not at all.
window.addEventListener('hf-seek', event => {
  const promise = drawFrame(event.detail.time);
  event.detail.waitUntil?.(promise);
});

window.drawFrame = drawFrame;
void drawFrame(0);
