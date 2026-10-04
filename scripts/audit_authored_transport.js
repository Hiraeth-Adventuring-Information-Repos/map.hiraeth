#!/usr/bin/env node
// Audit the real authored maps, including every connected address and place.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const T = require('../js/travel-network');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file)));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const results = [];
for (const name of ['Fair-Content', 'Astrousia', 'IceBeach', 'castgate']) {
    const data = read(`maps/${name}.json`), graph = T.build(data), before = read(`design/world-transport/before-${name}.json`);
    assert(!graph.errors.length, `${name}: ${graph.errors.join('; ')}`);
    const targets = data.buildings ? data.buildings.filter(b => b.access).map(b => b.address) : data.pointsOfInterest.filter(p => p.travelNodeId).map(p => p.name);
    assert(targets.length > 0, `${name}: empty destination inventory`);
    const correction = data.transportReview?.correctionReview;
    const reviewedUnmapped = new Set([...(correction?.unmappedDestinations || []), ...(correction?.disconnectedDestinations || [])].map(entry => typeof entry === 'string' ? entry : entry.name));
    let checked = 0; const unmapped = [], componentAnchors = [targets[0]];
    for (const target of targets) {
        let trip = T.route(graph, targets[0], target);
        if (!trip) {
            assert(reviewedUnmapped.has(target), `${name}: ${target} disconnected without source-review explanation`); unmapped.push(target);
            const anchor = componentAnchors.find(from => T.route(graph, from, target));
            if (anchor) trip = T.route(graph, anchor, target);
            else { componentAnchors.push(target); trip = T.route(graph, target, target); }
        }
        const measuredKm = trip.legs.reduce((sum, leg) => sum + leg.coordinates.slice(1).reduce((total, point, i) => total + Math.hypot(point[0] - leg.coordinates[i][0], point[1] - leg.coordinates[i][1]), 0) * data.scaleKilometers / data.scalePixels, 0);
        assert(Math.abs(trip.km - measuredKm) < 1e-7, `${name}: geometry distance mismatch for ${target}`);
        assert(Number.isFinite(trip.hours) && trip.hours >= 0, `${name}: invalid moving-time estimate`);
        checked++;
    }
    for (const [i, original] of before.pointsOfInterest.entries()) {
        const current = data.pointsOfInterest[i];
        for (const key of Object.keys(original)) assert(JSON.stringify(original[key]) === JSON.stringify(current[key]), `${name}: original ${original.name}/${key} changed`);
    }
    assert(JSON.stringify(data.regions) === JSON.stringify(before.regions), `${name}: original regions changed`);
    assert(JSON.stringify(data.lines.filter(line => !line.mappingSource)) === JSON.stringify(before.lines || []), `${name}: original decorative geometry changed`);
    const review = data.addressReview || data.transportReview;
    assert(sha(`maps/${name}.webp`) === review.sourceArtworkSha256, `${name}: artwork drift`);
    if (name !== 'castgate') {
        for (const line of data.lines.filter(T.mapped)) {
            assert(['proposed', 'closed'].includes(line.travelServiceStatus), `${name}: proposal asserted as established`);
            if (['sail', 'ferry', 'rail'].includes(line.travelMode)) assert(line.travelFareGp === undefined, `${name}: unknown fare invented`);
        }
    } else {
        assert(data.scalePixels === 6630 && data.scaleKilometers === 2 && data.scaleReview.status === 'provisional', 'Castgate scale was not corrected');
        assert(data.buildings.every(b => b.footprint?.length >= 3 && b.entrance && b.access?.path), 'Castgate roof/access geometry incomplete');
        for (const p of data.pointsOfInterest) {
            assert(p.travelNodeId || p.buildingId, `Castgate place lacks walking access: ${p.name}`);
            assert(T.route(graph, targets[0], p.name, { allowedModes: ['road', 'trail'] }), `Castgate place has no connected walk: ${p.name}`);
        }
    }
    if (name === 'IceBeach') {
        assert(!data.lines.some(line => line.travelMode === 'ferry' && /Whitedrift.*Thrawbreak|Thrawbreak.*Whitedrift/.test(line.name)), 'Closed ferry was restored');
        if (data.transportReview?.correctionReview) {
            assert(!T.route(graph, 'Whitedrift', 'Castgate', { allowedModes: ['road', 'trail'] }), 'An unverified printed river crossing became walkable');
            for (const [from,to] of [['Castgate','Icemoor'],['Sleetmond','Ottiker'],['Nil Buldin','Quilt'],['Shiverwallow','Houlen Top north-bank trail access']]) assert(T.route(graph,from,to,{allowedModes:['road','trail']}), `Source-traced walking route missing: ${from} to ${to}`);
            for (const [from,to] of [['Shiverwallow','Houlen Top'],['Gernerum','Thrawbreak'],['Quilt west-bank trail access','Quilt']]) assert(!T.route(graph,from,to,{allowedModes:['road','trail']}), `Unverified town water crossing became walkable: ${from} to ${to}`);
        } else assert(T.route(graph, 'Whitedrift', 'Thrawbreak', { allowedModes: ['road', 'trail'] }), 'Overland alternative missing');
    }
    results.push({ map: name, validatedLinks: data.lines.filter(T.mapped).length, connectionPoints: data.travelNodes.length, destinationsChecked: checked, namedPlacesChecked: data.pointsOfInterest.filter(p => p.travelNodeId || p.buildingId).length, reviewedDestinationsOutsideMainComponent: unmapped, componentAnchors, modes: T.overview(data).modes.filter(m => m.count).map(m => ({ mode: m.id, links: m.count })), mapSha256: sha(`maps/${name}.json`), allOriginalPlaceFieldsPreserved: true, sourceArtworkPreserved: true });
}
assert(sha('maps/The-Port-City-of-Stomion.json') === 'a8fe135b430fa95429de6c8c909b6f4a210205465227eccea6ffa1bbd6eb4651', 'Reviewed Stomion data changed');
fs.writeFileSync(path.join(root, 'design/world-transport/routing-audit.json'), JSON.stringify({ maps: results, preservedStomionSha256: sha('maps/The-Port-City-of-Stomion.json') }, null, 2) + '\n');
console.log(results.map(r => `${r.map}: ${r.destinationsChecked} destinations, ${r.validatedLinks} links`).join('\n'));
