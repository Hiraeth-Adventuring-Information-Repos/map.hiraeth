#!/usr/bin/env python3
"""Compile reviewed roof traces for Stomion, with reproducible image QA.

Input seeds are image pixels (x right, y down), individually read from the
artwork. Output uses the atlas's CRS.Simple coordinates [3072-y, x]. These
traces are a proposed street-address inventory; the artwork does not establish
occupancy, historical street names or the number of households in a building.

Run with the artifact Python runtime (Pillow and numpy). OpenCV is optional:
PYTHONPATH=/tmp/stomion-cv /home/codex/tools/artifacts/bin/python scripts/stomion_buildings.py
"""
import argparse
import hashlib
import json
import math
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DESIGN = ROOT / "design" / "stomion"
SOURCE = ROOT / "maps" / "The-Port-City-of-Stomion.webp"
HEIGHT = 3072


def rectangle(seed):
    x, y = seed["x"], seed["y"]
    w, h = seed.get("w", 16), seed.get("h", 16)
    angle = math.radians(seed.get("angle", 0))
    c, s = math.cos(angle), math.sin(angle)
    return [[round(x + u*c - v*s, 2), round(y + u*s + v*c, 2)]
            for u, v in [(-w/2, -h/2), (w/2, -h/2), (w/2, h/2), (-w/2, h/2)]]


def source_polygon(seed, frame=None):
    polygon = seed.get("footprint") or rectangle(seed)
    center = [seed["x"], seed["y"]]
    if frame:
        # Inputs from a rotated inspection image are inverted back to artwork.
        angle = math.radians(frame["rotateDegrees"])
        c, s = math.cos(angle), math.sin(angle)
        cx, cy = frame["center"]
        def inverse(point):
            x, y = point[0]-cx, point[1]-cy
            return [round(cx+c*x-s*y, 2), round(cy+s*x+c*y, 2)]
        polygon = [inverse(point) for point in polygon]
        center = inverse(center)
    return center, polygon


