const { test } = require('node:test');
const assert = require('node:assert/strict');
const { integrate, integrateRailways, project, entranceOnFootprint, obstructsAccess } = require('../scripts/integrate_stomion_addresses.js');

test('an entrance walk detects a roof corner crossing shorter than one image pixel', () => {
    const roof = { footprint: [[0, 0], [0, 5], [5, 5], [5, 0]] };
    assert.equal(obstructsAccess([4.895, -10], [5.095, 10], roof), true);
    assert.equal(obstructsAccess([5.05, -10], [5.15, 10], roof), false);
});
const { boundsOf } = require('../js/city-addresses.js');
const T = require('../js/travel-network.js');

test('a rail revision preserves addresses and surface routes, with no transfer at a geometric crossing', () => {
    const original = { width: 200, height: 200, scalePixels: 100, scaleKilometers: 1,
        buildings: [{ id: 'home', number: 17, address: '17 Main Street', coordinates: [25, 55], entrance: [25, 55], access: { lineId: 'walk', coordinates: [25, 50] } }], pointsOfInterest: [{ name: 'Existing lore', coords: [10, 10] }], regions: [{ name: 'Existing region' }],
        lines: [
            { id: 'walk', name: 'Main Street', coordinates: [[0, 50], [100, 50]], travelMode: 'road', travelSpeedKph: 5, travelFromNode: 'a', travelToNode: 'b', mappingSource: 'stomion-address-survey' },
            { id: 'old-train', coordinates: [[50, 0], [50, 100]], travelMode: 'rail', travelFromNode: 'old-a', travelToNode: 'old-b', mappingSource: 'stomion-address-survey' }
        ], travelNodes: [
            { id: 'a', name: 'A', kind: 'junction', coordinates: [0, 50] }, { id: 'b', name: 'B', kind: 'junction', coordinates: [100, 50] },
            { id: 'old-a', coordinates: [50, 0] }, { id: 'old-b', coordinates: [50, 100] }
        ], addressMapping: { streets: [{ id: 'walk', name: 'Main Street', kind: 'road' }, { id: 'old', kind: 'rail' }], railwayCount: 1 } };
    const source = { metadata: { railReview: 'Reviewed track' }, streets: [{ id: 'new', name: 'New Railway', kind: 'rail' }],
        nodes: [{ id: 'rail-a', layer: 'rail', coordinates: [50, 0] }, { id: 'rail-crossing', layer: 'rail', coordinates: [50, 50] }, { id: 'rail-b', layer: 'rail', coordinates: [50, 100] }],
        edges: [
            { id: 'new-1', streetId: 'new', name: 'New Railway', kind: 'rail', from: 'rail-a', to: 'rail-crossing', coordinates: [[50, 0], [50, 50]] },
            { id: 'new-2', streetId: 'new', name: 'New Railway', kind: 'rail', from: 'rail-crossing', to: 'rail-b', coordinates: [[50, 50], [50, 100]] }
        ] };
    Object.assign(source.edges[0], { travelOcclusions: [[[49, 20], [51, 20], [51, 30], [49, 30]]], travelCoverSources: ['footbridge'], travelBridgeIds: ['river-bridge'] });
    const before = structuredClone(original), revised = integrateRailways(original, source).map;
    const newRail = revised.lines.find(line => line.id === 'new-1');
    for (const field of ['travelOcclusions', 'travelCoverSources', 'travelBridgeIds']) assert.deepEqual(newRail[field], source.edges[0][field]);
    assert.deepEqual(original, before);
    for (const key of ['buildings', 'pointsOfInterest', 'regions']) assert.deepEqual(revised[key], original[key]);
    assert.deepEqual(revised.lines.find(line => line.id === 'walk'), original.lines[0]);
    assert.deepEqual(revised.travelNodes.filter(node => ['a', 'b'].includes(node.id)), original.travelNodes.slice(0, 2));
    assert.equal(revised.lines.some(line => line.id === 'old-train'), false);
    const graph = T.build(revised);
    assert.deepEqual(graph.errors, []);
    assert.equal(T.route(graph, 'node:rail-a', 'node:rail-b', { allowedModes: ['rail'] }).km, 1);
    assert.equal(T.route(graph, 'node:a', 'node:rail-b'), null);
    const corrupted = structuredClone(original); corrupted.lines[0].travelToNode = 'old-a';
    assert.throws(() => integrateRailways(corrupted, source), /shared with another mode/);
});

