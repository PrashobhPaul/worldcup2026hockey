#!/usr/bin/env python3
"""Derive every icon in the app from the two pieces of source artwork.

Both badges are a gold rounded rectangle painted onto an opaque square, so the
corners outside that border are dark filler. Left in, they show as hard wedges
wherever the icon sits on a lighter surface or gets rounded a second time by a
launcher, which is what made the app icon and the tournament emblem look like
squares with a badge printed on them. Everything here cuts the artwork down to
the badge and leaves those corners transparent.

Two different cuts, because the two files differ:

  * The app icon is cut by flooding inward from the edge of the canvas. The
    unbroken gold border stops the fill, so the badge is found exactly without
    anyone having to guess a corner radius.
  * The tournament emblem has a soft glow spilling past its border. A flood
    fill stops at the glow and leaves a halo, so its rounded rectangle is
    fitted to the border instead. EMBLEM_BOX and EMBLEM_RADIUS below were
    measured off the artwork, the radius by tracing the corner arc and fitting
    a circle to it (mean residual ~3px over 199 sampled points).

Sources live in resources/artwork/ and are never written to, so this is
reproducible and safe to re-run: every output is derived, nothing is edited in
place. Regenerate with `npm run icons` after changing the artwork.
"""
from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'resources' / 'artwork'
PUB = ROOT / 'public'
ANDROID = ROOT / 'resources' / 'android' / 'res'

EMBLEM_BOX = (187, 151, 1080, 1083)     # outer edge of the gold border
EMBLEM_RADIUS = 199
BRAND_BG = (11, 23, 54)                 # #0b1736, matches capacitor.config.json


def flood_cut(im, thresh=95, feather=0.7):
    """Make transparent every dark pixel reachable from the canvas edge."""
    im = im.convert('RGBA')
    w, h = im.size
    px = im.load()
    dark = lambda p: max(p[0], p[1], p[2]) < thresh
    seen = bytearray(w * h)
    q = deque()

    def seed(x, y):
        if dark(px[x, y]) and not seen[y * w + x]:
            seen[y * w + x] = 1
            q.append((x, y))

    for x in range(w):
        seed(x, 0)
        seed(x, h - 1)
    for y in range(h):
        seed(0, y)
        seed(w - 1, y)
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and dark(px[nx, ny]):
                seen[ny * w + nx] = 1
                q.append((nx, ny))

    alpha = Image.new('L', (w, h), 255)
    ap = alpha.load()
    for y in range(h):
        for x in range(w):
            if seen[y * w + x]:
                ap[x, y] = 0
    im.putalpha(alpha.filter(ImageFilter.GaussianBlur(feather)))
    return im.crop(im.getbbox())


def rounded_cut(im, box, radius, ss=4):
    """Crop to `box`, keeping only the rounded rectangle within it."""
    left, top, right, bottom = box
    w, h = right - left + 1, bottom - top + 1
    mask = Image.new('L', (w * ss, h * ss), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, w * ss - 1, h * ss - 1], radius=radius * ss, fill=255)
    badge = im.convert('RGBA').crop((left, top, right + 1, bottom + 1))
    badge.putalpha(mask.resize((w, h), Image.LANCZOS))    # supersampled = smooth edge
    return badge


def square(badge, size, scale=1.0, background=None):
    """Centre the badge on a square canvas without distorting it."""
    art = badge.copy()
    art.thumbnail((max(1, int(size * scale)),) * 2, Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (*background, 255) if background else (0, 0, 0, 0))
    canvas.paste(art, ((size - art.width) // 2, (size - art.height) // 2), art)
    return canvas


def main():
    emblem = rounded_cut(Image.open(ART / 'emblem-source.png'), EMBLEM_BOX, EMBLEM_RADIUS)
    emblem.save(PUB / 'emblem.png')
    print('public/emblem.png            %dx%d  rounded-cut' % emblem.size)

    badge = flood_cut(Image.open(ART / 'app-icon-source.png'))
    print('app badge                    %dx%d  flood-cut' % badge.size)

    for name, size in (('icon-512.png', 512), ('icon-192.png', 192), ('logo.png', 96)):
        square(badge, size).save(PUB / name)
        print('public/%-22s %dx%d' % (name, size, size))

    # iOS ignores transparency and applies its own mask, so this one keeps a
    # filled background rather than compositing the corners to black.
    square(badge, 180, background=BRAND_BG).save(PUB / 'apple-touch-icon.png')
    print('public/apple-touch-icon.png  180x180  opaque (iOS masks it)')

    # A maskable icon is cropped to whatever shape the launcher wants, so the
    # badge sits inside the safe zone on a filled square.
    square(badge, 512, scale=0.66, background=BRAND_BG).save(PUB / 'icon-maskable-512.png')
    print('public/icon-maskable-512.png 512x512  safe-zone, opaque')

    square(badge, 64).save(PUB / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    print('public/favicon.ico           16/32/48/64')

    # Android launcher icons. The project generated by `npx cap add android`
    # ships Capacitor's own icon, so these are copied over it during the build
    # (see build-apk.yml). Legacy rasters cover pre-26; 26+ uses the adaptive
    # pair, where the system applies its own mask and the foreground therefore
    # sits in the inner 66% so no launcher shape can clip the badge.
    for folder, legacy, fg in (('mdpi', 48, 108), ('hdpi', 72, 162), ('xhdpi', 96, 216),
                               ('xxhdpi', 144, 324), ('xxxhdpi', 192, 432)):
        out = ANDROID / ('mipmap-' + folder)
        out.mkdir(parents=True, exist_ok=True)
        square(badge, legacy).save(out / 'ic_launcher.png')
        square(badge, legacy).save(out / 'ic_launcher_round.png')
        square(badge, fg, scale=0.66).save(out / 'ic_launcher_foreground.png')
        print('resources/android mipmap-%-7s legacy %3d  adaptive %3d' % (folder, legacy, fg))

    anydpi = ANDROID / 'mipmap-anydpi-v26'
    anydpi.mkdir(parents=True, exist_ok=True)
    adaptive = ('<?xml version="1.0" encoding="utf-8"?>\n'
                '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
                '    <background android:drawable="@color/ic_launcher_background" />\n'
                '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n'
                '</adaptive-icon>\n')
    (anydpi / 'ic_launcher.xml').write_text(adaptive)
    (anydpi / 'ic_launcher_round.xml').write_text(adaptive)

    values = ANDROID / 'values'
    values.mkdir(parents=True, exist_ok=True)
    (values / 'ic_launcher_background.xml').write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
        '    <color name="ic_launcher_background">#%02x%02x%02x</color>\n</resources>\n' % BRAND_BG)
    print('resources/android adaptive icon on #%02x%02x%02x' % BRAND_BG)


if __name__ == '__main__':
    main()
