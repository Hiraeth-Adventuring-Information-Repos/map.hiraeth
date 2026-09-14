const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { JSDOM } = require('jsdom');
const { resolveImageMagickBinary } = require('./generate_tiles.js');

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

function plainText(value) {
    return JSDOM.fragment(String(value || '')).textContent.replace(/\s+/g, ' ').trim();
}

function collectShareMaps(tree) {
    const maps = new Map();
    function visit(node) {
        if (node.id && node.imageUrl) {
            if (!/^[A-Za-z0-9_-]+$/.test(node.id)) throw new Error(`Unsafe share map ID: ${node.id}`);
            if (maps.has(node.id)) throw new Error(`Duplicate share map ID: ${node.id}`);
            maps.set(node.id, node);
        }
        (node.children || []).forEach(visit);
    }
    tree.forEach(visit);
    return [...maps.values()];
}

function renderSharePage(map, brand) {
    const title = plainText(map.name || map.id);
    const description = plainText(map.selectorDescription || map.summary || map.blurb || map.description)
        || `Explore ${title} in the interactive Hiraeth atlas.`;
    const base = new URL(brand.publicUrl);
    base.search = '';
    base.hash = '';
    if (!base.pathname.endsWith('/')) base.pathname += '/';
    const canonical = new URL(`share/${map.id}/`, base).href;
    const image = new URL(`share/${map.id}/preview.jpg`, base).href;
    const target = `../../#${map.id}`;
    return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · ${escapeHtml(brand.shortName || 'Hiraeth Maps')}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(brand.shortName || 'Hiraeth Maps')}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${escapeHtml(`Map of ${title}`)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<style>body{margin:0;background:#151c20;color:#eee;font:20px Georgia,serif}main{max-width:960px;margin:auto;padding:24px}img{width:100%;height:auto;border-radius:12px}h1{font-size:2rem}p{line-height:1.5}a{color:#f0dba0}</style>
</head><body><main>
<img src="preview.jpg" width="1200" height="630" alt="${escapeHtml(`Map of ${title}`)}">
<h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p>
<p><a id="open-map" href="${target}">Open interactive map</a></p>
</main><script>
const target = new URL(${JSON.stringify(target)}, window.location.href);
target.search = window.location.search;
// Preserve sidebar state, but always open the map named by this share page.
if (window.location.hash.endsWith('-s=c')) target.hash += '-s=c';
document.getElementById('open-map').href = target.href;
window.location.replace(target.href);
</script></body></html>\n`;
}

function generateSharePages({ repoRoot, outputDir, brand, tree }) {
    const maps = collectShareMaps(tree);
    const binary = resolveImageMagickBinary({ preferredBinary: process.env.MAGICK_BINARY });
    for (const map of maps) {
        const source = path.resolve(repoRoot, map.imageUrl);
        if (!source.startsWith(`${path.resolve(repoRoot)}${path.sep}`)
            || /[\0\r\n*?\[\]{}]/.test(source)
            || !/\.(webp|png|jpe?g)$/i.test(source)) {
            throw new Error(`Invalid share image: ${map.imageUrl}`);
        }
        const directory = path.join(outputDir, 'share', map.id);
        fs.mkdirSync(directory, { recursive: true });
        const coder = path.extname(source).slice(1).replace('jpg', 'jpeg');
        const result = spawnSync(binary, [`${coder}:${source}`, '-auto-orient', '-resize', '1200x630',
            '-background', '#151c20', '-alpha', 'remove', '-gravity', 'center', '-extent', '1200x630',
            '-strip', '-quality', '85', `jpeg:${path.join(directory, 'preview.jpg')}`], { encoding: 'utf8' });
        if (result.error || result.status !== 0) throw new Error(`Share thumbnail failed for ${map.id}: ${result.error?.message || result.stderr}`);
        fs.writeFileSync(path.join(directory, 'index.html'), renderSharePage(map, brand));
    }
    return maps.length;
}

module.exports = { collectShareMaps, generateSharePages, renderSharePage };
