#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""BAZR Tag -- generator for the Chrome extension (MV3) icons at 16/32/48/128.

Why Pillow: this environment has no convert, magick, rsvg-convert or inkscape, so there is
no SVG -> PNG conversion path at all (and MV3 does not accept an SVG reference anyway, only PNG).
So the shapes are drawn directly with Pillow, skipping SVG entirely, and antialiased by a
LANCZOS downsample.

Design: a weekend flea-market price tag.
A pentagon with the top-left corner cut off, plus one string hole (grommet). Transparent
background, bright midday tones. The palette is the four colours fixed below.

Rendering note 1 -- RGB and alpha are drawn separately:
  Rotating or shrinking a single RGBA image blends the RGB(0,0,0) of the transparent pixels
  into the edges and leaves a black rim (dark fringe). So the RGB canvas is filled with colour
  edge to edge, background included, the silhouette is kept on its own L canvas (alpha), and
  the two are merged at the end.

Rendering note 2 -- the outline is drawn inward:
  A stroke centred on the boundary grows the silhouette by half the line width and leaves the
  boundary sitting on a half pixel, which smears at small sizes. Leaving alpha as the bare
  polygon and stroking only RGB at double width, then letting alpha clip it, gives a silhouette
  that is exactly the polygon and an outline that lies N pixels inside it.

Run: python3 make-icons.py   (no arguments, and it does not matter where you run it from)
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------- paths
# This has to behave the same wherever it is run from, so paths are absolute and anchored on the script file.
PKG_ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = PKG_ROOT / "public" / "icons"

# ---------------------------------------------------------------- palette
TAG_RED = (232, 69, 47)        # #E8452F  tag body
LABEL_CREAM = (242, 239, 227)  # #F2EFE3  label panel
ASPHALT = (58, 58, 56)         # #3A3A38  outline / text
TARP_BLUE = (31, 111, 178)     # #1F6FB2  grommet ring

# Only fonts that actually exist on the system are candidates. Even if every one fails, the script does not die.
FONT_CANDIDATES = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/ubuntu/Ubuntu[wdth,wght].ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
)

# ---------------------------------------------------------------- per-size simplification
# - 16 and 32 carry no lettering. Silhouette and hole only.
# - 16 is not tilted (tilt 0) and its tag box is snapped to whole pixels.
#   At 16px a 7-degree rotation lands every edge on a fractional pixel and the shape turns to mush.
#   At small sizes take the head-on version the brief allows.
#
# Unit rules (never mix them):
#   w / h                   = fraction of one icon edge
#   cut / round / r_* / gap = fraction of the tag width (w)
#   outline / ring_outline  = absolute final pixels (a line must not disappear at small sizes)
# Do not add an "under 1 is a fraction, 1 and above is pixels" auto-detection --
# the absolute 0.62 in the 16px spec was once read as a fraction and the hole punched clean
# through the whole tag (observed).
SPECS = {
    16: {
        "tilt": 0.0, "snap": True,
        "w": 0.70, "h": 0.90, "cut": 0.55, "round": 0.05,
        "outline": 1.0,
        "r_out": 0.135, "r_hole": 0.078, "gap": 0.045, "ring_outline": 0.0,
        "panel": False, "text": None,
    },
    32: {
        "tilt": -7.0, "snap": False,
        "w": 0.62, "h": 0.86, "cut": 0.48, "round": 0.055,
        "outline": 1.6,
        "r_out": 0.115, "r_hole": 0.055, "gap": 0.05, "ring_outline": 0.0,
        "panel": False, "text": None,
    },
    48: {
        "tilt": -7.0, "snap": False,
        "w": 0.62, "h": 0.86, "cut": 0.44, "round": 0.055,
        "outline": 2.2,
        "r_out": 0.110, "r_hole": 0.052, "gap": 0.05, "ring_outline": 0.7,
        "panel": True, "text": "$",
    },
    128: {
        "tilt": -7.0, "snap": False,
        "w": 0.62, "h": 0.86, "cut": 0.42, "round": 0.055,
        "outline": 5.0,
        "r_out": 0.105, "r_hole": 0.050, "gap": 0.05, "ring_outline": 1.7,
        "panel": True, "text": "BAZR",
    },
}

SIZES = (16, 32, 48, 128)


def supersample_factor(size: int) -> int:
    """Scale so the working canvas lands at 512-1024px (under 4x the stair-stepping survives)."""
    return max(4, min(64, round(1024 / size)))


# ---------------------------------------------------------------- shape helpers
def _quad_bezier(p0, p1, p2, steps):
    out = []
    for i in range(steps + 1):
        t = i / steps
        mt = 1.0 - t
        out.append(
            (
                mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
                mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1],
            )
        )
    return out


