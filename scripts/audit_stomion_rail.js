#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRailBarrier } = require('./stomion_rail_barriers');
const root = path.resolve(__dirname, '..');
function audit(data, review) {
    const barrier = createRailBarrier(data.lines, review.bridges, { height: data.height, clearance: review.clearancePixels });
    const paths = data.lines.filter(line => ['road', 'trail'].includes(line.travelMode));
    const entrances = (data.buildings || []).filter(building => building.access);
    return { walkingEdges: paths.length, entrancePaths: entrances.length, reviewedBridges: review.bridges.length,
        railClearancePixels: barrier.clearance,
        unmappedAccesses: (data.buildings || []).filter(building => !building.access).map(building => building.id),
        streetConflicts: paths.filter(line => barrier.crosses(line.coordinates)).map(line => ({ id: line.id, streetId: line.streetId })),
        entranceConflicts: entrances.filter(building => barrier.crosses(building.access.path || [building.entrance, building.access.coordinates]))
            .map(building => ({ id: building.id, address: building.address })),
        method: 'Every full walking polyline and entrance path sampled at half an artwork pixel against rail clearance outside individually source-reviewed bridge polygons.',
        limit: 'Bridge provenance is based on the supplied artwork. Exact door placement and pedestrian permission on depicted bridge decks remain unresolved.' };
}
if (require.main === module) {
    const mapPath = path.join(root, 'maps/The-Port-City-of-Stomion.json'), reviewPath = path.join(root, 'design/stomion/rail-walking-bridges.json');
    const report = audit(JSON.parse(fs.readFileSync(mapPath)), JSON.parse(fs.readFileSync(reviewPath)));
    report.mapSha256 = crypto.createHash('sha256').update(fs.readFileSync(mapPath)).digest('hex');
    report.bridgeReviewSha256 = crypto.createHash('sha256').update(fs.readFileSync(reviewPath)).digest('hex');
    fs.writeFileSync(path.join(root, 'design/stomion/rail-path-audit.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    if (process.argv.includes('--strict') && (report.streetConflicts.length || report.entranceConflicts.length)) process.exitCode = 1;
}
module.exports = { audit };
