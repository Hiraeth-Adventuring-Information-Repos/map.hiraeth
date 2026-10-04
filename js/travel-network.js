(function expose(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.TravelNetwork = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const modes = {
        road: { label: 'Road', speed: 5, color: '#d6ad60' },
        trail: { label: 'Trail', speed: 3, color: '#85b875' },
        rail: { label: 'Train', speed: 40, color: '#ba9feb' },
        sail: { label: 'Sailing', speed: 10, color: '#62bee5' },
        ferry: { label: 'Ferry', speed: 8, color: '#63d5c1' }
    };
    const plannerProfiles = [
        { id: 'all', label: 'Suggested', icon: 'route', modes: Object.keys(modes) },
        { id: 'walk', label: 'Walk', icon: 'footprints', modes: ['road', 'trail'] },
        { id: 'train', label: 'Train + walk', icon: 'train-front', modes: ['road', 'trail', 'rail', 'ferry'], requires: ['rail'] },
        { id: 'boat', label: 'Boat + walk', icon: 'ship', modes: ['road', 'trail', 'sail', 'ferry'], requires: ['sail', 'ferry'] }
    ];
    const key = name => String(name || '').trim().toLowerCase();
    const mapped = line => !!line?.travelMode;
    const active = line => mapped(line) && line.travelServiceStatus !== 'closed';
    const linesOf = data => [...(Array.isArray(data?.lines) ? data.lines : []), ...(Array.isArray(data?.roads) ? data.roads : [])];
    const pair = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
    const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
    const distance = points => points.slice(1).reduce((sum, point, i) => sum + Math.hypot(point[0] - points[i][0], point[1] - points[i][1]), 0);

    function pointInRing(point, ring, boundary = true) {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const a = ring[j], b = ring[i], edge = b.map((v, axis) => v - a[axis]), offset = point.map((v, axis) => v - a[axis]);
            if (edge[0] ** 2 + edge[1] ** 2 < 1e-16) continue;
            const cross = edge[0] * offset[1] - edge[1] * offset[0], dot = edge[0] * offset[0] + edge[1] * offset[1];
            if (Math.abs(cross) < 1e-8 && dot >= 0 && dot <= edge[0] ** 2 + edge[1] ** 2) return boundary;
            if ((a[0] > point[0]) !== (b[0] > point[0]) && point[1] < (b[1] - a[1]) * (point[0] - a[0]) / (b[0] - a[0]) + a[1]) inside = !inside;
        }
        return inside;
    }
    function buildingFootprintRings(building) {
        return [building.footprint, ...(building.footprintHoles || [])];
    }
    function footprintContains(building, point) {
        return pair(point) && Array.isArray(building.footprint) && pointInRing(point, building.footprint)
            && !(building.footprintHoles || []).some(ring => pointInRing(point, ring));
    }
    function ringEdges(ring) {
        if (distance([ring[0], ring.at(-1)]) < 1e-8) ring = ring.slice(0, -1);
        return ring.map((point, i) => [point, ring[(i + 1) % ring.length]]);
    }
    function edgesIntersect(a, b, c, d) {
        const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
        const on = (p, q, r) => Math.abs(cross(p, q, r)) < 1e-8 && r.every((v, i) => v >= Math.min(p[i], q[i]) - 1e-8 && v <= Math.max(p[i], q[i]) + 1e-8);
        return (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
    }
    function courtyardError(building) {
        const holes = building.footprintHoles;
        if (holes === undefined) return null;
        if (!Array.isArray(holes) || holes.some(ring => !Array.isArray(ring) || ring.length < 3 || !ring.every(pair) || Math.abs(footprintArea(ring)) < .0001)) return 'open courtyards need rings with at least three valid corners and a nonzero area.';
        if (!holes.length) return null;
        const outer = building.footprint;
        if (!Array.isArray(outer) || outer.length < 3 || !outer.every(pair)) return 'open courtyards need a valid outer footprint.';
        const outerEdges = ringEdges(outer);
        for (const [index, ring] of holes.entries()) {
            const edges = ringEdges(ring);
            if (ring.some(point => !pointInRing(point, outer, false)) || edges.some(([a, b]) => outerEdges.some(([c, d]) => edgesIntersect(a, b, c, d)))) return 'open courtyards must stay completely inside the outer footprint.';
            for (let i = 0; i < edges.length; i++) for (let j = i + 2; j < edges.length; j++) {
                if (i === 0 && j === edges.length - 1) continue;
                if (edgesIntersect(...edges[i], ...edges[j])) return 'open courtyard corners must not cross.';
            }
            for (const other of holes.slice(0, index)) {
                if (pointInRing(ring[0], other) || pointInRing(other[0], ring) || edges.some(([a, b]) => ringEdges(other).some(([c, d]) => edgesIntersect(a, b, c, d)))) return 'open courtyards must not overlap.';
            }
        }
        if (pair(building.coordinates) && !footprintContains(building, building.coordinates)) return 'place the building marker on its roof, outside open courtyards.';
        return null;
    }

    function visibleSegments(line, coordinates = line.coordinates) {
        const polygons = Array.isArray(line.travelOcclusions) ? line.travelOcclusions.filter(polygon => Array.isArray(polygon) && polygon.length >= 3 && polygon.every(pair)) : [];
        if (!polygons.length) return [coordinates];
        const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
        const inside = (point, polygon) => {
            let result = false;
            for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
                const a = polygon[j], b = polygon[i], edge = b.map((v, axis) => v - a[axis]), offset = point.map((v, axis) => v - a[axis]);
                const dot = offset.reduce((sum, v, axis) => sum + v * edge[axis], 0);
                const squaredLength = edge.reduce((sum, v) => sum + v * v, 0);
                if (squaredLength > 0 && Math.abs(cross(edge, offset)) < 1e-8 && dot >= 0 && dot <= squaredLength) return false;
                if ((a[0] > point[0]) !== (b[0] > point[0]) && point[1] < (b[1] - a[1]) * (point[0] - a[0]) / (b[0] - a[0]) + a[1]) result = !result;
            }
            return result;
        };
        const result = [];
        let current = null;
        for (let i = 1; i < coordinates.length; i++) {
            const a = coordinates[i - 1], b = coordinates[i], ray = b.map((v, axis) => v - a[axis]), cuts = [0, 1];
            for (const polygon of polygons) for (let j = 0; j < polygon.length; j++) {
                const p = polygon[j], q = polygon[(j + 1) % polygon.length], edge = q.map((v, axis) => v - p[axis]), offset = p.map((v, axis) => v - a[axis]), determinant = cross(ray, edge);
                if (Math.abs(determinant) < 1e-10) continue;
                const t = cross(offset, edge) / determinant, u = cross(offset, ray) / determinant;
                if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
            }
            cuts.sort((a, b) => a - b);
            const pointAt = t => a.map((v, axis) => v + ray[axis] * t);
            for (let j = 1; j < cuts.length; j++) {
                if (cuts[j] - cuts[j - 1] < 1e-10) continue;
                if (polygons.some(polygon => inside(pointAt((cuts[j] + cuts[j - 1]) / 2), polygon))) { current = null; continue; }
                const start = pointAt(cuts[j - 1]), end = pointAt(cuts[j]);
                if (!current || distance([current.at(-1), start]) > 1e-8) { current = [start]; result.push(current); }
                if (distance([current.at(-1), end]) > 1e-8) current.push(end);
            }
        }
        return result.filter(points => points.length > 1);
    }

    const nodeKinds = { junction: 'Junction', town: 'Town', station: 'Station', port: 'Port', landmark: 'Landmark' };
    const createId = () => globalThis.crypto?.randomUUID?.() || `travel-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const nodeRef = field => `${field}Node`;
    function endpoint(data, line, field) {
        const ref = line[nodeRef(field)];
        const node = (Array.isArray(data.travelNodes) ? data.travelNodes : []).find(node => ref ? node?.id === ref : key(node?.name) === key(line[field]));
        return ref || node ? (node ? { id: `node:${node.id}`, name: node.name, coords: node.coordinates } : null)
            : { id: key(line[field]), name: line[field], coords: field === 'travelFrom' ? line.coordinates?.[0] : line.coordinates?.at(-1) };
    }
    function validate(data, lines = linesOf(data)) {
        const routes = lines.filter(mapped), errors = [], nodes = new Map(), ids = new Set(), names = new Set();
        if (data.travelNodes !== undefined && !Array.isArray(data.travelNodes)) return ['Travel connection points must be a list.'];
        for (const node of data.travelNodes || []) {
            if (!node || typeof node.id !== 'string' || !node.id.trim() || ids.has(node.id)) errors.push('Travel connection points need unique IDs.');
            if (!node || typeof node.name !== 'string' || !node.name.trim() || names.has(key(node.name))) errors.push('Travel connection points need unique names.');
            if (!pair(node?.coordinates)) errors.push('Travel connection points need valid coordinates.');
            if (!Object.hasOwn(nodeKinds, node?.kind)) errors.push('Travel connection points need a valid kind.');
            ids.add(node?.id); names.add(key(node?.name));
        }
        if (data.buildings !== undefined && !Array.isArray(data.buildings)) errors.push('Building addresses must be a list.');
        const buildingIds = new Set(), buildingAddresses = new Set();
        for (const building of Array.isArray(data.buildings) ? data.buildings : []) {
            const label = building?.address || 'Building';
            if (!building || typeof building.id !== 'string' || !building.id.trim() || buildingIds.has(building.id)) errors.push('Buildings need unique IDs.');
            if (!building || typeof building.address !== 'string' || !key(building.address) || buildingAddresses.has(addressKey(building.address))) errors.push('Buildings need unique addresses.');
            if (!pair(building?.coordinates) || (building.entrance !== undefined && !pair(building.entrance))) errors.push(`${label}: building and entrance coordinates must be valid.`);
            if (building?.footprint !== undefined && (!Array.isArray(building.footprint) || building.footprint.length < 3 || !building.footprint.every(pair))) errors.push(`${label}: building footprint needs at least three valid points.`);
            const courtyardIssue = building && courtyardError(building);
            if (courtyardIssue) errors.push(`${label}: ${courtyardIssue}`);
            if (building?.access !== undefined && (!pair(building.access.coordinates) || !routes.some(line => line.id === building.access.lineId && ['road', 'trail'].includes(line.travelMode)))) errors.push(`${label}: access must reference a road or trail with valid coordinates.`);
            if (building?.access?.path !== undefined) {
                const line = routes.find(line => line.id === building.access.lineId), projection = projectPoint(building.access.coordinates, line);
                if (!validEntrancePath(building.access.path, building.entrance || building.coordinates, projection?.coordinates) || !pair(building.access.coordinates) || distance([building.access.path.at(-1), building.access.coordinates]) > .01) errors.push(`${label}: entrance path needs valid coordinates ordered from the entrance to its street access point.`);
            }
            buildingIds.add(building?.id); buildingAddresses.add(addressKey(building?.address));
        }
        if (data.addressAccessSpeedKph !== undefined && (!Number.isFinite(data.addressAccessSpeedKph) || data.addressAccessSpeedKph <= 0)) errors.push('Entrance walking speed must be greater than zero.');
        if (!routes.length) return errors;
        if (!(Number.isFinite(data.scalePixels) && data.scalePixels > 0 && Number.isFinite(data.scaleKilometers) && data.scaleKilometers > 0)) errors.push('Travel routes need a positive map scale in pixels and kilometers.');
        routes.forEach(line => {
            const label = line.name || 'Travel link';
            if (line.travelServiceStatus !== undefined && !['available', 'proposed', 'closed'].includes(line.travelServiceStatus)) errors.push(`${label}: service status must be available, proposed or closed.`);
            if (line.travelOcclusions !== undefined && (!Array.isArray(line.travelOcclusions) || line.travelOcclusions.some(polygon => !Array.isArray(polygon) || polygon.length < 3 || !polygon.every(pair)))) errors.push(`${label}: covered passages need polygons with valid coordinates.`);
            if (!Object.hasOwn(modes, line.travelMode)) errors.push(`${label}: choose a valid travel mode.`);
            const ends = ['travelFrom', 'travelTo'].map(field => endpoint(data, line, field));
            if (ends.some(end => !end?.id || !key(end.name))) errors.push(`${label}: name both endpoints or choose existing connection points.`);
            if (ends[0]?.id === ends[1]?.id) errors.push(`${label}: endpoints must be different places.`);
            if (!Number.isFinite(line.travelSpeedKph) || line.travelSpeedKph <= 0) errors.push(`${label}: speed must be greater than zero.`);
            for (const field of ['travelFareGp', 'travelCostPerKmGp', 'travelDelayHours']) {
                if (line[field] !== undefined && !nonnegative(line[field])) errors.push(`${label}: ${field} must be zero or greater.`);
            }
            for (const field of ['travelOneWay', 'travelVisible']) {
                if (line[field] !== undefined && typeof line[field] !== 'boolean') errors.push(`${label}: ${field} must be a boolean.`);
            }
            if (!Array.isArray(line.coordinates) || line.coordinates.length < 2 || !line.coordinates.every(pair) || !(distance(line.coordinates) > 0)) {
                errors.push(`${label}: draw a route with at least two distinct points.`); return;
            }
            ends.forEach((end, i) => {
                if (!end?.id || !pair(end.coords)) return;
                const coords = i ? line.coordinates.at(-1) : line.coordinates[0];
                if (distance([end.coords, coords]) > 0.01 || (nodes.has(end.id) && distance([nodes.get(end.id), coords]) > 0.01)) errors.push(`${label}: “${end.name}” has different endpoint coordinates. Reconnect it in Travel network.`);
                else nodes.set(end.id, coords);
            });
        });
        return errors;
    }

    // Legacy named endpoints are shown immediately; conversion happens only on edit.
    function connectionPoints(data, lines = linesOf(data)) {
        const nodes = (data.travelNodes || []).map(node => ({ ...node }));
        for (const line of lines.filter(mapped)) for (const field of ['travelFrom', 'travelTo']) {
            if (line[nodeRef(field)] || !key(line[field])) continue;
            if (!nodes.some(node => key(node.name) === key(line[field]))) {
                nodes.push({ id: `legacy:${key(line[field])}`, name: line[field].trim(), kind: 'junction', coordinates: field === 'travelFrom' ? line.coordinates?.[0] : line.coordinates?.at(-1), legacy: true });
            }
        }
        return nodes.filter(node => pair(node.coordinates));
    }
    function ensureNodes(data, lines = linesOf(data)) {
        data.travelNodes ||= [];
        for (const point of connectionPoints(data, lines)) {
            if (point.legacy) { const { legacy, ...node } = point; data.travelNodes.push(node); }
        }
        for (const line of lines.filter(mapped)) for (const field of ['travelFrom', 'travelTo']) {
            if (line[nodeRef(field)]) continue;
            const node = data.travelNodes.find(node => key(node.name) === key(line[field]));
            if (node) line[nodeRef(field)] = node.id;
        }
        return data.travelNodes;
    }
    function addNode(data, coordinates, kind = 'junction', lines = linesOf(data)) {
        const nodes = ensureNodes(data, lines);
        let count = 1;
        while (nodes.some(node => key(node.name) === key(`${nodeKinds[kind]} ${count}`))) count++;
        const node = { id: createId(), name: `${nodeKinds[kind]} ${count}`, kind, coordinates: [...coordinates] };
        nodes.push(node); return node;
    }
    function setEndpointCoordinates(line, field, coordinates) {
        const index = field === 'travelFrom' ? 0 : line.coordinates.length - 1;
        line.coordinates[index] = [...coordinates];
        if (line.bezier?.anchors?.length) {
            const index = field === 'travelFrom' ? 0 : line.bezier.anchors.length - 1;
            const delta = coordinates.map((value, axis) => value - line.bezier.anchors[index][axis]);
            line.bezier.anchors[index] = [...coordinates];
            for (const side of ['in', 'out']) {
                const handle = line.bezier.handles?.[index]?.[side];
                if (pair(handle)) line.bezier.handles[index][side] = handle.map((value, axis) => value + delta[axis]);
            }
        }
    }
    function attach(line, field, node) {
        line[nodeRef(field)] = node.id; line[field] = node.name;
        setEndpointCoordinates(line, field, node.coordinates);
    }
    function updateNode(data, id, changes, lines = linesOf(data), resample) {
        const preview = connectionPoints(data, lines);
        if (changes.name !== undefined && (!key(changes.name) || preview.some(other => other.id !== id && key(other.name) === key(changes.name)))) throw new Error('Give this connection point a unique name.');
        const nodes = ensureNodes(data, lines), node = nodes.find(node => node.id === id);
        if (!node) throw new Error('Connection point no longer exists.');
        if (changes.name !== undefined && (!key(changes.name) || nodes.some(other => other !== node && key(other.name) === key(changes.name)))) throw new Error('Give this connection point a unique name.');
        Object.assign(node, changes);
        for (const line of lines) for (const field of ['travelFrom', 'travelTo']) {
            if (line[nodeRef(field)] !== id) continue;
            attach(line, field, node);
            if (line.bezier && resample) line.coordinates = resample(line.bezier.anchors, line.bezier.handles, false);
        }
        if (changes.coordinates) refreshBuildingAccess(data, lines.filter(line => ['travelFrom', 'travelTo'].some(field => line[nodeRef(field)] === id)));
        return node;
    }
    function createLink(from, to, coordinates, mode = 'road') {
        const line = { id: createId(), name: `${from.name} – ${to.name}`, type: 'Travel', coordinates: coordinates.map(point => [...point]), travelMode: mode,
            travelSpeedKph: modes[mode].speed, travelOneWay: false, travelVisible: false };
        if (mode === 'road' || mode === 'trail') line.travelFareGp = 0;
        attach(line, 'travelFrom', from); attach(line, 'travelTo', to); return line;
    }
    function splitLink(data, line, segmentIndex, coordinates, lines) {
        lines ||= Array.isArray(data.lines) && data.lines.includes(line) ? data.lines : data.roads;
        if (!Array.isArray(lines) || !lines.includes(line)) throw new Error('Travel link no longer exists.');
        ensureNodes(data, lines);
        if (!active(line) || segmentIndex < 0 || segmentIndex >= line.coordinates.length - 1) throw new Error('Choose a point along a travel link.');
        const node = addNode(data, coordinates, 'junction', lines);
        const second = JSON.parse(JSON.stringify(line));
        // The copy is a new feature, not the original file document identity.
        Object.keys(second).filter(key => key.startsWith('__hiraethFileIdentity')).forEach(key => delete second[key]);
        second.id = createId(); second.name = `${line.name || 'Link'} (continued)`;
        second.coordinates = [[...coordinates], ...line.coordinates.slice(segmentIndex + 1)];
        line.coordinates = [...line.coordinates.slice(0, segmentIndex + 1), [...coordinates]];
        delete line.bezier; delete second.bezier;
        attach(line, 'travelTo', node); attach(second, 'travelFrom', node);
        // Keep a complete trip's existing fare and delay when subdividing a link.
        if (line.travelFareGp !== undefined) second.travelFareGp = 0;
        second.travelDelayHours = 0;
        lines.splice(lines.indexOf(line) + 1, 0, second);
        // Keep buildings attached to the correct half when a junction is inserted.
        for (const building of data.buildings || []) {
            if (building.access?.lineId !== line.id) continue;
            const firstAccess = projectPoint(building.access.coordinates, line), secondAccess = projectPoint(building.access.coordinates, second);
            const nearest = firstAccess.distance <= secondAccess.distance ? firstAccess : secondAccess;
            building.access = { ...building.access, lineId: nearest.lineId, coordinates: nearest.coordinates };
        }
        return node;
    }

    // Addresses are searchable independently of routing. Ambiguous aliases are rejected.
    const addressKey = value => key(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[.,]/g, '').replace(/\b(street|st)\b/g, 'st').replace(/\b(road|rd)\b/g, 'rd').replace(/\b(avenue|ave)\b/g, 'ave').replace(/\s+/g, ' ');
    function addressIndex(data) {
        const entries = (Array.isArray(data?.buildings) ? data.buildings : []).filter(building => building && typeof building.id === 'string');
        const byId = new Map(), byAlias = new Map();
        for (const building of entries) {
            byId.set(building.id, building); byId.set(`address:${building.id}`, building);
            for (const value of [building.address, building.name, ...(Array.isArray(building.aliases) ? building.aliases : [])]) {
                const alias = addressKey(value); if (!alias) continue;
                if (byAlias.has(alias) && byAlias.get(alias) !== building) byAlias.set(alias, null); else byAlias.set(alias, building);
            }
        }
        return { entries, byId, byAlias };
    }
    function resolveAddress(index, value) {
        if (!index?.byId) index = addressIndex(index);
        return index.byId.get(value) || index.byAlias.get(addressKey(value)) || null;
    }
    function searchAddresses(index, query, limit = 12) {
        if (!index?.entries) index = addressIndex(index);
        const needle = addressKey(query), words = needle.split(' ').filter(Boolean);
        return index.entries.filter(building => [building.address, building.name, ...(building.aliases || [])].some(value => {
            const label = addressKey(value); return words.every(word => label.includes(word));
        })).sort((a, b) => Number(addressKey(b.address).startsWith(needle)) - Number(addressKey(a.address).startsWith(needle)) || a.address.localeCompare(b.address, undefined, { numeric: true })).slice(0, limit);
    }
    function projectPoint(point, line) {
        if (!pair(point) || !Array.isArray(line?.coordinates)) return null;
        let best = null, offset = 0;
        for (let i = 0; i < line.coordinates.length - 1; i++) {
            const a = line.coordinates[i], b = line.coordinates[i + 1];
            if (!pair(a) || !pair(b)) continue;
            const delta = b.map((value, axis) => value - a[axis]), length = Math.hypot(...delta);
            const ratio = length ? Math.max(0, Math.min(1, delta.reduce((sum, value, axis) => sum + value * (point[axis] - a[axis]), 0) / length ** 2)) : 0;
            const coordinates = a.map((value, axis) => value + delta[axis] * ratio), away = distance([point, coordinates]);
            if (!best || away < best.distance) best = { line, lineId: line.id, segmentIndex: i, ratio, coordinates, distance: away, offset: offset + length * ratio };
            offset += length;
        }
        return best;
    }
    function projectAddress(data, building, lines = linesOf(data), index) {
        if (building?.accessReview?.status === 'unmapped') return null;
        const entrance = pair(building?.entrance) ? building.entrance : building?.coordinates;
        if (!pair(entrance)) return null;
        const preferred = index?.get(building.access?.lineId) || lines.find(line => line.id === building.access?.lineId);
        // A saved access point may be deliberately placed beside an entrance, e.g. a gate.
        if (preferred && ['road', 'trail'].includes(preferred.travelMode)) return projectPoint(pair(building.access?.coordinates) ? building.access.coordinates : entrance, preferred);
        let best = null;
        for (const line of lines) {
            if (!['road', 'trail'].includes(line.travelMode)) continue;
            const projection = projectPoint(entrance, line);
            if (projection && (!best || projection.distance < best.distance)) best = projection;
        }
        return best;
    }
    function validEntrancePath(path, entrance, access) {
        return Array.isArray(path) && path.length >= 2 && path.every(pair) && pair(entrance) && pair(access)
            && distance([path[0], entrance]) <= .01 && distance([path.at(-1), access]) <= .01;
    }
    function entrancePath(building, projection) {
        return building.access?.path || [building.entrance || building.coordinates, projection.coordinates];
    }
    function updateBuilding(data, id, changes, lines = linesOf(data)) {
        const building = (data.buildings || []).find(item => item.id === id);
        if (!building) throw new Error('Address no longer exists.');
        changes = { ...changes };
        if (changes.number !== undefined && changes.address === undefined && building.address.startsWith(`${building.number} `)) changes.address = `${changes.number}${building.address.slice(String(building.number).length)}`;
        if (changes.address !== undefined && changes.number === undefined) {
            const houseNumber = String(changes.address).match(/^(\d+[a-z]?)\s+/i)?.[1];
            if (houseNumber) changes.number = typeof building.number === 'number' && /^\d+$/.test(houseNumber) ? Number(houseNumber) : houseNumber;
        }
        if (changes.address !== undefined && (!key(changes.address) || (data.buildings || []).some(other => other !== building && addressKey(other.address) === addressKey(changes.address)))) throw new Error('Give this building a unique address.');
        for (const field of ['coordinates', 'entrance']) if (changes[field] !== undefined && !pair(changes[field])) throw new Error('Enter two valid coordinates.');
        if (changes.footprint !== undefined && (!Array.isArray(changes.footprint) || changes.footprint.length < 3 || !changes.footprint.every(pair) || Math.abs(footprintArea(changes.footprint)) < .0001)) throw new Error('Draw a footprint with at least three valid corners and a nonzero area.');
        const next = { ...building, ...changes };
        if (changes.access) {
            next.access = { ...building.access, ...changes.access };
            if (['unmapped', 'isolated'].includes(next.accessReview?.status)) delete next.accessReview;
        }
        if (changes.coordinates && !changes.entrance) {
            const delta = changes.coordinates.map((value, axis) => value - building.coordinates[axis]);
            next.entrance = (building.entrance || building.coordinates).map((value, axis) => value + delta[axis]);
            if (!changes.footprint && Array.isArray(building.footprint)) next.footprint = building.footprint.map(point => point.map((value, axis) => value + delta[axis]));
            if (changes.footprintHoles === undefined && Array.isArray(building.footprintHoles)) next.footprintHoles = building.footprintHoles.map(ring => ring.map(point => point.map((value, axis) => value + delta[axis])));
        }
        const courtyardIssue = courtyardError(next);
        if (courtyardIssue) throw new Error(courtyardIssue);
        if (changes.coordinates || changes.entrance || changes.access || changes.footprint || changes.footprintHoles !== undefined) {
            if (!changes.access) delete next.access;
            const projection = projectAddress(data, next, lines);
            if (!projection) throw new Error('Connect a road or trail before moving this address.');
            if ((changes.footprint || changes.footprintHoles !== undefined) && !changes.entrance) next.entrance = footprintEntrance(next.coordinates, projection.coordinates, next.footprint, next.footprintHoles);
            next.access = { ...building.access, ...changes.access, lineId: projection.lineId, coordinates: projection.coordinates };
            // A path follows a particular entrance and street geometry. Metadata
            // edits keep it; moving either endpoint requires a new verified path.
            delete next.access.path;
            if (changes.access?.path !== undefined) {
                if (!validEntrancePath(changes.access.path, next.entrance || next.coordinates, projection.coordinates)) throw new Error('Draw an entrance path from the entrance to its street access point.');
                next.access.path = changes.access.path.map(point => [...point]);
            }
        }
        Object.assign(building, next);
        for (const point of data.pointsOfInterest || []) if (point.buildingId === id) point.address = building.address;
        return building;
    }
    function footprintArea(points) {
        return points.reduce((area, point, i) => { const next = points[(i + 1) % points.length]; return area + point[1] * next[0] - next[1] * point[0]; }, 0) / 2;
    }
    function footprintEntrance(center, access, points, holes = []) {
        const delta = access.map((value, axis) => value - center[axis]); let nearest = -Infinity;
        for (const ring of [points, ...holes]) ring.forEach((a, i) => {
            const b = ring[(i + 1) % ring.length], edge = b.map((value, axis) => value - a[axis]), det = delta[0] * edge[1] - delta[1] * edge[0];
            if (Math.abs(det) < 1e-9) return;
            const away = a.map((value, axis) => value - center[axis]), t = (away[0] * edge[1] - away[1] * edge[0]) / det, u = (away[0] * delta[1] - away[1] * delta[0]) / det;
            if (t >= 0 && t <= 1 && u >= 0 && u <= 1) nearest = Math.max(nearest, t);
        });
        return Number.isFinite(nearest) ? center.map((value, axis) => value + delta[axis] * nearest) : [...center];
    }
    function addBuilding(data, footprint, lines = linesOf(data)) {
        if (!Array.isArray(footprint) || footprint.length < 3 || !footprint.every(pair) || Math.abs(footprintArea(footprint)) < .0001) throw new Error('Draw a footprint with at least three valid corners and a nonzero area.');
        const coordinates = [0, 1].map(axis => footprint.reduce((sum, point) => sum + point[axis], 0) / footprint.length), projection = projectAddress(data, { coordinates }, lines);
        if (!projection) throw new Error('Draw a road or trail before adding an address.');
        const streetId = projection.line.streetId || projection.line.id, streetName = projection.line.streetName || projection.line.name || 'Street';
        const existing = data.buildings || []; let number = 1;
        while (existing.some(building => addressKey(building.address) === addressKey(`${number} ${streetName}`))) number += 2;
        const building = { id: createId(), address: `${number} ${streetName}`, number, streetId, coordinates, footprint: footprint.map(point => [...point]), entrance: footprintEntrance(coordinates, projection.coordinates, footprint), access: { lineId: projection.lineId, coordinates: [...projection.coordinates] } };
        data.buildings ||= []; data.buildings.push(building); return building;
    }
    function removeBuilding(data, id) {
        const index = (data.buildings || []).findIndex(building => building.id === id);
        if (index < 0) return false;
        data.buildings.splice(index, 1);
        for (const point of data.pointsOfInterest || []) if (point.buildingId === id) { delete point.buildingId; delete point.address; }
        return true;
    }
    function refreshBuildingAccess(data, lines = linesOf(data)) {
        const index = new Map(lines.map(line => [line.id, line]));
        for (const building of data.buildings || []) {
            if (!index.has(building.access?.lineId)) continue;
            const projection = projectPoint(building.entrance || building.coordinates, index.get(building.access.lineId));
            if (projection) { building.access = { ...building.access, coordinates: projection.coordinates }; delete building.access.path; }
        }
    }
    function sliceLine(line, start, end) {
        const points = [start.coordinates];
        for (let i = start.segmentIndex + 1; i <= end.segmentIndex; i++) {
            const point = line.coordinates[i]; if (distance([points.at(-1), point]) > 1e-9) points.push(point);
        }
        if (distance([points.at(-1), end.coordinates]) > 1e-9) points.push(end.coordinates);
        return points;
    }
    function build(data, lines = linesOf(data)) {
        const errors = validate(data, lines), nodes = new Map(), edges = new Map(), addresses = addressIndex(data), aliases = new Map(), streetNames = new Map();
        for (const line of lines) if (line.streetId && !streetNames.has(line.streetId)) streetNames.set(line.streetId, line.streetName || line.name);
        if (errors.length) return { nodes, edges, errors, addresses, aliases, streetNames };
        const addNode = node => { if (!nodes.has(node.id)) { nodes.set(node.id, node); edges.set(node.id, []); if (!node.virtual) aliases.set(key(node.name), node.id); } };
        const addEdge = leg => { edges.get(leg.from).push(leg); if (!leg.line.travelOneWay) edges.get(leg.to).push({ ...leg, from: leg.to, to: leg.from, coordinates: [...leg.coordinates].reverse() }); };
        for (const node of data.travelNodes || []) addNode({ id: `node:${node.id}`, name: node.name, kind: node.kind, coords: node.coordinates });
        const prepared = new Map(), kmPerPixel = data.scaleKilometers / data.scalePixels;
        lines.filter(active).forEach((line, index) => {
            const start = endpoint(data, line, 'travelFrom'), end = endpoint(data, line, 'travelTo');
            addNode({ ...start, name: start.name.trim() }); addNode({ ...end, name: end.name.trim() });
            prepared.set(line, { routeKey: `line:${index}`, points: [
                { id: start.id, offset: 0, coordinates: line.coordinates[0], segmentIndex: 0 },
                { id: end.id, offset: distance(line.coordinates), coordinates: line.coordinates.at(-1), segmentIndex: line.coordinates.length - 2 }
            ] });
        });
        const lineIndex = new Map(lines.map(line => [line.id, line]));
        for (const building of addresses.entries) {
            if (building.accessReview?.status === 'unmapped') continue;
            const projection = projectAddress(data, building, lines, lineIndex);
            if (!projection || !prepared.has(projection.line)) { errors.push(`${building.address}: no road or trail reaches this address.`); continue; }
            const street = prepared.get(projection.line), same = street.points.find(point => Math.abs(point.offset - projection.offset) < 1e-8);
            const accessId = same?.id || `street:${street.routeKey}:${projection.offset.toFixed(8)}`;
            if (!same) { street.points.push({ ...projection, id: accessId }); addNode({ id: accessId, name: projection.line.name || 'Street', coords: projection.coordinates, virtual: true }); }
            const id = `address:${building.id}`, entrance = building.entrance || building.coordinates;
            addNode({ id, name: building.address, coords: entrance, building });
            const coordinates = entrancePath(building, projection), km = distance(coordinates) * kmPerPixel;
            const accessLine = { id: `access:${building.id}`, name: `Entrance at ${building.address}`, travelMode: 'road', travelSpeedKph: data.addressAccessSpeedKph || 5, travelFareGp: 0 };
            addEdge({ line: accessLine, from: id, to: accessId, routeKey: accessLine.id, km, hours: km / accessLine.travelSpeedKph, cost: 0, entryFee: 0, entryDelay: 0, access: true, coordinates });
        }
        for (const [line, street] of prepared) {
            street.points.sort((a, b) => a.offset - b.offset);
            for (let i = 1; i < street.points.length; i++) {
                const from = street.points[i - 1], to = street.points[i], km = (to.offset - from.offset) * kmPerPixel;
                addEdge({ line, from: from.id, to: to.id, routeKey: street.routeKey, km, hours: km / line.travelSpeedKph, cost: line.travelFareGp === undefined ? null : km * (line.travelCostPerKmGp || 0), entryFee: line.travelFareGp ?? null, entryDelay: line.travelDelayHours || 0, coordinates: sliceLine(line, from, to) });
            }
        }
        return { nodes, edges, errors, addresses, aliases, streetNames };
    }
    function resolveNode(graph, value) {
        if (graph.nodes.has(value)) return value;
        const building = resolveAddress(graph.addresses, value);
        return building ? `address:${building.id}` : graph.aliases?.get(key(value)) || [...graph.nodes.values()].find(node => !node.virtual && key(node.name) === key(value))?.id;
    }
    const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
    class MinHeap {
        constructor() { this.items = []; }
        push(item) {
            const items = this.items; items.push(item); let i = items.length - 1;
            while (i) { const p = (i - 1) >> 1; if (!less(item.score, items[p].score)) break; items[i] = items[p]; i = p; } items[i] = item;
        }
        pop() {
            const items = this.items, top = items[0], last = items.pop(); if (!items.length) return top;
            let i = 0;
            while (i * 2 + 1 < items.length) { let c = i * 2 + 1; if (c + 1 < items.length && less(items[c + 1].score, items[c].score)) c++; if (!less(items[c].score, last.score)) break; items[i] = items[c]; i = c; } items[i] = last; return top;
        }
    }
    function route(graph, fromName, toName, { preference = 'fastest', allowedModes = Object.keys(modes) } = {}) {
        const from = resolveNode(graph, fromName), to = resolveNode(graph, toName);
        if (graph.errors.length || !graph.nodes.has(from) || !graph.nodes.has(to)) return null;
        const allowed = new Set(allowedModes), costs = new Map(), previous = new Map(), heap = new MinHeap();
        const token = (id, line) => JSON.stringify([id, line]), start = token(from, null);
        costs.set(start, [0, 0]); heap.push({ id: from, line: null, state: start, score: [0, 0] }); let finish = null;
        // Incoming-link state charges a toll/wait once when entering a street, even after address splits.
        while (heap.items.length) {
            const current = heap.pop(); if (less(costs.get(current.state), current.score)) continue;
            if (current.id === to) { finish = current.state; break; }
            for (const edge of graph.edges.get(current.id) || []) {
                if ((!edge.access && !allowed.has(edge.line.travelMode)) || (preference === 'cheapest' && edge.cost === null)) continue;
                const entering = current.line !== edge.routeKey, hours = edge.hours + (entering ? edge.entryDelay : 0);
                const cost = edge.cost === null ? null : edge.cost + (entering ? edge.entryFee : 0);
                const weight = preference === 'cheapest' ? cost : preference === 'shortest' ? edge.km : hours;
                const score = [current.score[0] + weight, current.score[1] + (preference === 'fastest' ? edge.km : hours)], state = token(edge.to, edge.routeKey);
                if (!costs.has(state) || less(score, costs.get(state))) {
                    costs.set(state, score); previous.set(state, { previous: current.state, leg: { ...edge, hours, cost } });
                    heap.push({ id: edge.to, line: edge.routeKey, state, score });
                }
            }
        }
        if (finish === null) return null;
        const raw = []; for (let state = finish; state !== start;) { const step = previous.get(state); raw.push(step.leg); state = step.previous; } raw.reverse();
        const legs = [];
        for (const leg of raw) {
            const previous = legs.at(-1);
            if (previous && previous.routeKey === leg.routeKey) {
                previous.to = leg.to; previous.km += leg.km; previous.hours += leg.hours;
                previous.cost = previous.cost === null || leg.cost === null ? null : previous.cost + leg.cost;
                previous.coordinates.push(...leg.coordinates.slice(1));
            } else legs.push({ ...leg, coordinates: [...leg.coordinates] });
        }
        return { from, to, legs, km: legs.reduce((sum, leg) => sum + leg.km, 0), hours: legs.reduce((sum, leg) => sum + leg.hours, 0), cost: legs.some(leg => leg.cost === null) ? null : legs.reduce((sum, leg) => sum + leg.cost, 0) };
    }

    function routeOptions(graph, from, to, settings = {}) {
        const preferred = settings.preference || 'fastest', choices = [], seen = new Set();
        for (const preference of [...new Set([preferred, 'fastest', 'shortest', 'cheapest'])]) {
            const trip = route(graph, from, to, { ...settings, preference });
            // An unavailable requested preference must stay an explicit error,
            // rather than silently switching from known fares to an unknown fare.
            if (!trip) { if (preference === preferred) return []; continue; }
            const signature = JSON.stringify(trip.legs.map(leg => [leg.routeKey, leg.coordinates]));
            if (seen.has(signature)) continue;
            seen.add(signature); choices.push({ preference, trip });
        }
        return choices;
    }

    function connectEndpoint(line, field, value, lines) {
        const endpoint = field === 'travelFrom' ? 0 : line.coordinates.length - 1;
        for (const other of lines) {
            if (other === line || !active(other)) continue;
            for (const [name, coords] of [[other.travelFrom, other.coordinates?.[0]], [other.travelTo, other.coordinates?.at(-1)]]) {
                if (key(value) && key(name) === key(value) && pair(coords)) {
                    if (distance([line.coordinates[endpoint], coords]) === 0) return false;
                    line.coordinates[endpoint] = [...coords];
                    if (line.bezier?.anchors?.length) {
                        const index = field === 'travelFrom' ? 0 : line.bezier.anchors.length - 1;
                        const delta = coords.map((value, axis) => value - line.bezier.anchors[index][axis]);
                        line.bezier.anchors[index] = [...coords];
                        for (const side of ['in', 'out']) {
                            const handle = line.bezier.handles?.[index]?.[side];
                            if (pair(handle)) line.bezier.handles[index][side] = handle.map((value, axis) => value + delta[axis]);
                        }
                    }
                    return true;
                }
            }
        }
    }

    function createAddressInput({ document, id, label, choices, value = '', className = 'travel-address-field', marker, placeholder = 'Type an address or place', clearLabel, onChoose = () => {} }) {
        const wrap = document.createElement('label'); wrap.className = className;
        const heading = document.createElement('span'); heading.className = 'travel-field-heading';
        if (marker) { const badge = document.createElement('span'); badge.className = 'travel-field-marker'; badge.textContent = marker; badge.dataset.endpoint = marker; badge.setAttribute('aria-hidden', 'true'); heading.append(badge); }
        heading.append(document.createTextNode(label)); wrap.append(heading);
        const input = document.createElement('input'); input.id = id; input.type = 'text'; input.value = value; input.autocomplete = 'off'; input.placeholder = placeholder; input.setAttribute('aria-label', label);
        input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false'); input.setAttribute('aria-controls', `${id}-suggestions`);
        const list = document.createElement('div'); list.id = `${id}-suggestions`; list.className = 'travel-address-suggestions'; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', `${label} suggestions`); list.hidden = true;
        const feedback = document.createElement('span'); feedback.id = `${id}-hint`; feedback.className = 'travel-field-hint'; feedback.setAttribute('aria-live', 'polite'); feedback.hidden = true; input.setAttribute('aria-describedby', feedback.id);
        let clear;
        if (clearLabel) {
            const controls = document.createElement('span'); controls.className = 'travel-field-controls';
            clear = document.createElement('button'); clear.type = 'button'; clear.textContent = '×'; clear.className = 'travel-field-clear'; clear.setAttribute('aria-label', clearLabel); clear.title = clearLabel; clear.hidden = !value;
            controls.append(input, clear); wrap.append(controls);
        } else wrap.append(input);
        wrap.append(list, feedback);
        const candidates = choices.map(choice => ({ ...choice, search: addressKey(`${choice.label} ${choice.detail || ''} ${(choice.aliases || []).join(' ')}`) })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
        let displayed = [], selected = -1;
        const hide = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); selected = -1; };
        const describe = (text = '', invalid = false) => { feedback.textContent = text; feedback.hidden = !text; input.setAttribute('aria-invalid', String(invalid)); };
        const exactChoice = () => {
            const needle = addressKey(input.value);
            return candidates.find(choice => addressKey(choice.label) === needle || (choice.aliases || []).some(alias => addressKey(alias) === needle) || (choice.detail && addressKey(choice.detail) === needle));
        };
        const confirm = () => {
            const choice = exactChoice(), needle = addressKey(input.value);
            describe(choice?.detail ? (addressKey(choice.label) === needle ? choice.detail : `${choice.displayLabel || choice.detail} · ${choice.label}`) : '');
        };
        const dispatch = type => input.dispatchEvent(new (document.defaultView?.Event || globalThis.Event)(type, { bubbles: true }));
        const choose = index => { const choice = displayed[index]; if (!choice) return; input.value = choice.label; if (clear) clear.hidden = false; hide(); confirm(); dispatch('change'); input.focus(); onChoose(choice); };
        const suggest = () => {
            const needle = addressKey(input.value), words = needle.split(' ').filter(Boolean), starts = [], rest = [];
            if (!needle) { hide(); describe(); return; }
            for (const choice of candidates) if (words.every(word => choice.search.includes(word))) (addressKey(choice.label).startsWith(needle) ? starts : rest).push(choice);
            displayed = [...starts, ...rest].slice(0, 12); list.replaceChildren(); selected = -1; input.removeAttribute('aria-activedescendant');
            displayed.forEach((choice, index) => {
                const option = document.createElement('button'); option.type = 'button'; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', 'false'); option.id = `${id}-option-${index}`; option.tabIndex = -1;
                const title = document.createElement('strong'); title.textContent = choice.displayLabel || choice.label; option.append(title);
                const secondary = choice.displayLabel && choice.displayLabel !== choice.label ? choice.label : choice.detail;
                if (secondary) { const detail = document.createElement('span'); detail.textContent = secondary; option.append(detail); }
                option.addEventListener('mousedown', event => event.preventDefault()); option.addEventListener('click', () => choose(index)); list.append(option);
            });
            list.hidden = !displayed.length; input.setAttribute('aria-expanded', String(!!displayed.length));
            if (input.getAttribute('aria-invalid') !== 'true') {
                if (!displayed.length) describe('No mapped places match this search.');
                else confirm();
            }
        };
        input.addEventListener('input', () => { describe(); if (clear) clear.hidden = !input.value; suggest(); });
        input.addEventListener('focus', () => { if (exactChoice()) { hide(); confirm(); } else suggest(); });
        clear?.addEventListener('click', () => { input.value = ''; clear.hidden = true; hide(); describe(); dispatch('input'); input.focus(); });
        input.addEventListener('blur', () => setTimeout(hide, 150));
        input.addEventListener('keydown', event => {
            if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
                event.preventDefault(); if (list.hidden) suggest(); if (!displayed.length) return;
                selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + displayed.length) % displayed.length;
                [...list.children].forEach((option, index) => option.setAttribute('aria-selected', String(index === selected)));
                input.setAttribute('aria-activedescendant', `${id}-option-${selected}`); list.children[selected].scrollIntoView({ block: 'nearest' });
            } else if (event.key === 'Enter' && !list.hidden && (selected >= 0 || displayed.length === 1)) { event.preventDefault(); choose(selected >= 0 ? selected : 0); }
            else if (event.key === 'Escape' && !list.hidden) { event.preventDefault(); event.stopPropagation(); hide(); }
        });
        return { wrap, input, hide, describe };
    }
    function overview(data, lines = linesOf(data)) {
        const links = lines.filter(mapped);
        return {
            links: links.length, proposed: links.filter(line => line.travelServiceStatus === 'proposed').length,
            closed: links.filter(line => line.travelServiceStatus === 'closed').length,
            modes: Object.entries(modes).map(([id, mode]) => ({ id, ...mode,
                count: links.filter(line => line.travelMode === id).length,
                available: links.filter(line => line.travelMode === id && active(line)).length,
                proposed: links.filter(line => line.travelMode === id && line.travelServiceStatus === 'proposed').length }))
        };
    }

    function createPlanner({ map, L, document, onOpen = () => {} }) {
        const el = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };
        const panel = el('section', '', 'travel-panel');
        panel.id = 'travel-panel'; panel.hidden = true; panel.setAttribute('aria-label', 'Travel directions');
        const header = el('div', '', 'travel-panel-header');
        const title = el('h2', 'Directions'), close = el('button', '×', 'travel-close'); close.type = 'button'; close.setAttribute('aria-label', 'Close directions');
        const expand = el('button', 'Expand', 'travel-expand'); expand.type = 'button'; expand.setAttribute('aria-label', 'Expand directions panel'); expand.setAttribute('aria-expanded', 'false');
        header.append(title, expand, close); panel.append(header);
        const intro = el('p', 'Follow roads, trails, railways and sea routes.', 'travel-intro'); panel.append(intro);
        const review = el('p', '', 'travel-review-note'); review.hidden = true;
        const summary = el('div', '', 'travel-summary'); summary.hidden = true; summary.setAttribute('aria-live', 'polite');
        const form = el('form'); panel.append(form);
        const field = (label, id, choices) => {
            const wrap = el('label', label), select = el('select'); select.id = id;
            (choices || []).forEach(([value, text]) => { const option = el('option', text); option.value = value; select.append(option); });
            wrap.append(select); form.append(wrap); return select;
        };
        let from = field('From', 'travel-from'), to = field('To', 'travel-to');
        let addressFields = [];
        const endpoints = el('div', '', 'travel-inputs'); endpoints.append(from.parentElement, to.parentElement); form.prepend(endpoints);
        const swap = el('button', '⇅', 'travel-swap'); swap.type = 'button'; swap.setAttribute('aria-label', 'Swap start and destination'); swap.title = 'Swap start and destination'; endpoints.append(swap);
        const profiles = el('div', '', 'travel-profiles'); profiles.setAttribute('role', 'group'); profiles.setAttribute('aria-label', 'Travel options'); form.append(profiles);
        const profileDefinitions = plannerProfiles;
        const profileButtons = profileDefinitions.map(profile => {
            const button = el('button', '', 'travel-profile'); button.type = 'button'; button.dataset.profile = profile.id; button.setAttribute('aria-label', profile.label); button.setAttribute('aria-pressed', 'false');
            const icon = el('i'); icon.dataset.lucide = profile.icon; icon.setAttribute('aria-hidden', 'true'); button.append(icon, el('span', profile.label)); profiles.append(button); return button;
        });
        const preference = field('Prefer', 'travel-preference', [['fastest', 'Fastest'], ['cheapest', 'Cheapest known fare'], ['shortest', 'Shortest distance']]);
        const modeGroup = el('fieldset'); modeGroup.append(el('legend', 'Travel by'));
        const modeChecks = Object.entries(modes).map(([id, mode]) => {
            const label = el('label', mode.label), check = el('input'); check.type = 'checkbox'; check.value = id; check.checked = true;
            check.setAttribute('aria-label', mode.label); label.prepend(check); modeGroup.append(label); return check;
        });
        const journeyOptions = el('details', '', 'travel-options'); journeyOptions.append(el('summary', 'Route options'), preference.parentElement, modeGroup); form.append(journeyOptions);
        const submit = el('button', 'Find route', 'travel-primary'); submit.type = 'submit'; form.append(submit);
        panel.append(summary);
        const results = el('div', '', 'travel-results'); results.setAttribute('aria-live', 'polite'); panel.append(results);
        const visibility = el('label', 'Show the whole travel network', 'travel-network-toggle');
        const show = el('input'); show.type = 'checkbox'; visibility.prepend(show); panel.append(visibility);
        const legend = el('div', '', 'travel-mode-legend'); legend.hidden = true; panel.append(legend);
        const info = el('details', '', 'travel-info'); info.append(el('summary', 'About these directions'), review);
        const note = el('p', 'Travel time uses the mapped speeds and configured delays. It excludes overnight rests, timetables and weather. Fares are per traveler in gp; supplies and lodging are extra.', 'travel-note'); info.append(note); panel.append(info);
        document.body.append(panel);
        const networkLayer = L.layerGroup().addTo(map), alternativesLayer = L.layerGroup().addTo(map), resultLayer = L.featureGroup().addTo(map), stepLayer = L.featureGroup().addTo(map);
        let graph = build({}), lines = [], opener = null, fieldsState = '', routeChoices = [], selectedChoice = 0, focusedMap = null, resizeTimer;
        const number = value => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
        const fare = value => value === null ? 'Fare unknown' : `${number(value)} gp`;
        const paintNetwork = () => {
            networkLayer.clearLayers();
            if (graph.errors.length) return;
            lines.filter(line => active(line) && (show.checked || line.travelVisible)).forEach(line => {
                L.polyline(visibleSegments(line), { color: modes[line.travelMode].color, weight: 3, opacity: 0.65, dashArray: ['sail', 'ferry'].includes(line.travelMode) ? '6 8' : null, interactive: false, className: 'travel-network-line' }).addTo(networkLayer);
            });
        };
        const setExpanded = value => { panel.classList.toggle('is-expanded', value); expand.textContent = value ? 'Show map' : 'Expand'; expand.setAttribute('aria-label', value ? 'Collapse directions panel' : 'Expand directions panel'); expand.setAttribute('aria-expanded', String(value)); };
        expand.addEventListener('click', () => {
            const opening = !panel.classList.contains('is-expanded');
            if (!opening) {
                results.querySelector('.travel-steps')?.removeAttribute('open');
                stepLayer.clearLayers(); results.querySelectorAll('[aria-current]').forEach(step => step.removeAttribute('aria-current'));
            }
            setExpanded(opening);
            const trip = routeChoices[selectedChoice]?.trip;
            if (!opening && trip) focusCoordinates(trip.legs.flatMap(leg => leg.coordinates));
        });
        const clearResult = () => { resultLayer.clearLayers(); alternativesLayer.clearLayers(); stepLayer.clearLayers(); routeChoices = []; focusedMap = null; results.replaceChildren(); summary.replaceChildren(); summary.hidden = true; intro.hidden = false; panel.classList.remove('has-route'); };
        const focusCoordinates = (coordinates, maxZoom = Math.min(map.getMaxZoom(), graph.addresses.entries.length ? 1 : 0)) => {
            const mobile = document.defaultView.innerWidth <= 768, box = panel.getBoundingClientRect();
            const mapBox = map.getContainer().getBoundingClientRect(); focusedMap = { coordinates, maxZoom };
            const toolbarBox = document.getElementById('directions-btn')?.getBoundingClientRect();
            const mobileLeft = Math.max(30, toolbarBox?.width ? toolbarBox.right - mapBox.left + 24 : 0);
            map.fitBounds(L.latLngBounds(coordinates), { paddingTopLeft: mobile ? [mobileLeft, 70] : [Math.max(30, box.right - mapBox.left + 24), 90], paddingBottomRight: mobile ? [30, Math.min(document.defaultView.innerHeight * .75, document.defaultView.innerHeight - box.top + 24)] : [60, 120], maxZoom, animate: false });
        };
        map.on('resize', () => { if (focusedMap && !panel.hidden) focusCoordinates(focusedMap.coordinates, focusedMap.maxZoom); });
        document.defaultView.addEventListener('resize', () => {
            clearTimeout(resizeTimer); resizeTimer = setTimeout(() => {
                if (panel.hidden) return;
                onOpen(); map.invalidateSize({ pan: false });
                if (focusedMap) focusCoordinates(focusedMap.coordinates, focusedMap.maxZoom);
            }, 350);
        });
        const compactTime = hours => {
            if (hours < 1 / 60) return '<1 min';
            const minutes = Math.max(1, Math.round(hours * 60));
            if (minutes < 60) return `${minutes} min`;
            if (minutes < 1440) return `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
            const days = Math.floor(minutes / 1440), remainingHours = Math.round((minutes % 1440) / 60);
            return remainingHours === 24 ? `${days + 1} days` : `${days} ${days === 1 ? 'day' : 'days'}${remainingHours ? ` ${remainingHours} hr` : ''}`;
        };
        const choiceLabels = { fastest: 'Fastest', shortest: 'Shortest', cheapest: 'Lowest known fare' };
        const displayTrip = (choiceIndex = 0) => {
            selectedChoice = choiceIndex;
            const trip = routeChoices[choiceIndex].trip;
            resultLayer.clearLayers(); alternativesLayer.clearLayers(); stepLayer.clearLayers(); summary.replaceChildren(); results.replaceChildren();
            const cards = el('div', '', 'travel-route-cards'); cards.setAttribute('role', 'group'); cards.setAttribute('aria-label', 'Available routes');
            routeChoices.forEach((choice, index) => {
                const card = el('button', '', 'travel-route-card'); card.type = 'button'; card.setAttribute('aria-pressed', String(index === choiceIndex)); card.setAttribute('aria-label', `${choiceLabels[choice.preference]} route`);
                const length = choice.trip.km < 1 ? `${number(choice.trip.km * 1000)} m` : `${number(choice.trip.km)} km`;
                const meta = el('span', `${length} · ${choice.trip.cost === 0 ? 'Free' : fare(choice.trip.cost)}`, `travel-route-meta${index === choiceIndex ? ' travel-total' : ''}`);
                meta.dataset.km = String(choice.trip.km); meta.dataset.hours = String(choice.trip.hours); meta.dataset.fareGp = choice.trip.cost === null ? 'unknown' : String(choice.trip.cost);
                card.append(el('span', choiceLabels[choice.preference], 'travel-route-kind'), el('strong', compactTime(choice.trip.hours)), meta);
                card.addEventListener('click', () => { displayTrip(index); summary.querySelectorAll('.travel-route-card')[index]?.focus({ preventScroll: true }); }); cards.append(card);
                if (index !== choiceIndex) choice.trip.legs.forEach(leg => L.polyline(visibleSegments(leg.line, leg.coordinates), { color: '#77858a', weight: 3, opacity: .7, className: 'travel-alternative-line' }).on('click', () => displayTrip(index)).addTo(alternativesLayer));
            });
            summary.append(cards);
            summary.hidden = false; intro.hidden = true; panel.classList.add('has-route');
            if (trip.legs.some(leg => leg.line.travelServiceStatus === 'proposed')) summary.append(el('p', 'This journey uses proposed services. Moving time is an estimate; availability and fares need confirmation.', 'travel-note'));
            const actions = el('div', '', 'travel-route-actions');
            const overviewButton = el('button', 'Route overview'), edit = el('button', 'Edit journey', 'travel-edit-route'), clear = el('button', 'Clear route'); overviewButton.type = edit.type = clear.type = 'button';
            overviewButton.addEventListener('click', () => { stepLayer.clearLayers(); results.querySelectorAll('[aria-current]').forEach(button => button.removeAttribute('aria-current')); setExpanded(false); focusCoordinates(trip.legs.flatMap(leg => leg.coordinates)); });
            edit.addEventListener('click', () => { steps.open = false; setExpanded(false); panel.scrollTop = 0; from.focus(); });
            clear.addEventListener('click', clearResult); actions.append(overviewButton, edit, clear); summary.append(actions);
            const steps = el('details', '', 'travel-steps'); steps.append(el('summary', 'Step-by-step directions')); results.append(steps);
            steps.addEventListener('toggle', () => {
                if (document.defaultView.innerWidth > 768) return;
                setExpanded(steps.open); focusCoordinates(trip.legs.flatMap(leg => leg.coordinates));
            });
            const placeLabel = node => node.building?.name || node.name;
            steps.append(el('p', `${placeLabel(graph.nodes.get(trip.from))} → ${placeLabel(graph.nodes.get(trip.to))}`, 'travel-endpoints'));
            const list = el('ol'); steps.append(list);
            const displayLegs = [];
            trip.legs.forEach(leg => {
                const previous = displayLegs.at(-1);
                if (graph.addresses.entries.length && !leg.access && !previous?.access && previous?.line.streetId && previous.line.streetId === leg.line.streetId && previous.line.travelMode === leg.line.travelMode) {
                    previous.to = leg.to; previous.km += leg.km; previous.hours += leg.hours;
                    previous.cost = previous.cost === null || leg.cost === null ? null : previous.cost + leg.cost;
                    previous.coordinates.push(...leg.coordinates.slice(1)); previous.segments.push(...visibleSegments(leg.line, leg.coordinates));
                } else displayLegs.push({ ...leg, coordinates: [...leg.coordinates], segments: visibleSegments(leg.line, leg.coordinates) });
                const visible = visibleSegments(leg.line, leg.coordinates);
                L.polyline(visible, { color: '#fff9ef', weight: 9, opacity: .95, interactive: false, className: 'travel-route-halo' }).addTo(resultLayer);
                L.polyline(visible, { color: '#6451a3', weight: 5, opacity: 1, interactive: false, className: 'travel-result-line' }).addTo(resultLayer);
            });
            displayLegs.forEach((leg, index) => {
                const item = el('li'), button = el('button', '', 'travel-step'); button.type = 'button';
                const streetName = line => graph.streetNames?.get(line?.streetId) || line?.streetName || line?.name || modes[line?.travelMode]?.label || 'the street';
                const modeLabel = modes[leg.line.travelMode].label + (leg.line.travelServiceStatus === 'proposed' ? ' (proposed)' : '');
                const description = graph.addresses.entries.length ? (leg.access ? (index === 0 ? `Walk from ${placeLabel(graph.nodes.get(trip.from))} to ${streetName(displayLegs[index + 1]?.line)}` : `Arrive at ${placeLabel(graph.nodes.get(trip.to))}`) : `${['road', 'trail'].includes(leg.line.travelMode) ? 'Continue along' : modeLabel + ':'} ${streetName(leg.line)}`) : `${leg.access ? 'Walk' : modeLabel}: ${graph.nodes.get(leg.from).name} → ${graph.nodes.get(leg.to).name}`;
                button.append(el('strong', description), el('span', `${graph.addresses.entries.length ? '' : leg.line.name + ' · '}${leg.km < 1 ? number(leg.km * 1000) + ' m' : number(leg.km) + ' km'} · ${compactTime(leg.hours)}${leg.cost === null || leg.cost ? ` · ${fare(leg.cost)}` : ''}`));
                button.addEventListener('click', () => {
                    list.querySelectorAll('[aria-current]').forEach(step => step.removeAttribute('aria-current')); button.setAttribute('aria-current', 'step'); stepLayer.clearLayers();
                    L.polyline(leg.segments, { color: '#a94731', weight: 7, opacity: 1, interactive: false, className: 'travel-active-step' }).addTo(stepLayer); focusCoordinates(leg.coordinates, Math.min(map.getMaxZoom(), 0));
                }); item.append(button); list.append(item);
            });
            [trip.from, trip.to].forEach((id, i) => {
                const badge = el('span', i ? 'B' : 'A');
                L.marker(graph.nodes.get(id).coords, { icon: L.divIcon({ html: badge, className: `travel-map-endpoint ${i ? 'travel-destination-marker' : 'travel-start-marker'}`, iconSize: [28, 28], iconAnchor: [14, 14] }), interactive: false, keyboard: false }).addTo(resultLayer);
            });
            panel.scrollTop = 0;
            if (document.defaultView.innerWidth <= 768) cards.scrollLeft = cards.children[choiceIndex].offsetLeft - cards.offsetLeft;
            focusCoordinates(trip.legs.flatMap(leg => leg.coordinates));
        };
        const calculate = () => {
            clearResult();
            if (graph.errors.length) { results.textContent = `Travel network needs attention: ${graph.errors[0]}`; return; }
            if (!graph.nodes.size) { results.textContent = 'No travel routes have been mapped here yet.'; return; }
            const fromId = resolveNode(graph, from.value), toId = resolveNode(graph, to.value);
            if (!fromId || !toId) {
                results.textContent = `Choose a mapped address or place for ${!fromId ? 'your start' : 'your destination'}.`;
                addressFields[!fromId ? 0 : 1]?.describe('Choose a place from the suggestions or enter its full address.', true);
                (!fromId ? from : to).focus(); return;
            }
            if (fromId === toId) { results.textContent = 'Choose two different places.'; return; }
            addressFields.forEach(field => field.hide());
            routeChoices = routeOptions(graph, from.value, to.value, { preference: preference.value, allowedModes: modeChecks.filter(check => check.checked).map(check => check.value) });
            const trip = routeChoices[0]?.trip;
            if (!trip) {
                const unresolved = [from.value, to.value].map(value => resolveAddress(graph.addresses, value)).find(building => ['unmapped', 'isolated'].includes(building?.accessReview?.status));
                if (unresolved) { results.textContent = `Walking access to ${unresolved.name || unresolved.address} is still being checked. A connected route is not available yet.`; return; }
                const ferry = modeChecks.find(check => check.value === 'ferry');
                if (!ferry.checked && lines.some(line => line.travelMode === 'ferry') && route(graph, from.value, to.value, { preference: preference.value, allowedModes: [...modeChecks.filter(check => check.checked).map(check => check.value), 'ferry'] })) { results.textContent = 'No connected route with the selected travel modes. This journey needs a ferry. Enable Ferry under Travel by.'; return; }
                results.textContent = preference.value === 'cheapest' ? 'No connected route with known fares using these travel modes. Try Fastest or enable more modes.' : 'No connected route using these travel modes. Try enabling more modes.'; return; }
            displayTrip();
        };
        form.addEventListener('submit', event => { event.preventDefault(); calculate(); });
        const updateFields = () => {
            const next = JSON.stringify([from.value, to.value, preference.value, modeChecks.map(check => [check.value, check.checked])]);
            if (next !== fieldsState) clearResult();
            fieldsState = next;
            submit.disabled = graph.errors.length > 0 || !lines.some(active) || !from.value.trim() || !to.value.trim();
        };
        const selectProfile = id => {
            const profile = profileDefinitions.find(profile => profile.id === id);
            modeChecks.forEach(check => { check.checked = !check.disabled && profile.modes.includes(check.value) && (id !== 'all' || !graph.addresses.entries.length || ['road', 'trail', 'ferry'].includes(check.value)); });
            profileButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.profile === id)));
            updateFields();
            if (resolveNode(graph, from.value) && resolveNode(graph, to.value)) calculate();
        };
        profileButtons.forEach(button => button.addEventListener('click', () => selectProfile(button.dataset.profile)));
        modeGroup.addEventListener('change', () => profileButtons.forEach(button => button.setAttribute('aria-pressed', 'false')));
        form.addEventListener('change', updateFields); form.addEventListener('input', updateFields);
        swap.addEventListener('click', () => { [from.value, to.value] = [to.value, from.value]; addressFields.forEach(field => field.input.dispatchEvent(new Event('input', { bubbles: true }))); addressFields.forEach(field => field.hide()); updateFields(); });
        show.addEventListener('change', () => { legend.hidden = !show.checked; paintNetwork(); });
        const buttons = ['directions-btn', 'mobile-directions-btn'].map(id => document.getElementById(id)).filter(Boolean);
        const setOpen = value => { panel.hidden = !value; document.body.classList.toggle('travel-planner-open', value); buttons.forEach(button => button.setAttribute('aria-expanded', String(value))); };
        const dismiss = () => {
            setOpen(false);
            const target = opener?.closest('[inert]') ? document.getElementById('mobile-tools-launcher-btn') : opener;
            if (target?.getClientRects().length) target.focus();
        };
        close.addEventListener('click', dismiss);
        panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); dismiss(); } });
        buttons.forEach(button => button.addEventListener('click', () => {
            opener = button;
            if (!panel.hidden) { dismiss(); return; }
            onOpen(); setOpen(true); from.focus();
        }));
        return {
            hasRoutes: () => !graph.errors.length && lines.some(active),
            load(data, visibleLines) {
                clearResult(); lines = visibleLines || linesOf(data); graph = build(data, lines); show.checked = false;
                preference.value = 'fastest'; setExpanded(false); info.open = false;
                const inventory = overview(data, lines);
                modeChecks.forEach(check => {
                    const mode = inventory.modes.find(mode => mode.id === check.value);
                    check.disabled = !mode.available;
                    check.checked = !!mode.available && (!graph.addresses.entries.length || ['road', 'trail', 'ferry'].includes(check.value));
                    check.parentElement.lastChild.textContent = `${mode.label} · ${mode.available}`;
                    check.parentElement.title = mode.available ? `${mode.available} mapped links${mode.proposed ? '; includes proposed services' : ''}` : 'No available links mapped here';
                });
                journeyOptions.open = false;
                profileButtons.forEach(button => {
                    const profile = profileDefinitions.find(profile => profile.id === button.dataset.profile);
                    button.hidden = !!profile.requires && !profile.requires.some(id => inventory.modes.find(mode => mode.id === id)?.available);
                    button.setAttribute('aria-pressed', String(profile.id === 'all'));
                    button.title = profile.id === 'all' && graph.addresses.entries.length ? 'Walking routes, including mapped ferries' : profile.label;
                });
                legend.replaceChildren(); legend.hidden = true;
                inventory.modes.filter(mode => mode.available).forEach(mode => { const item = el('span', `${mode.label} · ${mode.available}`); item.style.setProperty('--transport-color', mode.color); legend.append(item); });
                review.textContent = [data.transportReview?.status === 'proposed atlas network' ? 'Proposed atlas network. Routes and services are awaiting setting review.' : '', inventory.closed ? `${inventory.closed} closed link${inventory.closed === 1 ? '' : 's'} excluded from directions.` : '', data.scaleReview?.status === 'provisional' ? data.scaleReview.note : ''].filter(Boolean).join(' ');
                review.hidden = !review.textContent;
                const choices = [...graph.nodes.values()].filter(node => graph.addresses.entries.length ? node.building || node.kind === 'landmark' : !node.virtual).map(node => ({ value: node.id, label: node.name, displayLabel: node.building?.name || node.name, detail: node.building?.name || (node.kind === 'landmark' ? 'Landmark entrance' : ''), aliases: node.building?.aliases || [] }));
                addressFields = [];
                [from, to] = [from, to].map((previous, index) => {
                    const id = index ? 'travel-to' : 'travel-from', label = index ? 'To' : 'From';
                    const addressField = createAddressInput({ document, id, label, choices, marker: index ? 'B' : 'A', clearLabel: index ? 'Clear destination' : 'Clear start', placeholder: graph.addresses.entries.length ? 'Address or place name' : 'Place name', onChoose: () => { if (!index && !to.value) to.focus(); } }); addressFields.push(addressField);
                    previous.closest('label').replaceWith(addressField.wrap); return addressField.input;
                });
                intro.textContent = 'Choose a start and destination.';
                updateFields(); from.disabled = to.disabled = !graph.nodes.size;
                if (typeof lucide !== 'undefined') lucide.createIcons({ root: profiles });
                if (graph.errors.length) results.textContent = `Travel network needs attention: ${graph.errors[0]}`;
                else if (!graph.nodes.size) results.textContent = 'No travel routes have been mapped here yet.';
                paintNetwork();
            },
            setEndpoint(value, role = 'from') {
                const id = resolveNode(graph, value); if (!id) return false;
                const control = role === 'to' ? to : from;
                control.value = graph.nodes.get(id).name;
                control.dispatchEvent(new Event('input', { bubbles: true })); addressFields.forEach(field => field.hide());
                updateFields(); onOpen(); setOpen(true); (role === 'to' ? from : to).focus(); return true;
            },
            reset() {
                clearResult(); networkLayer.clearLayers(); setOpen(false);
                buttons.forEach(button => { button.hidden = true; });
                graph = build({}); lines = []; from.replaceChildren(); to.replaceChildren();
                submit.disabled = true; from.disabled = to.disabled = true;
            }
        };
    }
    return { modes, plannerProfiles, nodeKinds, mapped, active, overview, linesOf, validate, build, route, routeOptions, visibleSegments, connectEndpoint, createPlanner, connectionPoints, ensureNodes, addNode, updateNode, attach, createLink, splitLink, createAddressInput, addressIndex, resolveAddress, searchAddresses, projectPoint, projectAddress, entrancePath, buildingFootprintRings, footprintContains, addBuilding, updateBuilding, removeBuilding, refreshBuildingAccess, resolveNode };
}));
