# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy>=1.26,<3", "opencv-python>=4.10,<5"]
# ///
"""Build text-cleared plates and per-frame motion tracks from a reference video.

Phases 2 and 3 of roto, in one pass: for each frame we measure
the trackers against the ORIGINAL pixels, then clear the text regions. Order
matters - clearing destroys the edges the trackers lock onto.

    uv run build_plates.py --config regions.json
    uv run build_plates.py --config regions.json --frames 45:72 --contact-sheet

Config schema: see templates/regions.example.json.
"""
import argparse
import ast
import json
import operator
from pathlib import Path

import cv2
import numpy as np

# --------------------------------------------------------------------------
# Rect expressions
#
# Clear rectangles often hang off a tracked value ("left + 65"), so rect
# components may be numbers or short expressions over this frame's track dict.
# ast keeps that from becoming an eval() hole in a script that reads config
# files from a repo you may not have written.
# --------------------------------------------------------------------------
_BINOPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
           ast.Div: operator.truediv, ast.FloorDiv: operator.floordiv, ast.Mod: operator.mod}
_FUNCS = {"min": min, "max": max, "abs": abs, "round": round, "int": int, "float": float}


def evaluate(node, names):
    if isinstance(node, ast.Expression):
        return evaluate(node.body, names)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.Name):
        if node.id not in names:
            raise ValueError(f"unknown name in expression: {node.id}")
        return names[node.id]
    if isinstance(node, ast.BinOp) and type(node.op) in _BINOPS:
        return _BINOPS[type(node.op)](evaluate(node.left, names), evaluate(node.right, names))
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
        value = evaluate(node.operand, names)
        return value if isinstance(node.op, ast.UAdd) else -value
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _FUNCS:
        return _FUNCS[node.func.id](*[evaluate(a, names) for a in node.args])
    if isinstance(node, ast.Subscript):
        return evaluate(node.value, names)[evaluate(node.slice, names)]
    raise ValueError(f"unsupported expression element: {ast.dump(node)}")


def resolve(value, names):
    if isinstance(value, (int, float)):
        return int(round(value))
    return int(round(evaluate(ast.parse(str(value), mode="eval"), names)))


def resolve_rect(rect, names, width, height):
    x0, y0, x1, y1 = (resolve(v, names) for v in rect)
    x0, x1 = max(0, min(x0, x1)), min(width, max(x0, x1))
    # Rows 0 and height-1 are excluded: every strategy reads the row outside
    # the region as its source, and there is nothing outside the frame.
    y0, y1 = max(1, min(y0, y1)), min(height - 1, max(y0, y1))
    return x0, y0, x1, y1


# --------------------------------------------------------------------------
# Clearing strategies. Each writes into `plate` in place, reading `original`
# for source pixels so that a later region cannot sample an earlier region's
# synthetic fill.
# --------------------------------------------------------------------------
def clear_solid(plate, original, rect, spec):
    x0, y0, x1, y1 = rect
    plate[y0:y1, x0:x1] = np.array(spec["color"][::-1], dtype=np.uint8)  # config is RGB


def clear_row_copy(plate, original, rect, spec):
    x0, y0, x1, y1 = rect
    row = spec.get("sourceRow", y1)
    row = max(0, min(original.shape[0] - 1, row))
    plate[y0:y1, x0:x1] = original[row:row + 1, x0:x1]


def clear_linear_blend(plate, original, rect, spec):
    x0, y0, x1, y1 = rect
    top = original[y0 - 1:y0, x0:x1].astype(float)
    bottom = original[y1:y1 + 1, x0:x1].astype(float)
    t = np.linspace(0, 1, y1 - y0)[:, None, None]
    plate[y0:y1, x0:x1] = np.uint8(np.clip(top * (1 - t) + bottom * t, 0, 255))


def clear_cubic_hermite(plate, original, rect, spec):
    """Match value and slope at both edges, so a curved gradient has no seam."""
    x0, y0, x1, y1 = rect
    reach = int(spec.get("reach", 30))
    top_row = max(0, y0 - reach)
    bottom_row = min(original.shape[0] - 1, y1 + reach)
    a = original[y0, x0:x1].astype(float)
    b = original[y1, x0:x1].astype(float)
    da = (a - original[top_row, x0:x1].astype(float)) / max(1, y0 - top_row)
    db = (original[bottom_row, x0:x1].astype(float) - b) / max(1, bottom_row - y1)
    h = y1 - y0
    t = np.linspace(0, 1, h)[:, None, None]
    fill = ((2 * t ** 3 - 3 * t ** 2 + 1) * a
            + (t ** 3 - 2 * t ** 2 + t) * h * da
            + (-2 * t ** 3 + 3 * t ** 2) * b
            + (t ** 3 - t ** 2) * h * db)
    plate[y0:y1, x0:x1] = np.uint8(np.clip(fill, 0, 255))


