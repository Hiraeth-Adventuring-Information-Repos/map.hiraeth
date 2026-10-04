#!/usr/bin/env node
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { runtimeFiles, runtimeAssetFiles, runtimeDirectories } = require('./build_pages.js');

// Serve current viewer sources so a browser refresh picks up UX edits. Reuse
// the build's public asset list; the editor and repository internals stay private.
function createPreviewServer({ repoRoot = path.resolve(__dirname, '..') } = {}) {
    const root = fs.realpathSync(repoRoot);
    const publicFiles = new Set([...runtimeFiles, ...runtimeAssetFiles, 'site.config.json']);
    const publicDirectories = [...runtimeDirectories, 'maps', 'tile'];
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ico': 'image/x-icon' };
    return http.createServer((req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
        try {
            const url = new URL(req.url, 'http://localhost');
            if (url.pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ ok: true, sourcePreview: true })); return; }
            let relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^\//, '');
            // Generated source indexes use this prefix for local tile previews.
            if (relative.startsWith('dist/tile/')) relative = relative.slice('dist/'.length);
            const parts = relative.split('/');
            if (parts.some(part => part.startsWith('.') || part.includes('\\')) || (!publicFiles.has(relative) && !publicDirectories.includes(parts[0]))) { res.writeHead(404); res.end(); return; }
            let target = path.resolve(root, relative);
            // The shared tile cache stays available while dist is rebuilt.
            if (parts[0] === 'tile' && !fs.existsSync(target)) {
                const cached = path.resolve(root, '.cache/pages-tiles', relative.slice('tile/'.length));
                target = fs.existsSync(cached) ? cached : path.resolve(root, 'dist', relative);
            }
            if (!target.startsWith(root + '/') || !fs.existsSync(target) || !fs.statSync(target).isFile() || !fs.realpathSync(target).startsWith(root + '/')) { res.writeHead(404); res.end(); return; }
            res.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream');
            if (relative === 'site.config.json') {
                const config = JSON.parse(fs.readFileSync(target));
                config.performance = { ...config.performance, serviceWorker: false };
                res.end(req.method === 'HEAD' ? undefined : JSON.stringify(config));
            } else {
                res.setHeader('Content-Length', fs.statSync(target).size);
                if (req.method === 'HEAD') res.end();
                else fs.createReadStream(target).on('error', () => res.destroy()).pipe(res);
            }
        } catch { res.writeHead(400); res.end(); }
    });
}

function startPreviewServer({ host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT ?? 0), stateFile } = {}) {
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer from 0 to 65535; 0 selects an available random port.');
    const server = createPreviewServer();
    server.listen(port, host, () => {
        const address = { host, port: server.address().port, pid: process.pid, sourcePreview: true };
        if (stateFile) fs.writeFileSync(stateFile, JSON.stringify(address, null, 2) + '\n');
        console.log(`Hiraeth source preview: http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${address.port}/index.html#The-Port-City-of-Stomion-s=c`);
    });
    server.on('error', error => { console.error(error.message); process.exitCode = 1; });
    return server;
}
if (require.main === module) startPreviewServer({ stateFile: process.env.PREVIEW_STATE_FILE });
module.exports = { createPreviewServer, startPreviewServer };
