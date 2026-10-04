#!/usr/bin/env node
// Import reviewed raster tracing into the authoritative map without changing its lore.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const rounded = value => Math.round(value * 1e6) / 1e6;
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function project(point, coordinates) {
    let best = null, chainage = 0;
    for (let i = 1; i < coordinates.length; i++) {
        const a = coordinates[i - 1], b = coordinates[i], dy = b[0] - a[0], dx = b[1] - a[1];
        const length = distance(a, b);
        if (!length) continue;
        const fraction = Math.max(0, Math.min(1, ((point[0] - a[0]) * dy + (point[1] - a[1]) * dx) / (length * length)));
        const projected = [a[0] + fraction * dy, a[1] + fraction * dx];
        const gap = distance(point, projected);
        if (!best || gap < best.distance) best = { coordinates: projected.map(rounded), distance: gap,
            segmentIndex: i - 1, chainage: chainage + fraction * length, side: dx * (point[0] - projected[0]) - dy * (point[1] - projected[1]) };
        chainage += length;
    }
    return best;
}
function pointAlong(coordinates, offset) {
    for (let i = 1; i < coordinates.length; i++) {
        const a = coordinates[i - 1], b = coordinates[i], length = distance(a, b);
        if (length && offset <= length) return a.map((value, axis) => rounded(value + (b[axis] - value) * Math.max(0, offset) / length));
        offset -= length;
    }
    return coordinates.at(-1);
}
function contains(point, polygon) {
    if (!polygon?.length) return false;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i], b = polygon[j];
        if ((a[0] > point[0]) !== (b[0] > point[0]) && point[1] < (b[1] - a[1]) * (point[0] - a[0]) / (b[0] - a[0]) + a[1]) inside = !inside;
    }
    return inside;
}
function entranceOnFootprint(center, access, footprint) {
    const dy = access[0] - center[0], dx = access[1] - center[1];
    const crossings = [];
    for (let i = 0; i < (footprint || []).length; i++) {
        const a = footprint[i], b = footprint[(i + 1) % footprint.length];
        const ey = b[0] - a[0], ex = b[1] - a[1], det = dy * ex - dx * ey;
        if (Math.abs(det) < 1e-9) continue;
        const ay = a[0] - center[0], ax = a[1] - center[1];
        const t = (ay * ex - ax * ey) / det, u = (ay * dx - ax * dy) / det;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) crossings.push(t);
    }
    if (!crossings.length) return [...center];
    // A concave compound may have several wings along this ray. Put the door
    // on the final street-facing boundary so its walk never re-enters a wing.
    const t = Math.max(...crossings);
    return [rounded(center[0] + t * dy), rounded(center[1] + t * dx)];
}
function obstructsAccess(a, b, roof) {
    const polygon = roof.footprint || [];
    const minY = Math.min(a[0], b[0]), maxY = Math.max(a[0], b[0]);
    const minX = Math.min(a[1], b[1]), maxX = Math.max(a[1], b[1]);
    if (!polygon.length || polygon.every(p => p[0] <= minY) || polygon.every(p => p[0] >= maxY)
        || polygon.every(p => p[1] <= minX) || polygon.every(p => p[1] >= maxX)) return false;
    // Check each interval cut by the polygon boundary. Pixel-spaced samples
    // can miss a short corner crossing on an otherwise clear entrance walk.
    const ray = b.map((value, axis) => value - a[axis]), cuts = [0, 1];
    const cross = (u, v) => u[0] * v[1] - u[1] * v[0];
    for (let i = 0; i < polygon.length; i++) {
        const start = polygon[i], end = polygon[(i + 1) % polygon.length];
        const edge = end.map((value, axis) => value - start[axis]);
        const offset = start.map((value, axis) => value - a[axis]);
        const determinant = cross(ray, edge);
        if (Math.abs(determinant) < 1e-10) continue;
        const t = cross(offset, edge) / determinant, u = cross(offset, ray) / determinant;
        if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
    }
    cuts.sort((u, v) => u - v);
    for (let i = 1; i < cuts.length; i++) {
        if (cuts[i] - cuts[i - 1] < 1e-10) continue;
        const t = (cuts[i] + cuts[i - 1]) / 2;
        if (contains(a.map((value, axis) => value + ray[axis] * t), polygon)) return true;
    }
    return false;
}
function crossesWater(a, b, waterAt) {
    if (!waterAt) return false;
    const steps = Math.max(1, Math.ceil(distance(a, b)));
    for (let step = 0; step <= steps; step++) if (waterAt(a.map((value, axis) => value + (b[axis] - value) * step / steps))) return true;
    return false;
}
function obstructsOwnAccess(a, b, source) {
    if (source.kind === 'gatehouse') return false;
    const length = distance(a, b);
    if (!length) return false;
    // Boundary coordinates round to six decimals. Ignore only the first
    // thousandth of a source pixel, while checking every later roof interval.
    const fraction = Math.min(1, .001 / length);
    return obstructsAccess(a.map((value, axis) => value + (b[axis] - value) * fraction), b, source);
}
function exportNetwork(streetSource) {
    let railOrdinal = 0;
    const nodes = streetSource.nodes.map((node, i) => ({ id: node.id, name: node.layer === 'rail' ? `Stomion rail junction ${++railOrdinal}` : `Stomion junction ${i + 1}`,
        kind: 'junction', coordinates: node.coordinates, mappingSource: 'stomion-address-survey' }));
    const byNode = new Map(nodes.map(node => [node.id, node]));
    const generatedLines = streetSource.edges.map(edge => ({ id: edge.id, streetId: edge.streetId, name: edge.name,
        type: 'Street', coordinates: edge.coordinates, travelMode: edge.kind === 'ferry' ? 'ferry' : edge.kind === 'rail' ? 'rail' : ['trail', 'path'].includes(edge.kind) ? 'trail' : 'road',
        travelFrom: byNode.get(edge.from).name, travelTo: byNode.get(edge.to).name,
        travelFromNode: edge.from, travelToNode: edge.to, travelSpeedKph: edge.kind === 'ferry' ? 8 : edge.kind === 'rail' ? 40 : ['trail', 'path'].includes(edge.kind) ? 3 : 5,
        ...(['rail','ferry'].includes(edge.kind) ? {} : { travelFareGp: 0 }), ...(edge.kind === 'ferry' ? { travelServiceStatus: 'proposed' } : {}), travelOneWay: false, travelVisible: false, mappingSource: 'stomion-address-survey' }));
    generatedLines.forEach((line, index) => {
        const edge = streetSource.edges[index];
        for (const field of ['travelOcclusions', 'travelCoverSources', 'travelBridgeIds']) if (edge[field]?.length) line[field] = clone(edge[field]);
    });
    return { nodes, generatedLines };
}
function integrateRailways(map, streetSource) {
    const next = clone(map);
    const oldLines = next.lines.filter(line => line.mappingSource === 'stomion-address-survey' && line.travelMode === 'rail');
    const oldNodes = new Set(oldLines.flatMap(line => [line.travelFromNode, line.travelToNode]));
    if (next.lines.some(line => !oldLines.includes(line) && [line.travelFromNode, line.travelToNode].some(id => oldNodes.has(id)))) throw new Error('A railway junction is shared with another mode; review the connection before replacing it.');
    const source = { nodes: streetSource.nodes.filter(node => node.layer === 'rail'), edges: streetSource.edges.filter(edge => edge.kind === 'rail') };
    const { nodes, generatedLines } = exportNetwork(source);
    nodes.forEach((node, index) => { node.name = `Stomion rail junction ${index + 1}`; });
    const names = new Map(nodes.map(node => [node.id, node.name]));
    generatedLines.forEach(line => { line.travelFrom = names.get(line.travelFromNode); line.travelTo = names.get(line.travelToNode); });
    next.lines = [...next.lines.filter(line => !oldLines.includes(line)), ...generatedLines];
    next.travelNodes = [...next.travelNodes.filter(node => !oldNodes.has(node.id)), ...nodes];
    const railways = streetSource.streets.filter(street => street.kind === 'rail').map(({ id, name, kind }) => ({ id, name, kind }));
    next.addressMapping.streets = [...next.addressMapping.streets.filter(street => street.kind !== 'rail'), ...railways];
    next.addressMapping.railwayCount = railways.length;
    next.addressMapping.railReview = streetSource.metadata.railReview;
    if (streetSource.metadata.railStructureSource) next.addressMapping.railStructureSource = streetSource.metadata.railStructureSource;
    return { map: next, report: { railwayCount: railways.length, railNodes: nodes.length, railLinks: generatedLines.length } };
}
function preserveAddressLabels(next, previous) {
    const prior = new Map((previous.buildings || []).map(building => [building.id, building]));
    const reserved = new Map();
    for (const building of previous.buildings || []) {
        const key = `${building.streetId}:${building.number % 2}`;
        reserved.set(key, Math.max(reserved.get(key) || 0, building.number));
    }
    for (const building of next.buildings) {
        const old = prior.get(building.id);
        if (old) for (const field of ['number', 'address', 'streetId', 'streetName']) building[field] = old[field];
        else {
            const parity = building.number % 2, key = `${building.streetId}:${parity}`;
            building.number = (reserved.get(key) || (parity ? -1 : 0)) + 2;
            building.address = `${building.number} ${building.streetName}`;
            reserved.set(key, building.number);
        }
    }
    const current = new Map(next.buildings.map(building => [building.id, building]));
    for (const point of next.pointsOfInterest || []) if (current.has(point.buildingId)) point.address = current.get(point.buildingId).address;
    return next;
}
function integrate(map, streetSource, buildingSource, landmarkSource = [], { waterAt, railBarrier, unmappedBuildingIds = [], preferConnectedFrontage = false, reviewedFrontages = {} } = {}) {
    const next = clone(map);
    const unmapped = new Set(unmappedBuildingIds);
    const physicalRoofs = [...buildingSource.buildings, ...(buildingSource.obstacles || [])];
    landmarkSource = clone(landmarkSource);
    const streets = new Map(streetSource.streets.map(street => [street.id, street]));
    const { nodes, generatedLines } = exportNetwork(streetSource);
    const byNode = new Map(nodes.map(node => [node.id, node]));
    // Open baths, waterworks and other non-house destinations remain landmarks.
    // Split the real frontage segment; never teleport to a distant intersection.
    for (const landmark of landmarkSource) {
        const coordinates = [next.height - landmark.entrance[1], landmark.entrance[0]];
        const candidates = generatedLines.filter(line => ['road', 'trail'].includes(line.travelMode) && !line.landmarkAccess)
            .map(line => ({ line, ...project(coordinates, line.coordinates) })).sort((a, b) => a.distance - b.distance);
        const nearest = candidates[0];
        if (!nearest || nearest.distance > 50) throw new Error(`${landmark.name}: no reviewed frontage within 50 pixels`);
        const line = nearest.line;
        let frontage = distance(nearest.coordinates, line.coordinates[0]) < .001 ? byNode.get(line.travelFromNode)
            : distance(nearest.coordinates, line.coordinates.at(-1)) < .001 ? byNode.get(line.travelToNode) : null;
        if (!frontage) {
            frontage = { id: `${landmark.id}-frontage`, name: `${landmark.name} frontage`, kind: 'junction', coordinates: nearest.coordinates, mappingSource: 'stomion-address-survey' };
            const second = { ...line, id: `${line.id}-${landmark.id}`, coordinates: [nearest.coordinates, ...line.coordinates.slice(nearest.segmentIndex + 1)], travelFrom: frontage.name, travelFromNode: frontage.id };
            line.coordinates = [...line.coordinates.slice(0, nearest.segmentIndex + 1), nearest.coordinates];
            line.travelTo = frontage.name; line.travelToNode = frontage.id;
            nodes.push(frontage); byNode.set(frontage.id, frontage); generatedLines.push(second);
        }
        if (distance(coordinates, frontage.coordinates) < .001) {
            const previousId = frontage.id;
            frontage.id = landmark.id; byNode.delete(previousId); byNode.set(frontage.id, frontage);
            frontage.kind = 'landmark'; frontage.name = landmark.name; frontage.notes = landmark.notes;
            for (const edge of generatedLines) for (const field of ['travelFrom', 'travelTo']) if (edge[`${field}Node`] === previousId) { edge[field] = frontage.name; edge[`${field}Node`] = frontage.id; }
            landmark.nodeId = frontage.id;
        } else {
            const node = { id: landmark.id, name: landmark.name, kind: 'landmark', coordinates, notes: landmark.notes, mappingSource: 'stomion-address-survey' };
            nodes.push(node); byNode.set(node.id, node); landmark.nodeId = node.id;
            generatedLines.push({ id: `${landmark.id}-access`, name: `${landmark.name} entrance walk`, type: 'Street', coordinates: [frontage.coordinates, coordinates], travelMode: 'road', travelFrom: frontage.name, travelTo: node.name, travelFromNode: frontage.id, travelToNode: node.id, travelSpeedKph: 5, travelFareGp: 0, travelOneWay: false, travelVisible: false, landmarkAccess: true, mappingSource: 'stomion-address-survey' });
        }
    }
    next.lines = [...(next.lines || []).filter(line => line.mappingSource !== 'stomion-address-survey'), ...generatedLines];
    next.travelNodes = [...(next.travelNodes || []).filter(node => node.mappingSource !== 'stomion-address-survey'), ...nodes];
    const walkingLines = generatedLines.filter(line => ['road', 'trail'].includes(line.travelMode) && !line.landmarkAccess);
    const adjacency = new Map();
    for (const line of generatedLines.filter(line => ['road', 'trail', 'ferry'].includes(line.travelMode))) {
        for (const [a, b] of [[line.travelFromNode, line.travelToNode], [line.travelToNode, line.travelFromNode]]) {
            if (!adjacency.has(a)) adjacency.set(a, []);
            adjacency.get(a).push(b);
        }
    }
    const visited = new Set(); let connected = new Set();
    for (const id of adjacency.keys()) {
        if (visited.has(id)) continue;
        const component = new Set([id]), pending = [id]; visited.add(id);
        while (pending.length) for (const nextId of adjacency.get(pending.pop()) || []) if (!visited.has(nextId)) {
            visited.add(nextId); component.add(nextId); pending.push(nextId);
        }
        if (component.size > connected.size) connected = component;
    }
    const provisional = buildingSource.buildings.map(source => {
        let candidates = [];
        const permitted = reviewedFrontages[source.id] ? new Set(reviewedFrontages[source.id]) : null;
        for (const line of walkingLines) {
            if (permitted && !permitted.has(line.streetId)) continue;
            const projection = project(source.entrance || source.coordinates, line.coordinates);
            if (projection) candidates.push({ ...projection, line });
        }
        if (!candidates.length) throw new Error(`${source.id}: no walking frontage matches its source review`);
        candidates.sort((a, b) => a.distance - b.distance);
        const allCandidates = candidates;
        if (preferConnectedFrontage && candidates.length) {
            // Rail clipping can leave a tiny nearby street fragment. Prefer
            // genuine frontage connected to the city when it is still local;
            // the entire approach must independently avoid physical obstacles.
            const local = candidates.filter(candidate => connected.has(candidate.line.travelFromNode)
                && candidate.distance <= Math.min(160, candidates[0].distance + 120));
            if (local.length) candidates = local;
        }
        // A neighbor may block the perpendicular projection while a nearby
        // opening leads to another point on that same street. Test frontage
        // points along its actual bends before choosing a different street.
        // Bound the physical distance, not the number of fragments: a densely
        // split bank walk must not conceal another nearby, clear frontage.
        const frontages = pool => pool.filter(candidate => candidate.distance <= pool[0].distance + 40).flatMap(candidate => [0, -6, 6, -12, 12, -24, 24, -40, 40].map(offset => {
            const coordinates = offset ? pointAlong(candidate.line.coordinates, Math.max(0, candidate.chainage + offset)) : candidate.coordinates;
            return { ...candidate, coordinates, distance: distance(source.entrance || source.coordinates, coordinates) };
        })).filter(candidate => candidate.distance <= pool[0].distance + 40).sort((a, b) => a.distance - b.distance);
        let frontageCandidates = frontages(candidates);
        const clearFrontage = candidate => {
            if (contains(candidate.coordinates, source.footprint)) return false;
            const entrance = source.entrance || entranceOnFootprint(source.coordinates, candidate.coordinates, source.footprint);
            if (obstructsOwnAccess(entrance, candidate.coordinates, source)) return false;
            if (crossesWater(entrance, candidate.coordinates, waterAt)) return false;
            if (railBarrier?.crosses([entrance, candidate.coordinates])) return false;
            return !physicalRoofs.some(other => other.id !== source.id && obstructsAccess(entrance, candidate.coordinates, other));
        };
        let nearest = frontageCandidates.find(clearFrontage);
        const obstacleAt = point => Boolean(waterAt?.(point) || railBarrier?.blockedAt(point));
        let bentAccess = !nearest ? require('./stomion_access_paths.js').approach(source, frontageCandidates, physicalRoofs, obstacleAt, [next.height, next.width]) : null;
        if (!nearest && !bentAccess && candidates !== allCandidates) {
            // A disconnected, dry local frontage is still useful evidence. Keep
            // it isolated rather than inventing a shortcut into the city.
            candidates = allCandidates; frontageCandidates = frontages(candidates);
            nearest = frontageCandidates.find(clearFrontage);
            bentAccess = !nearest ? require('./stomion_access_paths.js').approach(source, frontageCandidates, physicalRoofs, obstacleAt, [next.height, next.width]) : null;
        }
        if (!nearest && !bentAccess && unmapped.has(source.id)) {
            const candidate = candidates[0], street = streets.get(candidate.line.streetId), ordering = project(source.coordinates, street.coordinates);
            const entry = { ...source, streetId: street.id, streetName: street.name, mappingSource: 'stomion-address-survey',
                accessReview: { status: 'unmapped', reason: 'No source-supported entrance walk avoids the reviewed roofs, water and railway. Access requires further source review.' } };
            delete entry.access;
            return { entry, chainage: ordering.chainage, odd: ordering.side >= 0 };
        }
        if (!nearest && !bentAccess) throw new Error(`${source.id}: no entrance walk avoids the reviewed roofs, water and railway`);
        nearest ||= bentAccess?.candidate || candidates[0];
        if (!nearest) throw new Error(`${source.id}: no mapped walking street`);
        const entrance = bentAccess?.entrance || source.entrance || entranceOnFootprint(source.coordinates, nearest.coordinates, source.footprint);
        const accessPath = bentAccess?.path || [entrance, nearest.coordinates];
        if (accessPath.slice(1).some((point, i) => obstructsOwnAccess(accessPath[i], point, source))) {
            throw new Error(`${source.id}: entrance walk reenters its own occupied roof`);
        }
        if (railBarrier?.crosses(accessPath)) throw new Error(`${source.id}: no entrance walk avoids the railway outside a reviewed bridge`);
        const accessObstructions = physicalRoofs.filter(other => other.id !== source.id && accessPath.slice(1).some((point, i) => obstructsAccess(accessPath[i], point, other))).map(other => other.id);
        const waterConflict = accessPath.slice(1).some((point, i) => crossesWater(accessPath[i], point, waterAt));
        const street = streets.get(nearest.line.streetId), ordering = project(source.coordinates, street.coordinates);
        const entry = { ...source, streetId: street.id, streetName: street.name,
            entrance,
            access: { lineId: nearest.line.id, coordinates: nearest.coordinates, ...(bentAccess ? { path: accessPath, pathProvenance: bentAccess.provenance } : {}) },
            ...(accessObstructions.length || waterConflict ? { accessReview: { obstructions: accessObstructions, ...(waterConflict ? { waterConflict: true } : {}) } } : {}),
            district: (next.regions || []).find(region => contains(source.coordinates, region.coordinates))?.name || source.district,
            mappingSource: 'stomion-address-survey' };
        return { entry, chainage: ordering.chainage, odd: ordering.side >= 0 };
    });
    // Each side follows the original street centerline's order, not fragment IDs.
    const buckets = new Map();
    for (const item of provisional) {
        const key = `${item.entry.streetId}:${item.odd}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(item);
    }
    for (const bucket of buckets.values()) {
        bucket.sort((a, b) => a.chainage - b.chainage || a.entry.id.localeCompare(b.entry.id));
        bucket.forEach((item, index) => {
            item.entry.number = index * 2 + (item.odd ? 1 : 2);
            item.entry.address = `${item.entry.number} ${item.entry.streetName}`;
        });
    }
    const buildings = provisional.map(item => item.entry);
    const unmatchedPlaces = [];
    for (const point of next.pointsOfInterest || []) {
        if (String(point.buildingId || '').startsWith('stomion-building-')) {
            delete point.address; delete point.buildingId;
        }
        if (String(point.travelNodeId || '').startsWith('stomion-landmark-')) delete point.travelNodeId;
        const landmark = landmarkSource.find(item => item.name === point.name);
        if (landmark) { point.travelNodeId = landmark.nodeId; continue; }
        if (point.visibility === 'gm' || !['Tavern', 'Temple', 'Building', 'Castle', 'Fort', 'Lighthouse', 'Tower', 'Dock & Trading'].includes(point.type)) continue;
        const associated = buildings.find(building => building.name === point.name || building.aliases?.includes(point.name));
        const containing = associated || buildings.find(building => contains(point.coords, building.footprint));
        const nearest = containing || buildings.reduce((best, building) => !best || distance(point.coords, building.coordinates) < distance(point.coords, best.coordinates) ? building : best, null);
        if (!nearest || (!containing && distance(point.coords, nearest.coordinates) > 35)) { unmatchedPlaces.push(point.name); continue; }
        nearest.name ||= point.name;
        nearest.aliases = [...new Set([...(nearest.aliases || []), point.name])];
        point.address = nearest.address;
        point.buildingId = nearest.id;
    }
    next.buildings = buildings;
    next.addressMapping = {
        sourceImage: next.imageUrl, bridgeAccessAssumption: streetSource.metadata?.bridgeWalkways, railGradeSeparation: streetSource.metadata?.railGradeSeparation, railReview: streetSource.metadata?.railReview, coordinateSystem: '[height-imageY,imageX]',
        provenance: 'Streets and building footprints traced from the existing artwork. Street names and house numbers newly assigned for this atlas.',
        numbering: 'Odd and even numbers on opposite sides, increasing along each traced street.',
        scalePixels: next.scalePixels, scaleKilometers: next.scaleKilometers,
        streets: streetSource.streets.map(street => ({ id: street.id, name: street.name, kind: street.kind })),
        buildingCount: buildings.length, streetCount: streetSource.streets.filter(street => !['rail', 'ferry'].includes(street.kind)).length,
        railwayCount: streetSource.streets.filter(street => street.kind === 'rail').length,
        ferryCount: streetSource.streets.filter(street => street.kind === 'ferry').length,
        ferryAccess: streetSource.metadata?.proposedFerries || (streetSource.metadata?.isletFerry ? [streetSource.metadata.isletFerry] : []),
        landmarks: landmarkSource.map(({ id, name, notes }) => ({ id, name, notes }))
    };
    if (buildingSource.obstacles?.length) next.addressMapping.unaddressedRoofObstacles = clone(buildingSource.obstacles);
    const gaps = buildings.filter(building => building.access).map(building => { const points = building.access.path || [building.entrance, building.access.coordinates]; return { id: building.id, address: building.address,
        pixels: rounded(points.slice(1).reduce((sum, point, i) => sum + distance(points[i], point), 0)) }; }).sort((a, b) => b.pixels - a.pixels);
    return { map: next, report: { streets: streetSource.streets.length, junctions: nodes.length,
        links: generatedLines.length, buildings: buildings.length,
        estimatedEntrancePaths: buildings.filter(building => building.access?.path).length,
        bentEntranceWalks: buildings.filter(building => building.access?.path?.length > 2).length, unmatchedPlaces,
        unmappedAccesses: buildings.filter(building => building.accessReview?.status === 'unmapped').map(building => ({ id: building.id, address: building.address })),
        longestAccesses: gaps.slice(0, 50), accessOver40Pixels: gaps.filter(gap => gap.pixels > 40).length,
        obstructedAccesses: buildings.filter(building => building.accessReview).map(building => ({ id: building.id, address: building.address, ...building.accessReview })) } };
}
if (require.main === module) {
    const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
    const landmarkPath = path.join(root, 'design/stomion/landmarks.json');
    const landmarks = fs.existsSync(landmarkPath) ? JSON.parse(fs.readFileSync(landmarkPath, 'utf8')).landmarks : [];
    const waterIndexPath = path.join(root, 'design/stomion/water-index.json');
    const water = fs.existsSync(waterIndexPath) ? JSON.parse(fs.readFileSync(waterIndexPath, 'utf8')) : null;
    const maskPath = path.join(root, 'design/stomion/water-mask.png');
    if (fs.existsSync(maskPath) && (!water || water.sourceSha256 !== require('node:crypto').createHash('sha256').update(fs.readFileSync(maskPath)).digest('hex'))) throw new Error('Rebuild the current water index with python scripts/stomion_water_index.py before importing addresses.');
    const waterAt = water ? point => {
        const y = Math.round(water.height - point[0]), x = Math.round(point[1]);
        return (water.rows[y] || []).some(([start, end]) => x >= start && x < end);
    } : undefined;
    const railOnly = process.argv.includes('--rail-only');
    const streetSource = read('design/stomion/streets.json');
    const bridgePath = path.join(root, 'design/stomion/rail-walking-bridges.json');
    const bridgeReview = fs.existsSync(bridgePath) ? read('design/stomion/rail-walking-bridges.json') : null;
    const railBarrier = bridgeReview ? require('./stomion_rail_barriers').createRailBarrier(streetSource.edges, bridgeReview.bridges,
        { clearance: bridgeReview.clearancePixels }) : undefined;
    const accessReviewPath = path.join(root, 'design/stomion/access-review.json');
    const accessReview = fs.existsSync(accessReviewPath) ? read('design/stomion/access-review.json') : null;
    const result = railOnly ? integrateRailways(read('maps/The-Port-City-of-Stomion.json'), streetSource) : integrate(read('maps/The-Port-City-of-Stomion.json'), streetSource, read('design/stomion/buildings.json'), landmarks,
        { waterAt, railBarrier, unmappedBuildingIds: accessReview?.unmappedBuildingIds, preferConnectedFrontage: Boolean(accessReview?.preferConnectedFrontage), reviewedFrontages: accessReview?.reviewedFrontages });
    if (!railOnly && accessReview) {
        const known = new Set(result.map.buildings.map(building => building.id));
        for (const id of accessReview.disconnectedBuildingIds || []) if (!known.has(id)) throw new Error(`Unknown reviewed address: ${id}`);
        const records = new Map((accessReview.records || []).map(record => [record.id, record]));
        const disconnected = new Set(accessReview.disconnectedBuildingIds || []);
        for (const building of result.map.buildings) if (disconnected.has(building.id)) {
            building.accessReview = { status: building.access ? 'isolated' : 'unmapped',
                reason: records.get(building.id)?.reason || 'A source-supported connection to the city has not been established.',
                ...(records.get(building.id)?.evidence ? { evidence: records.get(building.id).evidence } : {}) };
        }
        result.map.addressMapping.accessReview = clone(accessReview);
    }
    if (!railOnly && process.argv.includes('--keep-addresses')) preserveAddressLabels(result.map, read('maps/The-Port-City-of-Stomion.json'));
    if (!railOnly) {
        result.report.unmappedAccesses = result.map.buildings.filter(building => building.accessReview?.status === 'unmapped').map(({ id, address }) => ({ id, address }));
        result.report.accessReviewRecords = result.map.buildings.filter(building => building.accessReview?.status).map(({ id, address, accessReview }) => ({ id, address, ...accessReview }));
        result.report.obstructedAccesses = result.map.buildings.filter(building => building.accessReview?.obstructions?.length || building.accessReview?.waterConflict)
            .map(({ id, address, accessReview }) => ({ id, address, ...accessReview }));
        const addresses = new Map(result.map.buildings.map(({ id, address }) => [id, address]));
        for (const gap of result.report.longestAccesses) gap.address = addresses.get(gap.id);
    }
    const errors = require('../js/travel-network.js').validate(result.map);
    if (errors.length) throw new Error(errors.join('\n'));
    fs.writeFileSync(path.join(root, 'maps/The-Port-City-of-Stomion.json'), JSON.stringify(result.map, null, 2) + '\n');
    fs.writeFileSync(path.join(root, railOnly ? 'design/stomion/rail-integration-qa.json' : 'design/stomion/address-integration-qa.json'), JSON.stringify(result.report, null, 2) + '\n');
    if (railOnly) {
        const qaPath = path.join(root, 'design/stomion/address-integration-qa.json');
        const qa = read('design/stomion/address-integration-qa.json');
        qa.streets = result.map.addressMapping.streets.length;
        qa.junctions = result.map.travelNodes.filter(node => node.mappingSource === 'stomion-address-survey').length;
        qa.links = result.map.lines.filter(line => line.mappingSource === 'stomion-address-survey').length;
        qa.railRevision = 'design/stomion/review/rail-crossings/verification.json';
        fs.writeFileSync(qaPath, JSON.stringify(qa, null, 2) + '\n');
    }
    console.log(JSON.stringify(result.report, null, 2));
}
module.exports = { integrate, integrateRailways, preserveAddressLabels, project, contains, entranceOnFootprint, obstructsAccess };
