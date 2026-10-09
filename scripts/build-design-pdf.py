"""Package the actual frontend screenshots as a readable digital design document."""

import json
from pathlib import Path
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from pypdf import PdfReader

root = Path(__file__).resolve().parents[1]
shots = root / "output" / "screenshots"
pages = json.loads((shots / "manifest.json").read_text())
target = root / "frontend_designs.pdf"
c = canvas.Canvas(str(target), pagesize=(1100, 850))
c.setTitle("Zoom Workplace - Frontend Designs")
c.setAuthor("Zoom Meeting Platform")
c.setFillColor(HexColor("#f7f9fc"))
c.rect(0, 0, 1100, 850, fill=1, stroke=0)
c.setFillColor(HexColor("#0b5cff"))
c.setFont("Helvetica-Bold", 30)
c.drawString(55, 780, "zoom  Workplace")
c.setFillColor(HexColor("#202a3a"))
c.setFont("Helvetica-Bold", 39)
c.drawString(55, 699, "Frontend designs")
c.setFont("Helvetica", 16)
c.setFillColor(HexColor("#718097"))
c.drawString(55, 660, "Video conferencing platform | Desktop and mobile")
c.setFont("Helvetica", 12)
c.drawString(
    55, 626, f"{len(pages)} screens captured from the running Next.js application."
)
c.drawString(
    55, 604, "Design preview data is used here; the backend is implemented separately."
)
c.drawImage(
    ImageReader(str(shots / "01-dashboard.png")),
    55,
    170,
    width=475,
    height=403,
    preserveAspectRatio=True,
    anchor="n",
)
c.setFillColor(HexColor("#3f506b"))
c.setFont("Helvetica-Bold", 14)
c.drawString(605, 558, "SCREEN INDEX")
for index, p in enumerate(pages):
    c.setFont("Helvetica", 11)
    c.setFillColor(HexColor("#77879d"))
    c.drawString(605, 528 - index * 19, f"{index + 1:02d}   {p['title']}")
c.setFont("Helvetica", 10)
c.drawString(55, 55, "8 October 2026 | Assignment implementation | Original code")
c.showPage()
for index, p in enumerate(pages):
    file = shots / p["file"]
    iw, ih = Image.open(file).size
    scale = 1 if iw > 600 else 1.15
    width = max(900, iw * scale + 96)
    height = ih * scale + 165
    c.setPageSize((width, height))
    c.setFillColor(HexColor("#f7f9fc"))
    c.rect(0, 0, width, height, fill=1, stroke=0)
    c.setFillColor(HexColor("#0b5cff"))
    c.setFont("Helvetica-Bold", 11)
    c.drawString(
        48, height - 35, f"ZOOM WORKPLACE   /   FRONTEND DESIGN   /   {index + 1:02d}"
    )
    c.setFillColor(HexColor("#202a3a"))
    c.setFont("Helvetica-Bold", 25)
    c.drawString(48, height - 70, p["title"])
    c.setFillColor(HexColor("#7c899c"))
    c.setFont("Helvetica", 11)
    c.drawString(48, height - 93, p["description"])
    c.drawImage(
        ImageReader(str(file)),
        (width - iw * scale) / 2,
        48,
        width=iw * scale,
        height=ih * scale,
    )
    c.setFillColor(HexColor("#8e9aad"))
    c.setFont("Helvetica", 9)
    c.drawString(
        48,
        21,
        f"{iw} x {ih} viewport capture | Design preview | Page {index + 2} of {len(pages) + 1}",
    )
    c.showPage()
c.save()
reader = PdfReader(target)
assert len(reader.pages) == len(pages) + 1
assert all(page.extract_text().strip() for page in reader.pages)
print(
    f"Created {target.name}: {len(reader.pages)} pages, {target.stat().st_size:,} bytes"
)
