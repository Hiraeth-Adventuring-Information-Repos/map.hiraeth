#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const T = require('../js/travel-network.js');
const { contains, project } = require('./integrate_stomion_addresses.js');
const root = path.resolve(__dirname, '..');
const distance = points => points.slice(1).reduce((sum, point, i) => sum + Math.hypot(point[0] - points[i][0], point[1] - points[i][1]), 0);
function audit(data) {
    const errors = T.validate(data);
    assert.deepEqual(errors, [], 'Map must have valid addresses and street connections');
    const graph = T.build(data); assert.deepEqual(graph.errors, []);
    const buildings = data.buildings || [], lines = data.lines.filter(T.active), byLine = new Map(lines.map(line => [line.id, line]));
    assert.ok(buildings.length, 'The city must have address records');
    // Walkways and explicitly authored ferry links prove full address reachability.
    function reachable(modes) {
        const first = `address:${buildings[0].id}`, reached = new Set([first]), pending = [first];
        while (pending.length) {
            for (const edge of graph.edges.get(pending.pop()) || []) {
                if (!modes.includes(edge.line.travelMode) || reached.has(edge.to)) continue;
                reached.add(edge.to); pending.push(edge.to);
            }
        }
        return reached;
    }
    const modes = ['road', 'trail', 'ferry'], reached = reachable(modes), walkingReached = reachable(['road', 'trail']);
    const unreachableBuildings = buildings.filter(building => !reached.has(`address:${building.id}`));
    const unreachable = unreachableBuildings.map(building => building.address);
    const expectedUnreachable = data.addressMapping?.accessReview?.disconnectedBuildingIds || [];
    const unreachableLandmarks = (data.travelNodes || []).filter(node => node.kind === 'landmark' && !reached.has(`node:${node.id}`)).map(node => node.name);
    const ferryRequired = buildings.filter(building => reached.has(`address:${building.id}`) && !walkingReached.has(`address:${building.id}`)).map(building => building.address);
    assert.deepEqual(unreachableBuildings.map(building => building.id).sort(), [...expectedUnreachable].sort(), 'Every disconnected address must have explicit source-review evidence');
    assert.deepEqual(unreachableLandmarks, [], 'Every named landmark must be connected to the city');
    for (const building of buildings) {
        assert.ok(building.footprint?.length >= 3, `${building.address}: footprint missing`);
        if (building.access) {
            const projection = project(building.access.coordinates, byLine.get(building.access.lineId).coordinates);
            assert.ok(projection.distance < .001, `${building.address}: access is not on its street`);
        } else assert.equal(building.accessReview?.status, 'unmapped', `${building.address}: access needs an explicit review state`);
        assert.ok(Number.isInteger(building.number) && building.number > 0, `${building.address}: invalid house number`);
        for (const point of [building.coordinates, building.entrance, ...building.footprint].filter(Boolean)) {
            assert.ok(point[0] >= 0 && point[0] <= data.height && point[1] >= 0 && point[1] <= data.width, `${building.address}: outside artwork`);
        }
    }
    const routes = [], kmPerPixel = data.scaleKilometers / data.scalePixels;
    // Spread destinations through the inventory, both directions, plus same-address routes.
    const connectedBuildings = buildings.filter(building => reached.has(`address:${building.id}`));
    for (let index = 0; index < connectedBuildings.length; index += Math.max(1, Math.floor(connectedBuildings.length / 30))) {
        const a = connectedBuildings[index], b = connectedBuildings[(index + Math.floor(connectedBuildings.length / 2)) % connectedBuildings.length];
        const trip = T.route(graph, a.address, b.address, { allowedModes: modes });
        assert.ok(trip, `${a.address} → ${b.address}: no route`);
        const geometryKm = trip.legs.reduce((sum, leg) => sum + distance(leg.coordinates) * kmPerPixel, 0);
        assert.ok(Math.abs(geometryKm - trip.km) < 1e-7, 'Route distance must equal its complete geometry');
        const hours = trip.legs.reduce((sum, leg) => sum + distance(leg.coordinates) * kmPerPixel / leg.line.travelSpeedKph + (leg.line.travelDelayHours || 0), 0);
        assert.ok(Math.abs(hours - trip.hours) < 1e-8, 'Total time must equal leg times');
        const reverse = T.route(graph, b.address, a.address, { allowedModes: modes });
        assert.ok(reverse); assert.ok(Math.abs(reverse.km - trip.km) < 1e-7, 'Reverse walking distance must match');
        routes.push({ from: a.address, to: b.address, km: trip.km, minutes: trip.hours * 60, legs: trip.legs.length });
    }
    const same = T.route(graph, buildings[0].address, buildings[0].address);
    assert.equal(same.km, 0); assert.equal(same.hours, 0);
    assert.equal(T.route(graph, '999999 Unknown Street', buildings[0].address), null);
    const physicalRoofs = [...buildings, ...(data.addressMapping?.unaddressedRoofObstacles || [])];
    const roofBounds = physicalRoofs.map(building => ({ building, minY: Math.min(...building.footprint.map(p => p[0])),
        maxY: Math.max(...building.footprint.map(p => p[0])), minX: Math.min(...building.footprint.map(p => p[1])), maxX: Math.max(...building.footprint.map(p => p[1])) }));
    const inside = point => roofBounds.filter(box => point[0] > box.minY && point[0] < box.maxY && point[1] > box.minX && point[1] < box.maxX && contains(point, box.building.footprint));
    const streetRoofCrossings = [], roofCoreCrossings = [], obstructedAccesses = [];
    // Rectangular survey footprints can include eaves, courts or paving at their
    // corners. Keep those disagreements visible, and separately identify streets
    // through a conservative inner roof core for targeted source-image review.
    const cores = physicalRoofs.map(building => ({ ...building, footprint: building.footprint.map(p => p.map((v, axis) => building.coordinates[axis] + (v - building.coordinates[axis]) * .55)) }));
    const byCore = new Map(cores.map(building => [building.id, building]));
    for (const line of lines) {
        const crossed = new Set(), coreCrossed = new Set();
        for (let i = 1; i < line.coordinates.length; i++) {
            const a = line.coordinates[i - 1], b = line.coordinates[i], count = Math.ceil(distance([a, b]) / 3);
            for (let step = 0; step <= count; step++) {
                const point = a.map((value, axis) => value + (b[axis] - value) * step / Math.max(1, count));
                for (const box of inside(point)) {
                    crossed.add(box.building.id);
                    if (contains(point, byCore.get(box.building.id).footprint)) coreCrossed.add(box.building.id);
                }
            }
        }
        for (const id of crossed) streetRoofCrossings.push({ lineId: line.id, street: line.name, buildingId: id });
        for (const id of coreCrossed) roofCoreCrossings.push({ lineId: line.id, street: line.name, mode: line.travelMode, buildingId: id,
            kind: byCore.get(id).kind, confidence: byCore.get(id).confidence });
    }
    for (const building of buildings) {
        if (!building.access) continue;
        const points = building.access.path || [building.entrance, building.access.coordinates], obstacles = new Set();
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1], b = points[i], count = Math.ceil(distance([a, b]) / 2);
            for (let step = 1; step < count; step++) {
                const point = a.map((value, axis) => value + (b[axis] - value) * step / count);
                for (const box of inside(point)) if (box.building.id !== building.id) obstacles.add(box.building.id);
            }
        }
        if (obstacles.size) obstructedAccesses.push({ id: building.id, address: building.address, obstacles: [...obstacles] });
    }
    return { buildings: buildings.length, streets: data.addressMapping?.streetCount, links: lines.length, graphNodes: graph.nodes.size,
        allAddressesReachable: !unreachable.length, allReviewedConnectedAddressesReachable: true,
        unmappedAccesses: buildings.filter(building => building.accessReview?.status === 'unmapped').map(building => ({ id: building.id, address: building.address })),
        unreachable, unreachableLandmarks, ferryRequired, routes,
        streetRoofCrossings, roofCoreCrossings, obstructedAccesses, geometryReviewRequired: streetRoofCrossings.length > 0 || obstructedAccesses.length > 0 };
}
if (require.main === module) {
    const data = JSON.parse(fs.readFileSync(path.join(root, 'maps/The-Port-City-of-Stomion.json'), 'utf8'));
    const report = audit(data);
    fs.writeFileSync(path.join(root, 'design/stomion/city-audit.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ ...report, routes: report.routes.length, streetRoofCrossings: report.streetRoofCrossings.length,
        roofCoreCrossings: report.roofCoreCrossings.length, obstructedAccesses: report.obstructedAccesses.length }, null, 2));
}
module.exports = { audit };
