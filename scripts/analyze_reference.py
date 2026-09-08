# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy>=1.26,<3", "opencv-python>=4.10,<5"]
# ///
"""Decode a reference video, find its loop, and propose scene bands.

Phase 1 of roto. Emits a contact sheet to look at, a band table
to fill in, and analysis.json for the later phases. The cut points come from
inter-frame difference; the meaning of each band is yours to write.

    uv run analyze_reference.py reference/original.mp4 --out docs/
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np

# Everything below runs on downsampled grayscale. Full-res comparison costs
# minutes and changes no decision this script makes.
THUMB = (160, 90)


def load(path, limit):
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise SystemExit(f"cannot open {path}")
    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    thumbs, keep = [], []
    while len(thumbs) < limit:
        ok, frame = cap.read()
        if not ok:
            break
        thumbs.append(cv2.cvtColor(cv2.resize(frame, THUMB), cv2.COLOR_BGR2GRAY).astype(np.int16))
        keep.append(frame)
    cap.release()
    if not thumbs:
        raise SystemExit("no frames decoded")
    return np.stack(thumbs), keep, fps, width, height


def find_loop(thumbs, min_len):
    """Smallest L where frame i and frame i+L agree across the whole overlap."""
    n = len(thumbs)
    best = None
    for length in range(min_len, n // 2 + 1):
        score = float(np.abs(thumbs[:-length] - thumbs[length:]).mean())
        if best is None or score < best[1]:
            best = (length, score)
    if best is None:
        return None
    length, score = best
    # 2.0/255 comfortably separates a real loop from codec noise; a genuine
    # repeat on lossy source lands near 0.1, an unrelated pairing near 20.
    return {"length": length, "meanAbsDiff": round(score, 4), "confident": score < 2.0}


def find_bands(thumbs, sensitivity):
    diffs = np.abs(np.diff(thumbs.astype(np.int32), axis=0)).mean(axis=(1, 2))
    # Median + MAD rather than mean + std: the cuts we are looking for are
    # themselves large enough to inflate the standard deviation past their own
    # magnitude, so a mean-based threshold hides everything but the biggest one.
    median = float(np.median(diffs))
    mad = float(np.median(np.abs(diffs - median)))
    threshold = median + sensitivity * (mad if mad > 1e-6 else diffs.std() or 1.0)
    cuts = [0]
    for i, d in enumerate(diffs, start=1):
        # Minimum band length suppresses the cluster of spikes a single hard
        # cut produces across its motion-blurred frames.
        if d > threshold and i - cuts[-1] >= 6:
            cuts.append(i)
    cuts.append(len(thumbs))
    return [(cuts[i], cuts[i + 1]) for i in range(len(cuts) - 1)], diffs


def contact_sheet(frames, path, columns, count):
    picks = np.linspace(0, len(frames) - 1, min(count, len(frames))).astype(int)
    cells = []
    for index in picks:
        cell = cv2.resize(frames[index], (320, 180))
        cv2.rectangle(cell, (0, 158), (60, 180), (0, 0, 0), -1)
        cv2.putText(cell, str(index), (5, 175), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        cells.append(cell)
    rows = []
    for i in range(0, len(cells), columns):
        row = cells[i:i + columns]
        while len(row) < columns:
            row.append(np.zeros_like(cells[0]))
        rows.append(np.hstack(row))
    cv2.imwrite(str(path), np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 88])


def timecode(frame, fps):
    return f"{frame / fps:.4f}" if fps else "?"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("--out", default="docs", help="output directory (default: docs)")
    ap.add_argument("--max-frames", type=int, default=3000, help="decode cap")
    ap.add_argument("--min-loop", type=int, default=24, help="shortest loop to consider")
    ap.add_argument("--sensitivity", type=float, default=12.0,
                help="band cut threshold, in median absolute deviations above the median")
    ap.add_argument("--sheet-columns", type=int, default=6)
    ap.add_argument("--sheet-frames", type=int, default=36)
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    thumbs, frames, fps, width, height = load(args.video, args.max_frames)
    if len(frames) == args.max_frames:
        print(f"warning: stopped at --max-frames {args.max_frames}; video may be longer")

    loop = find_loop(thumbs, args.min_loop)
    # Bands are only ever authored for one cycle. Everything after it repeats.
    span = loop["length"] if loop and loop["confident"] else len(thumbs)
    bands, diffs = find_bands(thumbs[:span], args.sensitivity)
    contact_sheet(frames[:span], out / "contact-sheet.jpg", args.sheet_columns, args.sheet_frames)

    report = {
        "source": str(args.video),
        "frames": len(frames),
        "width": width,
        "height": height,
        "fps": fps,
        "loop": loop,
        "authoredFrames": span,
        "bands": [{"start": a, "end": b, "startTime": float(a / fps) if fps else None} for a, b in bands],
        "frameDiff": [round(float(d), 4) for d in diffs],
    }
    (out / "analysis.json").write_text(json.dumps(report, indent=2) + "\n")

    lines = [
        "# Reference frame analysis",
        "",
        f"Reference: `{args.video}`. {len(frames)} decoded frames, {width}x{height}, {fps:g} fps.",
        "",
    ]
    if loop and loop["confident"]:
        lines += [
            f"Loop detected at **{loop['length']} frames** "
            f"({loop['length'] / fps:.4f} s), mean absolute difference "
            f"{loop['meanAbsDiff']}/255 against the following cycle. Author plates and tracks for "
            f"frames 0-{loop['length'] - 1} only and modulo the frame index at draw time.",
            "",
        ]
    else:
        lines += ["No loop found. Every frame needs its own plate.", ""]
    lines += [
        "Cut points below come from inter-frame difference. Replace the behavior column with what",
        "the reference actually does in each band - that description drives the clearing regions in",
        "Phase 2 and the draw branches in Phase 4.",
        "",
        "| Frames | Time | Reference behavior |",
        "| --- | --- | --- |",
    ]
    for a, b in bands:
        lines.append(f"| {a}-{b - 1} | {timecode(a, fps)}-{timecode(b, fps)} s | TODO |")
    lines.append("")
    (out / "frame-analysis.md").write_text("\n".join(lines))

    print(f"{len(frames)} frames, {width}x{height} @ {fps:g} fps")
    print(f"loop: {loop}")
    print(f"{len(bands)} proposed bands over {span} authored frames")
    print(f"wrote {out}/frame-analysis.md, {out}/analysis.json, {out}/contact-sheet.jpg")


if __name__ == "__main__":
    main()
