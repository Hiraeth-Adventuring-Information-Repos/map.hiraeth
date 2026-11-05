const { test } = require('node:test');
const assert = require('node:assert/strict');
const travel = require('../js/travel-network');
const files = require('../js/map-file-document');
const shared = require('../js/editor-shared');
const segment = (name, from, to, coordinates, extra = {}) => ({ id: name, name, coordinates, travelMode: 'road', travelFrom: from, travelTo: to, travelSpeedKph: 5, travelFareGp: 0, ...extra });
const fixture = () => ({ scalePixels: 10, scaleKilometers: 1, lines: [
    segment('Hill road', 'A', 'B', [[0, 0], [30, 0], [30, 40]], { travelFareGp: 1, travelCostPerKmGp: .5 }),
    segment('Express', 'B', 'C', [[30, 40], [30, 140]], { travelMode: 'rail', travelSpeedKph: 40, travelFareGp: 10, travelDelayHours: .5 }),
    segment('Coast trail', 'A', 'C', [[0, 0], [0, 140], [30, 140]], { travelMode: 'trail', travelSpeedKph: 3 }),
    segment('Boat', 'C', 'D', [[30, 140], [90, 140]], { travelMode: 'sail', travelSpeedKph: 10, travelFareGp: 4, travelOneWay: true })
] });
test('fastest, cheapest and shortest use full polyline lengths, fares and delays', () => {
    const graph = travel.build(fixture());
    assert.deepEqual(graph.errors, []);
    const fast = travel.route(graph, 'A', 'C');
    assert.deepEqual(fast.legs.map(leg => leg.line.name), ['Hill road', 'Express']);
    assert.equal(fast.km, 17); assert.equal(fast.hours, 2.15); assert.equal(fast.cost, 14.5);
    const cheap = travel.route(graph, 'A', 'C', { preference: 'cheapest' });
    assert.equal(cheap.cost, 0); assert.equal(cheap.legs[0].line.name, 'Coast trail');
    assert.equal(travel.route(graph, 'A', 'C', { preference: 'shortest' }).hours, 2.15);
});
test('visibility is independent of routing; mode filtering, reverse geometry and one-way travel work', () => {
    const data = fixture(); data.lines[0].travelVisible = false;
    const graph = travel.build(data);
    assert.equal(travel.route(graph, 'A', 'D').legs.length, 3);
    assert.equal(travel.route(graph, 'D', 'A'), null);
    assert.equal(travel.route(graph, 'A', 'D', { allowedModes: ['road', 'rail'] }), null);
    assert.equal(travel.route(graph, 'A', 'C', { allowedModes: ['trail'] }).legs[0].line.name, 'Coast trail');
    assert.deepEqual(travel.route(graph, 'B', 'A').legs[0].coordinates, [[30, 40], [30, 0], [0, 0]]);
    assert.equal(travel.route(graph, 'A', 'A').hours, 0);
    assert.equal(travel.route(graph, 'missing', 'A'), null);
});
test('unknown fares are never treated as free, and zero-cost cycles terminate', () => {
    const data = fixture(); delete data.lines[3].travelFareGp;
    const graph = travel.build(data);
    assert.equal(travel.route(graph, 'A', 'D').cost, null);
    assert.equal(travel.route(graph, 'A', 'D', { preference: 'cheapest' }), null);
    assert.equal(travel.route(graph, 'C', 'A', { preference: 'cheapest' }).cost, 0);
});
test('route choices omit duplicate paths and preserve mode, closure and known-fare restrictions', () => {
    const data = fixture(), graph = travel.build(data);
    const choices = travel.routeOptions(graph, 'A', 'C');
    assert.deepEqual(choices.map(choice => choice.preference), ['fastest', 'cheapest']);
    assert.equal(choices[0].trip.cost, 14.5); assert.equal(choices[1].trip.cost, 0);
    assert.deepEqual(travel.routeOptions(graph, 'A', 'C', { preference: 'cheapest' }).map(choice => choice.preference), ['cheapest', 'fastest']);
    assert.equal(travel.routeOptions(graph, 'A', 'C', { allowedModes: ['trail'] }).length, 1);
    data.lines[1].travelServiceStatus = 'closed';
    assert.equal(travel.routeOptions(travel.build(data), 'A', 'C').length, 1);
    delete data.lines[3].travelFareGp;
    assert.equal(travel.routeOptions(travel.build(data), 'A', 'D')[0].trip.cost, null);
    assert.deepEqual(travel.routeOptions(travel.build(data), 'A', 'D', { preference: 'cheapest' }), []);
    assert.deepEqual(travel.routeOptions(graph, 'missing', 'C'), []);
});
test('closed services remain editable and validated but never enter directions', () => {
    const data = fixture();
    data.lines[1].travelServiceStatus = 'closed';
    data.lines[3].travelServiceStatus = 'proposed';
    assert.equal(travel.mapped(data.lines[1]), true);
    assert.equal(travel.active(data.lines[1]), false);
    assert.deepEqual(travel.validate(data), []);
    assert.deepEqual(travel.route(travel.build(data), 'A', 'C').legs.map(leg => leg.line.name), ['Coast trail']);
    const inventory = travel.overview(data);
    assert.equal(inventory.closed, 1); assert.equal(inventory.proposed, 1);
    assert.equal(inventory.modes.find(mode => mode.id === 'rail').available, 0);
    data.lines[1].travelSpeedKph = 0;
    assert.ok(travel.validate(data).some(error => error.includes('speed')));
});
test('bad scales, speeds, geometry, disconnected nodes and invalid fares fail explicitly', () => {
    assert.deepEqual(travel.validate({}), []);
    for (const change of [data => data.scalePixels = 0, data => data.lines[0].travelSpeedKph = 0, data => data.lines[0].travelFareGp = -1,
        data => data.lines[0].coordinates = [[0, NaN], [1, 1]], data => data.lines[0].coordinates[0] = [999, 999],
        data => data.lines[0].travelMode = '__proto__', data => data.lines[0].travelTo = '']) {
        const data = fixture(); change(data); assert.ok(travel.validate(data).length); assert.equal(travel.build(data).nodes.size, 0);
    }
    const data = fixture(); data.lines = [data.lines[0], data.lines[3]];
    assert.equal(travel.route(travel.build(data), 'A', 'D'), null);
});
test('named endpoints snap to existing junctions; crossing geometry alone does not create a connection', () => {
    const data = fixture(), line = segment('New road', 'E', 'B', [[900, 800], [32, 39]]);
    travel.connectEndpoint(line, 'travelTo', ' b ', data.lines);
    assert.deepEqual(line.coordinates.at(-1), [30, 40]);
    data.lines.push(line); assert.deepEqual(travel.validate(data), []);
    assert.equal(travel.route(travel.build(data), 'E', 'A').legs.length, 2);
    const crossing = { scalePixels: 1, scaleKilometers: 1, lines: [
        segment('East west', 'W', 'E', [[0, -10], [0, 10]]),
        segment('North south', 'N', 'S', [[-10, 0], [10, 0]])
    ] };
    assert.equal(travel.route(travel.build(crossing), 'W', 'N'), null);
});
test('editor normalization and lossless export preserve routing and unrelated fields', () => {
    const raw = fixture(); raw.custom = { untouched: true }; raw.lines[0].custom = ['preserve'];
    raw.lines[0].travelOcclusions = [[[20, -5], [20, 5], [25, 5], [25, -5]]];
    raw.lines[0].travelBridgeIds = ['river-bridge'];
    const normalized = { ...raw, lines: raw.lines.map(shared.normalizeLine) };
    const session = files.createSession(raw, normalized);
    session.editableDocument.lines[0].travelFareGp = 8;
    const result = files.buildDocument(session.snapshot, session.editableDocument);
    assert.equal(result.lines[0].travelFareGp, 8);
    assert.deepEqual(result.lines[0].custom, ['preserve']); assert.deepEqual(result.custom, raw.custom);
    assert.deepEqual(result.lines[0].coordinates, raw.lines[0].coordinates);
    assert.deepEqual(result.lines[0].travelOcclusions, raw.lines[0].travelOcclusions);
    assert.deepEqual(result.lines[0].travelBridgeIds, raw.lines[0].travelBridgeIds);
});

