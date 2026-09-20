(function expose(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.CampaignJourneys = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const defaultColor = '#d97706';
    const validCoords = coords => Array.isArray(coords) && coords.length === 2 && coords.every(Number.isFinite);
    const color = value => /^#[0-9a-f]{6}$/i.test(value || '') ? value : defaultColor;
    function createId() {
        // randomUUID requires HTTPS; the LAN editor also supports plain HTTP.
        if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
        const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
        return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    }
    function safeWikiLink(value) {
        try {
            const url = new URL(value);
            return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
        } catch { return ''; }
    }

    function validate(journeys) {
        if (journeys === undefined) return [];
        if (!Array.isArray(journeys)) return ['Journeys must be an array.'];
        const errors = [];
        const ids = new Set();
        journeys.forEach((journey, index) => {
            const label = `Journey ${index + 1}`;
            if (!journey || typeof journey !== 'object' || Array.isArray(journey)) {
                errors.push(`${label} must be an object.`);
                return;
            }
            for (const field of ['id', 'name', 'campaign']) {
                if (typeof journey[field] !== 'string' || !journey[field].trim()) errors.push(`${label}: ${field} is required.`);
            }
            if (ids.has(journey.id)) errors.push(`${label}: duplicate journey ID.`);
            ids.add(journey.id);
            if (journey.color !== undefined && !/^#[0-9a-f]{6}$/i.test(journey.color)) errors.push(`${label}: use a six-digit hex color.`);
            if (journey.visibleByDefault !== undefined && typeof journey.visibleByDefault !== 'boolean') errors.push(`${label}: default visibility must be a boolean.`);
            const checkText = (item, context, fields) => fields.forEach(field => {
                if (item[field] !== undefined && typeof item[field] !== 'string') errors.push(`${context}: ${field} must be text.`);
            });
            const checkLink = (item, context) => {
                if (item.wikiLink && !safeWikiLink(item.wikiLink)) errors.push(`${context}: wiki link must be a full http or https URL.`);
            };
            checkText(journey, label, ['description', 'wikiLink']);
            checkLink(journey, label);
            if (!Array.isArray(journey.stops) || !journey.stops.length) {
                errors.push(`${label}: add at least one stop.`);
                return;
            }
            const stopIds = new Set();
            journey.stops.forEach((stop, stopIndex) => {
                const context = `${label}, stop ${stopIndex + 1}`;
                if (!stop || typeof stop !== 'object' || Array.isArray(stop)) {
                    errors.push(`${context} must be an object.`);
                    return;
                }
                for (const field of ['id', 'name']) {
                    if (typeof stop[field] !== 'string' || !stop[field].trim()) errors.push(`${context}: ${field} is required.`);
                }
                if (stopIds.has(stop.id)) errors.push(`${context}: duplicate stop ID.`);
                stopIds.add(stop.id);
                if (!validCoords(stop.coords)) errors.push(`${context}: coordinates must be two finite numbers [Y, X].`);
                checkText(stop, context, ['date', 'session', 'description', 'wikiLink']);
                checkLink(stop, context);
            });
        });
        return errors;
    }

    function popup(document, journey, stop, index) {
        const content = document.createElement('div');
        content.className = 'journey-popup';
        const append = (tag, value, className = '') => {
            if (!value) return;
            const node = document.createElement(tag);
            node.textContent = value;
            node.className = className;
            content.append(node);
        };
        append('p', journey.campaign, 'journey-popup-campaign');
        append('h3', stop ? `${index + 1}. ${stop.name}` : journey.name);
        if (stop) append('p', journey.name);
        if (stop?.date) append('p', stop.date, 'journey-popup-date');
        if (stop?.session) append('p', `Session: ${stop.session}`);
        append('p', (stop || journey).description, 'journey-popup-description');
        const appendLink = (value, label) => {
            const href = safeWikiLink(value);
            if (!href) return;
            const link = document.createElement('a');
            link.href = href;
            link.textContent = label;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            content.append(link);
        };
        if (stop) appendLink(stop.wikiLink, 'Read about this stop ↗');
        appendLink(journey.wikiLink, 'Open campaign wiki ↗');
        return content;
    }

    function createLayer(L, document, journey, options = {}) {
        const group = L.featureGroup();
        const stops = Array.isArray(journey.stops) ? journey.stops : [];
        const routeColor = color(journey.color);
        // Only connect adjacent valid stops; malformed data must not invent a leg.
        stops.forEach((stop, index) => {
            if (!validCoords(stop?.coords)) return;
            if (index && validCoords(stops[index - 1]?.coords)) {
                const route = L.polyline([stops[index - 1].coords, stop.coords], {
                    color: routeColor, weight: 3, dashArray: '1 9', lineCap: 'round',
                    className: 'campaign-journey-route', bubblingMouseEvents: false
                }).addTo(group);
                if (options.onSelect) route.on('click', () => options.onSelect());
                else route.bindPopup(() => popup(document, journey), { maxWidth: 320 });
            }
        });
        stops.forEach((stop, index) => {
            if (!validCoords(stop?.coords)) return;
            const pin = document.createElement('span');
            pin.className = 'journey-pin-number';
            pin.style.backgroundColor = routeColor;
            pin.textContent = String(index + 1);
            const marker = L.marker(stop.coords, {
                icon: L.divIcon({ className: 'campaign-journey-pin', html: pin, iconSize: [28, 28], iconAnchor: [14, 14] }),
                title: `${journey.name}: ${index + 1}. ${stop.name}`,
                alt: `${journey.name}: ${index + 1}. ${stop.name}`,
                draggable: Boolean(options.draggable), bubblingMouseEvents: false
            }).addTo(group);
            if (options.onSelect) marker.on('click', () => options.onSelect(index));
            else marker.bindPopup(() => popup(document, journey, stop, index), { maxWidth: 320 });
            if (options.onDragStart) marker.on('dragstart', () => options.onDragStart(index));
            if (options.onDragEnd) marker.on('dragend', event => options.onDragEnd(index, event.target.getLatLng()));
        });
        return group;
    }
    return { defaultColor, createId, validCoords, color, safeWikiLink, validate, popup, createLayer };
}));
