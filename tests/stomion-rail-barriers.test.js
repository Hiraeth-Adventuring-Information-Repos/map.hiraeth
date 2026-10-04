const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRailBarrier } = require('../scripts/stomion_rail_barriers');
const { integrate, preserveAddressLabels, obstructsAccess } = require('../scripts/integrate_stomion_addresses');
const { clearParts } = require('../scripts/stomion_clip_rail_paths');
const { addBridgeLinks } = require('../scripts/stomion_bridge_links');
const T = require('../js/travel-network');

const track = { travelMode: 'rail', coordinates: [[100, 0], [100, 200]] };
test('rail crossings require a reviewed bridge throughout the track clearance', () => {
    const bridge = { footprint: [[45, 92], [55, 92], [55, 108], [45, 108]] };
    const barrier = createRailBarrier([track], [bridge], { height: 200 });
    assert.equal(barrier.crosses([[80, 50], [120, 50]]), false);
    assert.equal(barrier.crosses([[80, 60], [120, 60]]), true);
    assert.equal(barrier.crosses([[80, 50], [100, 50], [100, 60], [120, 60]]), true);
    assert.equal(barrier.crosses([[95, 70], [95, 90]]), false);
    assert.equal(barrier.crosses([[97, 70], [97, 90]]), true);
    assert.equal(createRailBarrier([track], [], { height: 200 }).crosses([[80, 50], [120, 50]]), true);
});
test('reviewed bridge approaches join exact street projections and survive routing export', () => {
    const source = { metadata: {}, streets: [], nodes: [], edges: [] };
    for (const [id, y] of [['west', 80], ['east', 120]]) {
        const coordinates = [[y, 0], [y, 100]];
        source.streets.push({ id, name: id, kind: 'road', coordinates });
        source.nodes.push({ id: id+'-a', coordinates: coordinates[0] }, { id: id+'-b', coordinates: coordinates[1] });
        source.edges.push({ id, name: id, streetId: id, kind: 'road', from: id+'-a', to: id+'-b', coordinates });
    }
    const link = { id: 'bridge-walk', bridgeId: 'reviewed-bridge', nativePolyline: [[50, 3072-80], [50, 3072-120]],
        fromProjection: { edgeId: 'west' }, toProjection: { edgeId: 'east' } };
    const { source: linked } = addBridgeLinks(source, [link]);
    assert.equal(source.edges.length, 2);
    const { map } = integrate({ width: 200, height: 3072, scalePixels: 100, scaleKilometers: 1 }, linked, { buildings: [] });
    assert.deepEqual(T.validate(map), []);
    const trip = T.route(T.build(map), 'node:west-a', 'node:east-b');
    assert.ok(trip);
    assert.equal(trip.km, 1.4);
    assert.throws(() => addBridgeLinks(source, [{ ...link, nativePolyline: [[50, 3072-81], [50, 3072-120]] }]), /detached/);
});
test('geometry revisions retain surviving addresses and reserve merged address numbers', () => {
    const previous = { buildings: [
        { id: 'home', streetId: 'main', streetName: 'Main Street', number: 12, address: '12 Main Street' },
        { id: 'merged', streetId: 'main', streetName: 'Main Street', number: 14, address: '14 Main Street' }
    ] };
    const next = { buildings: [
        { id: 'home', streetId: 'new', streetName: 'New Street', number: 2, address: '2 New Street', access: { lineId: 'new-frontage' } },
        { id: 'restored', streetId: 'main', streetName: 'Main Street', number: 2, address: '2 Main Street' }
    ], pointsOfInterest: [{ buildingId: 'home', address: '2 New Street' }] };
    preserveAddressLabels(next, previous);
    assert.equal(next.buildings[0].address, '12 Main Street');
    assert.equal(next.buildings[0].access.lineId, 'new-frontage');
    assert.equal(next.buildings[1].address, '16 Main Street');
    assert.equal(next.pointsOfInterest[0].address, '12 Main Street');
});
test('cutting an unsupported crossing retains two frontage paths without a connecting jump', () => {
    const barrier = createRailBarrier([track]);
    const parts = clearParts([[80, 50], [120, 50]], barrier.blockedAt);
    assert.equal(parts.length, 2);
    assert.deepEqual(parts[0][0], [80, 50]);
    assert.deepEqual(parts[1].at(-1), [120, 50]);
    assert.ok(parts[0].at(-1)[0] < 96);
    assert.ok(parts[1][0][0] > 104);
    assert.equal(parts.some(barrier.crosses), false);
});
test('address importer selects frontage on the same side of a railway', () => {
    const streets = { streets: [], nodes: [], edges: [] };
    for (const [id, y] of [['Opposite bank', 80], ['Same bank', 150]]) {
        const coordinates = [[y, 0], [y, 200]];
        streets.streets.push({ id, name: id, kind: 'road', coordinates });
        streets.nodes.push({ id: id+'-a', coordinates: coordinates[0] }, { id: id+'-b', coordinates: coordinates[1] });
        streets.edges.push({ id, name: id, streetId: id, kind: 'road', from: id+'-a', to: id+'-b', coordinates });
    }
    const home = { id: 'home', coordinates: [115, 50], footprint: [[110, 45], [110, 55], [120, 55], [120, 45]] };
    const { map } = integrate({ width: 200, height: 200, pointsOfInterest: [] }, streets, { buildings: [home] }, [],
        { railBarrier: createRailBarrier([track], [], { height: 200 }) });
    assert.equal(map.buildings[0].access.lineId, 'Same bank');
    assert.equal(map.buildings[0].streetId, 'Same bank');
});

