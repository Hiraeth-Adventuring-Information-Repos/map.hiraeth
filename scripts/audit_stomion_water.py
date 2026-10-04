#!/usr/bin/env python3
"""Compare complete pedestrian geometry to the reviewed water/bridge mask.

The conservative water mask is source review evidence, not a claim to classify
every pixel of the artist's waterways. Bridge corridors are cut by its author.
This independent audit never reroutes a line or hides a disagreement.
"""
import argparse
import hashlib
import io
import json
import math
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def samples(points, height):
    for start, end in zip(points, points[1:]):
        steps = max(1, math.ceil(math.dist(start, end)))
        for index in range(steps + 1):
            point = [a + (b - a) * index / steps for a, b in zip(start, end)]
            yield round(point[1]), round(height - point[0])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--strict', action='store_true', help='Fail if reviewed water intersects pedestrian geometry.')
    parser.add_argument('--map', type=Path, default=ROOT / 'maps/The-Port-City-of-Stomion.json')
    parser.add_argument('--output', type=Path, default=ROOT / 'design/stomion/water-audit.json')
    args = parser.parse_args()
    map_path = args.map
    mask_path = ROOT / 'design/stomion/water-mask.png'
    map_bytes, mask_bytes = map_path.read_bytes(), mask_path.read_bytes()
    data = json.loads(map_bytes)
    mask = Image.open(io.BytesIO(mask_bytes)).convert('L')
    if mask.size != (data['width'], data['height']):
        raise ValueError('Water mask dimensions must match the source map.')
    pixels = mask.load()

    def intersections(points):
        return sorted({(x, y) for x, y in samples(points, data['height'])
                       if 0 <= x < mask.width and 0 <= y < mask.height and pixels[x, y] > 127})

    street_conflicts, entrance_conflicts = [], []
    for line in data.get('lines', []):
        if line.get('travelMode') not in ('road', 'trail'):
            continue
        hits = intersections(line['coordinates'])
        if hits:
            street_conflicts.append({'id': line['id'], 'name': line['name'], 'waterPixels': len(hits), 'sourceSamples': hits[::max(1, len(hits)//8)][:10]})
    for building in data.get('buildings', []):
        if not building.get('access'):
            if building.get('accessReview', {}).get('status') != 'unmapped':
                raise ValueError(f"Missing unreviewed access: {building['id']}")
            continue
        hits = intersections(building['access'].get('path') or [building['entrance'], building['access']['coordinates']])
        if hits:
            entrance_conflicts.append({'id': building['id'], 'address': building['address'], 'waterPixels': len(hits), 'sourceSamples': hits[::max(1, len(hits)//8)][:10]})
    report = {'mapSha256': hashlib.sha256(map_bytes).hexdigest(),
              'maskSha256': hashlib.sha256(mask_bytes).hexdigest(),
              'method': 'Independently sample every road/trail and entrance walk at <=1 source pixel and compare to the reviewed water mask with depicted bridges cut out.',
              'streetConflicts': street_conflicts, 'entranceConflicts': entrance_conflicts,
              'allPedestrianGeometryAvoidsReviewedWater': not street_conflicts and not entrance_conflicts,
              'unmappedAccesses': [b['id'] for b in data.get('buildings', []) if not b.get('access')],
              'limitation': 'A conservative mask cannot prove that unclassified pixels are dry ground; final source-overlay review remains necessary.'}
    args.output.write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({'streetConflicts': len(street_conflicts), 'entranceConflicts': len(entrance_conflicts),
                      'allPedestrianGeometryAvoidsReviewedWater': report['allPedestrianGeometryAvoidsReviewedWater']}))
    if args.strict and (street_conflicts or entrance_conflicts):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
