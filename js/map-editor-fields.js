(function exposeMapEditorFields(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.MapEditorFields = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createMapEditorFields() {
    const mapFields = [
        { key: 'name', label: 'Name', surface: 'overview', section: 'Map identity', required: true, maxLength: 120, help: 'The visitor-facing map name.' },
        {
            key: 'status',
            label: 'Status',
            surface: 'overview',
            section: 'Map identity',
            control: 'select',
            options: [
                { value: '', label: 'Published (default)' },
                { value: 'active', label: 'Active' },
                { value: 'draft', label: 'Draft' },
                { value: 'coming-soon', label: 'Coming soon' },
                { value: 'archived', label: 'Archived' }
            ],
            help: 'Editorial state for this map entry.'
        },
        {
            key: 'visibility',
            label: 'Visibility',
            surface: 'overview',
            section: 'Map identity',
            control: 'select',
            options: [
                { value: '', label: 'Public (default)' },
                { value: 'public', label: 'Public' },
                { value: 'gm', label: 'GM only' }
            ],
            help: 'Choose who can find this map in the atlas.'
        },
        { key: 'group', label: 'Group', surface: 'overview', section: 'Map chooser', maxLength: 120, source: 'group', help: 'Optional map-chooser grouping.' },
        { key: 'selectorDescription', label: 'Map Chooser Summary', surface: 'overview', section: 'Map chooser', control: 'textarea', rows: 4, maxLength: 500, placeholder: 'Short text for the map chooser', help: 'A short description shown on map cards before a visitor opens this map.' },
        { key: 'blurb', label: 'Map Introduction', surface: 'overview', section: 'Map chooser', control: 'textarea', rows: 6, maxLength: 5000, help: 'The longer introduction shown after this map is selected.' },
        { key: 'type', label: 'Type', surface: 'advanced', section: 'Atlas record', maxLength: 60 },
        { key: 'dataUrl', label: 'Data URL', surface: 'advanced', section: 'Atlas record', source: 'dataUrl', readOnly: true, help: 'Authoritative map-data path. Rename files outside the editor with a reviewed migration.' },
        { key: 'parentId', label: 'Parent Folder', surface: 'advanced', section: 'Atlas record', control: 'select', source: 'parentId', persist: false, help: 'Moves this entry in the atlas hierarchy.' },
        { key: 'order', label: 'Order', surface: 'advanced', section: 'Atlas record', control: 'number', min: 0, step: 1, source: 'order', persist: false, help: 'Zero-based position among sibling entries.' },
        { key: 'imageUrl', label: 'Image URL', surface: 'advanced', section: 'Artwork', maxLength: 500 },
        { key: 'mobileImageUrl', label: 'Mobile Image URL', surface: 'advanced', section: 'Artwork', maxLength: 500 },
        { key: 'smallImageUrl', label: 'Small Image URL', surface: 'advanced', section: 'Artwork', maxLength: 500 },
        { key: 'width', label: 'Width', surface: 'advanced', section: 'Canvas size', control: 'number', min: 0, step: 1 },
        { key: 'height', label: 'Height', surface: 'advanced', section: 'Canvas size', control: 'number', min: 0, step: 1 },
        { key: 'scalePixels', label: 'Scale Pixels', surface: 'advanced', section: 'Scale', control: 'number', min: 0, step: 1, help: 'Optional pixel distance used with scale kilometers.' },
        { key: 'scaleKilometers', label: 'Scale Kilometers', surface: 'advanced', section: 'Scale', control: 'number', min: 0, step: 0.01, help: 'Optional real-world distance represented by scale pixels.' },
        { key: 'scaleUnitName', label: 'Scale Unit Name', surface: 'advanced', section: 'Scale', maxLength: 40 },
        { key: 'backgroundColor', label: 'Background Color', surface: 'advanced', section: 'Appearance', maxLength: 40, placeholder: '#0b1522' },
        { key: 'atmosphere', label: 'Atmosphere', surface: 'advanced', section: 'Appearance', maxLength: 80 },
        { key: 'latNorth', label: 'North', surface: 'advanced', control: 'number', step: 'any', path: 'latLonBounds.north', group: 'bounds' },
        { key: 'latSouth', label: 'South', surface: 'advanced', control: 'number', step: 'any', path: 'latLonBounds.south', group: 'bounds' },
        { key: 'latEast', label: 'East', surface: 'advanced', control: 'number', step: 'any', path: 'latLonBounds.east', group: 'bounds' },
        { key: 'latWest', label: 'West', surface: 'advanced', control: 'number', step: 'any', path: 'latLonBounds.west', group: 'bounds' }
    ];

    const commonFeatureFields = [
        { key: 'name', label: 'Name', section: 'Content', required: true, maxLength: 160 },
        { key: 'type', label: 'Type', section: 'Content', maxLength: 80, help: 'The visitor-facing kind of place or feature.' },
        { key: 'summary', label: 'Card Summary', section: 'Content', control: 'textarea', rows: 3, maxLength: 800, help: 'A short description for search results, cards, and quick previews.' },
        { key: 'description', label: 'Full Description', section: 'Content', control: 'textarea', rows: 4, maxLength: 12000, help: 'The complete visitor-facing description shown after opening this feature.' },
        { key: 'wikiLink', label: 'Wiki Link', section: 'Links', maxLength: 1000 },
        { key: 'linkedMapId', label: 'Linked Map ID', section: 'Links', maxLength: 160, help: 'Optional stable ID of a map this feature should open.' }
    ];

    const featureFields = {
        points: [
            commonFeatureFields[0],
            { key: 'pronunciation', label: 'Pronunciation', section: 'Content', maxLength: 240 },
            ...commonFeatureFields.slice(1, 4),
            { key: 'propertiesText', label: 'Key Facts', section: 'Facts and Sections', control: 'textarea', rows: 5, format: 'keyFacts', update: 'keyFacts', placeholder: 'Nation: Commonwealth of Half Height\nKnown for: Trade and white-stone terraces', help: 'One visitor-facing fact per line in Label: value form.' },
            { key: 'tags', label: 'Tags', section: 'Facts and Sections', control: 'textarea', rows: 3, format: 'tags', update: 'tags', placeholder: 'One tag per line, or comma-separated' },
            { key: 'detailSections', label: 'Detail Sections', section: 'Facts and Sections', control: 'detailSections', update: 'detailSections', help: 'Optional titled sections shown in the feature detail view.' },
            ...commonFeatureFields.slice(4),
            { key: 'coordY', label: 'Y', section: 'Position', control: 'number', format: 'coordY', update: 'pointCoordinate', group: 'coordinates' },
            { key: 'coordX', label: 'X', section: 'Position', control: 'number', format: 'coordX', update: 'pointCoordinate', group: 'coordinates' },
            { key: 'properties', label: 'Properties JSON', section: 'Advanced Data', control: 'textarea', rows: 5, format: 'json', update: 'json', advanced: true, help: 'Advanced raw properties. Prefer Key Facts for visitor-facing values.' }
        ],
        regions: [
            ...commonFeatureFields.slice(0, 2),
            { key: 'value', label: 'Value', section: 'Content', maxLength: 160 },
            ...commonFeatureFields.slice(2),
            { key: 'color', label: 'Stroke Color', section: 'Presentation', maxLength: 40, group: 'style' },
            { key: 'fillColor', label: 'Fill Color', section: 'Presentation', maxLength: 40, group: 'style' },
            { key: 'fillOpacity', label: 'Fill Opacity', section: 'Presentation', control: 'number', min: 0, max: 1, step: 0.05, update: 'number', group: 'style' },
            { key: 'coordinates', label: 'Coordinates', section: 'Position', control: 'textarea', rows: 7, format: 'coordinates', update: 'coordinates', className: 'map-editor-coordinates', help: 'One Y, X pair per line; regions require at least three rows. Changing these coordinates replaces Bezier curves with straight segments.' },
            { key: 'id', label: 'ID', section: 'Advanced Data', required: true, maxLength: 160 },
            { key: 'properties', label: 'Properties JSON', section: 'Advanced Data', control: 'textarea', rows: 5, format: 'json', update: 'json', advanced: true }
        ],
        lines: [
            ...commonFeatureFields,
            { key: 'color', label: 'Color', section: 'Presentation', maxLength: 40, group: 'style' },
            { key: 'weight', label: 'Weight', section: 'Presentation', control: 'number', min: 1, step: 1, update: 'number', group: 'style' },
            { key: 'dashArray', label: 'Dash Array', section: 'Presentation', maxLength: 80, group: 'style' },
            { key: 'coordinates', label: 'Coordinates', section: 'Position', control: 'textarea', rows: 7, format: 'coordinates', update: 'coordinates', className: 'map-editor-coordinates', help: 'One Y, X pair per line; lines require at least two rows. Changing these coordinates replaces Bezier curves with straight segments.' },
            { key: 'id', label: 'ID', section: 'Advanced Data', required: true, maxLength: 160 },
            { key: 'properties', label: 'Properties JSON', section: 'Advanced Data', control: 'textarea', rows: 5, format: 'json', update: 'json', advanced: true }
        ]
    };

    function assertDefinition(definition) {
        if (!definition || !String(definition.key || '').trim() || !String(definition.label || '').trim()) {
            throw new Error('Field definitions require a key and label.');
        }
    }

    function registerMapField(definition) {
        assertDefinition(definition);
        if (mapFields.some((field) => field.key === definition.key)) {
            throw new Error(`Map field already exists: ${definition.key}`);
        }
        mapFields.push({ surface: 'advanced', section: 'Other settings', ...definition });
    }

    function registerFeatureField(mode, definition) {
        assertDefinition(definition);
        if (!featureFields[mode]) throw new Error(`Unknown feature mode: ${mode}`);
        if (featureFields[mode].some((field) => field.key === definition.key)) {
            throw new Error(`Feature field already exists for ${mode}: ${definition.key}`);
        }
        featureFields[mode].push({ ...definition });
    }

    function getMapFields(surface) {
        return mapFields.filter((field) => !surface || field.surface === surface);
    }

    function getFeatureFields(mode) {
        return featureFields[mode] || [];
    }

    function getPathValue(source, fieldPath) {
        return String(fieldPath || '').split('.').reduce((value, key) => value?.[key], source);
    }

    function setPathValue(target, fieldPath, value) {
        const keys = String(fieldPath || '').split('.').filter(Boolean);
        let cursor = target;
        keys.forEach((key, index) => {
            if (index === keys.length - 1) {
                cursor[key] = value;
            } else {
                if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
                cursor = cursor[key];
            }
        });
    }

    function getMapFieldValue(field, map, context = {}) {
        if (field.source === 'group') return map?.group ?? map?.category ?? '';
        if (field.source === 'dataUrl') return map?.dataUrl || context.currentMapDataUrl || '';
        if (field.source === 'order') return context.currentLocation?.index ?? 0;
        if (field.source === 'parentId') return context.currentLocation?.parentId || '';
        return getPathValue(map, field.path || field.key) ?? '';
    }

    function getMapFieldValues(map, context = {}) {
        return Object.fromEntries(mapFields.map((field) => [field.key, getMapFieldValue(field, map, context)]));
    }

    function readMapForm(inputs) {
        const result = {};
        mapFields.filter((field) => field.persist !== false).forEach((field) => {
            const input = inputs[field.key];
            if (!input) return;
            setPathValue(result, field.path || field.key, input.value);
        });
        return result;
    }

    function validateValue(field, value) {
        const text = String(value ?? '');
        if (field.required && !text.trim()) return `${field.label} is required.`;
        if (field.maxLength && text.length > field.maxLength) return `${field.label} must be ${field.maxLength} characters or fewer.`;
        if (field.control === 'number' && text !== '') {
            const number = Number(text);
            if (!Number.isFinite(number)) return `${field.label} must be a number.`;
            if (field.min !== undefined && number < field.min) return `${field.label} must be at least ${field.min}.`;
            if (field.max !== undefined && number > field.max) return `${field.label} must be at most ${field.max}.`;
        }
        return '';
    }

    function applyControlAttributes(control, field, id) {
        control.id = id;
        control.name = field.key;
        control.dataset.field = field.key;
        if (field.className) control.className = field.className;
        if (field.placeholder) control.placeholder = field.placeholder;
        if (field.rows) control.rows = field.rows;
        if (field.required) control.required = true;
        if (field.readOnly) control.readOnly = true;
        ['min', 'max', 'step', 'maxLength'].forEach((attribute) => {
            if (field[attribute] !== undefined) control[attribute] = field[attribute];
        });
    }

    function createStandardField(document, field, idPrefix) {
        const label = document.createElement('label');
        const labelText = document.createElement('span');
        labelText.className = 'map-editor-field-label';
        labelText.textContent = field.label;
        label.appendChild(labelText);

        if (field.help) {
            const help = document.createElement('span');
            help.className = 'map-editor-field-help';
            help.id = `${idPrefix}-${field.key}-help`;
            help.textContent = field.help;
            label.appendChild(help);
        }

        const control = document.createElement(
            field.control === 'textarea' ? 'textarea' : (field.control === 'select' ? 'select' : 'input')
        );
        if (control.tagName === 'INPUT') control.type = field.control === 'number' ? 'number' : 'text';
        if (control.tagName === 'SELECT' && Array.isArray(field.options)) {
            field.options.forEach((option) => {
                const optionElement = document.createElement('option');
                optionElement.value = option.value;
                optionElement.textContent = option.label;
                control.appendChild(optionElement);
            });
        }
        applyControlAttributes(control, field, `${idPrefix}-${field.key}`);
        if (field.help) control.setAttribute('aria-describedby', `${idPrefix}-${field.key}-help`);
        label.appendChild(control);
        return { control, element: label };
    }

    function createDetailSectionsField(document, field, idPrefix) {
        const fieldset = document.createElement('fieldset');
        fieldset.className = 'map-editor-detail-sections';
        fieldset.dataset.field = field.key;
        const legend = document.createElement('legend');
        legend.textContent = field.label;
        fieldset.appendChild(legend);
        if (field.help) {
            const help = document.createElement('p');
            help.className = 'map-editor-field-help';
            help.textContent = field.help;
            fieldset.appendChild(help);
        }
        const empty = document.createElement('p');
        empty.className = 'map-editor-detail-section-empty';
        empty.dataset.detailSectionEmpty = '';
        empty.textContent = 'No detail sections yet.';
        fieldset.appendChild(empty);
        const list = document.createElement('div');
        list.className = 'map-editor-detail-section-list';
        list.dataset.detailSectionList = '';
        fieldset.appendChild(list);
        const addButton = document.createElement('button');
        addButton.type = 'button';
        addButton.className = 'map-editor-detail-section-add';
        addButton.dataset.action = 'add-detail-section';
        addButton.textContent = 'Add Detail Section';
        fieldset.appendChild(addButton);
        return { control: null, element: fieldset, idPrefix };
    }

    function createAdvancedField(document, field, idPrefix) {
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = 'Advanced properties JSON';
        details.appendChild(summary);
        const rendered = createStandardField(document, field, idPrefix);
        details.appendChild(rendered.element);
        return { control: rendered.control, element: details };
    }

    function appendRenderedFields(document, container, definitions, idPrefix) {
        let currentGroup = '';
        let currentSection = '';
        let groupContainer = null;
        definitions.forEach((field) => {
            if (field.section && field.section !== currentSection) {
                currentSection = field.section;
                currentGroup = '';
                groupContainer = null;
                const heading = document.createElement('h3');
                heading.className = 'map-editor-property-section-title';
                heading.textContent = field.section;
                container.appendChild(heading);
            }
            if (field.group && field.group !== currentGroup) {
                currentGroup = field.group;
                groupContainer = document.createElement('div');
                groupContainer.className = 'map-editor-form-grid';
                groupContainer.dataset.fieldGroup = field.group;
                container.appendChild(groupContainer);
            } else if (!field.group) {
                currentGroup = '';
                groupContainer = null;
            }
            const rendered = field.control === 'detailSections'
                ? createDetailSectionsField(document, field, idPrefix)
                : (field.advanced
                    ? createAdvancedField(document, field, idPrefix)
                    : createStandardField(document, field, idPrefix));
            (groupContainer || container).appendChild(rendered.element);
        });
    }

    function renderMapFields(document) {
        ['overview', 'advanced'].forEach((surface) => {
            const container = document.querySelector(`[data-map-field-surface="${surface}"]`);
            if (!container) return;
            container.innerHTML = '';
            const definitions = getMapFields(surface);
            const bounds = definitions.filter((field) => field.group === 'bounds');
            const regular = definitions.filter((field) => field.group !== 'bounds');
            if (surface === 'advanced') {
                [...new Set(regular.map(field => field.section))].forEach(section => {
                    const details = document.createElement('details');
                    details.className = 'dm-settings-section';
                    details.setAttribute('aria-disabled', 'false');
                    const summary = document.createElement('summary');
                    summary.textContent = section || 'Other settings';
                    details.appendChild(summary);
                    appendRenderedFields(document, details, regular.filter(field => field.section === section), 'map');
                    container.appendChild(details);
                });
            } else appendRenderedFields(document, container, regular, 'map');
            if (bounds.length > 0) {
                const fieldset = document.createElement('fieldset');
                fieldset.className = 'map-editor-coordinate-fieldset';
                const legend = document.createElement('legend');
                legend.textContent = 'Geographic bounds';
                fieldset.appendChild(legend);
                const help = document.createElement('p');
                help.className = 'map-editor-field-help';
                help.textContent = 'Optional latitude and longitude calibration for coordinate display.';
                fieldset.appendChild(help);
                const grid = document.createElement('div');
                grid.className = 'map-editor-form-grid';
                fieldset.appendChild(grid);
                appendRenderedFields(document, grid, bounds.map((field) => ({ ...field, group: '' })), 'map');
                const calibration = document.createElement('details');
                calibration.className = 'dm-settings-section';
                calibration.setAttribute('aria-disabled', 'false');
                const summary = document.createElement('summary');
                summary.textContent = 'Geographic calibration';
                calibration.append(summary, fieldset);
                container.appendChild(calibration);
            }
        });
    }

    function collectMapInputs(document) {
        return Object.fromEntries(mapFields.map((field) => [field.key, document.getElementById(`map-${field.key}`)]));
    }

    function getFeatureFieldValue(field, feature, formatters = {}) {
        if (field.format === 'keyFacts') return formatters.stringifyKeyFacts(feature?.properties || {});
        if (field.format === 'tags') return formatters.stringifyTags(feature?.tags || []);
        if (field.format === 'coordinates') return formatters.stringifyCoordinates(feature?.coordinates || []);
        if (field.format === 'json') return JSON.stringify(feature?.properties || {}, null, 2);
        if (field.format === 'coordY') return feature?.coords?.[0] ?? '';
        if (field.format === 'coordX') return feature?.coords?.[1] ?? '';
        return feature?.[field.key] ?? '';
    }

    function renderFeatureFields(document, form, mode, feature, formatters = {}) {
        const definitions = getFeatureFields(mode);
        form.innerHTML = '';
        const sectionOrder = [];
        const sectionFields = new Map();
        definitions.forEach((field) => {
            const section = field.section || 'Other';
            if (!sectionFields.has(section)) {
                sectionOrder.push(section);
                sectionFields.set(section, []);
            }
            sectionFields.get(section).push(field);
        });
        sectionOrder.forEach((section, index) => {
            const details = document.createElement('details');
            details.className = 'map-editor-feature-section';
            details.dataset.featureSection = section.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            details.open = index === 0;
            const summary = document.createElement('summary');
            summary.textContent = section;
            details.appendChild(summary);
            const sectionBody = document.createElement('div');
            sectionBody.className = 'map-editor-feature-section-body';
            appendRenderedFields(
                document,
                sectionBody,
                sectionFields.get(section).map((field) => ({ ...field, section: '' })),
                `feature-${mode}`
            );
            details.appendChild(sectionBody);
            form.appendChild(details);
        });
        definitions.forEach((field) => {
            const control = form.querySelector(`[data-field="${field.key}"]`);
            if (control && field.control !== 'detailSections') {
                control.value = getFeatureFieldValue(field, feature, formatters);
            }
        });
        return definitions;
    }

    return {
        collectMapInputs,
        getFeatureFieldValue,
        getFeatureFields,
        getMapFieldValue,
        getMapFieldValues,
        getMapFields,
        readMapForm,
        registerFeatureField,
        registerMapField,
        renderFeatureFields,
        renderMapFields,
        validateValue
    };
}));
