const { project } = require('./integrate_stomion_addresses');
const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function addBridgeLinks(source, links) {
    const next = structuredClone(source), changes = [];
    for (const link of links) {
        if (next.edges.some(edge => edge.id === link.id)) continue;
        const coordinates = link.nativePolyline.map(([x, y]) => [3072 - y, x]);
        const endpoints = [link.fromProjection, link.toProjection].map((hint, side) => {
            const point = side ? coordinates.at(-1) : coordinates[0];
            const candidates = next.edges.filter(edge => !['rail', 'ferry'].includes(edge.kind))
                .map(edge => ({ edge, ...project(point, edge.coordinates) }))
                .filter(candidate => candidate.distance < .01)
                .sort((a, b) => Number(b.edge.id === hint.edgeId) - Number(a.edge.id === hint.edgeId) || a.distance - b.distance);
            const hit = candidates[0];
            if (!hit) throw new Error(`${link.id}: bridge approach is detached from a real street at endpoint ${side}`);
            const edge = hit.edge;
            if (gap(hit.coordinates, edge.coordinates[0]) < .00001) return edge.from;
            if (gap(hit.coordinates, edge.coordinates.at(-1)) < .00001) return edge.to;
            const id = `${link.id}-frontage-${side}`;
            next.nodes.push({ id, layer: 'street', coordinates: hit.coordinates, imageCoordinates: [hit.coordinates[1], 3072 - hit.coordinates[0]] });
            next.edges.push({ ...edge, id: `${edge.id}-${link.bridgeId}-${side}`, from: id,
                coordinates: [hit.coordinates, ...edge.coordinates.slice(hit.segmentIndex + 1)] });
            edge.coordinates = [...edge.coordinates.slice(0, hit.segmentIndex + 1), hit.coordinates];
            edge.to = id;
            return id;
        });
        const streetId = link.bridgeId.endsWith('-footbridge') ? link.bridgeId : link.bridgeId + '-footbridge';
        const label = link.bridgeId.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
        const name = link.name || (label.endsWith('Footbridge') ? label : label + ' Footbridge');
        next.streets.push({ id: streetId, name, kind: 'bridge', coordinates, edgeIds: [link.id] });
        next.edges.push({ id: link.id, name, streetId, kind: 'bridge', from: endpoints[0], to: endpoints[1], coordinates,
            travelBridgeIds: [link.bridgeId], geometryReviewSource: 'design/stomion/review/geometry-audit/rail/eight-city-bridge-links.json' });
        changes.push({ id: link.id, bridgeId: link.bridgeId, coordinates });
    }
    for (const street of next.streets) street.edgeIds = next.edges.filter(edge => edge.streetId === street.id).map(edge => edge.id);
    return { source: next, changes };
}
module.exports = { addBridgeLinks };