test('a court entrance bends around a blocking roof and the journey counts its full approach', () => {
    const original = { id: 'city', width: 200, height: 200, scalePixels: 100, scaleKilometers: 1, lines: [], pointsOfInterest: [], regions: [] };
    const street = { id: 'main', name: 'Main Street', coordinates: [[50, 0], [50, 200]], kind: 'road' };
    const streets = { streets: [street], nodes: [{ id: 'west', coordinates: [50, 0] }, { id: 'east', coordinates: [50, 200] }],
        edges: [{ ...street, streetId: street.id, from: 'west', to: 'east' }] };
    const buildings = { buildings: [
        { id: 'court', coordinates: [105, 100], entrance: [100, 100], footprint: [[100, 90], [100, 110], [110, 110], [110, 90]] },
        { id: 'block', coordinates: [82, 100], footprint: [[70, 50], [70, 150], [95, 150], [95, 50]] }
    ] };
    const { map, report } = integrate(original, streets, buildings);
    const home = map.buildings.find(b => b.id === 'court');
    assert.ok(home.access.path?.length >= 3, 'The approach must bend around the neighboring roof');
    assert.deepEqual(home.access.path[0], home.entrance);
    assert.deepEqual(home.access.path.at(-1), home.access.coordinates);
    assert.deepEqual(report.obstructedAccesses, []);
    const trip = T.route(T.build(map), home.id, 'node:west');
    const actual = trip.legs.reduce((sum, leg) => sum + leg.coordinates.slice(1).reduce((s, point, i) => s + Math.hypot(point[0] - leg.coordinates[i][0], point[1] - leg.coordinates[i][1]), 0), 0) / 100;
    assert.ok(trip.km > Math.hypot(home.entrance[0] - 50, home.entrance[1]) / 100);
    assert.ok(Math.abs(trip.km - actual) < 1e-9);
    assert.deepEqual(buildings.buildings[0].entrance, [100, 100], 'The fixed source entrance is preserved');
});

test('door-to-road geometry starts at the roof boundary and keeps full street chainage', () => {
    assert.deepEqual(entranceOnFootprint([50, 50], [50, 100], [[40, 40], [40, 60], [60, 60], [60, 40]]), [50, 60]);
    const at = project([45, 75], [[0, 0], [0, 100], [100, 100]]);
    assert.deepEqual(at.coordinates, [45, 100]);
    assert.equal(at.chainage, 145);
    assert.equal(at.distance, 25);
});

