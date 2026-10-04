// Short entrance walks may bend through a court or around a neighboring roof.
// These are local approach estimates, bounded by mapped roofs, reviewed water and railway barriers.
// They do not assert that a door or a paved public street is depicted there.
const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const polyContains = (point, polygon) => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i], b = polygon[j];
        if ((a[0] > point[0]) !== (b[0] > point[0]) && point[1] < (b[1] - a[1]) * (point[0] - a[0]) / (b[0] - a[0]) + a[1]) inside = !inside;
    }
    return inside;
};
function approach(source, candidates, roofs, waterAt, mapBounds) {
    const unique = new Map();
    for (const candidate of candidates) unique.set(candidate.coordinates.map(v => v.toFixed(3)).join(','), candidate);
    const targets = [...unique.values()].filter(candidate => !polyContains(candidate.coordinates, source.footprint));
    if (!targets.length) return null;
    const points = [...source.footprint, ...targets.map(c => c.coordinates), ...(source.entrance ? [source.entrance] : [])];
    const min = [0, 1].map(axis => Math.max(0, Math.floor(Math.min(...points.map(p => p[axis]))) - 40));
    const max = [0, 1].map(axis => Math.min(mapBounds[axis], Math.ceil(Math.max(...points.map(p => p[axis]))) + 40));
    const height = max[0] - min[0] + 1, width = max[1] - min[1] + 1;
    if (height * width > 180000) return null;
    const nearby = roofs.filter(roof => roof.footprint.some(p => p[0] >= min[0] && p[0] <= max[0] && p[1] >= min[1] && p[1] <= max[1]) ||
        (Math.min(...roof.footprint.map(p => p[0])) <= max[0] && Math.max(...roof.footprint.map(p => p[0])) >= min[0] &&
         Math.min(...roof.footprint.map(p => p[1])) <= max[1] && Math.max(...roof.footprint.map(p => p[1])) >= min[1]));
    // A quarter-pixel clearance avoids shaving an approximate roof corner;
    // independent samplers must not disagree about a tangential approach.
    const blocked = point => Boolean(waterAt?.(point)) || nearby.some(roof =>
        [[0, 0], [-.25, 0], [.25, 0], [0, -.25], [0, .25]].some(([dy, dx]) => polyContains([point[0] + dy, point[1] + dx], roof.footprint)));
    const clear = (a, b, entrance = false) => {
        const count = Math.max(1, Math.ceil(gap(a, b) * 2));
        for (let i = entrance ? 1 : 0; i <= count; i++) if (blocked(a.map((v, axis) => v + (b[axis] - v) * i / count))) return false;
        return true;
    };
    const size = width * height, cells = new Uint8Array(size);
    const pointAt = index => [min[0] + Math.floor(index / width), min[1] + index % width];
    const indexAt = point => (point[0] - min[0]) * width + point[1] - min[1];
    for (let i = 0; i < size; i++) cells[i] = blocked(pointAt(i)) ? 1 : 0;
    const cellsNear = point => {
        const choices = [];
        for (let y = Math.round(point[0]) - 2; y <= Math.round(point[0]) + 2; y++) for (let x = Math.round(point[1]) - 2; x <= Math.round(point[1]) + 2; x++) {
            if (y < min[0] || y > max[0] || x < min[1] || x > max[1] || gap(point, [y, x]) > 2.5) continue;
            const index = indexAt([y, x]); if (!cells[index]) choices.push(index);
        }
        return choices;
    };
    const ends = new Map();
    for (const target of targets) {
        if (blocked(target.coordinates)) continue;
        for (const index of cellsNear(target.coordinates)) if (clear(pointAt(index), target.coordinates)) {
            const existing = ends.get(index), tail = gap(pointAt(index), target.coordinates);
            if (!existing || tail < existing.tail) ends.set(index, { candidate: target, tail });
        }
    }
    if (!ends.size) return null;
    const entrances = [];
    if (source.entrance) entrances.push(source.entrance);
    else for (let i = 0; i < source.footprint.length; i++) {
        const a = source.footprint[i], b = source.footprint[(i + 1) % source.footprint.length];
        entrances.push(a, a.map((v, axis) => (v + b[axis]) / 2));
    }
    const costs = new Float64Array(size); costs.fill(Infinity);
    const previous = new Int32Array(size); previous.fill(-1);
    const origin = new Int32Array(size); origin.fill(-1);
    const closed = new Uint8Array(size), heap = [];
    const targetPoints = [...ends.keys()].map(pointAt);
    const heuristic = point => Math.min(...targetPoints.map(target => gap(point, target)));
    const push = entry => { let i = heap.length; heap.push(entry); while (i) { const parent = (i - 1) >> 1; if (heap[parent].score <= entry.score) break; heap[i] = heap[parent]; i = parent; } heap[i] = entry; };
    const pop = () => { const first = heap[0], last = heap.pop(); if (heap.length) { let i = 0; while (i * 2 + 1 < heap.length) { let child = i * 2 + 1; if (child + 1 < heap.length && heap[child + 1].score < heap[child].score) child++; if (last.score <= heap[child].score) break; heap[i] = heap[child]; i = child; } heap[i] = last; } return first; };
    entrances.forEach((entrance, which) => {
        if (waterAt?.(entrance) || nearby.some(roof => roof.id !== source.id && polyContains(entrance, roof.footprint))) return;
        for (const index of cellsNear(entrance)) if (clear(entrance, pointAt(index), true)) {
            const cost = gap(entrance, pointAt(index));
            if (cost < costs[index]) { costs[index] = cost; origin[index] = which; push({ index, score: cost + heuristic(pointAt(index)) }); }
        }
    });
    const maximum = Math.min(240, Math.max(80, candidates[0].distance * 2 + 60));
    let finish = null, best = Infinity;
    while (heap.length) {
        const current = pop(), index = current.index;
        if (current.score >= best || current.score > maximum) break;
        if (closed[index]) continue; closed[index] = 1;
        if (ends.has(index)) { const end = ends.get(index), total = costs[index] + end.tail; if (total < best) { best = total; finish = { index, ...end }; } }
        const point = pointAt(index), y = Math.floor(index / width), x = index % width;
        for (const [dy, dx] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
            const ny = y + dy, nx = x + dx;
            if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
            const next = ny * width + nx;
            if (cells[next] || closed[next] || (dy && dx && (cells[y * width + nx] || cells[ny * width + x]))) continue;
            const cost = costs[index] + Math.hypot(dy, dx);
            if (cost >= costs[next] || !clear(point, pointAt(next))) continue;
            costs[next] = cost; previous[next] = index; origin[next] = origin[index];
            push({ index: next, score: cost + heuristic(pointAt(next)) });
        }
    }
    if (!finish) return null;
    const reverse = []; let cursor = finish.index;
    while (cursor >= 0) { reverse.push(pointAt(cursor)); cursor = previous[cursor]; }
    const entrance = entrances[origin[finish.index]], raw = [entrance, ...reverse.reverse(), finish.candidate.coordinates];
    const path = [entrance]; let at = 0;
    while (at < raw.length - 1) {
        let next = raw.length - 1;
        while (next > at + 1 && !clear(raw[at], raw[next], at === 0)) next--;
        if (gap(path.at(-1), raw[next]) > .000001) path.push(raw[next]); at = next;
    }
    if (path.length < 2 || gap(path.at(-1), finish.candidate.coordinates) > .000001) return null;
    return { candidate: finish.candidate, entrance, path, provenance: 'Approximate local entrance walk around mapped roof boundaries, reviewed water and railway barriers; exact doors and pavement are unresolved in the artwork.' };
}
module.exports = { approach };
