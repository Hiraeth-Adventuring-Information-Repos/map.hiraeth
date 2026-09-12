const assert = require('node:assert/strict');
const fs = require('node:fs');

const leafletCss = fs.readFileSync('css/leaflet.css', 'utf8');
const appCss = fs.readFileSync('css/style.css', 'utf8');

const tileBlendRule = /\.leaflet-container img\.leaflet-tile\s*\{(?<body>[\s\S]*?)\}/.exec(leafletCss);

assert.ok(tileBlendRule, 'Leaflet tile images should keep an explicit compatibility rule');
assert.match(tileBlendRule.groups.body, /issues\.chromium\.org\/issues\/40084005/);
assert.match(tileBlendRule.groups.body, /formerly 600120/);
assert.match(tileBlendRule.groups.body, /mix-blend-mode:\s*plus-lighter;/);

assert.match(
    appCss,
    /#map \.map-tile-layer\s*\{[\s\S]*?isolation:\s*isolate;[\s\S]*?\}/,
    'Generated map tile layers should not blend against the preview underlay'
);
assert.match(
    appCss,
    /#map \.map-tile-layer img\.leaflet-tile\s*\{[\s\S]*?mix-blend-mode:\s*normal;[\s\S]*?\}/,
    'Generated map tile images should override the global seam-blending rule while the preview underlay is present'
);
assert.match(
    appCss,
    /#map \.map-tile-layer img\.leaflet-tile-loaded\s*\{[\s\S]*?opacity:\s*1\s*!important;[\s\S]*?\}/,
    'Generated map tiles should render at full opacity as soon as they are loaded'
);

assert.match(
    appCss,
    /#map > \.leaflet-map-pane > \.leaflet-tile-pane > svg,\s*#map > \.leaflet-map-pane > \.leaflet-tile-pane > canvas\s*\{[\s\S]*?z-index:\s*0;[\s\S]*?\}/,
    'The map underlay SVG and Firefox canvas should render behind the tile/image artwork'
);
assert.match(
    appCss,
    /#map > \.leaflet-map-pane > \.leaflet-tile-pane > \.leaflet-layer,\s*#map > \.leaflet-map-pane > \.leaflet-tile-pane > \.leaflet-image-layer\s*\{[\s\S]*?z-index:\s*1;[\s\S]*?\}/,
    'The primary tile and image layers should render above the underlay renderer'
);

console.log('Leaflet CSS compatibility checks passed');
