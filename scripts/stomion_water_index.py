#!/usr/bin/env python3
"""Export the reviewed water mask as row intervals for the address importer."""
import hashlib
import io
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / 'design/stomion/water-mask.png'
source_bytes = source.read_bytes()
image = Image.open(io.BytesIO(source_bytes)).convert('L')
pixels = image.load()
rows = []
for y in range(image.height):
    intervals, start = [], None
    for x in range(image.width + 1):
        water = x < image.width and pixels[x, y] > 127
        if water and start is None:
            start = x
        elif not water and start is not None:
            intervals.append([start, x])
            start = None
    rows.append(intervals)
data = {'width': image.width, 'height': image.height,
        'sourceSha256': hashlib.sha256(source_bytes).hexdigest(),
        'coordinateSystem': 'Source image pixels; x intervals include start and exclude end', 'rows': rows}
(ROOT / 'design/stomion/water-index.json').write_text(json.dumps(data, separators=(',', ':'))+'\n')
print(json.dumps({'width': image.width, 'height': image.height, 'intervals': sum(map(len, rows))}))
