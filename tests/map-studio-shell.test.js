const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'map-studio.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'js/map-studio.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/map-studio.css'), 'utf8');

assert.match(html, /js\/map-studio-model\.js/);
assert.match(html, /class="pipeline-steps"/);
assert.match(html, /id="continue-editing-link"/);
assert.match(html, /id="workspace-capability-note"/);
assert.match(script, /deriveWorkspacePresentation/);
assert.match(script, /capabilities\.canCreateMap/);
assert.match(css, /\.studio-appbar\s*\{/);
assert.match(css, /\.pipeline-steps\s*\{/);

console.log('map studio shell checks passed');
