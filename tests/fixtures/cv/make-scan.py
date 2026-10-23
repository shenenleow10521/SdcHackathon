# Renders a CV text file to a "scanned" or "photo-like" image, for OCR tests (dev tool only; needs Pillow).
#   python tests/fixtures/cv/make-scan.py tests/fixtures/cv/priya-nair.txt tests/fixtures/cv/priya-scan.png --lines 24
#   python tests/fixtures/cv/make-scan.py demo/priya-cv.txt out.jpg --photo
# --photo adds an uneven grey background, a small tilt and noise, then saves a lower-quality JPEG.
import argparse, random, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

FONTS = ["C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/System/Library/Fonts/Helvetica.ttc"]

def font(size):
    for f in FONTS:
        try: return ImageFont.truetype(f, size)
        except OSError: pass
    sys.exit("No TrueType font found; edit FONTS in make-scan.py")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src"); ap.add_argument("out")
    ap.add_argument("--lines", type=int, default=0, help="only the first N lines (0 = all)")
    ap.add_argument("--width", type=int, default=1240, help="page width in pixels (1240 = A4 at 150 dpi)")
    ap.add_argument("--photo", action="store_true")
    a = ap.parse_args()
    random.seed(7)
    lines = open(a.src, encoding="utf-8").read().splitlines()
    if a.lines: lines = lines[:a.lines]
    size = round(a.width / 75)          # about 10 pt text on A4
    f, lh, margin = font(size), round(size * 1.45), round(a.width / 14)
    h = margin * 2 + lh * len(lines)
    img = Image.new("L", (a.width, h), 255)
    d = ImageDraw.Draw(img)
    for i, line in enumerate(lines): d.text((margin, margin + i * lh), line, fill=20, font=f)
    if a.photo:
        img = img.rotate(1.5, resample=Image.BICUBIC, expand=True, fillcolor=255)
        w, hh = img.size
        shade = Image.linear_gradient("L").resize((w, hh)).point(lambda v: 255 - v // 5)   # darker towards the bottom
        img = Image.composite(img, shade, img.point(lambda v: 255 if v < 128 else 0))
        noise = Image.effect_noise((w, hh), 18)
        img = Image.blend(img, noise, 0.12).filter(ImageFilter.GaussianBlur(0.6))
        img.convert("RGB").save(a.out, quality=70)
    else:
        img.save(a.out, optimize=True) if a.out.endswith(".png") else img.save(a.out, quality=85)
    print(f"wrote {a.out} {img.size[0]}x{img.size[1]}")

main()
