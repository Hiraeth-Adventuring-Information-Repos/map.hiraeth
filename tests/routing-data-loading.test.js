const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const { createPagesMapPayloads } = require('../scripts/build_pages.js');
const utilsSource = fs.readFileSync('js/shared-utils.js', 'utf8');
const original = {
    id: 'fixture', name: 'Fixture', pointsOfInterest: [{ id: 'poi', name: 'Shared POI', coords: [0, 0] }],
    buildings: [{ id: 'house', coordinates: [2, 2], footprint: [[1, 1], [1, 3], [3, 3]] }],
    travelNodes: [{ id: 'station', coordinates: [5, 6] }],
    roads: [{ id: 'road-a', coordinates: [[0, 0], [1, 1]] },
        { id: 'travel-road', travelMode: 'road', coordinates: [[1, 1], [2, 2]] },
        { name: 'Anonymous visible road', coordinates: [[2, 2], [3, 3]] }],
    lines: [{ id: 'ferry', travelMode: 'ferry', coordinates: [[1, 1], [4, 4]] },
        { id: 'river', type: 'River', coordinates: [[8, 8], [9, 9]] }]
};
const routingUrl = 'maps/routing/fixture.json';

function loader(respond) {
    const calls = [];
    const context = { URLSearchParams, window: { APP_ASSET_VERSION: 'test' },
        async fetch(url) { calls.push(url); return respond(url, calls); } };
    vm.createContext(context);
    vm.runInContext(utilsSource, context);
    return { calls, load: context.SharedUtils.fetchMapAsset };
}
const response = value => ({ ok: true, async json() { return JSON.parse(JSON.stringify(value)); } });
const plain = value => JSON.parse(JSON.stringify(value));

test('build splits only routing data and opt-in restores exact original arrays and feature IDs', async () => {
    const before = plain(original);
    const { base, routing } = createPagesMapPayloads(original, routingUrl);
    assert.deepEqual(original, before, 'authoring data must remain untouched');
    assert.equal(base.buildings, undefined);
    assert.equal(base.travelNodes, undefined);
    assert.deepEqual(base.roads, [original.roads[0], original.roads[2]]);
    assert.deepEqual(base.lines, [original.lines[1]]);
    const client = loader(url => response(url.startsWith(routingUrl) ? routing : base));
    assert.deepEqual(plain(await client.load('maps/fixture.json')), base);
    assert.deepEqual(client.calls, ['maps/fixture.json?v=test']);
    const restored = plain(await client.load('maps/fixture.json', true));
    delete restored.routingDataUrl;
    delete restored.routingDataFields;
    assert.deepEqual(restored, original);
    assert.ok(client.calls.includes(`${routingUrl}?v=test`));
});

test('source-preview data and maps without routing require no second request', async () => {
    for (const map of [original, { id: 'no-routing', roads: [original.roads[0]], buildings: [], travelNodes: [] }]) {
        const { base, routing } = createPagesMapPayloads(map, routingUrl);
        const sourcePreview = loader(() => response(map));
        assert.deepEqual(plain(await sourcePreview.load('maps/source.json', true)), map);
        assert.equal(sourcePreview.calls.length, 1);
        if (map.id === 'no-routing') {
            assert.equal(routing, null);
            assert.deepEqual(base, map);
            const client = loader(() => response(base));
            await client.load('maps/no-routing.json', true);
            assert.equal(client.calls.length, 1);
        }
    }
});

test('concurrent opt-in hydration shares one routing request', async () => {
    const { base, routing } = createPagesMapPayloads(original, routingUrl);
    const client = loader(url => response(url.startsWith(routingUrl) ? routing : base));
    await Promise.all([client.load('maps/fixture.json', true), client.load('maps/fixture.json', true)]);
    assert.equal(client.calls.filter(url => url.startsWith(routingUrl)).length, 1);
});

for (const failure of ['network', 'http', 'wrong-map', 'missing-field', 'bad-array']) {
    test(`routing ${failure} rejects incomplete map, clears failed request and permits retry`, async () => {
        const { base, routing } = createPagesMapPayloads(original, routingUrl);
        let fail = true;
        const client = loader(url => {
            if (!url.startsWith(routingUrl)) return response(base);
            if (!fail) return response(routing);
            if (failure === 'network') throw new TypeError('offline');
            if (failure === 'http') return { ok: false, status: 503, statusText: 'Unavailable' };
            const malformed = plain(routing);
            if (failure === 'wrong-map') malformed.mapId = 'other';
            if (failure === 'missing-field') delete malformed.buildings;
            if (failure === 'bad-array') malformed.lines = null;
            return response(malformed);
        });
        await assert.rejects(client.load('maps/fixture.json', true));
        fail = false;
        const restored = await client.load('maps/fixture.json', true);
        assert.deepEqual(plain(restored.buildings), original.buildings);
        assert.equal(client.calls.filter(url => url.startsWith(routingUrl)).length, 2);
    });
}
