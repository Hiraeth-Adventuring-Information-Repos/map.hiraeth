#!/usr/bin/env python3
"""Trace IceBeach's printed walking trails without rerunning the world generator.

Run with PYTHONPATH=/tmp/stomion-cv /home/codex/tools/artifacts/bin/python.
Reviewed native control corridors constrain dot detection; color alone never
invents a route or a bridge. Source and graph provenance is emitted per trail.
"""
from pathlib import Path
import copy
import hashlib
import json
import math

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'design/icebeach-correction'
BASELINE = ROOT / 'design/data-correction/before/IceBeach.json'
TARGET = ROOT / 'maps/IceBeach.json'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def guard_canonical(current_sha, baseline_sha, previous_sha=None):
    if current_sha not in {baseline_sha, previous_sha}:
        raise RuntimeError('IceBeach has later editor/data changes. Refusing to replace them with this correction; review a new baseline explicitly.')


def projection(point, controls):
    best = (math.inf, 0)
    distance = 0
    for a, b in zip(controls, controls[1:]):
        vector = np.asarray(b) - a
        length = float(np.linalg.norm(vector))
        t = max(0, min(1, float(np.dot(np.asarray(point) - a, vector)) / (length * length))) if length else 0
        closest = np.asarray(a) + t * vector
        error = float(np.linalg.norm(np.asarray(point) - closest))
        if error < best[0]:
            best = error, distance + t * length
        distance += length
    return best


def dot_centers(rgb):
    r, g, b = [rgb[:, :, i].astype(np.int16) for i in range(3)]
    red = ((r - g >= 16) & (r - b >= 7) & (r >= 18) & (r < 140) & (g < 100) & (b < 100)).astype(np.uint8)
    count, _, stats, centers = cv2.connectedComponentsWithStats(red, 8)
    points = []
    for index in range(1, count):
        x, y, width, height, area = stats[index]
        if 2 <= area <= 48 and 1 <= width <= 9 and 1 <= height <= 9 and 200 < x < 6800 and 150 < y < 4800:
            points.append([float(centers[index][0]), float(centers[index][1]), int(area)])
    return points


def trace(controls, dots, start_margin=7, end_margin=7):
    nearby = []
    total = sum(math.dist(a, b) for a, b in zip(controls, controls[1:]))
    for x, y, area in dots:
        error, distance = projection([x, y], controls)
        # At a branch, nearby dots may belong to the other arm beyond our
        # endpoint. Their projected arc length clamps to zero/the full length;
        # keeping them makes little retrace loops around the shared junction.
        if error <= 16 and start_margin < distance < total - end_margin:
            nearby.append((distance, [x, y], area))
    nearby.sort(key=lambda point: point[0])
    points = [controls[0]]
    detected = 0
    for distance, point, area in nearby:
        if math.dist(point, controls[0]) < start_margin or math.dist(point, controls[-1]) < end_margin:
            continue
        if math.dist(point, points[-1]) < 4:
            continue
        points.append(point)
        detected += 1
    points.append(controls[-1])
    # Preserve a reviewed control when a label hides a long stretch of dots.
    expanded = [points[0]]
    for a, b in zip(points, points[1:]):
        if math.dist(a, b) > 65:
            sa, sb = projection(a, controls)[1], projection(b, controls)[1]
            expanded.extend(p for p in controls[1:-1] if sa + 2 < projection(p, controls)[1] < sb - 2)
        expanded.append(b)
    result = cv2.approxPolyDP(np.asarray(expanded, np.float32).reshape(-1, 1, 2), 2.2, False).reshape(-1, 2).tolist()
    result[0], result[-1] = controls[0], controls[-1]
    return result, detected


def sample(points):
    samples = [points[0]]
    for a, b in zip(points, points[1:]):
        steps = max(1, math.ceil(math.dist(a, b)))
        for step in range(1, steps + 1):
            t = step / steps
            samples.append([a[k] + t * (b[k] - a[k]) for k in range(2)])
    return samples


