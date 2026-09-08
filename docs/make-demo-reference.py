# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy>=1.26,<3", "opencv-python>=4.10,<5", "pillow>=10,<12"]
# ///
"""Build an original reference video to demo roto on.

Deliberately made of the things roto has to cope with: an animated gradient
with real curvature, a panel that slides and scales, a cursor that travels,
and text sitting on both the gradient and the panel.
"""
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

W, H, FPS, N = 1280, 720, 24, 72
OUT = Path(__file__).parent
FONT = "/System/Library/Fonts/Helvetica.ttc"
bold = ImageFont.truetype(FONT, 84, index=1)
med = ImageFont.truetype(FONT, 34, index=0)
small = ImageFont.truetype(FONT, 30, index=0)

ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)

def gradient(t):
    """Two drifting radial blooms over a base tint. Curved, so a naive
    straight-line fill across it leaves a visible seam."""
    cx1, cy1 = W * (0.24 + 0.16 * np.sin(t * 1.6)), H * (0.30 + 0.12 * np.cos(t * 1.2))
    cx2, cy2 = W * (0.80 - 0.14 * np.cos(t * 1.1)), H * (0.70 + 0.10 * np.sin(t * 1.7))
    d1 = np.sqrt((xs - cx1) ** 2 + (ys - cy1) ** 2) / (W * 0.72)
    d2 = np.sqrt((xs - cx2) ** 2 + (ys - cy2) ** 2) / (W * 0.66)
    b1, b2 = np.clip(1 - d1, 0, 1) ** 1.7, np.clip(1 - d2, 0, 1) ** 1.7
    base = np.dstack([np.full((H, W), 0.99), np.full((H, W), 0.98), np.full((H, W), 0.97)])
    teal = np.dstack([b1 * 0.80, b1 * 0.42, b1 * 0.06])      # BGR
    violet = np.dstack([b2 * 0.62, b2 * 0.20, b2 * 0.44])
    img = np.clip(base - teal * 0.55 - violet * 0.42, 0, 1)
    return (img * 255).astype(np.uint8)

def ease(x):
    return 1 - (1 - x) ** 3

def frame(i):
    t = i / FPS
    img = gradient(t)
    pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    d = ImageDraw.Draw(pil, 'RGBA')

    if i < 30:
        # Title over the moving gradient, settling from an overshoot.
        p = ease(min(1, i / 18))
        d.text((W // 2, 300 - 14 * (1 - p)), "Ship It Faster",
               font=bold, fill=(16, 22, 34, int(255 * p)), anchor="mm")
        d.text((W // 2, 380), "The build tool that keeps up",
               font=med, fill=(70, 82, 100, int(255 * ease(min(1, max(0, i - 6) / 16)))), anchor="mm")
    else:
        # Panel slides in from the right while scaling up, with a cursor
        # travelling toward its button. Both must survive the text removal.
        p = ease(min(1, (i - 30) / 22))
        pw, ph = int(560 * (0.86 + 0.14 * p)), int(160 * (0.86 + 0.14 * p))
        px, py = int(W / 2 - pw / 2 + 150 * (1 - p)), int(H / 2 - ph / 2 + 40)
        d.rounded_rectangle([px, py, px + pw, py + ph], radius=18,
                            fill=(255, 255, 255, 235), outline=(214, 220, 230, 255), width=2)
        d.text((px + 34, py + 44), "Deploy to production",
               font=med, fill=(24, 30, 42, 255), anchor="lm")
        bx, by = px + pw - 150, py + ph - 52
        d.rounded_rectangle([bx, by, bx + 116, by + 38], radius=10, fill=(28, 110, 190, 255))
        d.text((bx + 58, by + 19), "Run", font=small, fill=(255, 255, 255, 255), anchor="mm")
        cp = ease(min(1, max(0, i - 44) / 24))
        cx, cy = int(W * 0.93 - (W * 0.93 - (bx + 58)) * cp), int(H * 0.94 - (H * 0.94 - (by + 19)) * cp)
        d.polygon([(cx, cy), (cx, cy + 26), (cx + 7, cy + 19), (cx + 12, cy + 29),
                   (cx + 17, cy + 26), (cx + 12, cy + 17), (cx + 20, cy + 16)], fill=(15, 15, 15, 255))
    return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)

frames = OUT / "frames"
frames.mkdir(exist_ok=True)
for i in range(N):
    cv2.imwrite(str(frames / f"{i:03d}.png"), frame(i), [cv2.IMWRITE_PNG_COMPRESSION, 3])
print(f"wrote {N} frames at {W}x{H}")
