const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const htmlSource = fs.readFileSync('map-editor.html', 'utf8');
const localAccessScriptMatch = htmlSource.match(/<script>\s*(\(function resolveMapEditorLocalAccess\(\) \{[\s\S]*?\}\)\(\);)\s*<\/script>/);

assert.ok(localAccessScriptMatch, 'local access bootstrap script should exist');

function evaluateLocalAccess(protocol, hostname, downloadOnly = false) {
    const addedClasses = [];
    const context = {
        window: {
            location: { protocol, hostname },
            __MAP_EDITOR_DOWNLOAD_ONLY__: downloadOnly
        },
        document: {
            documentElement: {
                classList: {
                    add: (className) => addedClasses.push(className)
                }
            }
        },
        Set
    };

    vm.runInNewContext(localAccessScriptMatch[1], context);

    return {
        allowed: context.window.__MAP_EDITOR_LOCAL_ACCESS__,
        addedClasses
    };
}

[
    ['http:', 'localhost'],
    ['http:', '127.0.0.1'],
    ['http:', '127.10.20.30'],
    ['http:', 'editor.localhost'],
    ['file:', '']
].forEach(([protocol, hostname]) => {
    const result = evaluateLocalAccess(protocol, hostname);
    assert.equal(result.allowed, true, `${protocol}//${hostname} should allow editor access`);
    assert.deepEqual(result.addedClasses, ['map-editor-local-access']);
});

[
    ['https:', 'maps.hiraeth.wiki'],
    ['https:', 'hiraeth-adventuring-information-repos.github.io'],
    ['http:', '0.0.0.0'],
    ['http:', '192.168.1.10']
].forEach(([protocol, hostname]) => {
    const result = evaluateLocalAccess(protocol, hostname);
    assert.equal(result.allowed, false, `${protocol}//${hostname} should show remote notice`);
    assert.deepEqual(result.addedClasses, ['map-editor-remote-access']);
});

console.log('map-editor local access checks passed');

assert.equal(evaluateLocalAccess('https:', 'maps.hiraeth.wiki', true).allowed, true, 'The published download editor should work on its public hostname');