def rounded_polygon(points, radius, steps=12):
    """Point list for a polygon whose every corner is rounded with a quadratic bezier."""
    n = len(points)
    out = []
    for i in range(n):
        prev_p = points[(i - 1) % n]
        cur = points[i]
        next_p = points[(i + 1) % n]
        v1 = (prev_p[0] - cur[0], prev_p[1] - cur[1])
        v2 = (next_p[0] - cur[0], next_p[1] - cur[1])
        l1 = math.hypot(*v1)
        l2 = math.hypot(*v2)
        if l1 <= 0 or l2 <= 0:
            out.append(cur)
            continue
        t = min(radius, l1 / 2.0, l2 / 2.0)
        a = (cur[0] + v1[0] / l1 * t, cur[1] + v1[1] / l1 * t)
        b = (cur[0] + v2[0] / l2 * t, cur[1] + v2[1] / l2 * t)
        out.extend(_quad_bezier(a, cur, b, steps))
    return out


class Pen:
    """Draws the same shape onto the RGB canvas and onto the alpha (L) canvas.

    With alpha=None the alpha canvas is left untouched.
    (Detail laid over an already opaque silhouette -- outline / label / lettering / ring)
    """

    def __init__(self, rgb_img, a_img):
        self.rgb = ImageDraw.Draw(rgb_img)
        self.a = ImageDraw.Draw(a_img)

    def polygon(self, pts, color, alpha=255):
        self.rgb.polygon(pts, fill=color)
        if alpha is not None:
            self.a.polygon(pts, fill=alpha)

    def stroke(self, pts, color, width, alpha=None):
        closed = list(pts) + [pts[0]]
        w = max(1, int(round(width)))
        self.rgb.line(closed, fill=color, width=w, joint="curve")
        if alpha is not None:
            self.a.line(closed, fill=alpha, width=w, joint="curve")

    def ellipse(self, box, color, alpha=None, outline=None, outline_w=0):
        ow = int(round(outline_w))
        self.rgb.ellipse(box, fill=color, outline=outline, width=ow if outline else 0)
        if alpha is not None:
            self.a.ellipse(box, fill=alpha)

    def rounded_rect(self, box, radius, color, alpha=None):
        self.rgb.rounded_rectangle(box, radius=radius, fill=color)
        if alpha is not None:
            self.a.rounded_rectangle(box, radius=radius, fill=alpha)

    def text(self, xy, s, font, color, alpha=None):
        self.rgb.text(xy, s, font=font, fill=color)
        if alpha is not None:
            self.a.text(xy, s, font=font, fill=alpha)


# ---------------------------------------------------------------- fonts
def load_font(px: int):
    """Opens only a font that really exists. If all of them fail it returns (None, None) and the caller drops the lettering."""
    px = max(1, int(px))
    for path in FONT_CANDIDATES:
        try:
            font = ImageFont.truetype(path, px)
        except Exception:
            continue
        try:  # For a variable font, take the Bold instance. Otherwise it raises and is simply ignored
            font.set_variation_by_name("Bold")
        except Exception:
            pass
        return font, path
    try:
        return ImageFont.load_default(size=px), "PIL built-in default"
    except Exception:
        pass
    try:
        return ImageFont.load_default(), "PIL built-in default (fixed size)"
    except Exception:
        return None, None


def fit_font(text: str, max_w: float, max_h: float):
    """Binary-searches for the largest font that still fits inside the given box."""
    lo, hi = 4, max(6, int(max_h * 4))
    best = None
    while lo <= hi:
        mid = (lo + hi) // 2
        font, src = load_font(mid)
        if font is None:
            return None
        try:
            bbox = font.getbbox(text)
        except Exception:
            return None
        if (bbox[2] - bbox[0]) <= max_w and (bbox[3] - bbox[1]) <= max_h:
            best = (font, src, bbox)
            lo = mid + 1
        else:
            hi = mid - 1
    return best


