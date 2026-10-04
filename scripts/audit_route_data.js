#!/usr/bin/env node
// Structural and routing checks complement the separate source-artwork review.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const T = require('../js/travel-network.js');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
const measure = points => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]), 0);

function audit(data) {
    const lines = T.linesOf(data), graph = T.build(data);
    assert.deepEqual(graph.errors, [], `${data.id}: invalid routing data`);
    const mapped = lines.filter(T.mapped), active = mapped.filter(T.active);
    const ids = lines.map(line => line.id).filter(Boolean);
    assert.equal(new Set(ids).size, ids.length, `${data.id}: duplicate line IDs`);
    const nodeIds = new Set((data.travelNodes || []).map(node => node.id));
    const buildingIds = new Set((data.buildings || []).map(building => building.id));
    const obstacleIds = (data.walkingObstacles || []).map(obstacle => obstacle.id);
    assert.equal(new Set(obstacleIds).size, obstacleIds.length, `${data.id}: duplicate physical obstacle IDs`);
    for (const obstacle of data.walkingObstacles || []) assert(Array.isArray(obstacle.footprint) && obstacle.footprint.length >= 3, `${obstacle.id}: physical obstacle needs a polygon`);
    for (const point of data.pointsOfInterest || []) {
        if (point.buildingId) assert(buildingIds.has(point.buildingId), `${point.name}: retired building reference`);
        if (point.travelNodeId) assert(nodeIds.has(point.travelNodeId), `${point.name}: dangling connection-point reference`);
    }
    const coordinates = [
        ...(data.travelNodes || []).map(node => [node.id, [node.coordinates]]),
        ...mapped.map(line => [line.id, line.coordinates]),
        ...(data.buildings || []).map(b => [b.id, [b.coordinates, b.entrance, ...(b.footprint || []), ...(b.footprintHoles || []).flat(), ...(b.access?.path || [])].filter(Boolean)]),
        ...(data.walkingObstacles || []).map(obstacle => [obstacle.id, obstacle.footprint])
    ];
    for (const [id, points] of coordinates) for (const p of points) assert(p[0] >= 0 && p[0] <= data.height && p[1] >= 0 && p[1] <= data.width, `${id}: coordinate outside artwork`);
    for (const building of data.buildings || []) {
        if (building.footprintHoles?.length) assert(T.footprintContains(building, building.coordinates), `${building.id}: marker is in open space`);
        if (!building.access) { assert.equal(building.accessReview?.status, 'unmapped', `${building.id}: missing unexplained entrance`); continue; }
        const projection = T.projectAddress(data, building, lines);
        assert(projection && projection.distance < .001, `${building.id}: stored access misses its street`);
        assert(T.active(projection.line), `${building.id}: access uses a closed street`);
    }
    const visited = new Set(), components = [];
    for (const id of graph.nodes.keys()) {
        if (visited.has(id)) continue;
        const pending = [id], members = []; visited.add(id);
        while (pending.length) {
            const next = pending.pop(); members.push(next);
            for (const edge of graph.edges.get(next) || []) {
                assert(graph.nodes.has(edge.to), `${data.id}: dangling graph edge`);
                assert(Number.isFinite(edge.km) && edge.km >= 0 && Number.isFinite(edge.hours) && edge.hours >= 0, `${data.id}: invalid edge estimate`);
                assert(Math.abs(edge.km - measure(edge.coordinates) * data.scaleKilometers / data.scalePixels) < 1e-7, `${edge.line.id}: geometry distance mismatch`);
                if (!visited.has(edge.to)) { visited.add(edge.to); pending.push(edge.to); }
            }
        }
        components.push(members);
    }
    const trips = [];
    for (const members of components) {
        const destinations = members.filter(id => !graph.nodes.get(id).virtual);
        if (destinations.length < 2) continue;
        const from = destinations[0];
        for (const to of destinations.filter((_, i) => i % Math.max(1, Math.floor(destinations.length / 12)) === 0).slice(0, 13)) {
            const trip = T.route(graph, from, to); assert(trip, `${data.id}: reachable component has no route`);
            const km = trip.legs.reduce((sum, leg) => sum + measure(leg.coordinates) * data.scaleKilometers / data.scalePixels, 0);
            assert(Math.abs(km - trip.km) < 1e-7); assert(Number.isFinite(trip.hours) && trip.hours >= 0);
            trips.push({ from, to, km: trip.km, hours: trip.hours });
        }
    }
    const isolatedPlaces = (data.pointsOfInterest || []).filter(point => {
        const id = point.buildingId ? 'address:' + point.buildingId : point.travelNodeId ? 'node:' + point.travelNodeId : null;
        return id && !graph.edges.get(id)?.length;
    }).map(p => p.name);
    return { id: data.id, buildings: buildingIds.size, authoredLinks: mapped.length, activeLinks: active.length,
        closedLinks: mapped.filter(line => !T.active(line)).map(line => ({ id: line.id, name: line.name, reason: line.sourceReview?.reason || line.travelClosureReason || line.summary })),
        graphNodes: graph.nodes.size, componentSizes: components.map(c => c.length).sort((a, b) => b - a),
        isolatedPlaces, unresolvedAddresses: (data.buildings || []).filter(b => b.accessReview?.status === 'unmapped').map(b => b.id),
        checkedTrips: trips, geometryAndReferencesValid: true };
}

