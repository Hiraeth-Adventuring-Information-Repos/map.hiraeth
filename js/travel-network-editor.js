/* Visual authoring for map-local transport networks. */
(function () {
    window.TravelNetworkEditor = { create };
    function create({ state, panel, isOpen, editable, lines, checkpoint, changed, draftChanged, clearDraft, status, resample }) {
        const T = window.TravelNetwork, map = state.map;
        const layer = L.layerGroup().addTo(map), previewLayer = L.layerGroup().addTo(map), addressRenderer = L.canvas({ padding: .5 });
        let selected = null, tool = 'select', kind = 'junction', mode = 'road', mapId = '', result = null, viewMode = 'all';
        const data = () => state.currentMap;
        const nodes = () => T.connectionPoints(data(), lines());
        const drawing = () => state.drawMode === 'network';
        const coords = latlng => [Number(latlng.lat.toFixed(2)), Number(latlng.lng.toFixed(2))];
        const el = (tag, text, className) => {
            const element = document.createElement(tag);
            if (text) element.textContent = text;
            if (className) element.className = className;
            return element;
        };
        function button(parent, text, action, disabled = false) {
            const control = el('button', text); control.type = 'button'; control.disabled = disabled;
            control.addEventListener('click', action); parent.append(control); return control;
        }
        function field(parent, label, value, options = {}) {
            const wrap = el('label', label), control = el(options.choices ? 'select' : options.multiline ? 'textarea' : 'input');
            control.id = options.id || `network-${options.key}`;
            if (options.choices) for (const [value, name] of options.choices) {
                const option = el('option', name); option.value = value; control.append(option);
            }
            else if (!options.multiline) { control.type = options.type || 'text'; if (control.type === 'number') { control.step = 'any'; control.min = options.min ?? 0; } }
            if (control.type === 'checkbox') control.checked = !!value; else control.value = value ?? '';
            control.disabled = options.edit !== false && !editable();
            if (options.change) control.addEventListener('change', () => {
                if (!control.reportValidity()) return;
                try { options.change(control.type === 'checkbox' ? control.checked : control.value); control.setCustomValidity(''); }
                catch (error) { status(error.message); control.setCustomValidity(error.message); control.reportValidity(); }
            });
            control.addEventListener('input', () => control.setCustomValidity(''));
            wrap.append(control); parent.append(wrap); return control;
        }
        function commit(label, action) {
            if (!editable() || drawing()) return;
            checkpoint(label); action(); result = null; changed(label); refresh();
        }
        function findSnap(coordinate) {
            const point = map.latLngToContainerPoint(coordinate);
            let nearest = null, limit = 16;
            for (const node of nodes()) {
                const distance = point.distanceTo(map.latLngToContainerPoint(node.coordinates));
                if (distance < limit) { nearest = { node, coordinates: node.coordinates }; limit = distance; }
            }
            if (nearest) return nearest;
            limit = 10;
            for (const line of lines().filter(T.mapped)) {
                for (let i = 0; i < line.coordinates.length - 1; i++) {
                    const a = map.latLngToContainerPoint(line.coordinates[i]), b = map.latLngToContainerPoint(line.coordinates[i + 1]);
                    const dx = b.x - a.x, dy = b.y - a.y;
                    const ratio = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
                    const projected = L.point(a.x + ratio * dx, a.y + ratio * dy), distance = point.distanceTo(projected);
                    if (distance < limit) { nearest = { line, index: i, coordinates: line.coordinates[i].map((value, axis) => value + ratio * (line.coordinates[i + 1][axis] - value)) }; limit = distance; }
                }
            }
            return nearest;
        }
        function resolvePoint(coordinate) {
            const snap = findSnap(coordinate);
            T.ensureNodes(data(), lines());
            if (snap?.node) return data().travelNodes.find(node => node.id === snap.node.id);
            if (snap?.line) return T.splitLink(data(), snap.line, snap.index, snap.coordinates, lines());
            return T.addNode(data(), coordinate, kind, lines());
        }
        function startLink(node) {
            if (!editable()) return;
            if (drawing() && tool === 'address') { status('Finish or cancel the address drawing first.'); return; }
            if (state.drawMode && !drawing()) { status('Finish or cancel the current drawing first.'); return; }
            tool = 'connect'; state.networkTool = 'connect'; selected = null; result = null; state.drawMode = 'network';
            if (node && !state.draftCoordinates.length) state.draftCoordinates = [[...node.coordinates]];
            if (state.draftCoordinates.length) draftChanged();
            refresh();
        }
        function cancel() {
            const address = tool === 'address'; tool = 'select'; state.networkTool = 'connect'; clearDraft(); refresh(); status(address ? 'Address drawing canceled.' : 'Connection drawing canceled.');
        }
        function startAddress() {
            if (!editable()) return;
            if (state.drawMode) { status('Finish or cancel the current drawing first.'); return; }
            if (!lines().some(line => ['road', 'trail'].includes(line.travelMode))) { status('Draw a road or trail before adding an address.'); return; }
            tool = 'address'; state.networkTool = 'address'; selected = null; result = null; state.drawMode = 'network'; refresh();
        }
        function finish() {
            if (!editable() || !drawing() || state.draftCoordinates.length < 2) return;
            const points = state.draftCoordinates.map(point => [...point]);
            if (tool === 'address') {
                const [a, b] = points;
                if (Math.abs(a[0] - b[0]) < .01 || Math.abs(a[1] - b[1]) < .01) { status('Choose two opposite roof corners with a width and height.'); return; }
                const footprint = [a, [a[0], b[1]], b, [b[0], a[1]]], draft = { ...data(), buildings: [...(data().buildings || [])] };
                let building;
                try { building = T.addBuilding(draft, footprint, lines()); } catch (error) { status(error.message); return; }
                checkpoint('Add building address'); data().buildings = draft.buildings; selected = { type: 'building', id: building.id }; tool = 'select'; state.networkTool = 'connect'; clearDraft(); result = null; changed('Building address added. Edit its number, entrance or footprint below.'); refresh(); return;
            }
            if (map.latLngToContainerPoint(points[0]).distanceTo(map.latLngToContainerPoint(points.at(-1))) < 1) {
                status('Choose two different connection points.'); return;
            }
            checkpoint('Draw travel connection');
            const from = resolvePoint(points[0]), to = resolvePoint(points.at(-1));
            const line = T.createLink(from, to, points, mode); lines().push(line);
            tool = 'select'; clearDraft(); selected = { type: 'link', id: line.id }; result = null;
            changed('Travel connection added.'); refresh();
        }
        function click(latlng) {
            if (!editable() || !isOpen()) return;
            const coordinate = coords(latlng), snap = findSnap(coordinate);
            if (drawing()) {
                if (tool === 'address') { state.draftCoordinates.push(coordinate); draftChanged(); if (state.draftCoordinates.length === 2) finish(); else refresh(); return; }
                const point = snap?.coordinates || coordinate, previous = state.draftCoordinates.at(-1);
                if (previous && Math.hypot(point[0] - previous[0], point[1] - previous[1]) < .01) return;
                state.draftCoordinates.push([...point]); draftChanged();
                if (snap && state.draftCoordinates.length > 1) finish(); else refresh();
            } else if (tool === 'point') {
                if (snap?.node) { selected = { type: 'node', id: snap.node.id }; refresh(); return; }
                commit('Add travel connection point', () => {
                    const node = resolvePoint(coordinate); selected = { type: 'node', id: node.id };
                });
            } else { selected = snap?.node ? { type: 'node', id: snap.node.id } : snap?.line ? { type: 'link', id: snap.line.id } : null; refresh(); }
        }
        function selectNode(node) {
            if (drawing()) click(L.latLng(node.coordinates));
            else { selected = { type: 'node', id: node.id }; tool = 'select'; refresh(); }
        }
        function renderMap() {
            layer.clearLayers(); previewLayer.clearLayers();
            if (!isOpen() || !data()) return;
            const displayed = new Map();
            for (const building of data().buildings || []) {
                if (!Array.isArray(building.footprint)) continue;
                const highlighted = selected?.type === 'building' && selected.id === building.id;
                const shape = L.polygon(T.buildingFootprintRings(building), { renderer: addressRenderer, color: highlighted ? '#ed8936' : '#b8c4cb', weight: highlighted ? 3 : 1, fillColor: highlighted ? '#ed8936' : '#b8c4cb', fillOpacity: highlighted ? .4 : .12, bubblingMouseEvents: false, className: 'network-address-footprint' }).addTo(layer);
                const tooltip = el('span', `${building.address}${building.name ? ' · ' + building.name : ''}`); shape.bindTooltip(tooltip);
                shape.on('click', event => { if (drawing() || tool === 'point') click(event.latlng); else { selected = { type: 'building', id: building.id }; refresh(); } });
                if (highlighted) {
                    const access = T.projectAddress(data(), building, lines()), entrance = building.entrance || building.coordinates;
                    if (access) L.polyline(T.entrancePath(building, access), { color: '#ed8936', weight: 3, dashArray: '4 4', interactive: false, className: 'network-address-approach' }).addTo(layer);
                    for (const [fieldName, point] of [['coordinates', building.coordinates], ['entrance', entrance]]) {
                        const text = el('span', fieldName === 'coordinates' ? String(building.number || '⌂') : '↪');
                        const marker = L.marker(point, { draggable: editable() && !drawing(), keyboard: true, zIndexOffset: 1000, title: `${fieldName === 'coordinates' ? 'Move building' : 'Move entrance'}: ${building.address}`, icon: L.divIcon({ html: text, className: 'network-address-handle', iconSize: [28, 28], iconAnchor: [14, 14] }), bubblingMouseEvents: false }).addTo(layer);
                        marker.on('dragstart', () => { checkpoint('Move building address'); state.geometryDragActive = true; });
                        marker.on('drag', () => { T.updateBuilding(data(), building.id, { [fieldName]: coords(marker.getLatLng()) }, lines()); shape.setLatLngs(T.buildingFootprintRings(building)); });
                        marker.on('dragend', () => { state.geometryDragActive = false; result = null; changed('Building and street access updated.'); refresh(); });
                    }
                }
            }
            for (const line of lines().filter(T.mapped)) {
                if (viewMode !== 'all' && line.travelMode !== viewMode) continue;
                if (!Array.isArray(line.coordinates) || line.coordinates.length < 2) continue;
                const selectedLink = selected?.type === 'link' && selected.id === line.id;
                const shape = L.polyline(T.visibleSegments(line), {
                    color: T.modes[line.travelMode]?.color || '#999', weight: selectedLink ? 7 : 4, opacity: .9,
                    dashArray: line.travelServiceStatus === 'closed' ? '2 6' : ['sail', 'ferry'].includes(line.travelMode) ? '7 7' : null,
                    className: 'editor-network-link', bubblingMouseEvents: false
                }).addTo(layer);
                const text = el('span', `${line.name || T.modes[line.travelMode]?.label}${line.travelOneWay ? ' → one way' : ''}`);
                shape.bindTooltip(text);
                shape.on('click', event => { if (drawing() || tool === 'point') click(event.latlng); else { selected = { type: 'link', id: line.id }; refresh(); } });
                displayed.set(line, shape);
                if (selectedLink && !drawing() && editable()) line.coordinates.slice(1, -1).forEach((point, index) => {
                    // Dense sampled curves are reshaped using the existing feature editor.
                    if (line.bezier) return;
                    const marker = L.marker(point, { draggable: true, icon: L.divIcon({ className: 'network-bend', iconSize: [12, 12] }), title: `Move bend ${index + 1}` }).addTo(layer);
                    marker.on('dragstart', () => { checkpoint('Move travel link bend'); state.geometryDragActive = true; });
                    marker.on('drag', () => { line.coordinates[index + 1] = coords(marker.getLatLng()); shape.setLatLngs(T.visibleSegments(line)); });
                    marker.on('dragend', () => { T.refreshBuildingAccess(data(), [line]); state.geometryDragActive = false; result = null; changed('Travel link reshaped.'); refresh(); });
                });
            }
            const connectionPoints = nodes(), compactJunctions = connectionPoints.length > 100;
            for (const node of connectionPoints) {
                if (compactJunctions && node.kind === 'junction' && selected?.id !== node.id) {
                    // A city can have thousands of internal junctions. Keep them
                    // clickable without creating a permanent DOM label per point;
                    // selecting one restores the draggable, keyboard-enabled handle.
                    const dot = L.circleMarker(node.coordinates, { renderer: addressRenderer, radius: 4,
                        color: '#b8c4cb', fillColor: '#b8c4cb', fillOpacity: .9, weight: 1,
                        bubblingMouseEvents: false }).addTo(layer);
                    dot.bindTooltip(el('span', node.name));
                    dot.on('click', () => selectNode(node));
                    continue;
                }
                const icon = el('span', { junction: '●', town: '◆', station: '▣', port: '⚓' }[node.kind] || '●');
                const marker = L.marker(node.coordinates, { draggable: editable() && !drawing() && tool !== 'point', keyboard: true,
                    title: `${node.name} (${T.nodeKinds[node.kind]})`, alt: node.name, bubblingMouseEvents: false,
                    icon: L.divIcon({ html: icon, className: `network-node${selected?.id === node.id ? ' selected' : ''}`, iconSize: [26, 26], iconAnchor: [13, 13] }) }).addTo(layer);
                marker.getElement().setAttribute('aria-label', `${node.name} (${T.nodeKinds[node.kind]})`);
                const label = el('span', node.name); marker.bindTooltip(label, { direction: 'top', permanent: true, className: 'network-node-label', offset: [0, -12] });
                marker.on('click', () => selectNode(node));
                marker.on('dragstart', () => { checkpoint('Move travel connection point'); state.geometryDragActive = true; });
                marker.on('drag', () => {
                    T.updateNode(data(), node.id, { coordinates: coords(marker.getLatLng()) }, lines(), resample);
                    displayed.forEach((shape, line) => shape.setLatLngs(line.coordinates));
                });
                marker.on('dragend', () => { state.geometryDragActive = false; result = null; selected = { type: 'node', id: node.id }; changed('Connection point and attached links moved.'); refresh(); });
            }
            if (drawing() && state.draftCoordinates.length) {
                L.polyline(state.draftCoordinates, { color: '#ed8936', weight: 4, dashArray: '6 5', interactive: false }).addTo(layer);
                state.draftCoordinates.forEach(point => L.circleMarker(point, { radius: 5, color: '#ed8936', interactive: false }).addTo(layer));
            }
            if (result) result.legs.forEach(leg => L.polyline(T.visibleSegments(leg.line, leg.coordinates), { color: '#ff6434', weight: 8, opacity: .8, interactive: false, className: 'network-preview-route' }).addTo(previewLayer));
        }
        function renderSelection(parent) {
            const node = selected?.type === 'node' ? nodes().find(node => node.id === selected.id) : null;
            const line = selected?.type === 'link' ? lines().find(line => line.id === selected.id) : null;
            const building = selected?.type === 'building' ? (data().buildings || []).find(item => item.id === selected.id) : null;
            if ((!node && !line && !building) || drawing()) return;
            const section = el('section', '', 'network-selection'); parent.append(section);
            section.append(el('h3', building ? 'Building address' : node ? 'Connection point' : 'Transport link'));
            if (building) {
                const update = changes => commit('Edit building address', () => T.updateBuilding(data(), building.id, changes, lines()));
                field(section, 'Full address', building.address, { key: 'building-address', change: value => update({ address: value.trim() }) });
                field(section, 'House number', building.number, { key: 'building-number', change: value => { if (!value.trim()) throw new Error('Enter a house number.'); update({ number: value.trim() }); } });
                field(section, 'Building name', building.name, { key: 'building-name', change: value => update({ name: value.trim() }) });
                field(section, 'Address aliases (separate with ;)', (building.aliases || []).join('; '), { key: 'building-aliases', change: value => update({ aliases: value.split(';').map(name => name.trim()).filter(Boolean) }) });
                for (const [property, title] of [['coordinates', 'Building'], ['entrance', 'Entrance']]) {
                    const coordinates = building[property] || building.coordinates;
                    for (const [axis, axisName] of [[0, 'Y'], [1, 'X']]) field(section, `${title} ${axisName}`, coordinates[axis], { key: `building-${property}-${axis}`, type: 'number', min: -Infinity, change: value => { if (value === '' || !Number.isFinite(Number(value))) throw new Error('Enter a valid coordinate.'); const next = [...(building[property] || building.coordinates)]; next[axis] = Number(value); update({ [property]: next }); } });
                }
                const corners = el('details'); corners.append(el('summary', 'Footprint corners')); section.append(corners);
                field(corners, 'Footprint corners (X, Y per line)', (building.footprint || []).map(point => `${point[1]}, ${point[0]}`).join('\n'), { key: 'building-footprint', multiline: true, change: value => {
                    const footprint = value.trim().split(/\n/).map(row => { const values = row.trim().split(/[\s,]+/).map(Number); if (values.length !== 2 || !values.every(Number.isFinite)) throw new Error('Enter one X, Y coordinate pair per line.'); return [values[1], values[0]]; }); update({ footprint });
                } });
                const courtyards = el('details'); courtyards.append(el('summary', 'Open courtyards')); section.append(courtyards);
                field(courtyards, 'Courtyard corners (X, Y; blank line between courtyards)', (building.footprintHoles || []).map(ring => ring.map(point => `${point[1]}, ${point[0]}`).join('\n')).join('\n\n'), { key: 'building-courtyards', multiline: true, change: value => {
                    const footprintHoles = value.trim() ? value.trim().split(/\n\s*\n/).map(ring => ring.split(/\n/).map(row => { const values = row.trim().split(/[\s,]+/).map(Number); if (values.length !== 2 || !values.every(Number.isFinite)) throw new Error('Enter one X, Y coordinate pair per line.'); return [values[1], values[0]]; })) : [];
                    update({ footprintHoles });
                } });
                courtyards.append(el('small', 'Open space inside a connected roof stays outside the building. Leave blank for a roof without courtyards.'));
                const roadChoices = lines().filter(line => ['road', 'trail'].includes(line.travelMode)).map(line => [line.id, line.name || line.id]);
                field(section, 'Access street segment', building.access?.lineId, { key: 'building-access-line', choices: roadChoices, change: lineId => {
                    const street = lines().find(line => line.id === lineId), projection = T.projectPoint(building.entrance || building.coordinates, street);
                    update({ streetId: street.streetId || building.streetId, access: { ...building.access, lineId, coordinates: projection.coordinates, path: undefined } });
                } });
                const approach = el('details'); approach.append(el('summary', 'Entrance walking path')); section.append(approach);
                field(approach, 'Entrance walking path (X, Y per line)', (building.access?.path || []).map(point => `${point[1]}, ${point[0]}`).join('\n'), { key: 'building-access-path', multiline: true, change: value => {
                    const path = value.trim() ? value.trim().split(/\n/).map(row => { const values = row.trim().split(/[\s,]+/).map(Number); if (values.length !== 2 || !values.every(Number.isFinite)) throw new Error('Enter one X, Y coordinate pair per line.'); return [values[1], values[0]]; }) : undefined;
                    update({ access: { ...building.access, path } });
                } });
                approach.append(el('small', 'Start at the entrance and end at the street access point. Leave blank for a straight walk. Moving the roof, entrance or street clears this path.'));
                const access = T.projectAddress(data(), building, lines());
                section.append(el('p', access ? `Street access: ${Math.round(T.projectPoint(building.entrance || building.coordinates, access.line).distance * data().scaleKilometers / data().scalePixels * 1000)} m from entrance.` : 'No street access.'));
                section.append(el('small', 'Drag the number to move the building and footprint together. Drag ↪ to move its entrance. Street access recalculates after a move.'));
                button(section, 'Use as journey start', () => { const input = panel.querySelector('#network-test-from'); if (input) { input.value = building.address; input.dispatchEvent(new Event('change', { bubbles: true })); panel.querySelector('.network-preview').open = true; } });
                button(section, 'Use as journey destination', () => { const input = panel.querySelector('#network-test-to'); if (input) { input.value = building.address; input.dispatchEvent(new Event('change', { bubbles: true })); panel.querySelector('.network-preview').open = true; } });
                button(section, 'Delete address', () => commit('Delete building address', () => { T.removeBuilding(data(), building.id); selected = null; }), !editable());
            } else if (node) {
                const update = changes => commit('Edit travel connection point', () => T.updateNode(data(), node.id, changes, lines(), resample));
                field(section, 'Point name', node.name, { key: 'node-name', change: value => update({ name: value.trim() }) });
                field(section, 'Point kind', node.kind, { key: 'node-kind', choices: Object.entries(T.nodeKinds), change: kind => update({ kind }) });
                button(section, 'Connect from here', () => startLink(node), !editable());
                const attached = lines().filter(line => ['travelFrom', 'travelTo'].some(field => line[`${field}Node`] === node.id || (!line[`${field}Node`] && String(line[field]).trim().toLowerCase() === node.name.toLowerCase())));
                section.append(el('p', `${attached.length} attached link${attached.length === 1 ? '' : 's'}. Drag this point to move them together.`));
                button(section, 'Delete connection point', () => commit('Delete travel connection point', () => {
                    T.ensureNodes(data(), lines()); data().travelNodes = data().travelNodes.filter(item => item.id !== node.id); selected = null;
                }), !editable() || attached.length > 0);
                if (attached.length) section.append(el('small', 'Delete attached links before deleting this point.'));
            } else {
                const update = (key, value) => commit('Edit travel link', () => { if (value === undefined) delete line[key]; else line[key] = value; });
                field(section, 'Link name', line.name, { key: 'link-name', change: value => update('name', value) });
                for (const [key, label] of [['travelFrom', 'From point'], ['travelTo', 'To point']]) {
                    const selectedId = line[`${key}Node`] || `legacy:${String(line[key]).trim().toLowerCase()}`;
                    field(section, label, selectedId, { key, choices: nodes().map(node => [node.id, node.name]), change: id => {
                        const other = key === 'travelFrom' ? 'travelTo' : 'travelFrom';
                        if (id === (line[`${other}Node`] || `legacy:${String(line[other]).trim().toLowerCase()}`)) throw new Error('Choose two different connection points.');
                        commit('Reconnect travel link', () => { T.ensureNodes(data(), lines()); T.attach(line, key, data().travelNodes.find(node => node.id === id)); if (line.bezier) line.coordinates = resample(line.bezier.anchors, line.bezier.handles, false); T.refreshBuildingAccess(data(), [line]); });
                    } });
                }
                field(section, 'Transport mode', line.travelMode, { key: 'link-mode', choices: Object.entries(T.modes).map(([id, mode]) => [id, mode.label]), change: value => { if (!['road', 'trail'].includes(value) && (data().buildings || []).some(building => building.access?.lineId === line.id)) throw new Error('Move attached addresses to another street before changing this transport mode.'); update('travelMode', value); } });
                field(section, 'Service status', line.travelServiceStatus || 'available', { key: 'service-status', choices: [['available', 'Available'], ['proposed', 'Proposed'], ['closed', 'Closed']], change: value => update('travelServiceStatus', value) });
                for (const [key, label] of [['travelSpeedKph', 'Speed (km/h)'], ['travelFareGp', 'Fare or toll (gp)'], ['travelCostPerKmGp', 'Additional fare (gp/km)'], ['travelDelayHours', 'Wait or boarding time (hours)']]) {
                    field(section, label, line[key], { key, type: 'number', min: key === 'travelSpeedKph' ? .01 : 0, change: value => {
                        if (key === 'travelSpeedKph' && !value) throw new Error('Enter a speed greater than zero.');
                        update(key, value === '' ? undefined : Number(value));
                    } });
                }
                section.append(el('small', 'Fares and waits apply per link. Blank fare means unknown; 0 means free. Speeds are editable estimates.'));
                field(section, 'One way: from → to', line.travelOneWay, { key: 'one-way', type: 'checkbox', change: value => update('travelOneWay', value) });
                field(section, 'Visible on the public map', line.travelVisible, { key: 'visible', type: 'checkbox', change: value => update('travelVisible', value) });
                section.append(el('small', 'Hidden links still work for directions. All links are visible here.'));
                button(section, 'Delete transport link', () => commit('Delete travel link', () => { lines().splice(lines().indexOf(line), 1); selected = null; }), !editable() || (data().buildings || []).some(building => building.access?.lineId === line.id));
                if ((data().buildings || []).some(building => building.access?.lineId === line.id)) section.append(el('small', 'Move attached addresses to another street before deleting this link.'));
            }
        }
        function renderPreview(parent) {
            const details = el('details', '', 'network-preview'), summary = el('summary', 'Test a journey'); details.append(summary); parent.append(details);
            const graph = T.build(data(), lines()), choices = [...graph.nodes.values()].filter(node => graph.addresses.entries.length ? node.building || node.kind === 'landmark' : !node.virtual).map(node => [node.id, node.name]);
            if (graph.errors.length) { details.append(el('p', graph.errors[0])); return; }
            if (choices.length < 2) { details.append(el('p', 'Add at least two connection points to test directions.')); return; }
            const addressField = (label, id, defaultValue) => {
                const control = T.createAddressInput({ document, label, id, choices: choices.map(([value, label]) => ({ value, label })), value: defaultValue }); details.append(control.wrap); return control.input;
            };
            const from = addressField('Start', 'network-test-from', '');
            const to = addressField('Destination', 'network-test-to', '');
            const preference = field(details, 'Prefer', 'fastest', { id: 'network-test-preference', choices: [['fastest', 'Fastest'], ['cheapest', 'Cheapest known fare'], ['shortest', 'Shortest distance']], edit: false });
            const output = el('p', '', 'network-test-result'); output.setAttribute('role', 'status');
            const clear = () => { result = null; output.textContent = ''; previewLayer.clearLayers(); };
            [from, to, preference].forEach(control => control.addEventListener('change', clear));
            button(details, 'Calculate journey', () => {
                result = T.route(graph, from.value, to.value, { preference: preference.value });
                const format = value => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
                output.textContent = result ? `${result.km < 1 ? format(result.km * 1000) + ' m' : format(result.km) + ' km'} · ${result.hours < 1 ? format(result.hours * 60) + ' min' : format(result.hours) + ' hours'} · ${result.cost === null ? 'Fare unknown' : format(result.cost) + ' gp'}${result.legs.length ? ' — ' + result.legs.map(leg => leg.line.name).join(' → ') : ''}` : 'No connected route between these points.';
                renderMap();
            });
            button(details, 'Clear journey', clear); details.append(output);
        }
        function refresh() {
            panel.hidden = !isOpen();
            if (!data() || !isOpen()) { layer.clearLayers(); previewLayer.clearLayers(); return; }
            if (mapId !== state.currentMapId) { viewMode = 'all'; mapId = state.currentMapId; selected = null; tool = 'select'; result = null; }
            if (drawing()) tool = state.networkTool === 'address' ? 'address' : 'connect';
            const previousDetails = new Map([...panel.querySelectorAll('details')].map(item => [item.querySelector('summary')?.textContent, item.open]));
            panel.replaceChildren();
            const overview = T.overview(data(), lines()), inventory = el('section', '', 'network-overview');
            inventory.append(el('h3', 'Connections'), el('p', `${nodes().length.toLocaleString()} points · ${overview.links.toLocaleString()} links${data().buildings?.length ? ' · ' + data().buildings.length.toLocaleString() + ' addresses' : ''}`, 'network-count'));
            const filters = el('div', '', 'network-mode-filters'); filters.setAttribute('aria-label', 'Network display filters');
            const all = button(filters, 'All modes', () => { viewMode = 'all'; refresh(); }); all.setAttribute('aria-pressed', String(viewMode === 'all'));
            overview.modes.filter(item => item.count).forEach(item => { const control = button(filters, `${item.label} · ${item.count}`, () => { viewMode = item.id; refresh(); }); control.setAttribute('aria-pressed', String(viewMode === item.id)); control.style.setProperty('--transport-color', item.color); });
            inventory.append(filters);
            if (overview.proposed) inventory.append(el('p', `${overview.proposed} proposed links. Review their placement and service before adopting them in the setting.`, 'network-review-note'));
            if (overview.closed) inventory.append(el('p', `${overview.closed} closed links are visible for editing and excluded from directions.`, 'network-review-note'));
            if (data().scaleReview?.status === 'provisional') inventory.append(el('p', data().scaleReview.note, 'network-review-note'));
            panel.append(inventory);
            const toolbar = el('div', '', 'network-tools'); panel.append(toolbar);
            button(toolbar, 'Select / move', () => { if (drawing()) cancel(); tool = 'select'; refresh(); }, !editable()).setAttribute('aria-pressed', String(tool === 'select' && !drawing()));
            button(toolbar, 'Add point', () => { if (drawing()) cancel(); tool = 'point'; selected = null; refresh(); }, !editable()).setAttribute('aria-pressed', String(tool === 'point'));
            button(toolbar, 'Draw connection', () => startLink(), !editable()).setAttribute('aria-pressed', String(drawing() && tool === 'connect'));
            button(toolbar, 'Add address', startAddress, !editable() || drawing()).setAttribute('aria-pressed', String(drawing() && tool === 'address'));
            if (tool === 'point') field(panel, 'New point kind', kind, { key: 'new-kind', choices: Object.entries(T.nodeKinds), change: value => { kind = value; } });
            if (drawing()) {
                if (tool !== 'address') field(panel, 'New link mode', mode, { key: 'new-mode', choices: Object.entries(T.modes).map(([id, mode]) => [id, mode.label]), change: value => { mode = value; state.networkMode = value; draftChanged(); } });
                button(toolbar, tool === 'address' ? 'Finish address' : 'Finish connection', finish, state.draftCoordinates.length < 2 || !editable());
                button(toolbar, 'Undo last point', () => { state.draftCoordinates.pop(); draftChanged(); refresh(); }, !state.draftCoordinates.length);
                button(toolbar, tool === 'address' ? 'Cancel address' : 'Cancel connection', cancel);
            }
            if (state.networkMode && drawing() && tool !== 'address') { mode = state.networkMode; panel.querySelector('#network-new-mode').value = mode; }
            const help = drawing() && tool === 'address' ? 'Click two opposite roof corners to add a rectangular footprint. Its address and street entrance are filled in automatically; edit the corners for another roof shape.' : drawing() ? 'Click a start point, add bends, then click another point or link to finish. Finish connection creates a point at an empty end. Nearby points and links snap automatically.'
                : tool === 'point' ? 'Click the map to place a point. Click an existing link to insert a junction and connect a branch. Crossings stay separate until you add a junction.'
                : 'Place connection points, then draw the roads, tracks and waterways between them. Drag a point to move every attached link.';
            panel.append(el('p', help, 'network-help'));
            renderSelection(panel);
            renderPreview(panel);
            const list = el('details'); list.append(el('summary', 'Connection points & links')); panel.append(list);
            const connectionSearch = field(list, 'Find a connection point or link', '', { id: 'network-connection-search', edit: false });
            const connectionMatches = el('div'), connectionCount = el('small'); list.append(connectionCount, connectionMatches);
            const searchConnections = () => {
                connectionMatches.replaceChildren();
                const query = connectionSearch.value.trim().toLocaleLowerCase();
                const entries = [
                    ...nodes().map(node => ({ label: `${T.nodeKinds[node.kind]} · ${node.name}`, action: () => { selectNode(node); map.panTo(node.coordinates); } })),
                    ...lines().filter(T.mapped).map(line => ({ label: `${T.modes[line.travelMode]?.label || 'Link'} · ${line.name || 'Unnamed'}`, action: () => { if (drawing()) return; selected = { type: 'link', id: line.id }; refresh(); map.fitBounds(line.coordinates, { padding: [40, 40], maxZoom: 1 }); } }))
                ].filter(entry => !query || entry.label.toLocaleLowerCase().includes(query));
                connectionCount.textContent = entries.length > 80 ? `Showing 80 of ${entries.length} matches. Type a name to narrow the list.` : `${entries.length} matches`;
                for (const entry of entries.slice(0, 80)) button(connectionMatches, entry.label, entry.action);
            };
            connectionSearch.addEventListener('input', searchConnections);
            list.addEventListener('toggle', () => { if (list.open) searchConnections(); });
            if (data().buildings?.length) {
                const addresses = el('details', '', 'network-address-list'); addresses.append(el('summary', 'Building addresses')); panel.append(addresses);
                const search = field(addresses, 'Find a building address', '', { id: 'network-address-search', edit: false });
                const matches = el('div'); addresses.append(matches); const index = T.addressIndex(data());
                const searchBuildings = () => { matches.replaceChildren(); for (const building of T.searchAddresses(index, search.value)) button(matches, `${building.address}${building.name ? ' · ' + building.name : ''}`, () => { if (drawing()) return; selected = { type: 'building', id: building.id }; refresh(); if (data().buildings.length > 100 && building.footprint?.length) map.fitBounds(building.footprint, { padding: [60, 60], maxZoom: 1, animate: false }); else map.panTo(building.coordinates); }); };
                search.addEventListener('input', searchBuildings); searchBuildings();
            }
            panel.querySelectorAll('details').forEach(item => { item.open = previousDetails.get(item.querySelector('summary')?.textContent) || false; });
            if (list.open) searchConnections();
            renderMap();
        }
        return { refresh, click, finish, cancel, selectBuilding(id) { if (!(data()?.buildings || []).some(building => building.id === id)) return false; selected = { type: 'building', id }; refresh(); return true; }, invalidate() { result = null; }, keydown(event) {
            if (event.key === 'Escape') { cancel(); return true; }
            if (drawing() && event.key === 'Enter') { finish(); return true; }
            if (drawing() && ['Backspace', 'Delete'].includes(event.key)) { state.draftCoordinates.pop(); draftChanged(); refresh(); return true; }
            return false;
        } };
    }
}());
