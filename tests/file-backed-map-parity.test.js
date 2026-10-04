const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const snapshotPath = path.join('tests', 'fixtures', 'active-map-inline-snapshot.json');
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join('maps', 'maps.json'), 'utf8'));
const dataUrlById = new Map(manifest.map((entry) => [entry.id, entry.dataUrl]));

function normalizeFileBackedMap(mapData) {
    const normalized = JSON.parse(JSON.stringify(mapData));
    delete normalized.children;
    delete normalized.selectorDescription;
    // Authored transport and Castgate geometry are additive to the migrated
    // payload. Verify every original place field and decorative feature, while
    // excluding only records owned by these two explicit survey sources.
    const survey = normalized.id === 'castgate' ? 'castgate-address-survey' : normalized.transportReview?.mappingSource === 'world-transport-survey' ? 'world-transport-survey' : null;
    if (survey) {
        for (const field of ['lines', 'travelNodes', 'buildings']) {
            normalized[field] = (normalized[field] || []).filter(record => record.mappingSource !== survey);
            if (!normalized[field].length && (field !== 'lines' || !Array.isArray(snapshot[normalized.id]?.lines))) delete normalized[field];
        }
        for (const point of normalized.pointsOfInterest || []) {
            if (String(point.buildingId || '').startsWith('castgate-building-')) delete point.buildingId;
            if (String(point.travelNodeId || '').startsWith('castgate-landmark-') || String(point.travelNodeId || '').includes('-travel-')) delete point.travelNodeId;
            if (['castgate', 'The-Port-City-of-Stomion'].includes(point.linkedMapId)) delete point.linkedMapId;
        }
        delete normalized.transportReview;
        if (survey === 'castgate-address-survey') {
            delete normalized.addressReview; delete normalized.scaleReview; delete normalized.streets; delete normalized.walkingObstacles;
            // The user authorized replacing this original placeholder scale.
            normalized.scalePixels = 50; normalized.scaleKilometers = 3600;
        }
    }
    // The Stomion address survey is an additive overlay on the migrated lore.
    // Keep checking every original field while omitting this authored layer.
    if (normalized.id === 'The-Port-City-of-Stomion' && normalized.addressMapping) {
        delete normalized.addressMapping;
        normalized.lines = (normalized.lines || []).filter(line => line.mappingSource !== 'stomion-address-survey');
        for (const field of ['buildings', 'travelNodes']) {
            normalized[field] = (normalized[field] || []).filter(record => record.mappingSource !== 'stomion-address-survey');
            if (!normalized[field].length) delete normalized[field];
        }
        for (const point of normalized.pointsOfInterest || []) {
            if (String(point.buildingId || '').startsWith('stomion-building-')) {
                delete point.address;
                delete point.buildingId;
            }
            if (String(point.travelNodeId || '').startsWith('stomion-landmark-')) delete point.travelNodeId;
        }
    }
    return normalized;
}

for (const [mapId, expectedMap] of Object.entries(snapshot)) {
    const actualPath = dataUrlById.has(mapId)
        ? dataUrlById.get(mapId)
        : path.join('maps', `${mapId}.json`);
    assert.ok(fs.existsSync(actualPath), `${actualPath} should exist`);
    const actualMap = JSON.parse(fs.readFileSync(actualPath, 'utf8'));
    assert.deepEqual(
        normalizeFileBackedMap(actualMap),
        normalizeFileBackedMap(expectedMap),
        `${mapId} should preserve the migrated inline payload`
    );
}

console.log('file-backed map parity checks passed');
