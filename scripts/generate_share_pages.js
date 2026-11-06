const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { JSDOM } = require('jsdom');
const { resolveImageMagickBinary } = require('./generate_tiles.js');

const defaultThumbnailSettings = Object.freeze({ width: 1200, height: 630, background: '#151c20', quality: 85 });
// Bump if rendering or cache validation changes beyond the arguments below.
const thumbnailRendererVersion = 1;
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function thumbnailArgs(settings) {
    const { width, height, background, quality } = settings;
    if (![width, height, quality].every(Number.isInteger) || width < 1 || height < 1
        || quality < 1 || quality > 100 || !/^#[a-f0-9]{6}$/i.test(background)) {
        throw new Error('Invalid share thumbnail settings.');
    }
    return ['-auto-orient', '-resize', `${width}x${height}`, '-background', background,
        '-alpha', 'remove', '-gravity', 'center', '-extent', `${width}x${height}`, '-strip', '-quality', String(quality)];
}

function readCachedThumbnail(directory, fingerprint) {
    try {
        const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
        if (manifest.fingerprint !== fingerprint) return null;
        const bytes = fs.readFileSync(path.join(directory, 'preview.jpg'));
        // The digest binds these bytes to the image decoded before caching.
        return digest(bytes) === manifest.sha256 ? bytes : null;
    } catch {
        return null;
    }
}

function createThumbnail({ binary, source, coder, args, settings, directory, fingerprint, commandRunner, mapId }) {
    fs.mkdirSync(directory, { recursive: true });
    const temporary = fs.mkdtempSync(path.join(directory, '.pending-'));
    const previewPath = path.join(temporary, 'preview.jpg');
    try {
        const result = commandRunner(binary, [`${coder}:${source}`, ...args, `jpeg:${previewPath}`], { encoding: 'utf8' });
        if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || `exit ${result.status}`);
        // Decode once before recording the checksum. Header-only checks miss
        // truncated JPEG scans; warnings must fail validation too.
        const validation = commandRunner(binary, ['-regard-warnings', `jpeg:${previewPath}`,
            '-format', '%w|%h', 'info:'], { encoding: 'utf8' });
        if (validation.error || validation.status !== 0 || String(validation.stdout).trim() !== `${settings.width}|${settings.height}`) {
            throw new Error(`Invalid JPEG: ${validation.error?.message || validation.stderr || validation.stdout}`);
        }
        const bytes = fs.readFileSync(previewPath);
        fs.writeFileSync(path.join(temporary, 'manifest.json'), JSON.stringify({ fingerprint, sha256: digest(bytes) }));
        fs.renameSync(previewPath, path.join(directory, 'preview.jpg'));
        fs.renameSync(path.join(temporary, 'manifest.json'), path.join(directory, 'manifest.json'));
        return bytes;
    } catch (error) {
        throw new Error(`Share thumbnail failed for ${mapId}: ${error.message}`);
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
}

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

function renderSharePage(map, brand, settings = defaultThumbnailSettings) {
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
<meta property="og:image:width" content="${settings.width}">
<meta property="og:image:height" content="${settings.height}">
<meta property="og:image:alt" content="${escapeHtml(`Map of ${title}`)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<style>body{margin:0;background:#151c20;color:#eee;font:20px Georgia,serif}main{max-width:960px;margin:auto;padding:24px}img{width:100%;height:auto;border-radius:12px}h1{font-size:2rem}p{line-height:1.5}a{color:#f0dba0}</style>
</head><body><main>
<img src="preview.jpg" width="${settings.width}" height="${settings.height}" alt="${escapeHtml(`Map of ${title}`)}">
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

function generateSharePages({ repoRoot, outputDir, brand, tree,
    cacheDir = path.join(repoRoot, '.cache', 'pages-share-thumbnails'),
    thumbnailSettings = {}, commandRunner = spawnSync }) {
    const maps = collectShareMaps(tree);
    const settings = { ...defaultThumbnailSettings, ...thumbnailSettings };
    const args = thumbnailArgs(settings);
    const cacheRoot = path.resolve(cacheDir);
    const outputRoot = path.resolve(outputDir);
    if (cacheRoot === outputRoot || cacheRoot.startsWith(`${outputRoot}${path.sep}`)) {
        throw new Error('Share thumbnail cache must be outside the output directory.');
    }
    let binary;
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
        const fingerprint = crypto.createHash('sha256')
            .update(JSON.stringify({ version: thumbnailRendererVersion, coder, args, output: 'jpeg' }))
            .update(fs.readFileSync(source)).digest('hex');
        const cacheDirectory = path.join(cacheRoot, map.id);
        let preview = readCachedThumbnail(cacheDirectory, fingerprint);
        if (!preview) {
            binary ||= resolveImageMagickBinary({ preferredBinary: process.env.MAGICK_BINARY, commandRunner });
            preview = createThumbnail({ binary, source, coder, args, settings,
                directory: cacheDirectory, fingerprint, commandRunner, mapId: map.id });
        }
        fs.writeFileSync(path.join(directory, 'preview.jpg'), preview);
        fs.writeFileSync(path.join(directory, 'index.html'), renderSharePage(map, brand, settings));
    }
    return maps.length;
}

module.exports = { collectShareMaps, generateSharePages, renderSharePage };
