const assert = require('node:assert/strict');
const { test } = require('node:test');
const { sampleBezierPath, createBezierHandles, normalizeBezierHandles, getFeatureBezierGeometry, normalizeRegion } = require('../js/editor-shared.js');
const { createSession, buildDocument } = require('../js/map-file-document.js');

test('cubic curves interpolate the anchors and the known Bezier midpoint', () => {
    const anchors = [[0, 0], [0, 100]];
    const handles = [{ out: [100, 0] }, { in: [100, 100] }];
    const path = sampleBezierPath(anchors, handles);
    assert.deepEqual(path[0], anchors[0]);
    assert.deepEqual(path.at(-1), anchors[1]);
    assert.ok(path.some(point => point[0] === 75 && point[1] === 50));
    assert.deepEqual(sampleBezierPath(anchors), anchors);
    assert.deepEqual(anchors, [[0, 0], [0, 100]]);
});

test('a polygon mixes curved segments with exact sharp anchors and straight edges', () => {
    const anchors = [[0, 0], [0, 100], [100, 100], [100, 0]];
    const handles = [null, { in: [-40, 70], out: [30, 130] }, null, null];
    const path = sampleBezierPath(anchors, handles, true);
    for (const anchor of anchors) assert.ok(path.some(point => point[0] === anchor[0] && point[1] === anchor[1]));
    assert.deepEqual(path.slice(-2), anchors.slice(-2), 'edges between untouched corner points stay straight');
    assert.ok(path.length > 4);
    assert.deepEqual(sampleBezierPath(anchors, [], true), anchors);
    const closing = sampleBezierPath(anchors, [{ in: [30, -30] }], true);
    assert.ok(closing.length > 4, 'the polygon closing edge supports curves too');
    assert.notDeepEqual(closing.at(-1), closing[0], 'closed outlines omit the redundant closing anchor');
});

test('control handles at open endpoints do not invent another segment', () => {
    const anchors = [[0, 0], [100, 100], [200, 0]];
    assert.equal(createBezierHandles(anchors, 0, false).in, null);
    assert.equal(createBezierHandles(anchors, 2, false).out, null);
    const center = createBezierHandles(anchors, 1, false);
    assert.ok(center.in[0] < 100 && center.out[0] > 100);
    assert.equal(center.in[1], 100);
    assert.equal(center.out[1], 100);
});

test('degenerate chords and collinear overshooting controls are subdivided safely', () => {
    const path = sampleBezierPath([[0, 0], [0, 10]], [{ out: [0, 100] }, { in: [0, 100] }]);
    assert.ok(Math.max(...path.map(point => point[1])) > 50, 'a collinear cubic loop is not replaced with its short chord');
    const loop = sampleBezierPath([[0, 0], [0, 0]], [{ out: [100, 100] }, { in: [-100, 100] }]);
    assert.ok(loop.length > 2);
    assert.ok(loop.flat().every(Number.isFinite));
    assert.deepEqual(sampleBezierPath([]), []);
    assert.deepEqual(normalizeBezierHandles([[0, 0]], [{ in: [NaN, 1], out: [Infinity, 2] }]), [null]);
});

test('Bezier metadata survives normalization and downloads, while manual coordinate edits remain authoritative', () => {
    const anchors = [[0, 0], [0, 100], [100, 100]];
    const handles = [null, { in: [-20, 80], out: [20, 120] }, null];
    const feature = { id: 'curved', name: 'Mixed boundary', coordinates: sampleBezierPath(anchors, handles, true), bezier: { version: 1, anchors, handles } };
    const normalized = normalizeRegion(feature);
    assert.deepEqual(getFeatureBezierGeometry(normalized, true), { anchors, handles });
    const raw = { id: 'test-map', regions: [feature] };
    const session = createSession(raw, { ...raw, regions: [normalized] });
    session.editableDocument.regions[0].name = 'Renamed boundary';
    const saved = buildDocument(session.snapshot, session.editableDocument);
    assert.deepEqual(saved.regions[0].bezier, feature.bezier);
    assert.deepEqual(getFeatureBezierGeometry(saved.regions[0], true), { anchors, handles });
    saved.regions[0].coordinates[0] = [99, 99];
    assert.equal(getFeatureBezierGeometry(saved.regions[0], true), null);
});
