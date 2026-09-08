// Replacement typography over reference plates. Every frame is a pure function
// of its index: the renderer seeks, it never plays.
const FPS = 24, LOOP = 72, WIDTH = 1280, HEIGHT = 720;
const FACE = '"Helvetica Neue", Helvetica, Arial, sans-serif';

const canvas = document.getElementById('film');
const ctx = canvas.getContext('2d');
const ready = Promise.resolve();
const clamp = x => Math.max(0, Math.min(1, x));
const ease = x => 1 - Math.pow(1 - x, 3);

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

function type(text, x, y, size, color, align = 'left', weight = 400, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `${weight} ${size}px ${FACE}`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

async function drawFrame(time) {
  await ready;
  const f = Math.max(0, Math.round(time * FPS)) % LOOP;
  const track = window.referenceTracks[f];
  const img = await plate(f);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.drawImage(img, 0, 0);

  if (f < 30) {
    // Same settle-from-overshoot the reference had, recomputed from the index.
    const p = ease(Math.min(1, f / 18));
    type('Hey, Nikhil here', 640, 330 - 14 * (1 - p), 78, '#101622', 'center', 700, p);
    type('Welcome to roto', 640, 392, 34, '#465264', 'center', 400,
      ease(clamp((f - 6) / 16)));
  } else if (track.label) {
    // Rides the panel: position comes from the measured bounds of the text
    // that used to be there, so it slides and settles exactly as it did.
    type('Powered by roto', track.label[0], track.label[1] + 25, 34, '#181e2a');
  }
}

window.addEventListener('hf-seek', event => {
  const promise = drawFrame(event.detail.time);
  event.detail.waitUntil?.(promise);
});
window.drawFrame = drawFrame;
void drawFrame(0);