test('covered passages clip drawing in both directions while full geometry determines distance and time', () => {
    const line = segment('Train', 'A', 'B', [[0, 0], [0, 5], [0, 10]], {
        travelMode: 'rail', travelSpeedKph: 40, travelOcclusions: [[[-1, 3], [1, 3], [1, 7], [-1, 7]]]
    });
    const original = structuredClone(line);
    assert.deepEqual(travel.visibleSegments(line), [[[0, 0], [0, 3]], [[0, 7], [0, 10]]]);
    const graph = travel.build({ scalePixels: 1, scaleKilometers: 1, lines: [line] });
    const trip = travel.route(graph, 'B', 'A');
    assert.equal(trip.km, 10); assert.equal(trip.hours, .25);
    assert.deepEqual(travel.visibleSegments(line, trip.legs[0].coordinates), [[[0, 10], [0, 7]], [[0, 3], [0, 0]]]);
    assert.deepEqual(line, original);
});

test('overlapping and concave covers handle hidden vertices, complete cover and tangencies', () => {
    const coordinates = [[0, 0], [0, 5], [0, 10]];
    const rectangle = (a, b) => [[-1, a], [1, a], [1, b], [-1, b], [-1, a]];
    assert.deepEqual(travel.visibleSegments({ coordinates, travelOcclusions: [rectangle(2, 6), rectangle(4, 8)] }), [[[0, 0], [0, 2]], [[0, 8], [0, 10]]]);
    assert.deepEqual(travel.visibleSegments({ coordinates, travelOcclusions: [rectangle(-1, 11)] }), []);
    const tangent = travel.visibleSegments({ coordinates, travelOcclusions: [[[0, 2], [1, 2], [1, 8], [0, 8]]] });
    assert.equal(tangent.length, 1);
    assert.deepEqual(tangent[0][0], coordinates[0]); assert.deepEqual(tangent[0].at(-1), coordinates.at(-1));
    const concave = [[-1, 2], [1, 2], [1, 8], [-1, 8], [-1, 6], [.5, 6], [.5, 4], [-1, 4]];
    assert.deepEqual(travel.visibleSegments({ coordinates, travelOcclusions: [concave] }), [[[0, 0], [0, 2]], [[0, 4], [0, 5], [0, 6]], [[0, 8], [0, 10]]]);
    for (const mask of [null, [rectangle(2, 8).slice(0, 2)], [[[0, NaN], [1, 2], [3, 4]]]]) {
        const data = fixture(); data.lines[0].travelOcclusions = mask;
        assert.ok(travel.validate(data).some(error => /covered passages/.test(error)));
    }
});
test('connecting curved routes preserves editable handles when resampled by the editor', () => {
    const anchors = [[0, 0], [10, 10], [20, 0]], handles = [null, { in: [5, 10], out: [15, 10] }, { in: [18, 2] }];
    const line = segment('Curve', 'A', 'B', shared.sampleBezierPath(anchors, handles, false));
    line.bezier = { version: 1, anchors, handles };
    const other = segment('Join', 'B', 'C', [[50, 10], [60, 10]]);
    assert.equal(travel.connectEndpoint(line, 'travelTo', 'B', [other]), true);
    line.coordinates = shared.sampleBezierPath(line.bezier.anchors, line.bezier.handles, false);
    assert.deepEqual(line.coordinates.at(-1), [50, 10]);
    assert.deepEqual(line.bezier.handles[2].in, [48, 12]);
    assert.ok(shared.getFeatureBezierGeometry(line, false));
});