test('a concave courtyard door faces the street without re-entering another roof wing', () => {
    const footprint = [[0, 0], [0, 30], [30, 30], [30, 20], [10, 20], [10, 10], [30, 10], [30, 0]];
    assert.deepEqual(entranceOnFootprint([20, 5], [20, 40], footprint), [20, 30]);
    const building = { id: 'compound', address: '1 Main Street', number: 1, coordinates: [20, 5], footprint };
    const data = { buildings: [building], lines: [{ id: 'road', name: 'Main Street', coordinates: [[0, 40], [50, 40]], travelMode: 'road' }] };
    T.updateBuilding(data, building.id, { footprint });
    assert.deepEqual(building.entrance, [20, 30], 'Editor updates use the same street-facing boundary');
});
test('street import numbers opposite sides separately and preserves source lore and custom data', () => {
    const source = { id: 'The-Port-City-of-Stomion', imageUrl: 'city.webp', width: 200, height: 200,
        scalePixels: 100, scaleKilometers: 1, blurb: 'Original lore.', custom: { keep: 'unchanged' },
        regions: [], pointsOfInterest: [], lines: [{ id: 'decorative', name: 'Existing artwork overlay', coordinates: [[1, 1], [2, 2]] }] };
    const streets = { streets: [{ id: 'main', name: 'Main Street', coordinates: [[100, 0], [100, 200]] }],
        nodes: [{ id: 'stomion-junction-0001', coordinates: [100, 0] }, { id: 'stomion-junction-0002', coordinates: [100, 200] }],
        edges: [{ id: 'main-001', streetId: 'main', name: 'Main Street', kind: 'road', from: 'stomion-junction-0001', to: 'stomion-junction-0002', coordinates: [[100, 0], [100, 200]] }] };
    const roof = (id, y, x) => ({ id, coordinates: [y, x], footprint: [[y - 5, x - 5], [y - 5, x + 5], [y + 5, x + 5], [y + 5, x - 5]] });
    const buildings = { buildings: [roof('c', 120, 150), roof('a', 120, 50), roof('b', 80, 80)] };
    const { map } = integrate(source, streets, buildings);
    assert.equal(map.blurb, source.blurb); assert.deepEqual(map.custom, source.custom);
    assert.deepEqual(map.lines[0], source.lines[0]);
    assert.deepEqual(map.buildings.map(b => b.address), ['3 Main Street', '1 Main Street', '2 Main Street']);
    assert.deepEqual(map.buildings[1].entrance, [115, 50]);
    assert.deepEqual(map.buildings[1].access.coordinates, [100, 50]);
    assert.equal(source.buildings, undefined, 'Import must not mutate its input');
    assert.deepEqual(boundsOf(map.buildings[1]), [[115, 45], [125, 55]]);
});

test('a house connects to its unobstructed street frontage instead of crossing another roof', () => {
    const street = (id, y) => ({ id, name: `${id} Street`, coordinates: [[y, 0], [y, 200]] });
    const streets = { streets: [street('Front', 100), street('Back', 145)], nodes: [], edges: [] };
    for (const s of streets.streets) {
        streets.nodes.push({ id: `${s.id}-a`, coordinates: s.coordinates[0] }, { id: `${s.id}-b`, coordinates: s.coordinates[1] });
        streets.edges.push({ id: s.id, streetId: s.id, name: s.name, kind: 'road', from: `${s.id}-a`, to: `${s.id}-b`, coordinates: s.coordinates });
    }
    const roof = (id, y) => ({ id, coordinates: [y, 50], footprint: [[y - 5, 45], [y - 5, 55], [y + 5, 55], [y + 5, 45]] });
    const result = integrate({ width: 200, height: 200, pointsOfInterest: [] }, streets, { buildings: [roof('home', 120), roof('neighbor', 108)] });
    const home = result.map.buildings.find(b => b.id === 'home');
    assert.equal(home.streetId, 'Back');
    assert.deepEqual(home.entrance, [125, 50]);
    assert.deepEqual(home.access.coordinates, [145, 50]);
    assert.deepEqual(result.report.obstructedAccesses, []);
});

test('open landmarks get an exact frontage connection and a searchable destination without a house number', () => {
    const source = { width: 200, height: 200, scalePixels: 100, scaleKilometers: 1,
        pointsOfInterest: [{ name: 'Open Baths', type: 'Temple', coords: [120, 70] }] };
    const streets = { streets: [{ id: 'main', name: 'Main Street', kind: 'road', coordinates: [[100, 0], [100, 200]] }],
        nodes: [{ id: 'a', coordinates: [100, 0] }, { id: 'b', coordinates: [100, 200] }],
        edges: [{ id: 'main', streetId: 'main', name: 'Main Street', kind: 'road', from: 'a', to: 'b', coordinates: [[100, 0], [100, 200]] }] };
    const landmarks = [{ id: 'stomion-landmark-baths', name: 'Open Baths', entrance: [70, 80], notes: 'Reviewed bath entrance.' }];
    const before = JSON.stringify(landmarks);
    const { map } = integrate(source, streets, { buildings: [] }, landmarks);
    assert.deepEqual(T.validate(map), []);
    assert.equal(map.buildings.length, 0);
    assert.equal(map.pointsOfInterest[0].travelNodeId, landmarks[0].id);
    assert.equal(map.pointsOfInterest[0].address, undefined);
    const trip = T.route(T.build(map), 'node:a', 'Open Baths');
    assert.ok(trip);
    assert.ok(Math.abs(trip.km - .9) < 1e-10, 'Includes 70px of street and 20px of entrance walk');
    assert.equal(JSON.stringify(landmarks), before, 'Landmark source must remain unchanged');
    assert.deepEqual(integrate(map, streets, { buildings: [] }, landmarks).map, map, 'Regeneration must be stable');
});

