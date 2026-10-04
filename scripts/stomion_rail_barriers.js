// Physical rail clearance is independent of graph-layer separation. Only
// individually source-reviewed bridge footprints open the rail barrier.
const contains = (point, polygon) => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i], b = polygon[j];
        if ((a[0] > point[0]) !== (b[0] > point[0]) && point[1] < (b[1] - a[1]) * (point[0] - a[0]) / (b[0] - a[0]) + a[1]) inside = !inside;
    }
    return inside;
};
const distanceToSegment = (point, a, b) => {
    const dy = b[0] - a[0], dx = b[1] - a[1], size = dy * dy + dx * dx;
    const t = size ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dy + (point[1] - a[1]) * dx) / size)) : 0;
    return Math.hypot(point[0] - a[0] - t * dy, point[1] - a[1] - t * dx);
};
function createRailBarrier(lines, bridgeFootprints = [], { height = 3072, clearance = 4 } = {}) {
    const buckets = new Map(), cell = 64;
    const bridges = bridgeFootprints.map(bridge => {
        const polygon = bridge.footprint.map(([x, y]) => [height - y, x]);
        return { polygon, minY: Math.min(...polygon.map(p => p[0])), maxY: Math.max(...polygon.map(p => p[0])),
            minX: Math.min(...polygon.map(p => p[1])), maxX: Math.max(...polygon.map(p => p[1])) };
    });
    for (const line of lines.filter(line => (line.travelMode || line.kind) === 'rail')) for (let i = 1; i < line.coordinates.length; i++) {
        const a = line.coordinates[i - 1], b = line.coordinates[i];
        for (let y = Math.floor((Math.min(a[0], b[0]) - clearance) / cell); y <= Math.floor((Math.max(a[0], b[0]) + clearance) / cell); y++) {
            for (let x = Math.floor((Math.min(a[1], b[1]) - clearance) / cell); x <= Math.floor((Math.max(a[1], b[1]) + clearance) / cell); x++) {
                const key = `${y},${x}`;
                if (!buckets.has(key)) buckets.set(key, []);
                buckets.get(key).push([a, b]);
            }
        }
    }
    const blockedAt = point => {
        const segments = buckets.get(`${Math.floor(point[0] / cell)},${Math.floor(point[1] / cell)}`);
        if (!segments?.some(([a, b]) => distanceToSegment(point, a, b) <= clearance)) return false;
        return !bridges.some(bridge => point[0] >= bridge.minY && point[0] <= bridge.maxY && point[1] >= bridge.minX && point[1] <= bridge.maxX && contains(point, bridge.polygon));
    };
    const crosses = points => points.slice(1).some((b, i) => {
        const a = points[i], count = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2));
        for (let step = 0; step <= count; step++) if (blockedAt(a.map((value, axis) => value + (b[axis] - value) * step / count))) return true;
        return false;
    });
    return { blockedAt, crosses, clearance };
}
module.exports = { createRailBarrier, distanceToSegment };
