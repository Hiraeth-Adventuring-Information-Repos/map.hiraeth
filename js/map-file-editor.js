(function () {
    'use strict';
    const shell = document.getElementById('map-editor-app');
    if (!shell) return;
    let installed = false;
    let lastMode = '';
    function install() {
        if (installed || shell.dataset.fileMode !== 'true') return;
        installed = true;
        const byId = (id) => document.getElementById(id);
        const toolbar = shell.querySelector('.map-editor-toolbar-group');
        const action = (label, target, className = 'file-editor-action') => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = className;
            button.textContent = label;
            button.addEventListener('click', () => byId(target)?.click());
            return button;
        };
        byId('editor-collapse-inspector-btn').addEventListener('click', () => {
            const canvas = byId('editor-map');
            canvas.tabIndex = -1;
            canvas.focus({ preventScroll: true });
        });
        byId('editor-choose-map-btn').textContent = 'Maps';
        byId('editor-add-poi-btn').textContent = '+ Place';
        byId('editor-add-region-btn').textContent = '+ Region';
        byId('editor-add-line-btn').textContent = '+ Line';
        const features = action('Features', 'editor-edit-points-btn');
        const settings = action('Settings', 'editor-edit-map-details-btn');
        const setup = action('Artwork & scale', 'editor-edit-map-advanced-btn');
        toolbar.append(features);
        const more = document.createElement('details');
        more.className = 'file-editor-more';
        const summary = document.createElement('summary');
        summary.textContent = '•••';
        summary.setAttribute('aria-label', 'More editor options');
        const options = document.createElement('div');
        options.className = 'file-editor-options';
        const theme = shell.querySelector('[data-dm-theme]');
        theme.textContent = 'Light / dark theme';
        options.append(settings, setup, byId('editor-export-btn'), theme);
        const help = document.createElement('p');
        help.textContent = 'Click a feature to edit. Drag markers or orange corners to move them. Download changes keeps a local copy; server files stay unchanged.';
        options.append(help);
        const fileHelp = document.createElement('a');
        fileHelp.href = '/studio?help=1';
        fileHelp.textContent = 'Files and publishing';
        options.append(fileHelp);
        more.append(summary, options);
        shell.querySelector('.map-editor-appbar').append(more);
        options.addEventListener('click', (event) => {
            if (event.target.closest('button')) more.open = false;
        });
        more.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') { more.open = false; summary.focus(); }
        });
        const reopen = action('Edit details', 'editor-toggle-inspector-btn', 'file-editor-reopen');
        toolbar.append(reopen);
        const panelActions = document.createElement('div');
        panelActions.className = 'file-editor-panel-actions';
        const geometry = action('Edit on map', 'editor-collapse-inspector-btn', 'file-editor-geometry');
        geometry.title = 'Close the form to move the selected place or drag shape vertices';
        const remove = action('Delete feature', 'editor-delete-selection-btn', 'map-editor-danger-action');
        panelActions.append(geometry, remove);
        shell.querySelector('.map-editor-inspector-chrome').append(panelActions);
        function sync() {
            const mode = shell.dataset.mode;
            const selected = mode === 'feature-edit';
            panelActions.hidden = !selected;
            reopen.hidden = !selected;
            features.hidden = selected;
            features.disabled = byId('editor-add-poi-btn').disabled;
            settings.disabled = byId('editor-edit-map-details-btn').disabled;
            setup.disabled = byId('editor-edit-map-advanced-btn').disabled;
            // Existing controls own state changes, focus, unsaved guards and Leaflet resize.
            if (lastMode === 'library' && mode === 'map-details') byId('editor-collapse-inspector-btn').click();
            lastMode = mode;
        }
        sync();
        new MutationObserver(sync).observe(shell, { attributes: true, attributeFilter: ['data-mode', 'data-loading', 'data-access'] });
    }
    install();
    if (!installed) new MutationObserver(install).observe(shell, { attributes: true, attributeFilter: ['data-file-mode'] });
})();
