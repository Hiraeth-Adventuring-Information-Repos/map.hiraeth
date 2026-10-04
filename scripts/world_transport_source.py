#!/usr/bin/env python3
"""Review world transport corridors against artwork-derived water and coast masks.

These masks constrain proposed corridors; they do not establish a service,
bridge, surveyed road or railway from a continental illustration.
"""
from pathlib import Path
import hashlib
import json
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'design/world-transport'


def compile_mask(name):
    source = ROOT / f'maps/{name}.webp'
    rgb = np.asarray(Image.open(source).convert('RGB'))
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    # Blue/teal sea and river paint, excluding gray mountain/ice texture.
    water = ((hsv[:, :, 0] >= 73) & (hsv[:, :, 0] <= 125)
             & (hsv[:, :, 1] >= (65 if name == 'IceBeach' else 48))).astype(np.uint8)
    # Preserve narrow channels, while removing isolated decorative blue pixels.
    count, labels, stats, _ = cv2.connectedComponentsWithStats(water, 8)
    keep = np.zeros(count, dtype=np.uint8)
    keep[1:] = (stats[1:, cv2.CC_STAT_AREA] >= 24).astype(np.uint8)
    water = keep[labels]
    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(water * 255).save(OUT / f'{name}-water-mask.png')
    image = Image.fromarray(rgb)
    image.thumbnail((1600, 1600))
    draw = ImageDraw.Draw(image)
    data = json.loads((ROOT / f'maps/{name}.json').read_text())
    ratio = image.width / data['width']
    samples = []
    for place in data.get('pointsOfInterest', []):
        x, y = place['coords'][1], data['height'] - place['coords'][0]
        draw.ellipse((x * ratio - 4, y * ratio - 4, x * ratio + 4, y * ratio + 4), fill='#ffcc56', outline='#291922', width=2)
        draw.text((x * ratio + 6, y * ratio - 6), place['name'], fill='#fff7dd', stroke_width=1, stroke_fill='#291922')
        samples.append({'place': place['name'], 'native': [x, y], 'paintedWaterAtPin': bool(water[round(y), round(x)])})
    image.save(OUT / f'{name}-places-source.png')
    report = {'map': name, 'artworkSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
              'maskSha256': hashlib.sha256((OUT / f'{name}-water-mask.png').read_bytes()).hexdigest(),
              'waterPixels': int(water.sum()), 'placeSamples': samples,
              'limitations': ['Illustration color is a conservative route constraint, not a surveyed shoreline.',
                              'Unclassified pixels do not establish dry terrain; native source panels must be reviewed.',
                              'World transport services are newly proposed atlas additions.']}
    (OUT / f'{name}-source-review.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'map': name, 'waterPixels': report['waterPixels'], 'wetPlacePins': [p['place'] for p in samples if p['paintedWaterAtPin']]}))


if __name__ == '__main__':
    for name in sys.argv[1:] or ['Fair-Content', 'Astrousia', 'IceBeach']:
        compile_mask(name)
