// Keep street frontage on either side of an unbridged railway, with separate
// dead ends. Never join the two sides through a coordinate-only intersection.
const { createRailBarrier } = require('./stomion_rail_barriers');
const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const round = value => Math.round(value * 1e6) / 1e6;
function clearParts(coordinates, blockedAt) {
    const parts = [], samples = [coordinates[0]];
    for (let i = 1; i < coordinates.length; i++) {
        const a = coordinates[i - 1], b = coordinates[i], count = Math.max(1, Math.ceil(gap(a, b) * 2));
        for (let step = 1; step <= count; step++) samples.push(a.map((value, axis) => round(value + (b[axis] - value) * step / count)));
    }
    let part = [];
    for (const point of samples) {
        if (blockedAt(point)) { if (part.length > 1) parts.push(part); part = []; }
        else part.push(point);
    }
    if (part.length > 1) parts.push(part);
    return parts.map(points => {
        const simple = [];
        for (const point of points) {
            if (simple.length > 1) {
                const a = simple.at(-2), b = simple.at(-1);
                if (Math.abs((b[0] - a[0]) * (point[1] - b[1]) - (b[1] - a[1]) * (point[0] - b[0])) < 1e-7) simple.pop();
            }
            simple.push(point);
        }
        return simple;
    }).filter(points => points.slice(1).reduce((sum, point, i) => sum + gap(points[i], point), 0) > 1);
}
function clipNetwork(source, bridgeReview) {
    const next = structuredClone(source), nodes = new Map(next.nodes.map(node => [node.id, node]));
    const barrier = createRailBarrier(next.edges, bridgeReview.bridges, { clearance: bridgeReview.clearancePixels || 4 });
    const edges = [], changes = [];
    for (const edge of next.edges) {
        if (['rail', 'ferry'].includes(edge.kind) || !barrier.crosses(edge.coordinates)) { edges.push(edge); continue; }
        const parts = clearParts(edge.coordinates, barrier.blockedAt);
        changes.push({ id: edge.id, streetId: edge.streetId, retainedParts: parts.length, before: edge.coordinates, after: parts });
        parts.forEach((coordinates, index) => {
            const id = index ? `${edge.id}-rail-side-${index + 1}` : edge.id;
            const endpoints = [coordinates[0], coordinates.at(-1)].map((point, side) => {
                const originalId = side ? edge.to : edge.from;
                if (gap(point, nodes.get(originalId).coordinates) < 1e-6) return originalId;
                const nodeId = `${id}-rail-end-${side}`;
                nodes.set(nodeId, { id: nodeId, layer: 'street', coordinates: point, imageCoordinates: [point[1], round(3072 - point[0])] });
                return nodeId;
            });
            edges.push({ ...edge, id, from: endpoints[0], to: endpoints[1], coordinates,
                railClearanceReview: 'Unbridged track is a barrier; street ends on this side of the railway.' });
        });
    }
    next.edges = edges;
    const used = new Set(edges.flatMap(edge => [edge.from, edge.to]));
    next.nodes = [...nodes.values()].filter(node => used.has(node.id));
    for (const street of next.streets) street.edgeIds = edges.filter(edge => edge.streetId === street.id).map(edge => edge.id);
    next.streets = next.streets.filter(street => street.edgeIds.length);
    next.metadata.railBarrierReview = 'design/stomion/rail-walking-bridges.json';
    return { source: next, changes, barrier };
}
module.exports = { clearParts, clipNetwork };
