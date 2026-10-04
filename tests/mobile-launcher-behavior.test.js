const assert = require('node:assert/strict');
const fs = require('node:fs');

const appSource = fs.readFileSync('js/app.js', 'utf8');

function extractFunctionRange(startMarker, endMarker) {
    const start = appSource.indexOf(startMarker);
    if (start === -1) {
        throw new Error(`Could not find start marker: ${startMarker}`);
    }
    const end = endMarker ? appSource.indexOf(endMarker, start) : appSource.length;
    if (end === -1) {
        throw new Error(`Could not find end marker: ${endMarker}`);
    }
    return appSource.slice(start, end);
}

// eslint-disable-next-line no-eval
eval(extractFunctionRange('function hasVisibleMobileToolAction(', 'function markControlTouch('));

global.MOBILE_SURFACE_MODE_ATLAS = 'atlas';
global.MOBILE_SURFACE_MODE_SEARCH = 'search';
global.MOBILE_SURFACE_MODE_TOOLS = 'tools';
global.mobileSurfaceMode = null;
global.isMobileSurfaceMode = (mode) => global.mobileSurfaceMode === mode;
global.isMobileLayoutActive = true;
global.isEmbeddedView = false;
global.refreshLucideIcons = () => {};
global.searchControlContainer = { style: { display: 'block' } };
global.mobileMarkersBtn = { hidden: false };
global.mobileFiltersBtn = { hidden: false };
global.mobileDirectionsBtn = { hidden: false };
global.mobileMeasureBtn = { hidden: false };
global.mobileSoundBtn = { hidden: false };
global.mobileShareViewBtn = { hidden: false };
global.mobileCoordsBtn = { hidden: false };
global.mobileHelpBtn = { hidden: false };
global.mobileGmViewBtn = null;
global.mobileToolkitBtn = null;
global.mobileDock = {
    hidden: false
};
global.mobileSheetLauncherBtn = {
    hidden: false,
    innerHTML: '',
    attrs: {},
    classes: new Set(),
    classList: {
        toggle(name, active) {
            if (active) global.mobileSheetLauncherBtn.classes.add(name);
            else global.mobileSheetLauncherBtn.classes.delete(name);
        }
    },
    setAttribute(name, value) {
        this.attrs[name] = value;
    }
};
global.mobileSearchLauncherBtn = {
    hidden: false,
    innerHTML: '',
    attrs: {},
    classes: new Set(),
    classList: {
        toggle(name, active) {
            if (active) global.mobileSearchLauncherBtn.classes.add(name);
            else global.mobileSearchLauncherBtn.classes.delete(name);
        }
    },
    setAttribute(name, value) {
        this.attrs[name] = value;
    }
};
global.mobileToolsLauncherBtn = {
    hidden: false,
    innerHTML: '',
    attrs: {},
    classes: new Set(),
    classList: {
        toggle(name, active) {
            if (active) global.mobileToolsLauncherBtn.classes.add(name);
            else global.mobileToolsLauncherBtn.classes.delete(name);
        }
    },
    setAttribute(name, value) {
        this.attrs[name] = value;
    }
};
global.mobileInfoHelpBtn = {
    hidden: false
};

syncMobileDockState();
assert.equal(global.mobileDock.hidden, false);
assert.equal(global.mobileSheetLauncherBtn.hidden, false);
assert.equal(global.mobileSearchLauncherBtn.hidden, false);
assert.equal(global.mobileSheetLauncherBtn.attrs['aria-label'], 'Open atlas');
assert.equal(global.mobileSheetLauncherBtn.attrs['aria-pressed'], 'false');
assert.equal(global.mobileSheetLauncherBtn.attrs['aria-expanded'], 'false');
assert.equal(global.mobileSearchLauncherBtn.attrs['aria-label'], 'Open search');
assert.equal(global.mobileSearchLauncherBtn.attrs['aria-pressed'], 'false');
assert.equal(global.mobileSearchLauncherBtn.attrs['aria-expanded'], 'false');
assert.equal(global.mobileToolsLauncherBtn.attrs['aria-label'], 'Open tools');
assert.equal(global.mobileToolsLauncherBtn.attrs['aria-pressed'], 'false');
assert.equal(global.mobileToolsLauncherBtn.attrs['aria-expanded'], 'false');
assert.match(global.mobileSheetLauncherBtn.innerHTML, /Atlas/);
assert.match(global.mobileSearchLauncherBtn.innerHTML, /Search/);
assert.match(global.mobileSheetLauncherBtn.innerHTML, /chevron-right/);
assert.match(global.mobileSearchLauncherBtn.innerHTML, /search/);
assert.match(global.mobileToolsLauncherBtn.innerHTML, /sliders-horizontal/);

global.mobileSurfaceMode = 'atlas';
syncMobileDockState();
assert.equal(global.mobileSheetLauncherBtn.attrs['aria-label'], 'Close atlas');
assert.equal(global.mobileSheetLauncherBtn.attrs['aria-pressed'], 'true');
assert.equal(global.mobileSheetLauncherBtn.attrs['aria-expanded'], 'true');
assert.equal(global.mobileSearchLauncherBtn.attrs['aria-label'], 'Open search');
assert.equal(global.mobileSearchLauncherBtn.attrs['aria-pressed'], 'false');
assert.match(global.mobileSheetLauncherBtn.innerHTML, /Atlas/);
assert.doesNotMatch(global.mobileSheetLauncherBtn.innerHTML, /Close/);

global.mobileSurfaceMode = 'search';
syncMobileDockState();
assert.equal(global.mobileSheetLauncherBtn.attrs['aria-label'], 'Open atlas');
assert.equal(global.mobileSearchLauncherBtn.attrs['aria-label'], 'Close search');
assert.equal(global.mobileSearchLauncherBtn.attrs['aria-pressed'], 'true');
assert.equal(global.mobileSearchLauncherBtn.attrs['aria-expanded'], 'true');
assert.match(global.mobileSearchLauncherBtn.innerHTML, /Search/);
assert.doesNotMatch(global.mobileSearchLauncherBtn.innerHTML, /Close/);

global.mobileSurfaceMode = 'tools';
syncMobileDockState();
assert.equal(global.mobileToolsLauncherBtn.attrs['aria-label'], 'Close tools');
assert.equal(global.mobileToolsLauncherBtn.attrs['aria-pressed'], 'true');
assert.equal(global.mobileToolsLauncherBtn.attrs['aria-expanded'], 'true');
assert.equal(global.mobileToolsLauncherBtn.classes.has('active'), true);

global.searchControlContainer.style.display = 'none';
syncMobileDockState();
assert.equal(global.mobileSearchLauncherBtn.hidden, true);

global.isMobileLayoutActive = false;
syncMobileDockState();
assert.equal(global.mobileToolsLauncherBtn.hidden, true);
global.isMobileLayoutActive = true;
syncMobileDockState();
assert.equal(global.mobileToolsLauncherBtn.hidden, false, 'Tools should return after resizing back to mobile');

global.isEmbeddedView = true;
syncMobileDockState();
assert.equal(global.mobileDock.hidden, true);
assert.equal(global.mobileSheetLauncherBtn.hidden, true);
assert.equal(global.mobileInfoHelpBtn.hidden, true);
assert.equal(global.mobileToolsLauncherBtn.hidden, true);

console.log('mobile launcher behavior regression checks passed');
