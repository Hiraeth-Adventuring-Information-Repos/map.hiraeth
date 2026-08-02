const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { writeWithValidation } = require('./editor_server.js');

const MAX_MAP_UPLOAD_BYTES = 512 * 1024 * 1024;
const MAP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

function prettyJson(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
}

function getManifestEntries(document) {
    if (Array.isArray(document)) return document;
    if (document && Array.isArray(document.maps)) return document.maps;
    throw new Error('maps/maps.json must be an array or contain a maps array.');
}

function assertNewMapMetadata(metadata, manifestEntries) {
    const id = String(metadata.id || '').trim();
    const name = String(metadata.name || '').trim();
    const parentId = String(metadata.parentId || '').trim();
    if (!MAP_ID_PATTERN.test(id)) {
        throw new Error('Map ID must be 1–80 letters, numbers, underscores, or hyphens, beginning with a letter or number.');
    }
    if (!name || name.length > 120) throw new Error('Map name must be between 1 and 120 characters.');
    if (manifestEntries.some((entry) => String(entry?.id || '').trim() === id)) {
        throw new Error(`A map or folder with ID "${id}" already exists.`);
    }
    if (parentId && !manifestEntries.some((entry) => String(entry?.id || '').trim() === parentId)) {
        throw new Error(`Parent map or folder "${parentId}" does not exist.`);
    }
    const scalePixels = Number(metadata.scalePixels || 0);
    const scaleKilometers = Number(metadata.scaleKilometers || 0);
    if ((scalePixels > 0) !== (scaleKilometers > 0)) {
        throw new Error('Scale pixels and scale kilometers must either both be set or both be left blank.');
    }
    return {
        id,
        name,
        parentId,
        selectorDescription: String(metadata.selectorDescription || '').trim().slice(0, 500),
        blurb: String(metadata.blurb || '').trim().slice(0, 5000),
        scalePixels,
        scaleKilometers
    };
}

function readImageDimensions(imagePath) {
    const candidates = [
        ['magick', ['identify', '-format', '%w|%h', imagePath]],
        ['identify', ['-format', '%w|%h', imagePath]]
    ];
    for (const [command, args] of candidates) {
        const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'pipe', timeout: 30_000 });
        if (result.error?.code === 'ENOENT') continue;
        if (result.status !== 0) {
            const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
            throw new Error(`Could not inspect map artwork${output ? `: ${output}` : '.'}`);
        }
        const [width, height] = String(result.stdout || '').trim().split('|').map(Number);
        if (Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0) {
            return { width, height };
        }
    }
    throw new Error('ImageMagick identify is required to inspect map artwork.');
}

function getNextOrder(entries, parentId) {
    const siblingOrders = entries
        .filter((entry) => String(entry?.parentId || '').trim() === parentId)
        .map((entry) => Number(entry.order))
        .filter(Number.isFinite);
    return siblingOrders.length > 0 ? Math.max(...siblingOrders) + 1 : 0;
}

function createNewMapFromUpload({
    repoRoot,
    uploadPath,
    metadata,
    readDimensions = readImageDimensions,
    writeDocuments = writeWithValidation
}) {
    const manifestPath = path.join(repoRoot, 'maps', 'maps.json');
    const manifestDocument = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const manifestEntries = getManifestEntries(manifestDocument);
    const normalized = assertNewMapMetadata(metadata, manifestEntries);
    const { width, height } = readDimensions(uploadPath);
    const imageRelativePath = `maps/${normalized.id}.webp`;
    const documentRelativePath = `maps/${normalized.id}.json`;
    const imagePath = path.join(repoRoot, imageRelativePath);
    const documentPath = path.join(repoRoot, documentRelativePath);
    if (fs.existsSync(imagePath) || fs.existsSync(documentPath)) {
        throw new Error(`Map files for "${normalized.id}" already exist.`);
    }

    const mapDocument = {
        id: normalized.id,
        name: normalized.name,
        width,
        height,
        imageUrl: imageRelativePath,
        ...(normalized.scalePixels > 0 ? {
            scalePixels: normalized.scalePixels,
            scaleKilometers: normalized.scaleKilometers
        } : {}),
        blurb: normalized.blurb,
        selectorDescription: normalized.selectorDescription,
        pointsOfInterest: [],
        regions: [],
        lines: []
    };
    const manifestEntry = {
        id: normalized.id,
        order: getNextOrder(manifestEntries, normalized.parentId),
        ...(normalized.parentId ? { parentId: normalized.parentId } : {}),
        name: normalized.name,
        dataUrl: documentRelativePath
    };
    manifestEntries.push(manifestEntry);

    writeDocuments(repoRoot, [
        { fullPath: imagePath, sourcePath: uploadPath },
        { fullPath: documentPath, content: prettyJson(mapDocument) },
        { fullPath: manifestPath, content: prettyJson(manifestDocument) }
    ]);

    return {
        map: mapDocument,
        manifestEntry,
        files: [imageRelativePath, documentRelativePath, 'maps/maps.json', 'maps/atlas-index.json']
    };
}

function receiveUploadToTemporaryFile(request, options = {}) {
    const maxBytes = Number(options.maxBytes) > 0 ? Number(options.maxBytes) : MAX_MAP_UPLOAD_BYTES;
    const contentType = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (contentType !== 'image/webp') {
        return Promise.reject(new Error('New map artwork must be a WebP image.'));
    }
    const declaredLength = Number(request.headers['content-length'] || 0);
    if (declaredLength > maxBytes) return Promise.reject(new Error('Map artwork exceeds the upload limit.'));

    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hiraeth-map-upload-'));
    const uploadPath = path.join(tempDirectory, 'map.webp');
    const output = fs.createWriteStream(uploadPath, { flags: 'wx' });
    let receivedBytes = 0;

    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error) => {
            if (settled) return;
            settled = true;
            if (error) {
                output.destroy();
                fs.rmSync(tempDirectory, { recursive: true, force: true });
                reject(error);
                return;
            }
            resolve({
                uploadPath,
                receivedBytes,
                cleanup: () => fs.rmSync(tempDirectory, { recursive: true, force: true })
            });
        };

        request.on('data', (chunk) => {
            receivedBytes += chunk.length;
            if (receivedBytes > maxBytes) {
                request.destroy();
                finish(new Error('Map artwork exceeds the upload limit.'));
            }
        });
        request.on('error', (error) => finish(error));
        output.on('error', (error) => finish(error));
        output.on('finish', () => finish());
        request.pipe(output);
    });
}

function metadataFromHeaders(headers) {
    const encoded = String(headers['x-map-metadata'] || '').trim();
    if (encoded) {
        try {
            return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
        } catch (error) {
            throw new Error('Map upload metadata is invalid.');
        }
    }
    return {
        id: headers['x-map-id'],
        name: headers['x-map-name'],
        parentId: headers['x-map-parent-id'],
        scalePixels: headers['x-map-scale-pixels'],
        scaleKilometers: headers['x-map-scale-kilometers'],
        selectorDescription: headers['x-map-selector-description'],
        blurb: headers['x-map-blurb']
    };
}

module.exports = {
    MAP_ID_PATTERN,
    MAX_MAP_UPLOAD_BYTES,
    assertNewMapMetadata,
    createNewMapFromUpload,
    getManifestEntries,
    getNextOrder,
    metadataFromHeaders,
    readImageDimensions,
    receiveUploadToTemporaryFile
};
