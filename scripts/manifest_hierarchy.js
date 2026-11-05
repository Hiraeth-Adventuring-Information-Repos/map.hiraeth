// Shared authoring hierarchy rules for atlas generation and data validation.
function normalizeId(value, context) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${context}: expected a non-empty string`);
    }
    return value.trim();
}

function buildManifestTreeFromDocument(document) {
    const entries = Array.isArray(document) ? document : document?.maps;
    if (!Array.isArray(entries) || entries.length === 0) {
        throw new Error('maps/maps.json: expected a non-empty array or an object with a maps array');
    }
    const cloned = JSON.parse(JSON.stringify(entries));
    const flat = cloned.some(entry => entry && typeof entry === 'object' &&
        (Object.hasOwn(entry, 'parentId') || Object.hasOwn(entry, 'order')));
    if (!flat) return cloned;

    const byId = new Map();
    const children = new Map();
    cloned.forEach((entry, index) => {
        const context = `maps/maps.json[${index}]`;
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`${context}: expected an object`);
        const id = normalizeId(entry.id, `${context}.id`);
        if (byId.has(id)) throw new Error(`${context}.id: duplicate id "${id}"`);
        if (entry.children !== undefined && (!Array.isArray(entry.children) || entry.children.length)) {
            throw new Error(`${context}.children: use parentId for children in a flat manifest`);
        }
        const parent = entry.parentId == null || (typeof entry.parentId === 'string' && !entry.parentId.trim())
            ? '' : normalizeId(entry.parentId, `${context}.parentId`);
        entry.id = id;
        byId.set(id, { entry, index, parent });
    });
    for (const [id, { parent, index }] of byId) {
        if (parent === id) throw new Error(`maps/maps.json[${index}].parentId: self-parent cycle at "${id}"`);
        if (parent && !byId.has(parent)) throw new Error(`maps/maps.json[${index}].parentId: unknown parent "${parent}"`);
    }
    // Visit every component, including cycles disconnected from all roots.
    const complete = new Set();
    for (const id of byId.keys()) {
        const active = new Set();
        let cursor = id;
        while (cursor && !complete.has(cursor)) {
            if (active.has(cursor)) throw new Error(`maps/maps.json: parent cycle involving "${cursor}"`);
            active.add(cursor);
            cursor = byId.get(cursor).parent;
        }
        for (const visited of active) complete.add(visited);
    }
    for (const record of byId.values()) {
        if (!children.has(record.parent)) children.set(record.parent, []);
        children.get(record.parent).push(record);
    }
    function build(parent) {
        return (children.get(parent) || []).sort((a, b) => {
            const orderA = Number.isFinite(Number(a.entry.order)) ? Number(a.entry.order) : Number.MAX_SAFE_INTEGER;
            const orderB = Number.isFinite(Number(b.entry.order)) ? Number(b.entry.order) : Number.MAX_SAFE_INTEGER;
            return orderA - orderB || a.index - b.index;
        }).map(({ entry }) => {
            const node = { ...entry };
            delete node.parentId;
            delete node.order;
            delete node.children;
            const nested = build(node.id);
            if (nested.length) node.children = nested;
            return node;
        });
    }
    return build('');
}

function collectManifestHierarchy(tree, resolveReference, resolveSource = node => node) {
    const hierarchy = new Map();
    function visit(value, parent, context) {
        const fromFile = typeof value === 'string' && resolveReference;
        const referenced = fromFile ? resolveReference(value) : value;
        // String children already identify their source file. Preserve that origin
        // just as toManifestItem does, even when the file basename differs from id.
        const node = !fromFile && referenced && typeof referenced === 'object' && !Array.isArray(referenced)
            ? resolveSource(referenced)
            : referenced;
        if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error(`${context}: expected an object`);
        const id = normalizeId(node.id, `${context}.id`);
        if (hierarchy.has(id)) throw new Error(`${context}.id: duplicate id or cycle "${id}"`);
        hierarchy.set(id, { parent, node });
        if (node.children !== undefined) {
            if (!Array.isArray(node.children)) throw new Error(`${context}.children: expected an array`);
            node.children.forEach((child, index) => visit(child, id, `${context}.children[${index}]`));
        }
    }
    tree.forEach((node, index) => visit(node, '', `manifest[${index}]`));
    return hierarchy;
}

function assertManifestCoverage(expected, atlasTree) {
    const actual = collectManifestHierarchy(atlasTree);
    for (const [id, { parent }] of expected) {
        if (!actual.has(id)) throw new Error(`maps/atlas-index.json: missing manifest id "${id}"`);
        if (actual.get(id).parent !== parent) throw new Error(`maps/atlas-index.json: incorrect parent for manifest id "${id}"`);
    }
    for (const id of actual.keys()) {
        if (!expected.has(id)) throw new Error(`maps/atlas-index.json: unexpected id "${id}" absent from manifest`);
    }
}

module.exports = { buildManifestTreeFromDocument, collectManifestHierarchy, assertManifestCoverage };