def clear_patch_copy(plate, original, rect, spec):
    x0, y0, x1, y1 = rect
    sx, sy = (int(v) for v in spec["from"])
    plate[y0:y1, x0:x1] = original[sy:sy + (y1 - y0), sx:sx + (x1 - x0)]


STRATEGIES = {
    "solid": clear_solid,
    "row-copy": clear_row_copy,
    "linear-blend": clear_linear_blend,
    "cubic-hermite": clear_cubic_hermite,
    "patch-copy": clear_patch_copy,
}


# --------------------------------------------------------------------------
# Trackers. All read the original frame.
# --------------------------------------------------------------------------
def track_dark_column(frame, spec, index, names):
    lo, hi = spec.get("search", [0, frame.shape[1]])
    row = frame[int(spec["row"]), lo:hi]
    return int(np.argmin(row.mean(axis=1)) + lo)


def track_colored_column(frame, spec, index, names):
    """Strongest channel separation along a row - finds a coloured border that a
    brightness minimum would miss."""
    lo, hi = spec.get("search", [0, frame.shape[1]])
    plus, minus = spec.get("channels", [0, 2])  # BGR; default blue minus red
    row = frame[int(spec["row"]), lo:hi].astype(int)
    return int(np.argmax(row[:, plus] - row[:, minus]) + lo)


def track_top_edge(frame, spec, index, names):
    lo, hi = spec.get("search", [0, frame.shape[0]])
    column = frame[lo:hi, int(spec["column"])]
    threshold = spec.get("threshold", 249)
    hits = np.where(column.min(axis=1) > threshold)[0] if spec.get("above", True) \
        else np.where(column.max(axis=1) < threshold)[0]
    if not len(hits):
        return spec.get("fallback", lo)
    return int(hits[0] + lo)


def track_bbox(frame, spec, index, names):
    # Resolved against the trackers already measured this frame: the region the
    # original text occupies almost always rides on something else that moves.
    x0, y0, x1, y1 = resolve_rect(spec["rect"], names, frame.shape[1], frame.shape[0])
    roi = frame[y0:y1, x0:x1]
    mask = roi.max(axis=2) < spec.get("limit", 205)
    ys, xs = np.where(mask)
    if not len(xs):
        return spec.get("fallback")
    return [int(xs.min() + x0), int(ys.min() + y0), int(xs.max() + x0 + 1), int(ys.max() + y0 + 1)]


def track_keyframe(frame, spec, index, names):
    return float(np.interp(index, spec["frames"], spec["values"]))


def track_constant(frame, spec, index, names):
    return spec["value"]


TRACKERS = {
    "dark-column": track_dark_column,
    "colored-column": track_colored_column,
    "top-edge": track_top_edge,
    "bbox": track_bbox,
    "keyframe": track_keyframe,
    "constant": track_constant,
}


def post(value, spec):
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return value
    value = value * spec.get("scale", 1) + spec.get("offset", 0)
    if "clamp" in spec:
        value = max(spec["clamp"][0], min(spec["clamp"][1], value))
    if spec.get("round", True) and float(value).is_integer():
        value = int(value)
    return value


# --------------------------------------------------------------------------
def bands_for(config, index):
    for band in config["bands"]:
        if band.get("start", 0) <= index < band.get("end", config["frames"]):
            yield band


def contact_sheet(plates, path, columns=6):
    picks = np.linspace(0, len(plates) - 1, min(36, len(plates))).astype(int)
    cells = []
    for i in picks:
        cell = cv2.resize(plates[i], (320, 180))
        cv2.rectangle(cell, (0, 158), (60, 180), (0, 0, 0), -1)
        cv2.putText(cell, str(i), (5, 175), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        cells.append(cell)
    rows = []
    for i in range(0, len(cells), columns):
        row = cells[i:i + columns]
        while len(row) < columns:
            row.append(np.zeros_like(cells[0]))
        rows.append(np.hstack(row))
    cv2.imwrite(str(path), np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 88])



