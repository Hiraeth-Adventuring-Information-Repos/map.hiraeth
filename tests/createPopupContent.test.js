const assert = require('node:assert/strict');
const fs = require('node:fs');

const appSource = fs.readFileSync('js/app.js', 'utf8');
const routingExperimentEnabled = false;
const formatStart = appSource.indexOf('function formatPropertiesForPopup(properties, hasFollowingDescription) {');
const sanitizeStart = appSource.indexOf('function escapeHtml(value) {');
const wikiLinkStart = appSource.indexOf('function sanitizeWikiLinkForHref(value) {');
const resolveStart = appSource.indexOf('function resolveLinkedMapData(featureData) {');
const popupStart = appSource.indexOf('function createPopupContent(data, type) {');
const popupEnd = appSource.indexOf('// --- Auto-generate a reverse map for quick lookup (Type -> Group) ---');

if (
    formatStart === -1 ||
    sanitizeStart === -1 ||
    wikiLinkStart === -1 ||
    resolveStart === -1 ||
    popupStart === -1 ||
    popupEnd === -1
) {
    throw new Error('Could not locate createPopupContent dependencies in js/app.js');
}

const formatSource = appSource.slice(formatStart, sanitizeStart);
const sanitizeSource = appSource.slice(sanitizeStart, wikiLinkStart);
const wikiLinkSource = appSource.slice(wikiLinkStart, resolveStart);
const popupSource = appSource.slice(popupStart, popupEnd);

// Minimal dependency stub for this regression check.
function resolveLinkedMapData() {
    return null;
}

// eslint-disable-next-line no-eval
eval(formatSource);
// eslint-disable-next-line no-eval
eval(sanitizeSource);
// eslint-disable-next-line no-eval
eval(wikiLinkSource);
// eslint-disable-next-line no-eval
eval(popupSource);

const popupHtml = createPopupContent(
    {
        name: `Old <Lin> "Watch" O\\Brien`,
        description: 'A test location.'
    },
    'poi'
);

assert.ok(
    popupHtml.includes('<h3>Old &lt;Lin&gt; &quot;Watch&quot; O\\Brien</h3>'),
    'popup title should escape HTML-sensitive characters'
);

assert.ok(
    popupHtml.includes(`data-popup-action="share-feature" data-feature-type="poi" data-feature-name="Old &lt;Lin&gt; &quot;Watch&quot; O\\Brien"`),
    'share action data should preserve backslashes safely'
);
assert.ok(!popupHtml.includes('onclick='), 'popup actions should not use inline JavaScript');

const unsafeHtml = createPopupContent(
    {
        name: 'Unsafe Example',
        pronunciation: '<img src=x onerror=alert(1)>',
        summary: '<script>alert("summary")</script>',
        description: '<svg onload=alert("description")></svg>'
    },
    'poi'
);

assert.ok(
    !unsafeHtml.includes('<script>alert("summary")</script>'),
    'summary should not render raw script tags'
);
assert.ok(
    !unsafeHtml.includes('<svg onload=alert("description")></svg>'),
    'description should not render raw SVG payloads'
);
assert.ok(
    !unsafeHtml.includes('<img src=x onerror=alert(1)>'),
    'pronunciation should not render raw HTML'
);

const compactSummaryHtml = createPopupContent(
    {
        name: 'Compact Detail',
        type: 'Capital',
        summary: 'Short map popup summary.',
        description: 'Long drawer-only description.'
    },
    'poi'
);
assert.ok(
    compactSummaryHtml.includes('Short map popup summary.'),
    'compact popup should include summary text'
);
assert.ok(
    !compactSummaryHtml.includes('Long drawer-only description.'),
    'compact popup should not duplicate drawer-only description when summary exists'
);
assert.ok(
    !compactSummaryHtml.includes('Read More'),
    'compact popup should not render a Read More expander'
);
assert.ok(
    !compactSummaryHtml.includes('popup-read-more'),
    'compact popup should not render the old read-more class'
);

const javascriptLinkHtml = createPopupContent(
    {
        name: 'Unsafe Link',
        wikiLink: 'javascript:alert(1)',
        description: 'desc'
    },
    'poi'
);
assert.ok(
    !javascriptLinkHtml.includes('href="javascript:alert(1)"'),
    'javascript wikiLink should not render as href'
);
assert.ok(
    javascriptLinkHtml.includes('<h3>Unsafe Link</h3>'),
    'invalid wikiLink should fall back to plain header'
);

const injectedAttributeHtml = createPopupContent(
    {
        name: 'Injected Link',
        wikiLink: 'https://example.com" onclick="alert(1)',
        description: 'desc'
    },
    'poi'
);
assert.ok(
    !injectedAttributeHtml.includes('onclick="alert(1)"'),
    'wikiLink should not allow attribute injection'
);
assert.ok(
    injectedAttributeHtml.includes('<h3>Injected Link</h3>'),
    'malformed wikiLink should fall back to plain header'
);

const relativeLinkHtml = createPopupContent(
    {
        name: 'Relative Link',
        wikiLink: '/wiki/page',
        description: 'desc'
    },
    'poi'
);
assert.ok(
    relativeLinkHtml.includes('href="/wiki/page"'),
    'relative wikiLink should be allowed'
);

const hashLinkHtml = createPopupContent(
    {
        name: 'Hash Link',
        wikiLink: '#section-1',
        description: 'desc'
    },
    'poi'
);
assert.ok(
    hashLinkHtml.includes('href="#section-1"'),
    'hash wikiLink should be allowed'
);

console.log('createPopupContent regression checks passed');
