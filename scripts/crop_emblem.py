#!/usr/bin/env python3
"""
Emblem intake — runs in the data pipeline.

The repo owner uploads their original tournament emblem artwork VERBATIM as
  public/emblem-source.png   (any size, un-cropped)
and this script crops it along the golden border (keeping the border, trimming
the outer background) into
  public/emblem.png
which the home-page hero card displays. Re-runs are no-ops unless the source
changes. The artwork itself is never redrawn or altered — crop only.
"""
import os
import sys

PUB = os.path.join(os.path.dirname(__file__), '..', 'public')
SRC = os.path.join(PUB, 'emblem-source.png')
OUT = os.path.join(PUB, 'emblem.png')

def main():
    if not os.path.exists(SRC):
        print('No emblem-source.png — nothing to do.')
        return
    if os.path.exists(OUT) and os.path.getmtime(OUT) >= os.path.getmtime(SRC):
        print('emblem.png up to date.')
        return
    try:
        from PIL import Image
    except ImportError:
        print('Pillow not available — skipping emblem crop.')
        return

    img = Image.open(SRC).convert('RGB')
    w, h = img.size
    px = img.load()

    # Bounding box of the golden border: warm pixels where R > G > B and
    # brightness is high enough to be the gold frame, not the navy field.
    min_x, min_y, max_x, max_y = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if r > 150 and g > 90 and b < 120 and r > g > b:
                if x < min_x: min_x = x
                if x > max_x: max_x = x
                if y < min_y: min_y = y
                if y > max_y: max_y = y

    if max_x < 0 or (max_x - min_x) < w * 0.3 or (max_y - min_y) < h * 0.3:
        print('Golden border not detected — copying source uncropped.')
        img.save(OUT)
        return

    pad = max(2, w // 300)
    box = (max(0, min_x - pad), max(0, min_y - pad),
           min(w, max_x + 1 + pad), min(h, max_y + 1 + pad))
    img.crop(box).save(OUT)
    print(f'Cropped emblem along golden border: {box} -> emblem.png ({box[2]-box[0]}x{box[3]-box[1]})')

if __name__ == '__main__':
    sys.exit(main())
