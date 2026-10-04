(function expose(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.CityAddresses = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const pair = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
    function boundsOf(building) {
        const points = Array.isArray(building.footprint) && building.footprint.length >= 3
            ? building.footprint.filter(pair) : [building.coordinates].filter(pair);
        if (!points.length) return null;
        return [[Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1]))],
            [Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))]];
    }
    function create({ map, L, document, onChoose = () => {} }) {
        const hitAreas = L.layerGroup().addTo(map);
        const renderer = L.canvas({ padding: .5 });
        let entries = [], enabled = true;
        function popup(building) {
            const content = document.createElement('div'); content.className = 'city-address-popup';
            const heading = document.createElement('strong'); heading.textContent = building.address;
            content.append(heading);
            if (building.name) { const name = document.createElement('p'); name.textContent = building.name; content.append(name); }
            const actions = document.createElement('div'); actions.className = 'city-address-actions';
            for (const [role, text] of [['from', 'Directions from here'], ['to', 'Directions to here']]) {
                const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
                button.addEventListener('click', () => { map.closePopup(); onChoose(building, role); });
                actions.append(button);
            }
            content.append(actions); return content;
        }
        function render() {
            hitAreas.clearLayers();
            if (!enabled || !entries.length) return;
            const viewport = map.getBounds();
            for (const entry of entries) {
                if (!entry.bounds || !viewport.intersects(entry.bounds)) continue;
                const building = entry.building;
                const low = map.latLngToContainerPoint(entry.bounds.getSouthWest());
                const high = map.latLngToContainerPoint(entry.bounds.getNorthEast());
                const width = Math.abs(high.x - low.x), height = Math.abs(high.y - low.y);
                // Keep the artwork clean. These invisible roof hit areas only expose
                // address details after a deliberate click at a usable zoom level.
                if (Math.max(width, height) < 12) continue;
                const footprint = building.footprint?.length >= 3 ? building.footprint : [
                    [building.coordinates[0] - 3, building.coordinates[1] - 3],
                    [building.coordinates[0] - 3, building.coordinates[1] + 3],
                    [building.coordinates[0] + 3, building.coordinates[1] + 3],
                    [building.coordinates[0] + 3, building.coordinates[1] - 3]
                ];
                const outline = L.polygon([footprint, ...(building.footprintHoles || [])], { renderer, stroke: false,
                    fillOpacity: 0, className: 'city-building-hitarea' });
                // A popup may pan the map. Keep it independent of the outline,
                // which is rebuilt after that pan as the visible parcels change.
                outline.on('click', event => L.popup().setLatLng(event.latlng).setContent(popup(building)).openOn(map));
                hitAreas.addLayer(outline);
            }
        }
        map.on('moveend zoomend', render);
        return {
            load(data) {
                entries = (data.buildings || []).filter(building => building.address && pair(building.coordinates))
                    .map(building => ({ building, bounds: boundsOf(building) }))
                    .filter(entry => entry.bounds).map(entry => ({ ...entry, bounds: L.latLngBounds(entry.bounds) }));
                render();
            },
            setVisible(visible) { enabled = !!visible; render(); },
            destroy() { map.off('moveend zoomend', render); hitAreas.remove(); }
        };
    }
    return { create, boundsOf };
}));
