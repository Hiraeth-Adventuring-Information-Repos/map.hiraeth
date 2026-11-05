const assert = require('node:assert/strict');
const { test } = require('node:test');
const { roundGeometryCorners } = require('../js/editor-shared.js');

test('rounded polygon corners stay inside the original square and serialize as ordinary vertices', () => {
    const anchors = [[0, 0], [0, 100], [100, 100], [100, 0]];
    const before = JSON.stringify(anchors);
    const rounded = roundGeometryCorners(anchors, true);
    assert.ok(rounded.length > anchors.length);
    assert.ok(rounded.every(([y, x]) => Number.isInteger(y) && Number.isInteger(x) && x >= 0 && x <= 100 && y >= 0 && y <= 100));
    assert.ok(!rounded.some(([y, x]) => y === 0 && x === 0));
    assert.deepEqual(rounded, JSON.parse(JSON.stringify(rounded)));
    assert.equal(JSON.stringify(anchors), before);
    assert.deepEqual(roundGeometryCorners([...anchors, anchors[0]], true), rounded);
});

test('rounded routes keep endpoints and remove consecutive duplicate anchors', () => {
    const anchors = [[0, 0], [0, 100], [100, 100]];
    const rounded = roundGeometryCorners(anchors);
    assert.deepEqual(rounded[0], anchors[0]);
    assert.deepEqual(rounded.at(-1), anchors.at(-1));
    assert.ok(rounded.some(([y, x]) => y > 0 && y < 25 && x > 75 && x < 100));
    assert.deepEqual(roundGeometryCorners([anchors[0], anchors[1], anchors[1], anchors[2]]), rounded);
});

test('short and tiny drafts remain finite and valid', () => {
    for (const coordinates of [[], [[2, 3]], [[1, 2], [3, 4]]]) {
        assert.deepEqual(roundGeometryCorners(coordinates), coordinates);
    }
    const tiny = roundGeometryCorners([[0, 0], [0, 1], [1, 0]], true);
    assert.ok(tiny.length >= 3);
    assert.ok(tiny.flat().every(Number.isFinite));
});