test('visual connection points migrate legacy links only on edit and keep stable connections after rename/move', () => {
    const data = fixture(), original = structuredClone(data);
    const points = travel.connectionPoints(data);
    assert.equal(points.length, 4); assert.deepEqual(data, original);
    travel.ensureNodes(data);
    const b = data.travelNodes.find(node => node.name === 'B'), c = data.travelNodes.find(node => node.name === 'C');
    travel.updateNode(data, b.id, { name: 'Central station', kind: 'station', coordinates: [40, 50] }, data.lines, shared.sampleBezierPath);
    assert.deepEqual(data.lines[0].coordinates.at(-1), [40, 50]);
    assert.deepEqual(data.lines[1].coordinates[0], [40, 50]);
    assert.equal(data.lines[0].travelToNode, b.id); assert.equal(data.lines[1].travelFrom, 'Central station');
    assert.deepEqual(travel.validate(data), []);
    assert.equal(travel.route(travel.build(data), 'Central station', 'D').legs.length, 2);
    assert.throws(() => travel.updateNode(data, b.id, { name: 'C' }), /unique name/);
    const orphan = travel.addNode(data, [500, 500], 'port');
    assert.equal(travel.route(travel.build(data), `node:${orphan.id}`, `node:${c.id}`), null);
    data.lines[0].travelToNode = 'nonexistent'; assert.ok(travel.validate(data).some(error => /existing connection points/.test(error)));
});

