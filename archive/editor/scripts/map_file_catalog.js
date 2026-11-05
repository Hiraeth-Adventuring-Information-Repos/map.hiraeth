const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const revision = bytes => `"${crypto.createHash('sha256').update(bytes).digest('hex')}"`;
const getManifestEntries = doc => Array.isArray(doc) ? doc : doc.maps;
function mapPath(root, target) {
    const relative = path.relative(root, target);
    const maps = path.join(root, 'maps');
    if (!/^maps\/[A-Za-z0-9_. -]+\.json$/.test(relative) || relative.includes('..') || fs.realpathSync(maps) !== maps || fs.lstatSync(target).isSymbolicLink()) throw new Error('Invalid map catalog source path.');
}
function getFileCatalog(root) {
    const versions = {};
    const read = relative => {
        const target = path.resolve(root, relative);
        mapPath(root, target);
        const bytes = fs.readFileSync(target);
        versions[relative] = revision(bytes);
        return JSON.parse(bytes);
    };
    const manifest = read('maps/maps.json');
    const entries = getManifestEntries(manifest);
    const nodes = entries.map(entry => {
        const document = entry.dataUrl ? read(entry.dataUrl) : {};
        const node = { ...entry, ...document, children: [] };
        // JSON artwork/descriptions/names are editable directly; the manifest owns navigation.
        for (const key of ['id', 'dataUrl', 'parentId', 'order', 'type']) {
            if (Object.prototype.hasOwnProperty.call(entry, key)) node[key] = entry[key];
            else delete node[key];
        }
        // Feature geometry stays in its source file; the catalog is navigation metadata.
        delete node.pointsOfInterest; delete node.regions; delete node.lines; delete node.roads;
        delete node.travelNodes; delete node.buildings; delete node.walkingObstacles;
        node.regionCount = Array.isArray(document.regions) ? document.regions.length : 0;
        return node;
    });
    const byId = new Map(nodes.map(node => [node.id, node]));
    const tree = [];
    nodes.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    for (const node of nodes) {
        const ancestors = new Set([node.id]);
        let parent = byId.get(node.parentId);
        while (parent) {
            if (ancestors.has(parent.id)) throw new Error('Map hierarchy contains a cycle.');
            ancestors.add(parent.id); parent = byId.get(parent.parentId);
        }
        const owner = byId.get(node.parentId);
        (owner ? owner.children : tree).push(node);
    }
    return { ok: true, tree, versions, manifest };
}
module.exports = { getFileCatalog };