def geometry_report(buildings):
    """Check authored geometry without claiming raster accuracy or completeness."""
    def cross(a, b, c):
        return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])

    def contains(point, polygon):
        y, x = point
        contained = False
        for a, b in zip(polygon, polygon[1:]+polygon[:1]):
            ay, ax = a
            by, bx = b
            if abs(cross(a, b, point)) < 1e-7 and min(ay, by) <= y <= max(ay, by) and min(ax, bx) <= x <= max(ax, bx):
                return True
            if (ay > y) != (by > y) and x < (bx-ax)*(y-ay)/(by-ay)+ax:
                contained = not contained
        return contained

    report = {"buildingCount": len(buildings), "duplicateIds": [],
              "properPolygonSelfIntersections": [], "centersOutsidePolygon": [],
              "degeneratePolygons": [], "outOfArtworkBounds": [],
              "nearDuplicateCentersWithin7ArtworkPixels": [],
              "validationLimit": "Geometry sanity checks do not establish exact roof boundaries or exhaustiveness of source inventory."}
    ids, buckets = set(), {}
    for building in buildings:
        identifier, polygon = building["id"], building["footprint"]
        if identifier in ids:
            report["duplicateIds"].append(identifier)
        ids.add(identifier)
        n = len(polygon)
        for i in range(n):
            a, b = polygon[i], polygon[(i+1) % n]
            for j in range(i+2, n):
                if i == 0 and j == n-1:
                    continue
                c, d = polygon[j], polygon[(j+1) % n]
                if cross(a, b, c)*cross(a, b, d) < -1e-8 and cross(c, d, a)*cross(c, d, b) < -1e-8:
                    report["properPolygonSelfIntersections"].append([identifier, i, j])
        if not contains(building["coordinates"], polygon):
            report["centersOutsidePolygon"].append(identifier)
        area = abs(sum(a[1]*b[0]-b[1]*a[0] for a, b in zip(polygon, polygon[1:]+polygon[:1]))/2)
        if area < 1:
            report["degeneratePolygons"].append(identifier)
        if any(not (0 <= y <= HEIGHT and 0 <= x <= 4096) for y, x in [building["coordinates"]]+polygon):
            report["outOfArtworkBounds"].append(identifier)
        y, x = building["coordinates"]
        cell = math.floor(y/7), math.floor(x/7)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for other in buckets.get((cell[0]+dy, cell[1]+dx), []):
                    if math.dist(other["coordinates"], building["coordinates"]) < 7:
                        report["nearDuplicateCentersWithin7ArtworkPixels"].append([other["id"], identifier])
        buckets.setdefault(cell, []).append(building)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tiles", action="store_true", help="Write 512-pixel QA tiles as well as whole-map overlay.")
    args = parser.parse_args()
    image = Image.open(SOURCE).convert("RGB")
    if image.size != (4096, HEIGHT):
        raise ValueError("Unexpected artwork size; audit coordinate conversion.")
    records = []
    seed_files = sorted(DESIGN.glob("seeds-*.json"))
    if not seed_files:
        raise ValueError("No reviewed roof seed files were found.")
    for path in seed_files:
        document = json.loads(path.read_text())
        for index, item in enumerate(document["seeds"]):
            seed = item if isinstance(item, dict) else dict(zip(["x", "y", "w", "h", "angle"], item))
            center, polygon = source_polygon(seed, document.get("frame"))
            if not (0 <= center[0] <= 4096 and 0 <= center[1] <= HEIGHT):
                raise ValueError(f"{path.name} seed {index+1} is outside the artwork.")
            records.append({"source": path.name, "sourceIndex": index+1,
                            "district": document["district"], "seed": seed,
                            "reviewStatus": document.get("reviewStatus", "draft"),
                            "center": center, "polygon": polygon})
    records.sort(key=lambda r: (round(r["center"][1], 2), round(r["center"][0], 2), r["source"]))
    buildings = []
    for index, r in enumerate(records):
        x, y = r["center"]
        seed = r["seed"]
        building = {
            "id": seed.get("id") or f"stomion-building-{re.sub(r'[^a-z0-9-]', '-', r['source'].removeprefix('seeds-').removesuffix('.json').lower())}-{r['sourceIndex']:04d}",
            "coordinates": [round(HEIGHT-y, 2), round(x, 2)],
            "footprint": [[round(HEIGHT-py, 2), round(px, 2)] for px, py in r["polygon"]],
            "district": r["district"],
            "kind": seed.get("kind", "building"),
            "traceSource": {"file": r["source"], "seed": r["sourceIndex"]},
            "traceMethod": seed.get("method", "manual roof outline"),
            "confidence": seed.get("confidence", r["reviewStatus"]),
        }
        if seed.get("name"):
            building["name"] = seed["name"]
        if seed.get("aliases"):
            building["aliases"] = seed["aliases"]
        if seed.get("notes"):
            building["notes"] = seed["notes"]
        if seed.get("entrance"):
            ex, ey = seed["entrance"]
            building["entrance"] = [round(HEIGHT-ey, 2), round(ex, 2)]
        if seed.get("entranceSource"):
            building["entranceSource"] = seed["entranceSource"]
        if seed.get("accessReviewNote"):
            building["accessReviewNote"] = seed["accessReviewNote"]
        buildings.append(building)
    geometry = geometry_report(buildings)
    (DESIGN / "building-geometry-report.json").write_text(json.dumps(geometry, indent=2)+"\n")
    metadata = {
        "mapId": "The-Port-City-of-Stomion",
        "image": str(SOURCE.relative_to(ROOT)), "imageWidth": 4096, "imageHeight": HEIGHT,
        "imageSha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        "coordinateSystem": "CRS.Simple [imageHeight-imageY, imageX]",
        "inventoryMethod": "Manual roof outlines and transverse terrace separators from the source raster; review state is recorded per building.",
        "seedFiles": [str(p.relative_to(ROOT)) for p in seed_files],
        "scope": "Visible roof structures on the city, connected islands and shore settlements.",
        "occupancy": "The raster cannot establish residential use or household counts; one address is assigned per traced structure.",
    }
    obstacle_path = DESIGN / 'unaddressed-roofs.json'
    obstacles = []
    if obstacle_path.exists():
        for item in json.loads(obstacle_path.read_text()).get('roofs', []):
            obstacles.append({**item, 'coordinates': [HEIGHT-item['coordinates'][1], item['coordinates'][0]],
                'footprint': [[HEIGHT-y, x] for x, y in item['footprint']]})
    (DESIGN / "buildings.json").write_text(json.dumps({"metadata": metadata, "buildings": buildings, "obstacles": obstacles}, indent=2)+"\n")
    overlay = image.convert("RGBA")
    shade = Image.new("RGBA", image.size)
    draw = ImageDraw.Draw(shade)
    for index, r in enumerate(records):
        draw.polygon([tuple(p) for p in r["polygon"]], fill=(30, 185, 255, 44), outline=(10, 226, 255, 240), width=1)
        x, y = r["center"]
        draw.ellipse((x-2, y-2, x+2, y+2), fill=(255, 45, 60, 255))
        draw.text((x+3, y-4), str(index+1), fill=(255,255,70,255), stroke_width=1, stroke_fill=(0,0,0,180))
    overlay = Image.alpha_composite(overlay, shade).convert("RGB")
    overlay.save(DESIGN / "building-review-overlay.png")
    if args.tiles:
        tiledir = DESIGN / "review" / "building-tiles"
        tiledir.mkdir(parents=True, exist_ok=True)
        # A removed river/paving candidate may leave a tile with no structures.
        # Remove only this generator's tiles so old labels cannot survive a
        # corrected inventory and appear to be part of the current review.
        for old_tile in tiledir.rglob("x[0-9][0-9][0-9][0-9]-y[0-9][0-9][0-9][0-9].png"):
            old_tile.unlink()
        for y in range(0, HEIGHT, 512):
            for x in range(0, 4096, 512):
                if any(x <= r["center"][0] < x+512 and y <= r["center"][1] < y+512 for r in records):
                    overlay.crop((x,y,min(x+512,4096),min(y+512,HEIGHT))).resize((1024,1024)).save(tiledir / f"x{x:04d}-y{y:04d}.png")
        # A source-index overlay makes corrections independent of other authors.
        for path in seed_files:
            selected = [r for r in records if r["source"] == path.name]
            group_overlay = image.copy()
            group_draw = ImageDraw.Draw(group_overlay)
            for r in selected:
                group_draw.polygon([tuple(p) for p in r["polygon"]], outline=(10,226,255), width=1)
                x, y = r["center"]
                group_draw.ellipse((x-1,y-1,x+1,y+1), fill=(255,45,60))
                group_draw.text((x+3,y-4), str(r["sourceIndex"]), fill=(255,255,70), stroke_width=1, stroke_fill=(0,0,0))
            groupdir = tiledir / path.stem.removeprefix("seeds-")
            groupdir.mkdir(exist_ok=True)
            for y in range(0, HEIGHT, 512):
                for x in range(0, 4096, 512):
                    if any(x <= r["center"][0] < x+512 and y <= r["center"][1] < y+512 for r in selected):
                        group_overlay.crop((x,y,min(x+512,4096),min(y+512,HEIGHT))).resize((1024,1024)).save(groupdir / f"x{x:04d}-y{y:04d}.png")
    districts = {}
    for building in buildings:
        districts[building["district"]] = districts.get(building["district"], 0)+1
    report = {"buildingCount": len(buildings), "districtCounts": districts, "nearDuplicateCenters": geometry["nearDuplicateCentersWithin7ArtworkPixels"],
              "reviewStatusCounts": {state: sum(b["confidence"] == state for b in buildings) for state in sorted({b["confidence"] for b in buildings})},
              "missingDimensions": [b["id"] for b, r in zip(buildings, records) if not r["seed"].get("footprint") and ("w" not in r["seed"] or "h" not in r["seed"])],
              "coverageStatus": "Inspect numbered full-resolution tiles against the source before claiming an exhaustive inventory.",
              "overlay": "design/stomion/building-review-overlay.png"}
    (DESIGN / "building-quality-report.json").write_text(json.dumps(report, indent=2)+"\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
