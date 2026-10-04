const { test } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/travel-network.js');

const outer = [[10, 10], [10, 90], [90, 90], [90, 10]];
const courtyard = [[30, 30], [30, 70], [70, 70], [70, 30]];
const fixture = () => ({ scalePixels: 100, scaleKilometers: 1,
    lines: [{ id: 'court-lane', name: 'Court Lane', travelMode: 'road', travelSpeedKph: 5, travelFareGp: 0,
        travelFrom: 'West gate', travelTo: 'East gate', coordinates: [[50, 35], [50, 65]] }],
    buildings: [{ id: 'hall', address: '1 Court Lane', coordinates: [20, 50], entrance: [30, 50], footprint: outer.map(p => [...p]),
        footprintHoles: [courtyard.map(p => [...p])], access: { lineId: 'court-lane', coordinates: [50, 50], path: [[30, 50], [50, 50]] }, custom: { preserved: true } }]
});

test('a contiguous building keeps its open court outside the physical roof and remains navigable from that court', () => {
    const data = fixture(), hall = data.buildings[0];
    assert.deepEqual(T.validate(data), []);
    assert.equal(T.footprintContains(hall, [20, 50]), true);
    assert.equal(T.footprintContains(hall, [50, 50]), false);
    assert.equal(T.footprintContains(hall, [0, 50]), false);
    assert.deepEqual(T.buildingFootprintRings(hall), [outer, courtyard]);
    const trip = T.route(T.build(data), '1 Court Lane', 'East gate');
    assert.ok(trip); assert.equal(trip.km, .35);
    assert.deepEqual(trip.legs[0].coordinates, [[30, 50], [50, 50]]);
    T.updateBuilding(data, 'hall', { footprintHoles: [courtyard] });
    assert.deepEqual(hall.entrance, [30, 50], 'Entrance should be on the court edge, not on an interior roof point');
    assert.deepEqual(T.validate(data), []);
});

test('moving a building translates its court with its roof and metadata edits preserve both rings and the entrance walk', () => {
    const data = fixture(), hall = data.buildings[0];
    T.updateBuilding(data, 'hall', { name: 'Court Hall' });
    assert.deepEqual(hall.access.path, [[30, 50], [50, 50]]);
    T.updateBuilding(data, 'hall', { coordinates: [25, 55] });
    assert.deepEqual(hall.footprintHoles, [courtyard.map(p => p.map(v => v + 5))]);
    assert.deepEqual(hall.footprint, outer.map(p => p.map(v => v + 5)));
    assert.deepEqual(hall.entrance, [35, 55]); assert.deepEqual(hall.custom, { preserved: true });
    assert.equal(hall.access.path, undefined); assert.deepEqual(T.validate(data), []);
});

test('malformed, external, intersecting or overlapping courts and roof markers in a court are rejected without mutating the building', () => {
    const invalid = [null, [[[30, 30], [30, 30], [30, 30]]], [[[0, 0], [0, 20], [20, 20], [20, 0]]],
        [[[20, 20], [60, 60], [20, 60], [60, 20]]], [courtyard, [[40, 40], [40, 60], [60, 60], [60, 40]]],
        [[[15, 40], [15, 60], [25, 60], [25, 40]]]];
    for (const holes of invalid) {
        const data = fixture(), before = JSON.stringify(data);
        assert.throws(() => T.updateBuilding(data, 'hall', { footprintHoles: holes }), /courtyard|marker/);
        assert.equal(JSON.stringify(data), before);
        data.buildings[0].footprintHoles = holes;
        assert.notEqual(T.validate(data).length, 0);
        assert.equal(T.route(T.build(data), 'hall', 'East gate'), null);
    }
    const data = fixture(); data.buildings[0].footprint.push([...outer[0]]); data.buildings[0].footprintHoles[0].push([...courtyard[0]]);
    assert.deepEqual(T.validate(data), [], 'Explicitly closed polygon rings are supported');
    assert.equal(T.footprintContains(data.buildings[0], [50, 50]), false);
});
