const { test } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/travel-network');
const { JSDOM } = require('jsdom');

test('place search keeps named suggestions, canonical addresses, clear actions and validation accessible', () => {
    const dom = new JSDOM('<!doctype html><body></body>'), document = dom.window.document;
    let chosen = null;
    const field = T.createAddressInput({ document, id: 'from', label: 'From', marker: 'A', clearLabel: 'Clear start', onChoose: choice => { chosen = choice.value; },
        choices: [{ value: 'home', label: '12 Harbor Street', displayLabel: 'The Lantern', detail: 'The Lantern', aliases: ['Lantern Inn'] }] });
    document.body.append(field.wrap); field.input.focus();
    assert.equal(field.input.getAttribute('aria-expanded'), 'false');
    field.input.value = 'Lantern'; field.input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(field.wrap.querySelector('[role="option"] strong').textContent, 'The Lantern');
    assert.equal(field.wrap.querySelector('[role="option"] span').textContent, '12 Harbor Street');
    field.input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(field.input.value, '12 Harbor Street'); assert.equal(chosen, 'home');
    assert.equal(field.input.getAttribute('aria-describedby'), 'from-hint');
    assert.equal(field.wrap.querySelector('#from-hint').textContent, 'The Lantern');
    field.describe('Choose a mapped place.', true);
    field.wrap.querySelector('[aria-label="Clear start"]').click();
    assert.equal(field.input.value, ''); assert.equal(field.input.getAttribute('aria-invalid'), 'false');
    assert.equal(document.activeElement, field.input);
    field.input.value = 'Unknown'; field.input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(field.wrap.querySelector('#from-hint').textContent, 'No mapped places match this search.');
    assert.equal(field.input.getAttribute('aria-expanded'), 'false');
    dom.window.close();
});
const road = (id, from, to, coordinates, extra = {}) => ({ id, name: id, travelMode: 'road', travelFrom: from, travelTo: to, coordinates, travelSpeedKph: 5, travelFareGp: 0, ...extra });
const building = (id, address, entrance, lineId, access, extra = {}) => ({ id, address, number: parseInt(address), streetId: 'harbor', coordinates: entrance, entrance, footprint: [entrance, [entrance[0] + 2, entrance[1]], [entrance[0], entrance[1] + 2]], access: { lineId, coordinates: access }, ...extra });
const fixture = () => ({ scalePixels: 1000, scaleKilometers: 1, lines: [road('Harbor Street', 'West', 'North', [[0, 0], [0, 100], [100, 100]], { travelFareGp: 2, travelCostPerKmGp: 3, travelDelayHours: .1 })], buildings: [
    building('home', '12 Harbor Street', [10, 20], 'Harbor Street', [0, 20], { name: 'The Lantern', aliases: ['Lantern Inn'] }),
    building('shop', '18 Harbor Street', [10, 70], 'Harbor Street', [0, 70]),
    building('end', '30 Harbor Street', [80, 110], 'Harbor Street', [80, 100])
] });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} differs from ${expected}`);
test('address-to-address trips include exact access and along-street distance, once-only tolls/delays, and reverse geometry', () => {
    const graph = T.build(fixture()); assert.deepEqual(graph.errors, []);
    const trip = T.route(graph, '12 harbor st.', '30 Harbor Street');
    near(trip.km, .18); near(trip.hours, .18 / 5 + .1); near(trip.cost, 2 + .16 * 3);
    assert.deepEqual(trip.legs.map(leg => leg.access || false), [true, false, true]);
    assert.deepEqual(trip.legs[1].coordinates, [[0, 20], [0, 70], [0, 100], [80, 100]]);
    const reverse = T.route(graph, 'end', 'address:home'); near(reverse.km, trip.km); near(reverse.cost, trip.cost); near(reverse.hours, trip.hours);
    assert.deepEqual(reverse.legs[1].coordinates, [...trip.legs[1].coordinates].reverse());
    const sameSegment = T.route(graph, 'home', 'shop'); near(sameSegment.km, .07); near(sameSegment.cost, 2 + .05 * 3); near(sameSegment.hours, .07 / 5 + .1);
    assert.equal(T.route(graph, 'Lantern Inn', 'shop').from, 'address:home'); assert.equal(T.route(graph, 'invented place', 'shop'), null);
});
test('nearby addresses share projections, zero access distances stay finite, and street endpoint access works', () => {
    const data = fixture(); data.buildings = [building('a', '1 Harbor Street', [0, 0], 'Harbor Street', [0, 0]), building('b', '2 Harbor Street', [5, 0], 'Harbor Street', [0, 0])];
    const trip = T.route(T.build(data), 'a', 'b'); near(trip.km, .005); near(trip.hours, .001); near(trip.cost, 0); assert.equal(trip.legs.length, 2);
    assert.equal(T.route(T.build(data), 'a', 'a').km, 0);
});
test('bent entrance walks retain full geometry and contribute their full distance and time in both directions', () => {
    const data = fixture(), path = [[10, 20], [10, 30], [0, 30], [0, 20]];
    data.buildings[0].access.path = path; data.addressAccessSpeedKph = 2;
    const graph = T.build(data), trip = T.route(graph, 'home', 'shop');
    assert.deepEqual(graph.errors, []); assert.deepEqual(trip.legs[0].coordinates, path);
    near(trip.km, .09); near(trip.hours, .04 / 2 + .05 / 5 + .1); near(trip.cost, 2 + .05 * 3);
    const reverse = T.route(graph, 'shop', 'home');
    assert.deepEqual(reverse.legs.at(-1).coordinates, [...path].reverse()); near(reverse.km, trip.km); near(reverse.hours, trip.hours);
    T.updateBuilding(data, 'home', { name: 'Lantern Court', number: 14 }); assert.deepEqual(data.buildings[0].access.path, path);
    T.splitLink(data, data.lines[0], 0, [0, 60], data.lines); assert.deepEqual(data.buildings[0].access.path, path);
    assert.deepEqual(T.validate(data), []); near(T.route(T.build(data), 'home', 'shop').km, .09);
});
test('entrance paths reject malformed points or detached endpoints and geometry changes clear stale walks', () => {
    for (const path of [null, [], [[10, 20]], [[10, 20], [NaN, 30], [0, 20]], [[11, 20], [0, 20]], [[10, 20], [0, 21]], [[0, 20], [10, 20]]]) {
        const invalid = fixture(); invalid.buildings[0].access.path = path;
        assert.match(T.validate(invalid).join('\n'), /entrance path/); assert.equal(T.route(T.build(invalid), 'home', 'shop'), null);
    }
    const path = [[10, 20], [10, 30], [0, 30], [0, 20]];
    for (const changes of [{ entrance: [11, 20] }, { coordinates: [11, 20] }, { footprint: [[9, 19], [9, 21], [12, 20]] }, { access: { lineId: 'Harbor Street', coordinates: [0, 40] } }]) {
        const data = fixture(); data.buildings[0].access.path = path; T.updateBuilding(data, 'home', changes);
        assert.equal(data.buildings[0].access.path, undefined); assert.deepEqual(T.validate(data), []);
    }
    const data = fixture(); T.updateBuilding(data, 'home', { access: { path } });
    assert.equal(data.buildings[0].access.lineId, 'Harbor Street'); assert.deepEqual(data.buildings[0].access.coordinates, [0, 20]);
    const before = JSON.stringify(data); assert.throws(() => T.updateBuilding(data, 'home', { access: { ...data.buildings[0].access, path: [[11, 20], [0, 20]] } }), /entrance path/); assert.equal(JSON.stringify(data), before);
    data.lines.push(road('Other road', 'Other west', 'Other east', [[200, 0], [200, 100]]));
    T.ensureNodes(data); const other = data.travelNodes.find(node => node.name === 'Other west');
    T.updateNode(data, other.id, { coordinates: [201, 0] }); assert.deepEqual(data.buildings[0].access.path, path);
    const west = data.travelNodes.find(node => node.name === 'West'); T.updateNode(data, west.id, { coordinates: [1, 0] });
    assert.equal(data.buildings[0].access.path, undefined); assert.deepEqual(T.validate(data), []);
});
test('one-way streets prohibit reverse address travel; known-fare routing excludes unknown street fares', () => {
    const data = fixture(); data.lines[0].travelOneWay = true; const graph = T.build(data);
    assert.ok(T.route(graph, 'home', 'end')); assert.equal(T.route(graph, 'end', 'home'), null);
    delete data.lines[0].travelFareGp; const unknown = T.build(data); assert.equal(T.route(unknown, 'home', 'end').cost, null); assert.equal(T.route(unknown, 'home', 'end', { preference: 'cheapest' }), null);
    assert.equal(T.route(graph, 'home', 'end', { allowedModes: ['rail'] }), null);
});
test('shortest, fastest and cheapest choose actual street distances, speeds and fares', () => {
    const data = fixture(); data.lines[0].travelSpeedKph = 1; data.lines[0].travelDelayHours = 0; data.lines.push(road('Fast bypass', 'West', 'North', [[0, 0], [0, -100], [100, -100], [100, 100]], { travelSpeedKph: 100, travelFareGp: 8 }));
    const graph = T.build(data);
    assert.ok(T.route(graph, 'home', 'end').legs.some(leg => leg.line.id === 'Fast bypass'));
    assert.equal(T.route(graph, 'home', 'end', { preference: 'shortest' }).legs.length, 3);
    near(T.route(graph, 'home', 'end', { preference: 'cheapest' }).cost, 2.48);
});
test('nearest street projection uses real segments rather than junction endpoints', () => {
    const data = fixture(); const address = building('a', '1 New Street', [20, 55]); delete address.access;
    const projection = T.projectAddress(data, address); near(projection.coordinates[0], 0); near(projection.coordinates[1], 55); near(projection.offset, 55); near(projection.distance, 20);
    assert.deepEqual(T.projectPoint([40, 110], data.lines[0]).coordinates, [40, 100]);
});
test('named landmark entrances remain routable alongside building addresses', () => {
    const data = fixture(); T.ensureNodes(data);
    const landmark = data.travelNodes.find(node => node.name === 'North'); landmark.name = 'The Waterlock'; landmark.kind = 'landmark';
    const graph = T.build(data); assert.deepEqual(graph.errors, []); assert.equal(graph.nodes.get(`node:${landmark.id}`).kind, 'landmark');
    const trip = T.route(graph, 'Lantern Inn', 'The Waterlock'); assert.ok(trip); assert.equal(trip.to, `node:${landmark.id}`); near(trip.km, .19);
});
test('address edits preserve metadata and move entrances/footprints, reproject access, and survive street edits', () => {
    const data = fixture(); data.buildings[0].custom = { retained: true }; data.buildings[0].access.custom = 'keep';
    T.updateBuilding(data, 'home', { coordinates: [15, 25], address: '14 Harbor Street', number: 14 });
    const changed = data.buildings[0]; assert.deepEqual(changed.entrance, [15, 25]); assert.deepEqual(changed.access.coordinates, [0, 25]); assert.deepEqual(changed.custom, { retained: true }); assert.equal(changed.access.custom, 'keep');
    assert.deepEqual(changed.footprint[1], [17, 25]); assert.throws(() => T.updateBuilding(data, 'home', { address: '18 Harbor St' }), /unique address/);
    T.splitLink(data, data.lines[0], 0, [0, 60], data.lines);
    assert.equal(data.buildings[1].access.lineId, data.lines[1].id); assert.equal(data.buildings[0].access.lineId, data.lines[0].id);
    assert.deepEqual(T.validate(data), []); assert.ok(T.route(T.build(data), 'home', 'end'));
    const node = data.travelNodes.find(node => node.name === 'West'); T.updateNode(data, node.id, { coordinates: [10, 0] });
    assert.notDeepEqual(data.buildings[0].access.coordinates, [0, 25]); assert.deepEqual(T.validate(data), []);
});
test('new footprints receive unique street addresses and entrances; malformed edits preserve the record', () => {
    const data = fixture(), footprint = [[10, 30], [10, 40], [20, 40], [20, 30]], added = T.addBuilding(data, footprint);
    assert.equal(added.address, '1 Harbor Street'); assert.equal(T.addBuilding(data, footprint).address, '3 Harbor Street');
    assert.deepEqual(added.coordinates, [15, 35]); assert.deepEqual(added.entrance, [10, 35]); assert.deepEqual(added.access.coordinates, [0, 35]);
    assert.deepEqual(T.validate(data), []); near(T.route(T.build(data), added.id, 'shop').km, .055);
    const before = JSON.stringify(added); assert.throws(() => T.updateBuilding(data, added.id, { footprint: [[0, 0], [0, 1], [0, 2]] }), /nonzero/); assert.equal(JSON.stringify(added), before);
    T.updateBuilding(data, added.id, { footprint: [[5, 30], [5, 40], [20, 40], [20, 30]] }); assert.deepEqual(added.entrance, [5, 35]); near(T.route(T.build(data), added.id, 'shop').km, .05);
    const empty = { buildings: [] }; assert.throws(() => T.addBuilding(empty, footprint), /road or trail/); assert.deepEqual(empty.buildings, []);
});
test('address renumbering synchronizes linked places and deletion preserves their independent metadata', () => {
    const data = fixture(); data.pointsOfInterest = [{ id: 'lantern-place', buildingId: 'home', address: '12 Harbor Street', name: 'The Lantern', description: 'Keep this place.' }, { id: 'other-place', buildingId: 'shop', address: '18 Harbor Street' }];
    T.updateBuilding(data, 'home', { number: '14' }); assert.equal(data.buildings[0].address, '14 Harbor Street'); assert.equal(data.pointsOfInterest[0].address, '14 Harbor Street');
    T.updateBuilding(data, 'home', { address: '16 Harbor Street' }); assert.equal(data.buildings[0].number, '16'); assert.equal(data.pointsOfInterest[0].address, '16 Harbor Street');
    const before = JSON.stringify(data); assert.throws(() => T.updateBuilding(data, 'home', { number: '18' }), /unique address/); assert.equal(JSON.stringify(data), before);
    assert.equal(T.removeBuilding(data, 'home'), true); assert.equal(T.removeBuilding(data, 'home'), false); assert.deepEqual(data.pointsOfInterest[0], { id: 'lantern-place', name: 'The Lantern', description: 'Keep this place.' }); assert.equal(data.pointsOfInterest[1].address, '18 Harbor Street');
});
test('search accepts aliases and abbreviations, rejects ambiguous aliases and malformed address data', () => {
    const data = fixture(); data.buildings[1].aliases = ['Lantern Inn'];
    const index = T.addressIndex(data); assert.equal(T.resolveAddress(index, '12 Harbor St.'), data.buildings[0]); assert.equal(T.resolveAddress(index, 'Lantern Inn'), null);
    assert.deepEqual(T.searchAddresses(index, 'harbor 30').map(building => building.id), ['end']);
    for (const modify of [map => map.buildings[1].id = 'home', map => map.buildings[1].address = '12 Harbor St', map => map.buildings[0].entrance = [NaN, 1], map => map.buildings[0].access.lineId = 'missing']) {
        const invalid = fixture(); modify(invalid); assert.ok(T.validate(invalid).length); assert.equal(T.route(T.build(invalid), 'home', 'end'), null);
    }
});
test('thousands of addresses route with the heap without charging a toll per intermediate house', () => {
    const data = { scalePixels: 1000, scaleKilometers: 1, lines: [road('Long Street', 'A', 'B', [[0, 0], [0, 6000]], { travelFareGp: 1 })], buildings: [] };
    for (let i = 0; i < 5000; i++) data.buildings.push(building(`house-${i}`, `${i + 1} Long Street`, [3, i + .25], 'Long Street', [0, i + .25]));
    const start = performance.now(), graph = T.build(data), trip = T.route(graph, 'house-0', 'house-4999');
    assert.deepEqual(graph.errors, []); near(trip.km, 5.005); near(trip.cost, 1); assert.equal(trip.legs.length, 3);
    assert.ok(performance.now() - start < 5000, '5000-address build and route must complete within five seconds');
});
