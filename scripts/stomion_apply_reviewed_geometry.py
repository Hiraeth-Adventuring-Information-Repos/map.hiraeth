#!/usr/bin/env python3
"""Apply an inspected native-coordinate node/edge patch with baseline assertions.

This is for scoped source corrections, not a fresh image trace. The patch must
contain no unresolved edges, and every network endpoint must still meet its node.
"""
import argparse
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def apply(source, patch):
    if patch.get('failedEdges'):
        raise ValueError('Resolve every failed corridor before applying this patch')
    nodes = {item['id']: item for item in source['nodes']}
    edges = {item['id']: item for item in source['edges']}
    native = lambda point: [point[1], 3072 - point[0]]
    leaflet = lambda point: [3072 - point[1], point[0]]
    same = lambda a, b: math.dist(a, b) < 1e-6
    for move in patch.get('nodeMoves', []):
        assert same(native(nodes[move['id']]['coordinates']), move['expected']), move['id']
    for edit in patch.get('edgeReplacements', []):
        old = [native(point) for point in edges[edit['id']]['coordinates']]
        assert len(old) == len(edit['expected']) and all(same(a, b) for a, b in zip(old, edit['expected'])), edit['id']
    for move in patch.get('nodeMoves', []):
        nodes[move['id']]['coordinates'] = leaflet(move['coordinates'])
        nodes[move['id']]['imageCoordinates'] = move['coordinates']
    for edit in patch.get('edgeReplacements', []):
        edges[edit['id']]['coordinates'] = [leaflet(point) for point in edit['coordinates']]
    for edge in source['edges']:
        assert same(edge['coordinates'][0], nodes[edge['from']]['coordinates']), edge['id']
        assert same(edge['coordinates'][-1], nodes[edge['to']]['coordinates']), edge['id']
    for street in source['streets']:
        coords = []
        for edge_id in street['edgeIds']:
            points = edges[edge_id]['coordinates']
            coords.extend(points[1:] if coords and same(coords[-1], points[0]) else points)
        street['coordinates'] = coords
    return source


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('patch', type=Path)
    parser.add_argument('--source', type=Path, default=ROOT / 'design/stomion/streets.json')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    source = apply(json.loads(args.source.read_text()), json.loads(args.patch.read_text()))
    args.output.write_text(json.dumps(source, indent=2) + '\n')
    print(json.dumps({'output': str(args.output), 'edges': len(source['edges'])}))