test('address frontage selection avoids a canal between the door and its nearest street', () => {
    const makeStreet = (id, y) => ({ id, name: id, kind: 'road', coordinates: [[y, 0], [y, 200]] });
    const streets = { streets: [makeStreet('Canal opposite bank', 100), makeStreet('Dry frontage', 145)], nodes: [], edges: [] };
    for (const street of streets.streets) {
        streets.nodes.push({ id: `${street.id}-a`, coordinates: street.coordinates[0] }, { id: `${street.id}-b`, coordinates: street.coordinates[1] });
        streets.edges.push({ ...street, streetId: street.id, from: `${street.id}-a`, to: `${street.id}-b` });
    }
    const roof = { id: 'home', coordinates: [120, 50], footprint: [[115, 45], [115, 55], [125, 55], [125, 45]] };
    const waterAt = ([y]) => y > 105 && y < 110;
    const { map, report } = integrate({ width: 200, height: 200, pointsOfInterest: [] }, streets, { buildings: [roof] }, [], { waterAt });
    assert.equal(map.buildings[0].streetId, 'Dry frontage');
    assert.deepEqual(report.obstructedAccesses, []);
});

test('an address can use a clear opening farther along its own street', () => {
    const streets = { streets: [{ id: 'main', name: 'Main Street', coordinates: [[100, 0], [100, 200]] }],
        nodes: [{ id: 'a', coordinates: [100, 0] }, { id: 'b', coordinates: [100, 200] }],
        edges: [{ id: 'main', streetId: 'main', name: 'Main Street', kind: 'road', from: 'a', to: 'b', coordinates: [[100, 0], [100, 200]] }] };
    const roof = (id, y) => ({ id, coordinates: [y, 50], footprint: [[y-5,45],[y-5,55],[y+5,55],[y+5,45]] });
    const { map, report } = integrate({ width: 200, height: 200, pointsOfInterest: [] }, streets, { buildings: [roof('home', 120), roof('neighbor', 108)] });
    const home = map.buildings.find(b => b.id === 'home');
    assert.equal(home.streetId, 'main');
    assert.ok(Math.abs(home.access.coordinates[1] - 50) > 5, 'Blocked perpendicular frontage must move along the street');
    assert.deepEqual(report.obstructedAccesses, []);
    assert.equal(project(home.access.coordinates, streets.edges[0].coordinates).distance, 0);
});

test('dense street fragmentation cannot hide a nearby clear frontage', () => {
    const streets = { streets: [], nodes: [], edges: [] };
    const add = (id, coordinates) => {
        streets.streets.push({ id, name: id, coordinates });
        streets.nodes.push({ id: `${id}-a`, coordinates: coordinates[0] }, { id: `${id}-b`, coordinates: coordinates[1] });
        streets.edges.push({ id, streetId: id, name: id, kind: 'road', from: `${id}-a`, to: `${id}-b`, coordinates });
    };
    for (let index = 0; index < 100; index++) add(`front-${index}`, [[100, 90 + index * .2], [100, 90 + (index + 1) * .2]]);
    add('clear-back-street', [[145, 0], [145, 200]]);
    const home = { id: 'home', coordinates: [120, 100], footprint: [[115, 95], [115, 105], [125, 105], [125, 95]] };
    const neighbor = { id: 'neighbor', coordinates: [108, 100], footprint: [[103, 0], [103, 200], [112, 200], [112, 0]] };
    const { map } = integrate({ width: 200, height: 200, pointsOfInterest: [] }, streets, { buildings: [home, neighbor] });
    const address = map.buildings.find(building => building.id === 'home');
    assert.equal(address.streetId, 'clear-back-street');
    assert.equal(address.accessReview, undefined);
});
