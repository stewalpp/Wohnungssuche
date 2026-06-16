"""Generate the PWA app icons (house + magnifier on a blue→teal gradient).

Build-time helper only — not a runtime dependency. Run with Pillow installed:
    python tools/make_icons.py
Writes docs/icons/icon-512.png, icon-192.png and apple-touch-icon.png.
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path("docs/icons")
TOP = (10, 132, 255)      # iOS blue
BOTTOM = (48, 176, 199)   # teal


def gradient(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size), TOP)
    px = img.load()
    for y in range(size):
        t = y / (size - 1)
        r = round(TOP[0] + (BOTTOM[0] - TOP[0]) * t)
        g = round(TOP[1] + (BOTTOM[1] - TOP[1]) * t)
        b = round(TOP[2] + (BOTTOM[2] - TOP[2]) * t)
        for x in range(size):
            px[x, y] = (r, g, b)
    return img


def rounded_mask(size: int, radius_ratio: float = 0.225) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    r = int(size * radius_ratio)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=255)
    return mask


def draw_glyph(img: Image.Image, size: int) -> None:
    d = ImageDraw.Draw(img, "RGBA")
    white = (255, 255, 255, 255)
    cx = size * 0.46
    cy = size * 0.44
    w = size * 0.42          # house width
    # roof
    roof_h = size * 0.16
    body_top = cy - roof_h * 0.1
    left = cx - w / 2
    right = cx + w / 2
    apex = (cx, cy - roof_h - w * 0.18)
    d.polygon([(left - size * 0.03, body_top), apex, (right + size * 0.03, body_top)], fill=white)
    # body
    body_bottom = cy + w * 0.5
    d.rounded_rectangle([left, body_top, right, body_bottom], radius=size * 0.025, fill=white)
    # door (cut-out using gradient colour is messy; draw a tinted door)
    door_w = w * 0.26
    door_h = w * 0.34
    door_x = cx - door_w / 2
    d.rounded_rectangle(
        [door_x, body_bottom - door_h, door_x + door_w, body_bottom],
        radius=size * 0.012,
        fill=(10, 132, 255, 255),
    )
    # magnifier (bottom-right), drawn over the house
    mr = size * 0.135
    mx = size * 0.68
    my = size * 0.66
    ring = int(size * 0.055)
    # outer white ring
    d.ellipse([mx - mr, my - mr, mx + mr, my + mr], fill=white)
    # inner gradient hole
    inner = mr - ring
    d.ellipse([mx - inner, my - inner, mx + inner, my + inner], fill=(34, 158, 210, 255))
    # handle
    hx = mx + mr * math.cos(math.radians(45))
    hy = my + mr * math.sin(math.radians(45))
    ex = hx + size * 0.11
    ey = hy + size * 0.11
    d.line([(hx, hy), (ex, ey)], fill=white, width=int(size * 0.055))


def build(size: int, rounded: bool) -> Image.Image:
    base = gradient(size)
    draw_glyph(base, size)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    if rounded:
        out.paste(base, (0, 0), rounded_mask(size))
    else:
        out.paste(base, (0, 0))
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    # Full-bleed square for the manifest icons (work as maskable + any).
    build(512, rounded=False).save(OUT / "icon-512.png")
    build(192, rounded=False).save(OUT / "icon-192.png")
    # Apple touch icon: rounding is applied by iOS, but a filled square is fine.
    build(180, rounded=False).save(OUT / "apple-touch-icon.png")
    print("Icons geschrieben nach", OUT)


if __name__ == "__main__":
    main()