function preserved(before, after) {
    const mutable = new Set(['lines', 'travelNodes', 'buildings', 'pointsOfInterest', 'addressReview', 'transportReview', 'walkingObstacles']);
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) if (!mutable.has(key)) assert.deepEqual(after[key], before[key], `${after.id}: unrelated ${key} changed`);
    assert.equal(after.pointsOfInterest.length, before.pointsOfInterest.length);
    for (const [i, point] of before.pointsOfInterest.entries()) {
        for (const key of new Set([...Object.keys(point), ...Object.keys(after.pointsOfInterest[i])])) if (!['buildingId', 'travelNodeId', 'address'].includes(key)) assert.deepEqual(after.pointsOfInterest[i][key], point[key], `${point.name}: original ${key} changed`);
    }
    assert.deepEqual(after.lines.filter(line => !line.mappingSource), before.lines.filter(line => !line.mappingSource), 'Decorative original lines changed');
    const previousObstacles = before.walkingObstacles || [], currentObstacles = after.walkingObstacles || [];
    for (const obstacle of previousObstacles) assert.deepEqual(currentObstacles.find(item => item.id === obstacle.id), obstacle, 'Existing physical obstacle changed');
    const newObstacles = currentObstacles.filter(item => !previousObstacles.some(obstacle => obstacle.id === item.id));
    for (const obstacle of newObstacles) assert(obstacle.correctionPassId === after.addressReview?.correctionReview?.passId && obstacle.sourceReview, 'Additional physical obstacles require this source-reviewed correction provenance');
    return true;
}

if (require.main === module) {
    const names = ['Fair-Content', 'Astrousia', 'IceBeach', 'castgate', 'The-Port-City-of-Stomion'];
    const report = { auditedAt: new Date().toISOString(), maps: names.map(name => ({ ...audit(read('maps/' + name + '.json')), sha256: sha('maps/' + name + '.json') })) };
    report.correctionPassPreservedUnrelatedData = ['castgate', 'IceBeach'].every(name => preserved(read('design/data-correction/before/' + name + '.json'), read('maps/' + name + '.json')));
    for (const row of fs.readFileSync(path.join(root, 'design/data-correction/before/unchanged-source-hashes.txt'), 'utf8').trim().split('\n')) {
        const [expected, file] = row.split(/\s+/); assert.equal(sha(file), expected, file);
    }
    report.otherCanonicalMapsAndArtworkUnchanged = true;
    fs.writeFileSync(path.join(root, 'design/data-correction/route-data-audit.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(report.maps.map(m => `${m.id}: ${m.buildings} buildings, ${m.activeLinks} active links, ${m.checkedTrips.length} measured trips, ${m.isolatedPlaces.length} isolated named places`).join('\n'));
}
module.exports = { audit, preserved };