test('inserting a junction preserves total distance, fare, delay, one-way restrictions and unrelated data', () => {
    const data = fixture(); data.lines = [data.lines[0]];
    Object.assign(data.lines[0], { travelOneWay: true, travelDelayHours: 2, custom: { preserve: true }, __hiraethFileIdentity: 'lines:0' });
    const before = travel.route(travel.build(data), 'A', 'B');
    const junction = travel.splitLink(data, data.lines[0], 1, [30, 20], data.lines);
    assert.equal(data.lines.length, 2); assert.equal(data.travelNodes.length, 3);
    assert.equal(data.lines[1].__hiraethFileIdentity, undefined);
    assert.deepEqual(data.lines[1].custom, { preserve: true });
    assert.deepEqual(travel.validate(data), []);
    const after = travel.route(travel.build(data), 'A', 'B');
    assert.equal(after.km, before.km); assert.equal(after.hours, before.hours); assert.equal(after.cost, before.cost);
    assert.equal(travel.route(travel.build(data), 'B', 'A'), null);
    const port = travel.addNode(data, [100, 20], 'port');
    data.lines.push(travel.createLink(junction, port, [junction.coordinates, port.coordinates], 'rail'));
    assert.equal(travel.route(travel.build(data), 'A', port.name).legs.length, 2);
    assert.equal(travel.route(travel.build(data), 'A', port.name).cost, null);
});

test('new network data survives lossless export and unknown fields on nodes are preserved', () => {
    const raw = fixture(), normalized = structuredClone(raw), session = files.createSession(raw, normalized);
    const data = session.editableDocument;
    travel.ensureNodes(data); data.travelNodes[0].custom = { note: 'retain' };
    const split = travel.splitLink(data, data.lines[0], 1, [30, 20], data.lines);
    travel.updateNode(data, split.id, { name: 'Crossroads' });
    const saved = files.buildDocument(session.snapshot, data);
    assert.equal(saved.travelNodes.length, 5); assert.deepEqual(saved.travelNodes[0].custom, { note: 'retain' });
    assert.deepEqual(travel.validate(saved), []);
    assert.equal(JSON.stringify(saved).includes('__hiraethFileIdentity'), false);
    assert.equal(travel.route(travel.build(saved), 'A', 'D').legs.length, 4);
});

test('editor serialization keeps fractional network coordinates aligned with connection points', () => {
    const data = { id: 'precision', scalePixels: 100, scaleKilometers: 1, lines: [] };
    const a = travel.addNode(data, [100.25, 200.15], 'town');
    const b = travel.addNode(data, [550.3333, 240.8765], 'station');
    data.lines.push(travel.createLink(a, b, [a.coordinates, b.coordinates]));
    const result = shared.serializeMapDocumentState({ masterMapData: [data], currentMapId: data.id, collectedLines: data.lines, collectedPoints: [], collectedRegions: [], mapSettings: {} });
    assert.deepEqual(travel.validate(result), []);
    assert.deepEqual(result.lines[0].coordinates, [a.coordinates, b.coordinates]);
});

test('moving a shared curved endpoint retains exact fractional connections and editable handles', () => {
    const data = fixture(), line = data.lines[0];
    line.bezier = { version: 1, anchors: structuredClone(line.coordinates), handles: [null, null, { in: [25, 35] }] };
    line.coordinates = shared.sampleBezierPath(line.bezier.anchors, line.bezier.handles);
    travel.ensureNodes(data);
    const b = data.travelNodes.find(node => node.name === 'B');
    travel.updateNode(data, b.id, { coordinates: [40.25, 50.75] }, data.lines, shared.sampleBezierPath);
    assert.deepEqual(travel.validate(data), []);
    assert.deepEqual(line.coordinates.at(-1), [40.25, 50.75]);
    assert.deepEqual(line.bezier.handles.at(-1).in, [35.25, 45.75]);
    assert.ok(shared.getFeatureBezierGeometry(line, false));
});
