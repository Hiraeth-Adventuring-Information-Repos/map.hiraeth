const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { collectShareMaps, renderSharePage } = require('../scripts/generate_share_pages.js');
const brand = { publicUrl: 'https://maps.example.com/atlas/', shortName: 'Hiraeth Maps' };

test('Every image-backed map gets a preview, including folders with children', () => {
    const tree = [{ id: 'Fair', imageUrl: 'maps/fair.webp', children: [
        { id: 'group', children: [{ id: 'IceBeach', imageUrl: 'maps/ice.webp' }] }
    ] }];
    assert.deepEqual(collectShareMaps(tree).map(m => m.id), ['Fair', 'IceBeach']);
    assert.throws(() => collectShareMaps([{ id: '../escape', imageUrl: 'a.png' }]), /Unsafe/);
    assert.throws(() => collectShareMaps([tree[0], tree[0]]), /Duplicate/);
});

test('Preview metadata is available without JavaScript and safely strips HTML', () => {
    const html = renderSharePage({ id: 'IceBeach', name: 'Ice & Snow',
        selectorDescription: '<p>A <a href="x">frozen</a> coast &amp; frontier.</p>' }, brand);
    const document = new JSDOM(html).window.document;
    const meta = property => document.querySelector(`meta[property="${property}"]`).content;
    assert.equal(meta('og:title'), 'Ice & Snow');
    assert.equal(meta('og:description'), 'A frozen coast & frontier.');
    assert.equal(meta('og:url'), 'https://maps.example.com/atlas/share/IceBeach/');
    assert.equal(meta('og:image'), 'https://maps.example.com/atlas/share/IceBeach/preview.jpg');
    assert.equal(meta('og:image:width'), '1200');
    assert.equal(document.querySelector('a#open-map').getAttribute('href'), '../../#IceBeach');
    assert.equal(document.querySelector('meta[http-equiv="refresh"]'), null);
});

test('Opening a preview preserves targets and sidebar state, including under a subpath', () => {
    const html = renderSharePage({ id: 'IceBeach', name: 'IceBeach' }, brand);
    const document = new JSDOM(html).window.document;
    const script = document.querySelector('script').textContent;
    for (const query of ['?view=1.234,5.678,3&src=share&stype=view', '?poi=Old%20Dock&src=share&stype=poi', '?region=North', '?line=Road', '']) {
        let redirected;
        const location = { href: `https://maps.example.com/atlas/share/IceBeach/${query}#wrong-s=c`,
            search: query, hash: '#wrong-s=c', replace: value => { redirected = value; } };
        vm.runInNewContext(script, { URL, window: { location }, document });
        const target = new URL(redirected);
        assert.equal(target.pathname, '/atlas/');
        assert.equal(target.hash, '#IceBeach-s=c');
        assert.equal(target.search, query);
        assert.equal(document.querySelector('#open-map').href, target.href);
    }
});