def water_spans(points, water, exceptions):
    samples = sample(points)
    runs, start = [], None
    for index, point in enumerate(samples):
        x, y = [round(value) for value in point]
        wet = bool(water[y, x]) and not any(bounds[0] <= x <= bounds[2] and bounds[1] <= y <= bounds[3] for bounds in exceptions)
        if wet and start is None:
            start = index
        if not wet and start is not None:
            runs.append([start, index - 1])
            start = None
    if start is not None:
        runs.append([start, len(samples) - 1])
    # A single continuous river may contain small unclassified compression gaps.
    merged = []
    for start, end in runs:
        if merged and start - merged[-1][1] < 5:
            merged[-1][1] = end
        else:
            merged.append([start, end])
    return samples, merged


def review_images(source, data):
    before = Image.open(OUT / 'before-trail-overlay.png')
    after = Image.open(OUT / 'after-trail-overlay.png')
    comparison = Image.new('RGB', (before.width * 2, before.height + 70), '#f4f0e8')
    draw = ImageDraw.Draw(comparison)
    draw.text((30, 20), 'Before: generated corridors', fill='#333333')
    draw.text((before.width + 30, 20), 'After: printed trails and explicit closed river gaps', fill='#333333')
    comparison.paste(before, (0, 70)); comparison.paste(after, (before.width, 70))
    comparison.save(OUT / 'before-after.png')
    panels = [('Northern shared fork', (3400, 1100, 3750, 1450)),
              ('Fractured Point fork', (2700, 2570, 3050, 2920)),
              ('Sleetmond lake fork', (3500, 2920, 3850, 3270)),
              ('Ottiker–Quilt fork', (3530, 3270, 3880, 3620)),
              ('Nil Buldin branch', (4350, 2590, 4800, 2840)),
              ('Southwest trunk fork', (1550, 4060, 1900, 4410))]
    output = Image.new('RGB', (1440, 1080), '#f4f0e8'); title = ImageDraw.Draw(output)
    for index, (name, box) in enumerate(panels):
        panel = source.crop(box); draw = ImageDraw.Draw(panel)
        for line in data['lines']:
            if not line.get('trailSourceId'):
                continue
            points = [(p[1] - box[0], data['height'] - p[0] - box[1]) for p in line['coordinates']]
            draw.line(points, fill='#ee334c' if line.get('travelServiceStatus') == 'closed' else '#3997ea', width=2)
        for node in data['travelNodes']:
            if node.get('kind') != 'junction':
                continue
            x, y = node['coordinates'][1] - box[0], data['height'] - node['coordinates'][0] - box[1]
            draw.ellipse((x - 4, y - 4, x + 4, y + 4), fill='#fff1bb', outline='#181f27', width=1)
        panel.thumbnail((460, 460))
        output.paste(panel, (index % 3 * 480 + (480 - panel.width) // 2, index // 3 * 540 + 55))
        title.text((index % 3 * 480 + 15, index // 3 * 540 + 15), name, fill='#222222')
    output.save(OUT / 'junction-details.png')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    controls = json.loads((OUT / 'trail-controls.json').read_text())
    baseline_sha = digest(BASELINE)
    if baseline_sha != controls['baselineSha256']:
        raise RuntimeError('The immutable IceBeach correction baseline has changed; review and update the source inventory explicitly.')
    previous_report = OUT / 'trail-provenance.json'
    previous_sha = json.loads(previous_report.read_text()).get('correctedMapSha256') if previous_report.exists() else None
    guard_canonical(digest(TARGET), baseline_sha, previous_sha)
    baseline = json.loads(BASELINE.read_text())
    if digest(ROOT / baseline['imageUrl']) != controls['sourceArtworkSha256']:
        raise RuntimeError('IceBeach artwork has changed; these native controls require a fresh source review.')
    current = json.loads(TARGET.read_text())
    data = copy.deepcopy(current)
    image = Image.open(ROOT / baseline['imageUrl']).convert('RGB')
    rgb = np.asarray(image)
    dots = dot_centers(rgb)
    water = np.asarray(Image.open(ROOT / 'design/world-transport/IceBeach-water-mask.png').convert('L')) > 0
    height = data['height']
    native = lambda p: [p[1], height - p[0]]
    leaflet = lambda p: [round(height - p[1], 3), round(p[0], 3)]
    nodes = {node['id']: copy.deepcopy(node) for node in data['travelNodes'] if node.get('correctionSource') != controls['passId']}
    by_name = {node['name']: node for node in nodes.values()}
    for name, correction in controls.get('nodeAnchorCorrections', {}).items():
        node = by_name[name]
        node['coordinates'] = leaflet(correction['point'])
        node['sourceReview'] = {'status': 'reviewed dry trail anchor', 'nativePoint': correction['point'], 'reason': correction['reason']}
    existing = {line['id']: line for line in baseline['lines']}
    for key, entry in controls['junctions'].items():
        node = {'id': f'IceBeach-trail-{key}', 'name': entry['name'], 'kind': entry.get('kind', 'junction'),
                'coordinates': leaflet(entry['point']), 'mappingSource': 'world-transport-survey',
                'correctionSource': controls['passId'], 'sourceReview': {'artworkPoint': entry['point'], 'status': 'source-traced'},
                'transportInterchange': 'Printed trail junction; local conditions and availability unresolved.'}
        if entry.get('note'):
            node['sourceReview']['note'] = entry['note']
        nodes[node['id']] = node
        by_name[key] = node
    replaced = set(controls['removeUnsupportedLinks']) | {trail['id'] for trail in controls['trails']}
    preserved = [line for line in current['lines'] if line.get('correctionSource') != controls['passId'] and line['id'] not in replaced]
    lines, provenance, wet_review = [], [], []
    for trail in controls['trails']:
        a, b = by_name[trail['from']], by_name[trail['to']]
        route_controls = copy.deepcopy(trail['controls'])
        route_controls[0], route_controls[-1] = native(a['coordinates']), native(b['coordinates'])
        route_dots = [dot for dot in dots if not any(bounds[0] <= dot[0] <= bounds[2] and bounds[1] <= dot[1] <= bounds[3]
                                                   for bounds in trail.get('excludedDotBounds', []))]
        points, detected = (route_controls, 0) if trail.get('unresolvedAccess') else trace(
            route_controls, route_dots, 24 if a['kind'] == 'junction' else 7, 24 if b['kind'] == 'junction' else 7)
        exceptions = [entry['nativeBounds'] for entry in controls.get('artworkMaskExceptions', []) if entry['trailSourceId'] == trail['sourceId']]
        samples, runs = water_spans(points, water, exceptions)
        template = copy.deepcopy(existing.get(trail['id'], {}))
        for field in ['travelCrossingIds', 'travelRailCrossingIds', 'travelDelayHours']:
            template.pop(field, None)
        template.update({'id': trail['id'], 'name': f'{a["name"]} – {b["name"]}', 'type': 'Travel',
                         'travelMode': 'trail', 'travelSpeedKph': 3, 'travelFareGp': 0,
                         'travelFromNode': a['id'], 'travelToNode': b['id'], 'travelVisible': False,
                         'travelServiceStatus': 'proposed', 'travelGeometryStatus': 'source-traced trail',
                         'mappingSource': 'world-transport-survey', 'correctionSource': controls['passId'],
                         'trailSourceId': trail['sourceId'], 'color': '#85b875', 'weight': 3,
                         'summary': 'Walking trail traced from the dotted source artwork. Moving time and availability remain estimates.',
                         'sourceReview': {'status': 'source-traced', 'artwork': baseline['imageUrl'], 'detectedDots': detected,
                                          'nativeControls': route_controls, 'note': trail.get('note', '')}})
        if trail.get('excludedDotBounds'):
            template['sourceReview']['excludedDotBounds'] = trail['excludedDotBounds']
        graph_ids = []
        if trail.get('unresolvedAccess'):
            template.update({'coordinates': [leaflet(point) for point in points], 'travelServiceStatus': 'closed',
                             'travelGeometryStatus': 'unresolved town river access',
                             'travelClosureReason': trail['note'], 'summary': trail['note']})
            lines.append(template); graph_ids.append(template['id'])
            wet_review.append({'trailSourceId': trail['sourceId'], 'graphId': template['id'],
                               'nativeWaterSpan': [points[0], points[-1]], 'sampledWetLengthPx': sum(end-start+1 for start, end in runs),
                               'status': 'withheld town access pending bridge review'})
        elif not runs:
            template['coordinates'] = [leaflet(point) for point in points]
            lines.append(template)
            graph_ids.append(template['id'])
        else:
            cursor, previous, segment = 0, a, 0
            # Each water span is represented by an explicit closed edge, with
            # dry bank approaches retaining the printed trail's connectivity.
            for crossing, (start, end) in enumerate(runs, 1):
                bank_start, bank_end = max(cursor, start - 3), min(len(samples) - 1, end + 3)
                banks = []
                for side, index in [('from', bank_start), ('to', bank_end)]:
                    node = {'id': f'{trail["id"]}-bank-{crossing}-{side}', 'name': f'{template["name"]}: {side} river bank {crossing}',
                            'kind': 'junction', 'coordinates': leaflet(samples[index]), 'mappingSource': 'world-transport-survey',
                            'correctionSource': controls['passId'], 'sourceReview': {'status': 'bridge unresolved', 'trailSourceId': trail['sourceId']}}
                    nodes[node['id']] = node
                    banks.append(node)
                if bank_start > cursor:
                    approach = copy.deepcopy(template)
                    approach.update({'id': f'{trail["id"]}-approach-{segment + 1}', 'travelFromNode': previous['id'],
                                     'travelToNode': banks[0]['id'], 'coordinates': [leaflet(point) for point in samples[cursor:bank_start + 1]]})
                    lines.append(approach); graph_ids.append(approach['id']); segment += 1
                closed = copy.deepcopy(template)
                closed.update({'id': f'{trail["id"]}-unresolved-crossing-{crossing}', 'travelFromNode': banks[0]['id'],
                               'travelToNode': banks[1]['id'], 'coordinates': [leaflet(point) for point in samples[bank_start:bank_end + 1]],
                               'travelServiceStatus': 'closed', 'travelGeometryStatus': 'source-traced crossing; bridge unresolved',
                               'summary': 'The printed dotted trail meets painted water. A usable bridge is not established; this span is excluded from directions.',
                               'travelClosureReason': 'No source-visible bridge has been confirmed for this printed trail water span.'})
                lines.append(closed); graph_ids.append(closed['id'])
                wet_review.append({'trailSourceId': trail['sourceId'], 'graphId': closed['id'], 'nativeWaterSpan': [samples[start], samples[end]],
                                   'sampledWetLengthPx': end - start + 1, 'status': 'withheld pending bridge review'})
                cursor, previous = bank_end, banks[1]
            if cursor < len(samples) - 1:
                approach = copy.deepcopy(template)
                approach.update({'id': f'{trail["id"]}-approach-{segment + 1}', 'travelFromNode': previous['id'],
                                 'travelToNode': b['id'], 'coordinates': [leaflet(point) for point in samples[cursor:]]})
                lines.append(approach); graph_ids.append(approach['id'])
        provenance.append({'trailSourceId': trail['sourceId'], 'from': a['name'], 'to': b['name'],
                           'graphIds': graph_ids, 'detectedDots': detected, 'nativeTrace': points,
                           'nativeControls': route_controls, 'note': trail.get('note', ''), 'withheldWaterSpans': len(runs),
                           'unresolvedTownAccess': bool(trail.get('unresolvedAccess'))})
    data['travelNodes'] = list(nodes.values())
    data['lines'] = preserved + lines
    referenced_crossings = {identifier for line in data['lines'] for identifier in line.get('travelCrossingIds', [])}
    data['transportReview']['proposedCrossings'] = [crossing for crossing in data['transportReview'].get('proposedCrossings', []) if crossing['id'] in referenced_crossings]
    data['transportReview']['correctionReview'] = {'passId': controls['passId'], 'status': 'source-traced trails; unresolved water spans withheld',
        'sourceArtworkSha256': digest(ROOT / baseline['imageUrl']), 'sourceInventory': 'design/icebeach-correction/trail-provenance.json',
        'printedTrailLegs': sum(not trail.get('unresolvedAccess') for trail in controls['trails']),
        'unresolvedTownAccessGaps': sum(bool(trail.get('unresolvedAccess')) for trail in controls['trails']),
        'sharedJunctionsAndSourceTowns': len(controls['junctions']),
        'removedUnsupportedLinks': controls['removeUnsupportedLinks'], 'withheldWaterSpans': wet_review,
        'artworkMaskExceptions': controls.get('artworkMaskExceptions', []),
        'nodeAnchorCorrections': controls.get('nodeAnchorCorrections', {}),
        'unmappedDestinations': [{'name': place['name'], 'reason': 'No walking spur is depicted in the source artwork; the previous generated connection was unsupported.'}
                                 for place in data['pointsOfInterest']
                                 if not any(line.get('travelServiceStatus') != 'closed' and place.get('travelNodeId') in
                                            [line.get('travelFromNode'), line.get('travelToNode')] for line in data['lines'])],
        'disconnectedDestinations': [{'name': 'Gernerum',
                                     'reason': 'Its printed coastal trail reaches the dry Thrawbreak north bank. The river crossing into Thrawbreak is unconfirmed and closed; no glacier shortcut or boat service is invented.',
                                     'withheldAccessGraphId': 'IceBeach-transport-048', 'trailSourceId': 'printed-east-06'}],
        'notes': ['Printed burgundy dots are walking trails, not generated roads.',
                  'No glacier or mountain shortcut is inferred from the water mask.',
                  'Settlement pins, lore, original features and existing sailing/ferry services are preserved.',
                  'The Whitedrift–Thrawbreak ferry remains closed in the original lore and is not introduced.',
                  'Source-visible water crossings need a confirmed bridge before their closed spans become routable.']}
    TARGET.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    report = {'passId': controls['passId'], 'sourceArtworkSha256': digest(ROOT / baseline['imageUrl']),
              'baselineSha256': digest(BASELINE), 'correctedMapSha256': digest(TARGET), 'trails': provenance,
              'removedUnsupportedLinks': controls['removeUnsupportedLinks'], 'waterCrossings': wet_review,
              'counts': {'sourceTrailLegs': sum(not trail.get('unresolvedAccess') for trail in controls['trails']),
                         'unresolvedTownAccessGaps': sum(bool(trail.get('unresolvedAccess')) for trail in controls['trails']),
                         'mappedLinks': len(data['lines']),
                         'activeTrailLinks': sum(line.get('travelMode') == 'trail' and line.get('travelServiceStatus') != 'closed' for line in data['lines']),
                         'closedWaterSpans': len(wet_review), 'nodes': len(data['travelNodes']), 'preservedWaterAndLandingLinks': len(preserved)}}
    (OUT / 'trail-provenance.json').write_text(json.dumps(report, indent=2) + '\n')
    for name, map_data in [('before', baseline), ('after', data)]:
        overlay = image.copy(); overlay.thumbnail((1900, 1900)); draw = ImageDraw.Draw(overlay); ratio = overlay.width / data['width']
        for line in map_data['lines']:
            if line.get('travelMode') not in ['road', 'trail']:
                continue
            color = '#ee334c' if line.get('travelServiceStatus') == 'closed' else ('#79ec75' if line.get('correctionSource') else '#ffcf58')
            draw.line([(p[1] * ratio, (height - p[0]) * ratio) for p in line['coordinates']], fill=color, width=2)
        for node in map_data['travelNodes']:
            if node.get('kind') != 'junction':
                continue
            x, y = native(node['coordinates']); x *= ratio; y *= ratio
            draw.ellipse((x - 3, y - 3, x + 3, y + 3), fill='#ffffff', outline='#28333c', width=1)
        overlay.save(OUT / f'{name}-trail-overlay.png')
    review_images(image, data)
    print(json.dumps(report['counts'], indent=2))
    print(json.dumps(wet_review, indent=2))


if __name__ == '__main__':
    main()
