const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(require.resolve('../js/app.js'), 'utf8');
const start = source.indexOf('function canSkipMapToSearch()');
const end = source.indexOf('// Cached live collection', start);

function harness(t, { mobile = false } = {}) {
    const dom = new JSDOM(`<section id="chooser" hidden></section>
        <a id="skip" href="#input" hidden>Skip map to search</a>
        <button id="marker">Map marker</button>
        <section id="card"><div id="control"><input id="input" type="search"></div></section>`,
    { url: 'https://example.test/#The-Port-City-of-Stomion-s=c' });
    t.after(() => dom.window.close());
    const { document } = dom.window;
    const byId = id => document.getElementById(id);
    const calls = [];
    const context = {
        window: dom.window, MutationObserver: dom.window.MutationObserver,
        isEmbeddedView: false, mapChooserElement: byId('chooser'),
        searchControlContainer: byId('control'), poiSearchInput: byId('input'),
        skipMapToSearchLink: byId('skip'), bodyElement: document.body,
        featureDetailSheetOpen: false, isMobileLayoutActive: mobile,
        MOBILE_SURFACE_MODE_SEARCH: 'search',
        closeFeatureDetailSheet(options) { calls.push(['close', options.restoreFocus]); },
        openMobileSheet(options) {
            calls.push(['open', options.mode, options.triggerButton.id]);
            byId('card').inert = false;
            byId('card').removeAttribute('aria-hidden');
        }
    };
    if (mobile) {
        byId('card').inert = true;
        byId('card').setAttribute('aria-hidden', 'true');
    }
    vm.createContext(context);
    vm.runInContext(source.slice(start, end), context);
    function activate() {
        const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
        byId('skip').dispatchEvent(event);
        return event;
    }
    return { context, document, byId, activate, calls, dom };
}

test('skip link focuses desktop search and preserves the map hash and marker access', t => {
    const { byId, document, activate, dom } = harness(t);
    const hash = dom.window.location.hash;
    assert.equal(byId('skip').hidden, false);
    assert.equal(activate().defaultPrevented, true);
    assert.equal(document.activeElement, byId('input'));
    assert.equal(dom.window.location.hash, hash);
    byId('marker').focus();
    assert.equal(document.activeElement, byId('marker'));
});

test('mobile skip opens search before focusing its input and records the return target', t => {
    const { byId, document, activate, calls } = harness(t, { mobile: true });
    assert.equal(byId('skip').hidden, false);
    activate();
    assert.deepEqual(calls, [['open', 'search', 'skip']]);
    assert.equal(byId('card').inert, false);
    assert.equal(document.activeElement, byId('input'));
});

test('skip closes an open feature detail surface without restoring its focus', t => {
    const { context, activate, calls } = harness(t);
    context.featureDetailSheetOpen = true;
    activate();
    assert.deepEqual(calls, [['close', false]]);
});

for (const state of ['embed', 'gallery', 'disabled', 'readonly', 'no-search', 'hidden-input', 'inert-control']) {
    test(`skip is unavailable in the ${state} state and cannot change focus or hash`, async t => {
        const { context, byId, document, activate, dom } = harness(t);
        const hash = dom.window.location.hash;
        if (state === 'embed') { context.isEmbeddedView = true; document.body.classList.add('embedded-view'); }
        if (state === 'gallery') byId('chooser').hidden = false;
        if (state === 'disabled') byId('input').disabled = true;
        if (state === 'readonly') byId('input').readOnly = true;
        if (state === 'no-search') byId('control').style.display = 'none';
        if (state === 'hidden-input') byId('input').hidden = true;
        if (state === 'inert-control') byId('control').setAttribute('inert', '');
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(byId('skip').hidden, true);
        byId('marker').focus();
        assert.equal(activate().defaultPrevented, true);
        assert.equal(document.activeElement, byId('marker'));
        assert.equal(dom.window.location.hash, hash);
    });
}

test('skip availability returns when search becomes usable', async t => {
    const { byId } = harness(t);
    byId('control').style.display = 'none';
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(byId('skip').hidden, true);
    byId('control').style.display = 'block';
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(byId('skip').hidden, false);
});