# ---------------------------------------------------------------- the icon itself
def build_icon(size: int) -> Image.Image:
    spec = SPECS[size]
    ss = supersample_factor(size)
    canvas = size * ss

    # The RGB canvas is flooded with the outline colour, background and all (stops the dark fringe. Note 1 at the top of this file).
    rgb = Image.new("RGB", (canvas, canvas), ASPHALT)
    alpha = Image.new("L", (canvas, canvas), 0)
    pen = Pen(rgb, alpha)

    def S(*vals):
        """Final px -> supersampled px."""
        return tuple(v * ss for v in vals)

    def SP(pts):
        return [(x * ss, y * ss) for (x, y) in pts]

    # --- the price-tag pentagon (top-left corner cut off) ---
    w = spec["w"] * size
    h = spec["h"] * size
    if spec["snap"]:  # only when there is no rotation: put the edges on whole-pixel boundaries
        w = float(round(w))
        h = float(round(h))
        x0 = float(round((size - w) / 2.0))
        y0 = float(round((size - h) / 2.0))
    else:
        x0 = (size - w) / 2.0
        y0 = (size - h) / 2.0

    cut = spec["cut"] * w
    body = [
        (x0 + cut, y0),
        (x0 + w, y0),
        (x0 + w, y0 + h),
        (x0, y0 + h),
        (x0, y0 + cut),
    ]
    body_pts = SP(rounded_polygon(body, spec["round"] * w))

    # alpha stays the bare polygon (the silhouette). RGB is stroked at double width and alpha clips the outer half away.
    pen.polygon(body_pts, TAG_RED, alpha=255)
    pen.stroke(body_pts, ASPHALT, spec["outline"] * 2 * ss, alpha=None)

    # --- label panel plus lettering (48 and 128 only) ---
    if spec["panel"]:
        p_w = 0.82 * w
        p_h = 0.26 * h
        p_cx = x0 + w / 2.0
        p_cy = y0 + 0.635 * h
        pen.rounded_rect(
            S(p_cx - p_w / 2, p_cy - p_h / 2, p_cx + p_w / 2, p_cy + p_h / 2),
            radius=0.05 * w * ss,
            color=LABEL_CREAM,
        )
        label = spec["text"]
        if label:
            found = fit_font(label, max_w=p_w * 0.86 * ss, max_h=p_h * 0.70 * ss)
            if found:
                font, _src, bbox = found
                pen.text(
                    (
                        (p_cx * ss) - (bbox[0] + bbox[2]) / 2.0,
                        (p_cy * ss) - (bbox[1] + bbox[3]) / 2.0,
                    ),
                    label,
                    font=font,
                    color=ASPHALT,
                )
            else:
                print(f"  [warn] {size}px: no usable font, skipping the lettering")

    # --- grommet (the string hole) ---
    # Its centre sits (r_out + gap) inward from the cut diagonal edge.
    # r_* and gap are all fractions of the tag width (w). Only the hole is given a minimum radius, so it never vanishes.
    r_out = spec["r_out"] * w
    r_hole = max(spec["r_hole"] * w, 0.55)
    gap = spec["gap"] * w
    d = cut / math.sqrt(2.0) + r_out + gap
    gx = x0 + d / math.sqrt(2.0)
    gy = y0 + d / math.sqrt(2.0)

    ring_box = S(gx - r_out, gy - r_out, gx + r_out, gy + r_out)
    ring_ol = spec["ring_outline"] * ss
    if ring_ol > 0:
        pen.ellipse(ring_box, TARP_BLUE, outline=ASPHALT, outline_w=ring_ol)
    else:
        pen.ellipse(ring_box, TARP_BLUE)

    # The hole really is punched: RGB is filled with the surrounding ring colour (no fringe) and only alpha goes to 0.
    hole_box = S(gx - r_hole, gy - r_hole, gx + r_hole, gy + r_hole)
    pen.rgb.ellipse(hole_box, fill=TARP_BLUE)
    pen.a.ellipse(hole_box, fill=0)

    # --- tilt --- fillcolor has to match the background or black creeps into the rotation margin.
    tilt = spec["tilt"]
    if tilt:
        rgb = rgb.rotate(tilt, resample=Image.BICUBIC, fillcolor=ASPHALT)
        alpha = alpha.rotate(tilt, resample=Image.BICUBIC, fillcolor=0)

    # --- downsample --- shrink RGB and alpha separately, then merge them.
    rgb = rgb.resize((size, size), Image.LANCZOS)
    alpha = alpha.resize((size, size), Image.LANCZOS)

    r, g, b = rgb.split()
    return Image.merge("RGBA", (r, g, b, alpha))


def alpha_stats(path: Path):
    """Reopens the saved file and measures that (the artifact on disk, not the in-memory state)."""
    with Image.open(path) as im:
        im.load()
        mode = im.mode
        w, h = im.size
        a = im.convert("RGBA").getchannel("A")
        hist = a.histogram()
    total = w * h
    return {
        "w": w,
        "h": h,
        "mode": mode,
        "total": total,
        "nonzero": total - hist[0],
        "solid": sum(hist[128:]),
    }


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[make-icons] out dir: {OUT_DIR}")

    _probe, probe_src = load_font(24)
    print(f"[make-icons] font: {probe_src if probe_src else 'NONE -- going ahead without lettering'}")

    failed = 0
    for size in SIZES:
        path = OUT_DIR / f"icon{size}.png"
        build_icon(size).save(path, format="PNG", optimize=True)

        st = alpha_stats(path)
        ok = st["w"] == size and st["h"] == size and st["mode"] == "RGBA" and st["nonzero"] > 0
        if not ok:
            failed += 1
        print(
            f"[make-icons] {'PASS' if ok else 'FAIL'} {path.name}  "
            f"{st['w']}x{st['h']} {st['mode']}  bytes={path.stat().st_size}  "
            f"opaque_px={st['nonzero']}/{st['total']}  solid_px(a>=128)={st['solid']}"
        )

    verdict = "PASS" if failed == 0 else f"FAIL ({failed} icons)"
    print(f"[make-icons] wrote={len(SIZES)} verdict={verdict}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