def audit(config, coverage, lo, hi):
    """Report frames whose original lettering nobody removed.

    The quiet failure of this workflow is a band with no clear regions: the
    plate keeps the reference's own typography, the draw loop has no branch for
    it, and the source lettering ships in the output. It looks fine in a contact
    sheet because it looks like finished design - it just is not yours.
    """
    named = {}
    for entry in coverage:
        key = tuple(entry["bands"]) or ("(no band)",)
        slot = named.setdefault(key, {"frames": 0, "clears": entry["clears"]})
        slot["frames"] += 1
    warnings = []
    for bands, slot in named.items():
        label = ", ".join(bands)
        if bands == ("(no band)",):
            warnings.append(f"  {slot['frames']} frames match no band at all")
        elif slot["clears"] == 0:
            warnings.append(
                f"  band '{label}' ({slot['frames']} frames) declares no clear regions")
    if warnings:
        print("coverage audit:")
        print("\n".join(warnings))
        print("  Confirm the reference carries no lettering there. If it does, it passes")
        print("  through to your render as the original designer's typography.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default="regions.json")
    ap.add_argument("--out", help="plate directory (overrides config)")
    ap.add_argument("--frames", help="build a subset, e.g. 45:72, while tuning a band")
    ap.add_argument("--contact-sheet", action="store_true", help="also write plates-contact-sheet.jpg")
    ap.add_argument("--no-tracks", action="store_true", help="skip writing the tracks file")
    args = ap.parse_args()

    root = Path(args.config).resolve().parent
    config = json.loads(Path(args.config).read_text())
    total = int(config["frames"])
    out = Path(args.out or config.get("output", "assets/plates"))
    if not out.is_absolute():
        out = root / out
    out.mkdir(parents=True, exist_ok=True)
    pad = max(3, len(str(total - 1)))

    lo, hi = 0, total
    if args.frames:
        a, _, b = args.frames.partition(":")
        lo, hi = int(a), int(b or total)

    source = Path(config["source"])
    if not source.is_absolute():
        source = root / source
    cap = cv2.VideoCapture(str(source))
    if not cap.isOpened():
        raise SystemExit(f"cannot open {source}")

    tracks, built, coverage = [], [], []
    for index in range(total):
        ok, original = cap.read()
        if not ok:
            raise SystemExit(f"reference ended at frame {index}, expected {total}")
        height, width = original.shape[:2]
        record = {"frame": index}

        # Measure first, on untouched pixels. Tracking runs for every frame even
        # when --frames limits which plates get rebuilt: it is cheap, and a
        # partial tracks file would silently blank the bands you are not working
        # on, which looks like a composition bug three steps later.
        for band in bands_for(config, index):
            for spec in band.get("track", []):
                fn = TRACKERS.get(spec["type"])
                if fn is None:
                    raise SystemExit(f"unknown tracker: {spec['type']}")
                record[spec["name"]] = post(fn(original, spec, index, record), spec)
        tracks.append(record)

        if not (lo <= index < hi):
            continue
        plate = original.copy()

        # Then clear. Globals last so a fixed logo patch wins over a band fill.
        active = list(bands_for(config, index))
        band_clears = 0
        for band in active + [config.get("global", {})]:
            if band is not config.get("global", {}):
                band_clears += len(band.get("clear", []))
            for spec in band.get("clear", []):
                fn = STRATEGIES.get(spec["strategy"])
                if fn is None:
                    raise SystemExit(f"unknown strategy: {spec['strategy']}")
                # A tracker that found nothing this frame (text not on screen
                # yet) means its dependent clear has no rectangle to apply.
                # Skipping is correct; guessing one would clear the wrong pixels.
                needs = spec.get("requires", [])
                if isinstance(needs, str):
                    needs = [needs]
                if any(record.get(name) is None for name in needs):
                    continue
                rect = resolve_rect(spec["rect"], record, width, height)
                if rect[2] <= rect[0] or rect[3] <= rect[1]:
                    continue
                fn(plate, original, rect, spec)

        cv2.imwrite(str(out / f"{index:0{pad}d}.png"), plate, [cv2.IMWRITE_PNG_COMPRESSION, 3])
        built.append(plate)
        coverage.append({
            "frame": index,
            "bands": [b.get("name", "?") for b in active],
            "clears": band_clears,
        })
    cap.release()

    if not args.no_tracks:
        target = Path(config.get("tracksOutput", "assets/tracks.js"))
        if not target.is_absolute():
            target = root / target
        target.parent.mkdir(parents=True, exist_ok=True)
        var = config.get("tracksVar", "referenceTracks")
        target.write_text(f"window.{var}=" + json.dumps(tracks, default=int) + ";\n")
        print(f"wrote {target}")

    if args.contact_sheet and built:
        sheet = out.parent / "plates-contact-sheet.jpg"
        contact_sheet(built, sheet)
        print(f"wrote {sheet} - look at it before trusting these plates")

    audit(config, coverage, lo, hi)
    print(f"built {len(built)} plates in {out}")


if __name__ == "__main__":
    main()
