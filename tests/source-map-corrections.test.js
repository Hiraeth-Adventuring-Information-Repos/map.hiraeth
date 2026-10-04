const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const T = require('../js/travel-network.js');
const read = name => JSON.parse(fs.readFileSync(`maps/${name}.json`, 'utf8'));

test('printed IceBeach trails connect named places through their drawn junctions without glacier shortcuts', () => {
    const data = read('IceBeach'), graph = T.build(data);
    assert.deepEqual(graph.errors, []);
    for (const [from, to] of [['Castgate', 'Icemoor'], ['Sleetmond', 'Ottiker'], ['Sleetmond', 'Quilt'], ['Gernerum', 'Thrawbreak north-bank trail access'], ['Nil Buldin', 'Quilt'], ['Shiverwallow', 'Houlen Top north-bank trail access'], ['Shiverwallow', 'Quilt west-bank trail access'], ['Fractured Point', 'Ottiker']]) {
        const trip = T.route(graph, from, to, { allowedModes: ['road', 'trail'] });
        assert.ok(trip, `${from} to ${to} should use the printed trail`);
        assert.ok(trip.legs.every(leg => leg.line.travelMode === 'trail' && leg.line.trailSourceId && leg.line.travelGeometryStatus === 'source-traced trail'));
        assert.equal(trip.cost, 0);
        const reverse = T.route(graph, to, from, { allowedModes: ['road', 'trail'] });
        assert.ok(Math.abs(reverse.km - trip.km) < 1e-7);
    }
    assert.equal(data.lines.some(line => line.id === 'IceBeach-transport-005'), false, 'Unillustrated glacier shortcut must not return');
});

test('IceBeach keeps unverified water spans out of walking routes and preserves the closed-ferry lore', () => {
    const data = read('IceBeach'), graph = T.build(data);
    assert.equal(T.route(graph, 'Whitedrift', 'Castgate', { allowedModes: ['road', 'trail'] }), null);
    assert.equal(T.route(graph, 'Whitedrift', 'Thrawbreak', { preference: 'cheapest' }), null);
    for (const [from, to] of [['Quilt west-bank trail access', 'Quilt'], ['Shiverwallow', 'Houlen Top'], ['Gernerum', 'Thrawbreak']]) assert.equal(T.route(graph, from, to, { allowedModes: ['road', 'trail'] }), null, `${from} to ${to} crosses an unverified water span`);
    assert.ok(T.route(graph, 'Whitedrift', 'Castgate'), 'Preserved proposed boat alternative remains available');
    const review = data.transportReview.correctionReview;
    assert.ok(review.withheldWaterSpans.length);
    for (const span of review.withheldWaterSpans) {
        const line = data.lines.find(line => line.id === span.graphId);
        assert.equal(line?.travelServiceStatus, 'closed');
        assert.equal(T.active(line), false);
    }
    assert.equal(data.lines.some(line => line.travelMode === 'ferry' && /Whitedrift.*Thrawbreak|Thrawbreak.*Whitedrift/.test(line.name)), false);
});

test('Castgate keeps one palace roof instead of rooftop-detail addresses and excludes reviewed trees, boats and open grounds', () => {
    const data = read('castgate'), graph = T.build(data), index = T.addressIndex(data);
    assert.deepEqual(graph.errors, []);
    const palace = T.resolveAddress(index, "Chai en' Steep Inn");
    assert.equal(palace.id, 'castgate-building-0340');
    const bounds = palace.footprint.reduce((b, p) => [Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);
    assert.ok(bounds[2]-bounds[0] > 490 && bounds[3]-bounds[1] > 400, 'Palace outline must include its connected wings, not only a tiny skylight');
    for (const id of ['castgate-building-0002','castgate-building-0068','castgate-building-0077','castgate-building-0113','castgate-building-0321']) assert.equal(data.buildings.some(b => b.id === id), false, `${id} must not return as an independent roof`);
    const embassy = data.buildings.find(b => b.id === 'castgate-building-0091');
    assert.equal(embassy.footprintHoles.length, 1);
    assert.ok(T.footprintContains(embassy, embassy.coordinates));
    assert.ok(T.route(graph, "Chai en' Steep Inn", 'School for Adventures', { allowedModes: ['road','trail'] }));
    assert.ok(data.buildings.some(building => T.footprintContains(building, [data.height - 4322, 7810])), 'The connected snow-covered roof beside the Brewery pin must be a physical obstacle');
});

test('Castgate pier paths reach the city along their depicted deck approaches', () => {
    const data = read('castgate'), graph = T.build(data);
    assert.deepEqual(graph.errors, []);
    for (const id of ['castgate-junction-0054', 'castgate-junction-0069', 'castgate-junction-0084', 'castgate-junction-0090']) {
        const trip = T.route(graph, 'School for Adventures', `node:${id}`, { allowedModes: ['road', 'trail'] });
        assert.ok(trip, `${id}: a real pier must connect through its shore approach`);
        assert.ok(trip.legs.every(leg => ['road', 'trail'].includes(leg.line.travelMode)));
    }
    const pierEnd = data.lines.find(line => line.id === 'castgate-street-0039').coordinates.at(-1);
    const nativeEnd = [pierEnd[1], data.height - pierEnd[0]];
    assert.ok(nativeEnd[0] >= 3490 && nativeEnd[0] <= 3510 && nativeEnd[1] >= 4480 && nativeEnd[1] <= 4505, 'The left T-head must stop on its depicted timber, before the open-water gap');
});
