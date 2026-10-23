"""Builds assets/icon*.png and assets/icon.ico from assets/icon-source.png (needs Pillow). Run: python tools/build-icon.py

The source art is a glossy cube with an S on each face and a wordmark underneath. The cube is cut out (the wordmark
and the hard bottom edge of its glow are removed) and centred on a transparent square.
"""
from pathlib import Path
from PIL import Image

ASSETS = Path(__file__).resolve().parent.parent / "assets"
SIZES = [16, 24, 32, 48, 64, 128, 256, 512]
M = 1024  # master size

# Square region of the source around the cube, and the row where its glow is faded out (above the wordmark band).
BOX = (157, 30, 1097, 970)
FADE_FROM, FADE_TO = 905, 950

src = Image.open(ASSETS / "icon-source.png").convert("RGBA")
art = src.crop(BOX)
alpha = art.getchannel("A")
px = alpha.load()
for y in range(art.height):
    sy = y + BOX[1]
    k = 1.0 if sy <= FADE_FROM else max(0.0, (FADE_TO - sy) / (FADE_TO - FADE_FROM))
    if k < 1.0:
        for x in range(art.width):
            px[x, y] = int(px[x, y] * k)
art.putalpha(alpha)

master = art.resize((M, M), Image.LANCZOS)
master.save(ASSETS / "icon-1024.png")
for s in SIZES:
    master.resize((s, s), Image.LANCZOS).save(ASSETS / f"icon-{s}.png")
master.resize((512, 512), Image.LANCZOS).save(ASSETS / "icon.png")
master.save(ASSETS / "icon.ico", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
print("icons written to", ASSETS)