test('explicitly unresolved access never snaps across an obstacle or disables other routes', () => {
    const coordinates = [[100, 0], [100, 200]], streets = { streets: [{ id: 'main', name: 'Main Street', kind: 'road', coordinates }],
        nodes: [{ id: 'a', coordinates: coordinates[0] }, { id: 'b', coordinates: coordinates[1] }],
        edges: [{ id: 'main-001', streetId: 'main', name: 'Main Street', kind: 'road', from: 'a', to: 'b', coordinates }] };
    const roof = (id, y, x) => ({ id, coordinates: [y, x], footprint: [[y-5, x-5], [y-5, x+5], [y+5, x+5], [y+5, x-5]] });
    const source = { width: 200, height: 200, scalePixels: 100, scaleKilometers: 1 }, buildings = { buildings: [roof('islet', 50, 100), roof('home', 90, 150)] };
    const waterAt = point => point[0] >= 40 && point[0] <= 70;
    assert.throws(() => integrate(source, streets, buildings, [], { waterAt }), /no entrance walk avoids/);
    const { map } = integrate(source, streets, buildings, [], { waterAt, unmappedBuildingIds: ['islet'] });
    assert.equal(map.buildings[0].access, undefined);
    assert.equal(T.projectAddress(map, map.buildings[0]), null);
    const graph = T.build(map); assert.deepEqual(graph.errors, []);
    assert.equal(T.route(graph, 'islet', 'node:a'), null);
    assert.ok(T.route(graph, 'home', 'node:a'));
});

test('a courtyard entrance walks around its own roof wings before reaching the street', () => {
    const coordinates = [[60, 0], [60, 200]], streets = { streets: [{ id: 'main', name: 'Main Street', kind: 'road', coordinates }],
        nodes: [{ id: 'a', coordinates: coordinates[0] }, { id: 'b', coordinates: coordinates[1] }],
        edges: [{ id: 'main-001', streetId: 'main', name: 'Main Street', kind: 'road', from: 'a', to: 'b', coordinates }] };
    const home = { id: 'court', coordinates: [85, 100], entrance: [90, 100],
        footprint: [[80, 80], [80, 120], [120, 120], [120, 110], [90, 110], [90, 90], [120, 90], [120, 80]] };
    const { map } = integrate({ width: 200, height: 200 }, streets, { buildings: [home] });
    const approach = map.buildings[0].access.path;
    assert.ok(approach.length > 2);
    for (let i = 1; i < approach.length; i++) assert.equal(obstructsAccess(approach[i-1], approach[i], home), false);
});

test('a reviewed local frontage cannot gain a city route through an unverified gap', () => {
    const streets = { streets: [], nodes: [], edges: [] };
    for (const [id, y] of [['city', 100], ['raft', 130]]) {
        const coordinates = [[y, 0], [y, 200]];
        streets.streets.push({ id, name: id, kind: 'road', coordinates });
        streets.nodes.push({ id: id+'-a', coordinates: coordinates[0] }, { id: id+'-b', coordinates: coordinates[1] });
        streets.edges.push({ id, name: id, streetId: id, kind: 'road', from: id+'-a', to: id+'-b', coordinates });
    }
    const home = { id: 'home', coordinates: [110, 50], footprint: [[105, 45], [105, 55], [115, 55], [115, 45]] };
    const { map } = integrate({ width: 200, height: 200, scalePixels: 100, scaleKilometers: 1 }, streets, { buildings: [home] }, [],
        { preferConnectedFrontage: true, reviewedFrontages: { home: ['raft'] } });
    assert.equal(map.buildings[0].access.lineId, 'raft');
    const graph = T.build(map);
    assert.ok(T.route(graph, 'home', 'node:raft-a'));
    assert.equal(T.route(graph, 'home', 'node:city-a'), null);
});
