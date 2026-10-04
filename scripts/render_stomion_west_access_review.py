#!/usr/bin/env python3
"""Render current native-art roof/access evidence without changing source seeds.

The access report retains original provisional connector evidence. These images
show the current source inputs, with cyan outlines, red roof centers, and yellow
exterior access points. Artwork pixels, including narrow paved gaps, remain the
independent reference; this renderer does not verify roof completeness or doors.
"""
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw

from stomion_buildings import ROOT, DESIGN, SOURCE, source_polygon


def main():
    report = json.loads((DESIGN / "west-access-final-review.json").read_text())
    edits = json.loads((DESIGN / "west-access-source-edits.json").read_text())
    seeds = {}
    for path in DESIGN.glob("seeds-*.json"):
        document = json.loads(path.read_text())
        for seed in document.get("seeds", []):
            seeds[seed["id"]] = (seed, document.get("frame"))
    source = Image.open(SOURCE).convert("RGB")
    out = DESIGN / "review" / "west-access-final"
    out.mkdir(parents=True, exist_ok=True)
    ids = list(dict.fromkeys([row["id"] for row in edits["edits"]]
                            + [row["id"] for row in report["reviewedCoreCases"]]
                            + [row["id"] for row in report["issues"] if row["id"] in seeds]))
    edited_ids = {row["id"] for row in edits["edits"]}
    contacts = []
    for identifier in ids:
        seed, frame = seeds[identifier]
        center, polygon = source_polygon(seed, frame)
        for size, grid, suffix in [(120, True, "native"), (80, False, "edited")]:
            scale = 5
            x0, y0 = [round(value - size / 2) for value in center]
            image = source.crop((x0, y0, x0 + size, y0 + size)).resize((size * scale, size * scale))
            draw = ImageDraw.Draw(image)
            if grid:
                for x in range(math.ceil(x0 / 10) * 10, x0 + size, 10):
                    px = (x - x0) * scale
                    draw.line((px, 0, px, image.height), fill=(120, 100, 100))
                    draw.text((px + 2, 2), str(x), fill="white")
                for y in range(math.ceil(y0 / 10) * 10, y0 + size, 10):
                    py = (y - y0) * scale
                    draw.line((0, py, image.width, py), fill=(120, 100, 100))
                    draw.text((2, py + 2), str(y), fill="white")
            draw.line([((x - x0) * scale, (y - y0) * scale) for x, y in polygon + [polygon[0]]], fill="cyan", width=2)
            px, py = (center[0] - x0) * scale, (center[1] - y0) * scale
            draw.ellipse((px - 3, py - 3, px + 3, py + 3), fill="red")
            if seed.get("entrance"):
                ex, ey = seed["entrance"]  # Always original artwork pixels.
                px, py = (ex - x0) * scale, (ey - y0) * scale
                draw.ellipse((px - 4, py - 4, px + 4, py + 4), fill="yellow")
            draw.text((5, image.height - 18), identifier.removeprefix("stomion-building-"), fill="white", stroke_fill="black", stroke_width=1)
            image.save(out / f"{identifier}-{suffix}.png")
            if suffix == "edited" and identifier in edited_ids:
                contacts.append(image)
    for path in out.glob("edited-contact-*.png"):
        path.unlink()
    for index in range(0, len(contacts), 4):
        sheet = Image.new("RGB", (800, 800), "black")
        for offset, image in enumerate(contacts[index:index + 4]):
            sheet.paste(image, (offset % 2 * 400, offset // 2 * 400))
        sheet.save(out / f"edited-contact-{index // 4 + 1:02d}.png")
    print(json.dumps({"currentSourceCrops": len(ids), "editedSeedCrops": len(contacts), "output": str(out.relative_to(ROOT))}))


if __name__ == "__main__":
    main()
