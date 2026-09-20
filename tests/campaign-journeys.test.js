const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const journeys = require('../js/campaign-journeys.js');
const files = require('../js/map-file-document.js');
const editor = require('../js/editor-shared.js');

const journey = () => ({
    id: 'campaign-trail', name: 'The long road', campaign: 'Test campaign', color: '#d97706', visibleByDefault: false,
    stops: [
        { id: 'arrival', name: 'Arrival', coords: [12.123456789, 35.987654321], date: 'Late autumn, 58 BEC', custom: { source: 'session notes' } },
        { id: 'return', name: 'Return', coords: [23, 45], date: 'A few days later', wikiLink: 'https://example.org/wiki/return' }
    ]
});

test('journeys accept free-text dates and reject malformed geometry, unsafe links and duplicate IDs', () => {
    assert.deepEqual(journeys.validate(undefined), []);
    assert.deepEqual(journeys.validate([journey()]), []);
    const invalid = journey();
    invalid.stops[1].coords = ['23', Infinity];
    invalid.stops[1].id = 'arrival';
    invalid.stops[1].wikiLink = 'javascript:alert(1)';
    invalid.visibleByDefault = 'false';
    assert.equal(journeys.validate([invalid]).length, 4);
    assert.match(journeys.validate([{ ...journey(), stops: [] }])[0], /at least one stop/);
});

test('editor serialization and download preserve journey order, custom metadata and precise coordinates', () => {
    const raw = { id: 'map', name: 'Map', pointsOfInterest: [], journeys: [journey()], custom: { untouched: true } };
    const serialized = editor.serializeMapDocumentState({ masterMapData: [raw], currentMapId: 'map' });
    const session = files.createSession(raw, serialized);
    assert.deepEqual(files.buildDocument(session.snapshot, session.editableDocument), raw);
    const edited = session.editableDocument;
    edited.journeys[0].stops.reverse();
    edited.journeys[0].stops[1].description = 'Recorded later';
    const download = files.buildDocument(session.snapshot, edited);
    assert.deepEqual(download.journeys[0].stops.map(stop => stop.id), ['return', 'arrival']);
    assert.deepEqual(download.journeys[0].stops[1].custom, raw.journeys[0].stops[0].custom);
    assert.deepEqual(download.journeys[0].stops[1].coords, raw.journeys[0].stops[0].coords);
    assert.deepEqual(download.custom, raw.custom);
    assert.doesNotMatch(JSON.stringify(download), /__hiraethFileIdentity/);
    edited.journeys = [];
    assert.deepEqual(files.buildDocument(session.snapshot, edited).journeys, []);
});

test('stop popup treats notes as text and only makes safe wiki URLs clickable', () => {
    const document = new JSDOM('').window.document;
    const data = journey();
    data.stops[0].name = '<img src=x onerror=alert(1)>';
    data.stops[0].wikiLink = 'javascript:alert(1)';
    const unsafe = journeys.popup(document, data, data.stops[0], 0);
    assert.equal(unsafe.querySelector('img, script, a'), null);
    assert.match(unsafe.textContent, /Late autumn, 58 BEC/);
    const safe = journeys.popup(document, data, data.stops[1], 1);
    assert.equal(safe.querySelector('a').href, 'https://example.org/wiki/return');
    assert.equal(safe.querySelector('a').rel, 'noopener noreferrer');
});
