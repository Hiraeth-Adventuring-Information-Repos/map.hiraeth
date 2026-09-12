#!/usr/bin/env node

// Password-free, read-only hosting. Editing and JSON downloads happen in the browser.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { applySecurityHeaders, isAllowedHost, parseAllowedHosts } = require('./map_studio_server.js');
const { getManifestEntries } = require('./map_studio_maps.js');

const json = (res, status, value, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(value));
};
const revision = (bytes) => `"${crypto.createHash('sha256').update(bytes).digest('hex')}"`;
function mapPath(root, target) {
    const relative = path.relative(root, path.resolve(target));
    if (!/^maps\/[A-Za-z0-9_. -]+\.(json|webp)$/.test(relative) || relative.includes('..')) throw new Error('Only top-level map JSON and WebP files can be changed.');
    const maps = path.join(root, 'maps');
    if (fs.realpathSync(maps) !== maps || (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink())) throw new Error('Map symlinks cannot be edited.');
    return relative;
}
function recoverFileWrites(root) {
    const journal = path.join(root, '.cache', 'map-file-transaction.json');
    if (!fs.existsSync(journal)) return;
    const records = JSON.parse(fs.readFileSync(journal, 'utf8'));
    for (const record of records) {
        const target = path.resolve(root, record.path);
        mapPath(root, target);
        if (record.content === null) fs.rmSync(target, { force: true });
        else fs.writeFileSync(target, Buffer.from(record.content, 'base64'));
    }
    fs.rmSync(journal);
}
function writeMapFiles(root, writes) {
    recoverFileWrites(root);
    const records = writes.map(write => ({ path: mapPath(root, write.fullPath), content: fs.existsSync(write.fullPath) ? fs.readFileSync(write.fullPath).toString('base64') : null }));
    const journal = path.join(root, '.cache', 'map-file-transaction.json');
    fs.mkdirSync(path.dirname(journal), { recursive: true });
    fs.writeFileSync(`${journal}.tmp`, JSON.stringify(records), { mode: 0o600 });
    fs.renameSync(`${journal}.tmp`, journal);
    try {
        for (const write of writes) {
            const temporary = `${write.fullPath}.${process.pid}.tmp`;
            try {
                if (write.sourcePath) fs.copyFileSync(write.sourcePath, temporary);
                else fs.writeFileSync(temporary, write.content);
                fs.renameSync(temporary, write.fullPath);
            } finally { fs.rmSync(temporary, { force: true }); }
        }
        fs.rmSync(journal);
    } catch (error) { recoverFileWrites(root); throw error; }
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
function createMapFileServer(options = {}) {
    const root = fs.realpathSync(path.resolve(options.repoRoot || process.env.MAP_STUDIO_REPO_ROOT || path.join(__dirname, '..')));
    const allowed = parseAllowedHosts(options.allowedHosts || process.env.MAP_STUDIO_ALLOWED_HOSTS || '127.0.0.1,localhost,::1');
    const readiness = { fileMode: true, downloadOnly: true, canPreview: false, previewUrl: '', message: 'Save downloads JSON to your device. The hosted map files and public website are unchanged.' };
    const publicFiles = new Map([['/', 'file-studio.html'], ['/studio', 'file-studio.html'], ['/studio/', 'file-studio.html'], ['/file-studio.html', 'file-studio.html'], ['/css/file-studio.css', 'css/file-studio.css'], ['/js/file-studio.js', 'js/file-studio.js']]);
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg' };
    return http.createServer(async (req, res) => {
        applySecurityHeaders(res);
        if (!isAllowedHost(req, allowed)) return json(res, 421, { error: 'Unrecognized editor host.' });
        try {
            const url = new URL(req.url, `http://${req.headers.host}`);
            // Reject mutations before dispatch, including old login and save endpoints.
            if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { ok: false, downloadOnly: true, error: 'This editor only downloads files. Server writes are disabled.' }, { Allow: 'GET, HEAD' });
            if (url.pathname === '/healthz') return json(res, 200, { ok: true, service: 'hiraeth-map-files', downloadOnly: true });
            if (url.pathname === '/api/studio/session' && req.method === 'GET') return json(res, 200, { ok: true, authenticated: false, authenticationRequired: false, fileMode: true, downloadOnly: true });
            if (url.pathname === '/api/studio/workspace' && req.method === 'GET') return json(res, 200, { ok: true, workspace: { mode: 'files', branch: root, editable: true, fileMode: true, downloadOnly: true, capabilities: { canEdit: true, canStartDraft: false, canSave: false }, github: { configured: false } } });
            if (['/api/editor/status', '/api/editor/readiness'].includes(url.pathname) && req.method === 'GET') return json(res, 200, { ok: true, saveEnabled: false, downloadOnly: true, fileMode: true, message: 'Save downloads JSON to your device.', readiness });
            if (url.pathname === '/api/editor/catalog' && req.method === 'GET') return json(res, 200, getFileCatalog(root));
            if (url.pathname === '/api/studio/map-options' && req.method === 'GET') return json(res, 200, { ok: true, parents: getManifestEntries(JSON.parse(fs.readFileSync(path.join(root, 'maps/maps.json'), 'utf8'))) });
            if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Unknown file editor endpoint.' });
            if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method not allowed.' });
            const relative = publicFiles.get(url.pathname) || (url.pathname === '/studio/editor' ? 'map-editor.html' : decodeURIComponent(url.pathname).replace(/^\//, ''));
            if (relative.split('/').some(part => part.startsWith('.') || part === 'node_modules') || !/^(file-studio\.html|map-editor\.html|index\.html|site\.config\.json$|apple-touch-icon\.png$|css\/|js\/|maps\/|assets\/|images\/|fonts\/|favicon)/.test(relative)) return json(res, 404, { error: 'Not found.' });
            let target = path.resolve(root, relative);
            if (!target.startsWith(`${root}/`) || !fs.existsSync(target) || !fs.statSync(target).isFile() || !fs.realpathSync(target).startsWith(`${root}/`)) return json(res, 404, { error: 'Not found.' });
            let bytes = fs.readFileSync(target);
            if (url.pathname === '/studio/editor') bytes = Buffer.from(bytes.toString().replace('<head>', '<head>\n<base href="/">'));
            res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store', ETag: revision(bytes) });
            res.end(req.method === 'HEAD' ? undefined : bytes);
        } catch (error) { if (!res.headersSent) json(res, error.status || 400, { ok: false, error: error.message }); else res.end(); }
    });
}
function startMapFileServer(options = {}) {
    const host = options.host || process.env.HOST || '127.0.0.1';
    const port = Number(options.port ?? process.env.PORT ?? 8010);
    const server = createMapFileServer(options);
    server.listen(port, host, () => console.log(`Hiraeth map files: http://${host}:${server.address().port}/studio`));
    return server;
}
if (require.main === module) { try { startMapFileServer(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { createMapFileServer, startMapFileServer, writeMapFiles, recoverFileWrites, revision, getFileCatalog };
