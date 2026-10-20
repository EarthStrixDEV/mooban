"""Validates fixtures produced by tools/make-test-images.py (Spec 8)."""
import os
import unittest
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / "tests" / "fixtures"
SAMPLE = ROOT / "shared" / "public" / "sample.jpg"
LIMIT = 10 * 1024 * 1024
PASSING = ["test-1mp.jpg", "test-12mp.jpg", "test-24mp.jpg", "test-alpha.png", "test-exif.jpg"]


class FixtureTests(unittest.TestCase):
    def size(self, name):
        with Image.open(FIX / name) as im:
            return im.size

    def test_dimensions(self):
        self.assertEqual(self.size("test-1mp.jpg"), (1000, 1000))
        self.assertEqual(self.size("test-12mp.jpg"), (4000, 3000))
        self.assertEqual(self.size("test-24mp.jpg"), (6000, 4000))
        self.assertEqual(self.size("test-alpha.png"), (800, 600))
        self.assertEqual(self.size("test-exif.jpg"), (1600, 1200))
        self.assertEqual(self.size("test-25mp.jpg"), (5000, 5000))

    def test_passing_files_within_limit(self):
        for name in PASSING:
            self.assertLessEqual((FIX / name).stat().st_size, LIMIT, name)

    def test_alpha(self):
        with Image.open(FIX / "test-alpha.png") as im:
            self.assertEqual(im.mode, "RGBA")
            lo, _ = im.getchannel("A").getextrema()
            self.assertLess(lo, 255)

    def test_exif(self):
        with Image.open(FIX / "test-exif.jpg") as im:
            exif = im.getexif()
            self.assertEqual(exif.get(0x0112), 6)
            gps = exif.get_ifd(0x8825)
            self.assertTrue(gps)
            self.assertIn(2, gps)  # GPSLatitude

    def test_24mp_not_flat(self):
        with Image.open(FIX / "test-24mp.jpg") as im:
            self.assertEqual(im.size[0] * im.size[1], 24_000_000)
            crop = im.crop((0, 0, 512, 512)).convert("L")
            lo, hi = crop.getextrema()
            self.assertGreater(hi - lo, 30)

    def test_11mb(self):
        p = FIX / "test-11mb.jpg"
        self.assertEqual(p.stat().st_size, 11 * 1048576)
        self.assertEqual(p.read_bytes()[:3], b"\xff\xd8\xff")

    def test_fake(self):
        p = FIX / "test-fake.jpg"
        head = p.read_bytes()[:16]
        self.assertFalse(head.startswith(b"\xff\xd8\xff"))
        self.assertFalse(head.startswith(b"\x89PNG"))
        self.assertFalse(head.startswith(b"RIFF"))
        with self.assertRaises(Exception):
            with Image.open(p) as im:
                im.load()

    def test_corrupt_png(self):
        p = FIX / "test-corrupt.png"
        data = p.read_bytes()
        self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
        self.assertEqual(data[12:16], b"IHDR")
        with Image.open(p) as im:
            self.assertGreater(im.size[0], 0)
            with self.assertRaises(Exception):
                im.load()

    def test_sample(self):
        with Image.open(SAMPLE) as im:
            self.assertEqual(im.format, "JPEG")
            self.assertEqual(im.size, (1600, 1200))
        self.assertLessEqual(SAMPLE.stat().st_size, LIMIT)


if __name__ == "__main__":
    unittest.main()
