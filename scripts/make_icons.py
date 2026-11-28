#!/usr/bin/env python3
"""Generate PWA icons: near-black square, yellow Rhodes-style diamond,
学 character, hazard-stripe band at the bottom."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"
OUT.mkdir(exist_ok=True)
FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"

YELLOW = (247, 209, 23)
BLACK = (16, 16, 20)
WHITE = (242, 242, 240)

def make(size):
    img = Image.new("RGB", (size, size), BLACK)
    d = ImageDraw.Draw(img)
    s = size / 512.0
    # hazard band at bottom
    band_h = int(58 * s)
    y0 = size - band_h
    stripe = int(46 * s)
    for x in range(-band_h, size + stripe, stripe):
        d.polygon([(x, size), (x + stripe // 2, size), (x + stripe // 2 + band_h, y0), (x + band_h, y0)],
                  fill=YELLOW)
    d.rectangle([0, y0 - int(6 * s), size, y0], fill=YELLOW)
    # diamond outline
    cx, cy, r = size / 2, (y0) / 2, 150 * s
    pts = [(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)]
    d.polygon(pts, outline=YELLOW, width=max(4, int(13 * s)))
    # character
    f = ImageFont.truetype(FONT, int(150 * s))
    d.text((cx, cy), "学", font=f, fill=WHITE, anchor="mm")
    return img

for name, size in [("icon-512.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180)]:
    make(size).save(OUT / name)
    print(name, size)
