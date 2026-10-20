#!/usr/bin/env python3
"""Generate Mooban test fixtures (Spec 8) and shared/public/sample.jpg.

Usage: python tools/make-test-images.py --out tests/fixtures --sample shared/public/sample.jpg

All images are synthetic (gradients, shapes, noise); deterministic via fixed seeds.
"""
import argparse
import random
import struct
from pathlib import Path

from PIL import Image, ImageDraw

MB = 1048576


def synth(w, h, seed, noise=0.0, shapes=40):
    """Gradient background + random shapes (+ optional noise). No faces, no copyrighted content."""
    rnd = random.Random(seed)
    g = Image.linear_gradient("L").resize((w, h), Image.BILINEAR)
    g2 = g.transpose(Image.ROTATE_90).resize((w, h), Image.BILINEAR)
    base = Image.merge("RGB", (g, g2, g.point(lambda v: 255 - v)))
    d = ImageDraw.Draw(base)
    for _ in range(shapes):
        x, y = rnd.randrange(w), rnd.randrange(h)
        r = rnd.randrange(max(2, min(w, h) // 20), max(3, min(w, h) // 5))
        col = tuple(rnd.randrange(256) for _ in range(3))
        if rnd.random() < 0.5:
            d.ellipse((x - r, y - r, x + r, y + r), fill=col)
        else:
            d.rectangle((x - r, y - r // 2, x + r, y + r // 2), fill=col)
    if noise:
        # Coarse noise (1/4 resolution) keeps decode cost realistic while bounding file size.
        n = Image.effect_noise((max(1, w // 4), max(1, h // 4)), noise).resize((w, h), Image.BILINEAR)
        n = Image.merge("RGB", (n, n, n))
        base = Image.blend(base, n, 0.35)
    return base


def make_exif(w, h):
    exif = Image.Exif()
    exif[0x0112] = 6  # Orientation: rotate 90 CW to display
    exif[0x010F] = "Mooban Synthetic"
    gps = exif.get_ifd(0x8825)
    gps[1] = "N"
    gps[2] = (13.0, 45.0, 0.0)  # fake: 13 deg 45m 0s N
    gps[3] = "E"
    gps[4] = (100.0, 30.0, 0.0)  # fake: 100 deg 30m 0s E
    return exif


def corrupt_png(path, rnd):
    buf = path.with_suffix(".tmp.png")
    Image.new("RGB", (800, 600), (40, 90, 160)).save(buf, "PNG")
    data = buf.read_bytes()
    buf.unlink()
    head = data[:8 + 25]  # signature + IHDR chunk (4 len + 4 type + 13 data + 4 crc)
    assert head[12:16] == b"IHDR"
    garbage = bytes(rnd.randrange(256) for _ in range(4096))
    path.write_bytes(head + struct.pack(">I", 4096) + b"IDAT" + garbage)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--sample", required=True)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    sample = Path(a.sample)
    sample.parent.mkdir(parents=True, exist_ok=True)

    synth(1000, 1000, 1, noise=40).save(out / "test-1mp.jpg", "JPEG", quality=85)
    synth(4000, 3000, 2, noise=40).save(out / "test-12mp.jpg", "JPEG", quality=85)
    synth(6000, 4000, 3, noise=60).save(out / "test-24mp.jpg", "JPEG", quality=60)

    alpha = synth(800, 600, 4).convert("RGBA")
    mask = Image.new("L", (800, 600), 255)
    md = ImageDraw.Draw(mask)
    md.ellipse((150, 100, 450, 400), fill=0)  # fully transparent hole
    md.rectangle((500, 50, 750, 300), fill=128)  # semi-transparent
    alpha.putalpha(mask)
    alpha.save(out / "test-alpha.png", "PNG")

    synth(1600, 1200, 5, noise=40).save(out / "test-exif.jpg", "JPEG", quality=85, exif=make_exif(1600, 1200))

    synth(5000, 5000, 6, noise=40).save(out / "test-25mp.jpg", "JPEG", quality=60)

    p11 = out / "test-11mb.jpg"
    synth(2000, 1500, 7, noise=40).save(p11, "JPEG", quality=85)
    size = p11.stat().st_size
    assert size < 11 * MB
    with open(p11, "ab") as f:
        f.write(b"\x00" * (11 * MB - size))

    (out / "test-fake.jpg").write_text("This is not an image. It is a plain text file named .jpg.\n", encoding="utf-8", newline="\n")

    corrupt_png(out / "test-corrupt.png", random.Random(8))

    synth(1600, 1200, 9, noise=30, shapes=60).save(sample, "JPEG", quality=85)


if __name__ == "__main__":
    main()
