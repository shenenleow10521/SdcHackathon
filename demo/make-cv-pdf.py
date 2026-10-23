# Builds demo/priya-cv.pdf from demo/priya-cv.txt (one A4 page). Needs reportlab: python demo/make-cv-pdf.py
# Layout rules: line 1 = name (large, bold), line 2 = headline, ALL-CAPS lines = section headings,
# lines starting with " - " = bullets, other lines = plain text. Blank lines add a small gap.
from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

here = Path(__file__).resolve().parent
lines = (here / "priya-cv.txt").read_text(encoding="utf-8").splitlines()
c = canvas.Canvas(str(here / "priya-cv.pdf"), pagesize=A4)
c.setTitle("Priya Nair - CV (sample, fictional)")
c.setAuthor("HalaTuju demo (synthetic sample)")
W, H = A4
x, y = 50, H - 56

def text(s, font="Helvetica", size=9.5, dx=0, gap=12.5):
    global y
    c.setFont(font, size)
    c.drawString(x + dx, y, s)
    y -= gap

for i, raw in enumerate(lines):
    s = raw.rstrip()
    if i == 0:
        text(s, "Helvetica-Bold", 18, gap=20)
    elif i == 1:
        text(s.strip(), "Helvetica", 11, gap=16)
    elif not s:
        y -= 4
    elif s.isupper() and len(s) < 40 and not any(ch.isdigit() for ch in s):
        y -= 3
        text(s, "Helvetica-Bold", 10.5, gap=4)
        c.setLineWidth(0.5); c.line(x, y, W - x, y); y -= 10
    elif s.startswith(" - "):
        text("•  " + s[3:], dx=6)
    elif s.startswith("   "):
        text(s.strip(), dx=16)
    elif s.startswith("Sample CV for the HalaTuju demo"):
        y -= 6
        text(s, "Helvetica-Oblique", 8)
    else:
        text(s)

c.showPage()
c.save()
print("wrote", here / "priya-cv.pdf", "bottom margin", round(y))
