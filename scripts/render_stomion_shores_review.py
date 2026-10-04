#!/usr/bin/env python3
"""Render immutable shore-review decisions against native Stomion artwork.

This renders evidence only; it never edits authored seeds or their confidence.
Run with /home/codex/tools/artifacts/bin/python.
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
REVIEW = ROOT / "design/stomion/shores-final-review.json"
OUTPUT = ROOT / "design/stomion/review/shores-final"


def crop(image, center, scale):
    x, y = center
    bounds = (int(x)-40, int(y)-40, int(x)+40, int(y)+40)
    result = image.crop(bounds).resize((80*scale, 80*scale), Image.Resampling.NEAREST)
    draw = ImageDraw.Draw(result)
    cx, cy = (x-bounds[0])*scale, (y-bounds[1])*scale
    draw.line((cx-6, cy, cx+6, cy), fill="red", width=1)
    draw.line((cx, cy-6, cx, cy+6), fill="red", width=1)
    return result


def contact_sheets(image, records, prefix, columns, scale, corrected=False):
    size = 80*scale
    per_sheet = columns*columns
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 17)
    for start in range(0, len(records), per_sheet):
        sheet = Image.new("RGB", (columns*size, columns*(size+24)), (10, 10, 10))
        draw = ImageDraw.Draw(sheet)
        for index, record in enumerate(records[start:start+per_sheet]):
            center = record.get("recommendedCenter", record["originalCenter"]) if corrected else record["originalCenter"]
            x, y = center
            sx, sy = index % columns*size, index // columns*(size+24)
            draw.text((sx+3, sy+1), record["id"].split("-")[-1]+f" ({x:g},{y:g})", fill="white", font=font)
            sheet.paste(crop(image, center, scale), (sx, sy+24))
        sheet.save(OUTPUT / f"{prefix}-{start//per_sheet+1:02d}.png")


def main():
    report = json.loads(REVIEW.read_text())
    image = Image.open(ROOT / report["sourceImage"]).convert("RGB")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    records = report["records"]
    contact_sheets(image, records, "contact", 4, 5)
    corrected = [record for record in records if record["status"] == "correct"]
    contact_sheets(image, corrected, "corrected", 3, 6, corrected=True)
    for record in records:
        if record["status"] in ("retain", "correct"):
            center = record.get("recommendedCenter", record["originalCenter"])
            crop(image, center, 6).save(OUTPUT / f"verified-center-{record['id']}.png")
    overlay = image.copy()
    draw = ImageDraw.Draw(overlay)
    for record in records:
        x, y = record["originalCenter"]
        if record["status"] in ("remove", "ambiguous"):
            draw.line((x-4, y-4, x+4, y+4), fill=(255, 40, 60), width=2)
            draw.line((x-4, y+4, x+4, y-4), fill=(255, 40, 60), width=2)
        else:
            nx, ny = record.get("recommendedCenter", [x, y])
            draw.line((x, y, nx, ny), fill=(255, 170, 0), width=1)
            draw.ellipse((nx-2, ny-2, nx+2, ny+2), fill=(0, 245, 150))
            draw.text((nx+3, ny-4), record["id"].split("-")[-1], fill=(0, 245, 150), stroke_width=1, stroke_fill="black")
    overlay.save(OUTPUT / "whole-map-decisions.png")
    print(f"Rendered {len(records)} decisions, including {len(corrected)} corrected centers.")


if __name__ == "__main__":
    main()
