// --- Global Variables ---
let mapData = []; // Will be populated by loadMapData
let loadingProgressInterval = null;
let loadingProgress = 0;
let currentRegionGroup = null;
let regionsVisible = false; // Overall region visibility toggle
let currentRoadGroup = null; // Holds currently displayed road layers
// let regionFiltersPanelVisible = false; // No longer needed as separate panel

// --- Measurement Tool State ---
let isMeasuring = false; // Existing
let measurementStartPoint = null; // Existing
let measurementLayerGroup; // Declare it here

// --- Initialize Leaflet Map ---
const map = L.map('map', {
    crs: L.CRS.Simple,
    minZoom: -3,
    maxZoom: 4,
    attributionControl: false,
    zoomControl: false // Disable default zoom, using custom styled one
});

// NOW Initialize measurementLayerGroup
measurementLayerGroup = L.layerGroup().addTo(map);


// --- NEW: Multi-Point Measurement State ---
let isMeasuringMultiPoint = false; // Tracks if multi-point mode is active
let multiPointPath = []; // Array of L.LatLng objects for the current path
let multiPointPolyline = null; // The L.Polyline layer for the drawn path
let multiPointVertexMarkers = []; // Array of L.CircleMarker for vertices
let multiPointSegmentTooltips = []; // Array of L.Tooltip for segment lengths (optional)
let multiPointTotalTooltip = null; // L.Tooltip for the total path length
let temporaryMouseMoveLine = null; // L.Polyline for the line from last point to cursor
let temporaryMouseMoveTooltip = null; // L.Tooltip for the temporary line's length


// --- Initialize Leaflet Map ---
// Add styled zoom control
L.control.zoom({ position: 'topleft' }).addTo(map);

// --- Coordinate Display Control ---
const coordinateControl = L.Control.extend({
    onAdd: function(map) {
        const container = L.DomUtil.create('div', 'coordinate-control');
        container.innerHTML = `
            <span>0.0° N, 0.0° W</span>
            <button class="copy-coords-btn" title="Copy Coordinates">
                <span class="copy-coords-icon">📋</span>
                <span class="copy-coords-copied-msg">✔</span>
            </button>
        `;

        const copyBtn = container.querySelector('.copy-coords-btn');
        copyBtn.addEventListener('click', () => {
            if (copyBtn.classList.contains('copied')) return; // Prevent re-clicking

            const coordsText = container.querySelector('span').innerText;
            navigator.clipboard.writeText(coordsText).then(() => {
                copyBtn.classList.add('copied');
                copyBtn.title = "Copied!";

                setTimeout(() => {
                    copyBtn.classList.remove('copied');
                    copyBtn.title = "Copy Coordinates";
                }, 1500); // Reset after 1.5 seconds
            }).catch(err => {
                console.error('Failed to copy coordinates: ', err);
                // Optional: handle error visually
            });
        });

        return container;
    },
    update: function(lat, lon) {
        const latString = `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}`;
        const lonString = `${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'W' : 'E'}`;
        this.getContainer().querySelector('span').innerHTML = `${latString}, ${lonString}`;
    }
});
const coords = new coordinateControl({ position: 'topleft' });
coords.addTo(map);

const poiTypeGroups = {
    "Settlements": ["City", "Town", "Village", "Hamlet", "Settlement", "Capital"],
    "Structures": ["Castle", "Fortress", "Fort", "Tower", "Ruin", "Temple", "Shrine", "Mine", "Lighthouse", "Bridge", "Dungeon", "Lair", "Camp", "Asylum", "Landmark"],
    "Natural Features": ["Mountain", "Peak", "Forest", "Wood", "River", "Lake", "Cave", "Cavern", "Coast", "Bay", "Cove", "Swamp", "Marsh", "Desert", "Natural Landmark"],
    "Other": ["Point of Interest", "Region", "Portal"],
    "Unknown": ["Unknown"]
};

function getUrlParameters() {
    const params = {};
    const queryString = window.location.search.substring(1);
    const pairs = queryString.split('&');
    
    for (const pair of pairs) {
        const [key, value] = pair.split('=');
        if (key) params[decodeURIComponent(key)] = decodeURIComponent(value || '');
    }
    return params;
}

// --- NEW: Format Custom Properties for Popups ---
function formatPropertiesForPopup(properties, hasFollowingDescription) {
    if (!properties || Object.keys(properties).length === 0) {
        return '';
    }
    let hasContent = false;
    let listItems = '';
    for (const key in properties) {
        if (Object.hasOwnProperty.call(properties, key) && properties[key]) {
            hasContent = true;
            // Sanitize key and value to prevent basic HTML injection
            const sanKey = key.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            const sanValue = properties[key].replace(/</g, "&lt;").replace(/>/g, "&gt;");
            listItems += `<li><strong>${sanKey}:</strong> ${sanValue}</li>`;
        }
    }

    if (!hasContent) return '';

    let html = `<ul>${listItems}</ul>`;
    // Add separator AFTER properties if there's a description to follow
    if (hasFollowingDescription) {
        html += `<hr style="border-top: 1px dotted var(--border-color); border-bottom: none; margin: 10px 0;">`;
    }
    return html;
}

// --- NEW: Unified Popup Content Generator ---
function createPopupContent(data) {
    // Part 1: Build the header, which is always visible.
    let headerHtml = '';
    if (data.name) {
        if (data.wikiLink) {
            headerHtml += `<h3><a href="${data.wikiLink}" target="_blank" rel="noopener noreferrer" title="Visit wiki page for ${data.name}">${data.name}</a></h3>`;
        } else {
            headerHtml += `<h3>${data.name}</h3>`;
        }
    }
    if (data.pronunciation) {
        headerHtml += `<p style="margin-top: -10px; margin-bottom: 5px;"><em>${data.pronunciation}</em></p>`;
    }

    // Part 2: Build the rest of the content that will be expandable.
    let fullContentInnerHtml = '';
    if (data.type && data.value) { // Regions
        fullContentInnerHtml += `<p><em>${data.type}: ${data.value}</em></p>`;
    } else if (data.type) { // POIs, Roads
        const typeString = data.type.charAt(0).toUpperCase() + data.type.slice(1);
        fullContentInnerHtml += `<p><em>Type: ${typeString}</em></p>`;
    }
    fullContentInnerHtml += formatPropertiesForPopup(data.properties, !!data.description);
    if (data.description) {
        fullContentInnerHtml += `<p>${data.description}</p>`;
    }

    // Part 3: Check for summary and full content presence.
    const hasSummary = data.summary && data.summary.trim() !== '';
    const hasFullContent = fullContentInnerHtml.trim() !== '';

    // If there's nothing to show, just return the header.
    if (!hasSummary && !hasFullContent) {
        return headerHtml;
    }

    // Part 4: Construct the main container and "Read More" button based on content.
    let mainContent = '';
    let readMoreButton = '';

    if (hasSummary) {
        // If a summary exists, use the new structure with summary and full-content divs.
        mainContent = `
            <div class="popup-content-container">
                <div class="popup-summary">
                    <p>${data.summary}</p>
                </div>
                <div class="popup-full-content">
                    ${fullContentInnerHtml}
                </div>
            </div>
        `;
        // Show "Read More" button only if there's full content to expand to.
        if (hasFullContent) {
            readMoreButton = `<div class="popup-read-more" onclick="togglePopupExpand(this)">Read More</div>`;
        }
    } else {
        // No summary, so use the old behavior. The container will be truncated by CSS.
        mainContent = `
            <div class="popup-content-container">
                ${fullContentInnerHtml}
            </div>
        `;
        // Show "Read More" button if there's content that might be truncated.
        if (hasFullContent) {
            readMoreButton = `<div class="popup-read-more" onclick="togglePopupExpand(this)">Read More</div>`;
        }
    }

    // Combine the header, main content container, and button for the final popup HTML.
    return headerHtml + mainContent + readMoreButton;
}

// --- Auto-generate a reverse map for quick lookup (Type -> Group) ---
const typeToGroupMap = {};
for (const groupName in poiTypeGroups) {
    poiTypeGroups[groupName].forEach(type => {
        typeToGroupMap[type] = groupName;
    });
}
// --- END: POI Type Grouping Configuration ---

// --- More Global variables ---
let currentImageLayer = null;
let currentMarkerGroup = null; // Holds currently *visible* markers
let allMapMarkers = []; // Holds *all* markers for the loaded map
let currentBounds = null;
let currentlyLoadedMapId = null;
let currentSidebarState = 'o';
let markersVisible = true; // <--- THIS SHOULD BE TRUE FOR VISIBLE BY DEFAULT
let currentLatLonBounds = null;
let coordsLocked = false;
let lockedCoords = null;
const transitionDuration = 300; // ms for sidebar animation
let filtersPanelVisible = false; // State for combined filter panel visibility

// --- DOM Elements ---
const container = document.querySelector('.container');
const sidebar = document.getElementById('sidebar');
const mapListElement = document.getElementById('map-list');
const toggleBtn = document.getElementById('toggle-sidebar-btn');
const themeToggle = document.getElementById('theme-checkbox');
const bodyElement = document.body;
const mapElement = document.getElementById('map'); // Get map div
const toggleBlurbBtn = document.getElementById('toggle-blurb-btn');
const mapBlurbElement = document.getElementById('map-blurb');
const toggleMarkersBtn = document.getElementById('toggle-markers-btn');
const searchControlContainer = document.getElementById('search-control-container');
const poiSearchInput = document.getElementById('poi-search-input');
const searchResultsContainer = document.getElementById('search-results-container');
const poiFilterContainer = document.getElementById('poi-filter-container');
const filterToggleAllCheckbox = document.getElementById('filter-toggle-all');
const toggleFiltersBtn = document.getElementById('toggle-filters-btn');
const measureToolBtn = document.getElementById('measure-tool-btn');
const loadingIndicator = document.getElementById('loading-indicator');
// Sound elements
const lightAmbient = document.getElementById('light-ambient');
const darkAmbient = document.getElementById('dark-ambient');
const toggleSoundBtn = document.getElementById('toggle-sound-btn');
const soundIcon = document.getElementById('sound-icon');
let soundEnabled = false;


// --- Helper Functions ---
function findMapRecursive(items, id) {
    for (const item of items) {
        if (item.id === id) { return item; }
        if (item.type === 'folder' && item.children) {
            const found = findMapRecursive(item.children, id);
            if (found) return found;
        }
    }
    return null;
}

function findFirstLoadableIdRecursive(items) {
    for (const item of items) {
        if (item.id && item.status !== 'coming-soon') return item.id;
        if (item.type === 'folder' && item.children) {
            const foundId = findFirstLoadableIdRecursive(item.children);
            if (foundId) return foundId;
        }
    }
    // Fallback: If only coming-soon items exist, return the first ID found
    for (const item of items) {
            if (item.id) return item.id;
            if (item.type === 'folder' && item.children) {
                const foundId = findFirstLoadableIdRecursive(item.children); // Re-run without status check
                if (foundId) return foundId;
            }
    }
    return null;
}

function parseHash() {
    const hash = window.location.hash.substring(1);
    let mapId = null;
    let sidebarState = null;
    if (hash) {
        const parts = hash.split('-s=');
        mapId = parts[0];
        if (parts.length > 1 && ['o', 'c'].includes(parts[1])) {
            sidebarState = parts[1];
        }
    }
    // Default map ID determination moved to initializeApp after data is loaded
    return {
        mapId: mapId, // May be null initially
        sidebarState: sidebarState || 'o'
    };
}

// --- FIX: Corrected generateHash to only return the hash fragment ---
function generateHash(mapId, sidebarState) {
    return `#${mapId || ''}-s=${sidebarState}`;
}

// --- Function to Set Sidebar State ---
function setSidebarState(state, updateHash = true) {
    const shouldBeCollapsed = (state === 'c');
    const isCurrentlyCollapsed = container.classList.contains('sidebar-collapsed');
    if (shouldBeCollapsed !== isCurrentlyCollapsed) {
        container.classList.toggle('sidebar-collapsed', shouldBeCollapsed);

        // Update SVG direction
        if (shouldBeCollapsed) {
            // Point Right (Expand)
             toggleBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;
             toggleBtn.title = 'Expand Sidebar';
        } else {
            // Point Left (Collapse)
            toggleBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`;
            toggleBtn.title = 'Collapse Sidebar';
        }

        // Invalidate map size after CSS transition completes
        setTimeout(() => { map.invalidateSize({ animate: true }); }, transitionDuration);

            currentSidebarState = state;
            if (updateHash && currentlyLoadedMapId) {
            // --- FIX: Update history with search params and new hash ---
            const newHash = generateHash(currentlyLoadedMapId, state);
            const currentSearch = window.location.search;
            const newUrl = `${currentSearch}${newHash}`;
            history.replaceState(null, '', newUrl); // Use replaceState for sidebar toggle
            }
    } else {
            currentSidebarState = state;
    }
}

// --- Helper Function to Update the "Toggle All" Checkbox State ---
function updateToggleAllCheckboxState() {
    // Update indeterminate state for each region group parent
    const regionGroupCheckboxes = poiFilterContainer.querySelectorAll('.region-group-filter');
    regionGroupCheckboxes.forEach(groupCheckbox => {
        const groupName = groupCheckbox.value;
        const childCheckboxes = poiFilterContainer.querySelectorAll(`.region-type-filter[data-group="${groupName}"]`);
        const checkedChildren = poiFilterContainer.querySelectorAll(`.region-type-filter[data-group="${groupName}"]:checked`);

        if (checkedChildren.length === 0) {
            groupCheckbox.checked = false;
            groupCheckbox.indeterminate = false;
        } else if (checkedChildren.length === childCheckboxes.length) {
            groupCheckbox.checked = true;
            groupCheckbox.indeterminate = false;
        } else {
            groupCheckbox.checked = false;
            groupCheckbox.indeterminate = true;
        }
    });

    // Update master "Show All / Hide All" checkbox state
    const allTopLevelFilters = poiFilterContainer.querySelectorAll(
        '.poi-filter-checkbox:not(#filter-toggle-all), .region-group-filter, .line-type-filter'
    );
    const checkedTopLevelFilters = poiFilterContainer.querySelectorAll(
        '.poi-filter-checkbox:not(#filter-toggle-all):checked, .region-group-filter:checked:not(:indeterminate), .line-type-filter:checked'
    );
    const indeterminateTopLevelFilters = poiFilterContainer.querySelectorAll('.region-group-filter:indeterminate');

    if (allTopLevelFilters.length === 0) {
        filterToggleAllCheckbox.checked = true;
        filterToggleAllCheckbox.indeterminate = false;
    } else if (indeterminateTopLevelFilters.length > 0 || (checkedTopLevelFilters.length > 0 && checkedTopLevelFilters.length < allTopLevelFilters.length)) {
        filterToggleAllCheckbox.checked = false;
        filterToggleAllCheckbox.indeterminate = true;
    } else if (checkedTopLevelFilters.length === allTopLevelFilters.length) {
        filterToggleAllCheckbox.checked = true;
        filterToggleAllCheckbox.indeterminate = false;
    } else { // All are unchecked
        filterToggleAllCheckbox.checked = false;
        filterToggleAllCheckbox.indeterminate = false;
    }
}

// --- Function to Update Visible Markers AND Search Results ---
function updateVisibleMarkersAndSearch() {
    if (!currentMarkerGroup || allMapMarkers.length === 0) {
        // Hide map-based controls if no markers
        searchControlContainer.style.display = 'none';
        searchResultsContainer.style.display = 'none';
        // Don't hide filter panel/button here, regions might still need filtering
        return;
    }

    // Ensure map-based controls are potentially visible if markers exist
    searchControlContainer.style.display = 'block';

    const searchTerm = poiSearchInput.value.toLowerCase().trim();
    searchResultsContainer.innerHTML = ''; // Clear previous results
    let searchResultFound = false;

    // Get the set of *specifically* checked POI group filters
    const activeSpecificGroupFilters = new Set();
    poiFilterContainer.querySelectorAll('.poi-filter-checkbox:not(#filter-toggle-all):checked').forEach(checkbox => {
            activeSpecificGroupFilters.add(checkbox.value);
    });
    const allPoiGroupsChecked = filterToggleAllCheckbox.checked && !filterToggleAllCheckbox.indeterminate; // True if master toggle is fully checked

    allMapMarkers.forEach(marker => {
        const poi = marker.poiData;
        if (!poi) return;

        const nameMatch = !searchTerm || poi.name.toLowerCase().includes(searchTerm);

        const specificType = poi.type || 'Unknown';
        const poiGroup = typeToGroupMap[specificType] || 'Other';
        // A POI group matches if the master toggle is checked OR its specific group is checked
        const groupMatch = allPoiGroupsChecked || activeSpecificGroupFilters.has(poiGroup);

        // Update marker visibility on map
        if (markersVisible && nameMatch && groupMatch) { // Governed by markersVisible
            if (!currentMarkerGroup.hasLayer(marker)) {
                currentMarkerGroup.addLayer(marker);
            }
        } else {
            if (currentMarkerGroup.hasLayer(marker)) {
                currentMarkerGroup.removeLayer(marker);
            }
        }

        // --- Populate Search Results ---
        if (searchTerm && nameMatch) { // Only add to results if search term exists and name matches
            searchResultFound = true;
            const resultItem = document.createElement('div');
            resultItem.className = 'search-result-item';
            const highlightedName = poi.name.replace(
                new RegExp(searchTerm, 'gi'),
                '<strong>$&</strong>'
            );
            resultItem.innerHTML = highlightedName;
            resultItem.title = `Go to ${poi.name}`;
            resultItem.addEventListener('click', () => {
                map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 1));
                marker.openPopup();
                poiSearchInput.value = '';
                searchResultsContainer.style.display = 'none';
                searchResultsContainer.innerHTML = '';
            });
            searchResultsContainer.appendChild(resultItem);
        }
    });

    // Show/hide search results container
    searchResultsContainer.style.display = searchResultFound ? 'block' : 'none';
}


// --- Function to Populate Filter Checkboxes (in the panel) ---
function populateFilters(pointsOfInterest, mapId) {
    // Clear existing dynamic filters (headers, dividers, specific checkboxes)
    const dynamicElements = poiFilterContainer.querySelectorAll('h3:not(:first-of-type), hr, .filter-item:not(:first-child), .filter-group-container');
    dynamicElements.forEach(el => el.remove());

    const hasPOIs = pointsOfInterest && pointsOfInterest.length > 0;
    const selectedMap = findMapRecursive(mapData, mapId);
    const hasRegions = selectedMap && selectedMap.regions && Array.isArray(selectedMap.regions) && selectedMap.regions.length > 0;
    const hasRoads = selectedMap && selectedMap.roads && Array.isArray(selectedMap.roads) && selectedMap.roads.length > 0; // New check for roads

    // Hide filter button if no POIs, no regions, and no roads
    if (!hasPOIs && !hasRegions && !hasRoads) {
        poiFilterContainer.classList.remove('visible');
        toggleFiltersBtn.style.display = 'none';
        filtersPanelVisible = false;
        toggleFiltersBtn.classList.remove('active');
        filterToggleAllCheckbox.checked = true;
        filterToggleAllCheckbox.indeterminate = false;
        return;
    }

    // PART 1: Add POI type filters (existing logic)
    if (hasPOIs) {
        if (poiFilterContainer.querySelector('h3')) {
            const poiHeader = document.createElement('h3');
            poiHeader.textContent = "POI Types:";
            poiFilterContainer.appendChild(poiHeader);
        }
        const relevantGroups = new Set();
        pointsOfInterest.forEach(poi => {
            const specificType = poi.type || 'Unknown';
            const group = typeToGroupMap[specificType] || 'Other';
            relevantGroups.add(group);
        });
        const sortedGroups = Array.from(relevantGroups).sort();
        sortedGroups.forEach(groupName => {
            if (!groupName || (poiTypeGroups[groupName] && poiTypeGroups[groupName].length === 0)) return;
            const filterId = `filter-group-${groupName.replace(/\s+/g, '-')}`;
            const div = document.createElement('div');
            div.className = 'filter-item';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = filterId;
            checkbox.value = groupName;
            checkbox.checked = true;
            checkbox.className = 'poi-filter-checkbox';
            const label = document.createElement('label');
            label.htmlFor = filterId;
            label.textContent = groupName;
            div.appendChild(checkbox);
            div.appendChild(label);
            poiFilterContainer.appendChild(div);
        });
    }

    // PART 2: Add region type filters (NEW HIERARCHICAL LOGIC)
    if (hasRegions && selectedMap.filterGroups && selectedMap.filterGroups.Regions) {
        if (hasPOIs) {
            const divider = document.createElement('hr');
            divider.style.margin = '10px 0';
            divider.style.borderColor = 'var(--glass-border-light)';
            bodyElement.classList.contains('dark-theme') && (divider.style.borderColor = 'var(--glass-border-dark)');
            poiFilterContainer.appendChild(divider);
        }
        const regionHeader = document.createElement('h3');
        regionHeader.textContent = "Region Types:";
        poiFilterContainer.appendChild(regionHeader);

        const regionFilterGroups = selectedMap.filterGroups.Regions;

        for (const groupName in regionFilterGroups) {
            if (Object.hasOwnProperty.call(regionFilterGroups, groupName)) {
                const values = regionFilterGroups[groupName];
                if (!Array.isArray(values) || values.length === 0) continue;

                const groupContainer = document.createElement('div');
                groupContainer.className = 'filter-group closed'; // Start as closed

                const groupHeader = document.createElement('div');
                groupHeader.className = 'filter-group-header';
                groupHeader.innerHTML = `<span class="folder-toggle-icon"></span>`;

                const groupDiv = document.createElement('div');
                groupDiv.className = 'filter-item';
                const groupFilterId = `filter-region-group-${groupName.replace(/\s+/g, '-')}`;
                const groupCheckbox = document.createElement('input');
                groupCheckbox.type = 'checkbox';
                groupCheckbox.id = groupFilterId;
                groupCheckbox.value = groupName;
                groupCheckbox.checked = true;
                groupCheckbox.className = 'region-group-filter';
                const groupLabel = document.createElement('label');
                groupLabel.htmlFor = groupFilterId;
                groupLabel.textContent = groupName;
                groupDiv.appendChild(groupCheckbox);
                groupDiv.appendChild(groupLabel);
                groupHeader.appendChild(groupDiv);
                groupContainer.appendChild(groupHeader);

                const nestedList = document.createElement('div');
                nestedList.className = 'nested-filter-list';

                values.forEach(value => {
                    const filterId = `filter-region-value-${value.replace(/\s+/g, '-')}`;
                    const div = document.createElement('div');
                    div.className = 'filter-item';
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.id = filterId;
                    checkbox.value = value;
                    checkbox.checked = true;
                    checkbox.className = 'region-type-filter';
                    checkbox.dataset.group = groupName;
                    const label = document.createElement('label');
                    label.htmlFor = filterId;
                    label.textContent = value;
                    div.appendChild(checkbox);
                    div.appendChild(label);
                    nestedList.appendChild(div);
                });
                groupContainer.appendChild(nestedList);
                poiFilterContainer.appendChild(groupContainer);
            }
        }
    }

    // PART 3: Add line type filters (New)
    if (hasRoads) {
        if (hasPOIs || hasRegions) { // Add divider if other filters are present
            const divider = document.createElement('hr');
            divider.style.margin = '10px 0';
            divider.style.borderColor = 'var(--glass-border-light)';
            bodyElement.classList.contains('dark-theme') && (divider.style.borderColor = 'var(--glass-border-dark)');
            poiFilterContainer.appendChild(divider);
        }

        const lineHeader = document.createElement('h3');
        lineHeader.textContent = "Line Types:";
        poiFilterContainer.appendChild(lineHeader);

        const lineTypes = [...new Set(selectedMap.roads.map(r => r.type || "Unnamed Road Type").filter(Boolean))].sort();

        lineTypes.forEach(type => {
            const filterId = `filter-line-${(type || "untyped").replace(/\s+/g, '-').toLowerCase()}`;
            const div = document.createElement('div');
            div.className = 'filter-item';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = filterId;
            checkbox.value = type;
            checkbox.checked = true; // Default checked
            checkbox.className = 'line-type-filter'; // Specific class for line filters

            const label = document.createElement('label');
            label.htmlFor = filterId;
            label.textContent = type.charAt(0).toUpperCase() + type.slice(1); // Capitalize

            div.appendChild(checkbox);
            div.appendChild(label);
            poiFilterContainer.appendChild(div);
        });
    }

    // Show filter button since we have filters
    toggleFiltersBtn.style.display = 'block';

    // Ensure panel is hidden initially and button is not active
    poiFilterContainer.classList.remove('visible');
    filtersPanelVisible = false;
    toggleFiltersBtn.classList.remove('active');

    // Set initial state of the master toggle
    updateToggleAllCheckboxState();
}
// --- Function to Load/Switch Map ---
function loadMap(mapId, updateHash = true) {
    // --- Show loading indicator ---
    if (loadingIndicator) {
        loadingIndicator.style.display = 'flex';
        const progressBar = loadingIndicator.querySelector('.progress-bar');
        const loadingText = loadingIndicator.querySelector('.loading-text');
        const spinner = loadingIndicator.querySelector('.spinner');

        loadingProgress = 0;
        if (progressBar) progressBar.style.width = '0%';
        if (loadingText) loadingText.textContent = "Loading Map...";
        if (spinner) spinner.style.display = 'block';

        if (loadingProgressInterval) clearInterval(loadingProgressInterval);
        loadingProgressInterval = setInterval(() => {
            if (loadingProgress < 90) {
                loadingProgress += 2 + Math.random() * 3;
                loadingProgress = Math.min(loadingProgress, 90);
                if (progressBar) progressBar.style.width = loadingProgress + '%';
            } else {
                clearInterval(loadingProgressInterval);
                loadingProgressInterval = null;
            }
        }, 150);
    }
    // --- END: Loading Indicator Setup ---

    if (isMeasuring) toggleMeasurementTool(); // Assuming this is for the old tool
    if (isMeasuringMultiPoint) finalizeMultiPointMeasure(false); // Finalize new tool if active
    measurementLayerGroup.clearLayers();


    // --- Hide Search/Filter UI during load ---
    searchControlContainer.style.display = 'none';
    searchResultsContainer.style.display = 'none';
    poiFilterContainer.classList.remove('visible');
    toggleFiltersBtn.style.display = 'none';
    filtersPanelVisible = false;
    toggleFiltersBtn.classList.remove('active');
    poiSearchInput.value = '';

    const selectedMap = findMapRecursive(mapData, mapId);

    // --- Clear Filter Checkboxes ---
    const dynamicFilters = poiFilterContainer.querySelectorAll('h3:not(:first-of-type), hr, .filter-item:not(:first-child)');
    dynamicFilters.forEach(el => el.remove());
    filterToggleAllCheckbox.checked = true;
    filterToggleAllCheckbox.indeterminate = false;

    // Remove previous layers
    if (currentImageLayer) map.removeLayer(currentImageLayer);
    if (currentMarkerGroup) map.removeLayer(currentMarkerGroup);
    if (currentRegionGroup) map.removeLayer(currentRegionGroup);
    if (currentRoadGroup) map.removeLayer(currentRoadGroup);
    currentRoadGroup = L.layerGroup().addTo(map);

    currentImageLayer = null;
    currentMarkerGroup = null;
    currentRegionGroup = null;
    currentRoadGroup = null; // Explicitly nullify before reinitialization
    allMapMarkers = [];

    if (!selectedMap || selectedMap.status === 'coming-soon') {
        console.warn("Attempted to load map data not found or coming soon:", mapId);
        if (selectedMap) alert(`The map "${selectedMap.name}" is coming soon!`);
        currentlyLoadedMapId = null;
        mapBlurbElement.classList.remove('visible');
        toggleMarkersBtn.style.display = 'none';
        measureToolBtn.style.display = 'none';
        toggleFiltersBtn.style.display = 'none';
        searchControlContainer.style.display = 'none';
        if (updateHash) {
            // --- FIX: Update history with search params and new hash ---
            const newHash = generateHash('', currentSidebarState);
            const currentSearch = window.location.search;
            history.pushState(null, '', `${currentSearch}${newHash}`);
        }

        if (loadingIndicator) {
            if (loadingProgressInterval) clearInterval(loadingProgressInterval);
            loadingIndicator.style.display = 'none';
        }
        return;
    }

    // --- This block was removed as the logic is now handled by the history.pushState below ---

    if (mapId === currentlyLoadedMapId) {
        if (updateHash) {
            // --- FIX: Ensure the full correct URL is in the history state ---
            const newHash = generateHash(mapId, currentSidebarState);
            const currentSearch = window.location.search;
            const newUrl = `${currentSearch}${newHash}`;
            if (window.location.href !== new URL(newUrl, window.location.href).href) {
                history.replaceState(null, '', newUrl);
            }
        }
        if (loadingIndicator) {
            if (loadingProgressInterval) clearInterval(loadingProgressInterval);
            loadingIndicator.style.display = 'none';
        }
        return;
    }


    // Initialize Layer Groups for this map load
    currentMarkerGroup = L.layerGroup(); // Not added to map until populated
    currentRegionGroup = L.layerGroup().addTo(map); // Add to map immediately
    currentRoadGroup = L.layerGroup().addTo(map);   // Add to map immediately


    const mapHeight = selectedMap.height;
    const mapWidth = selectedMap.width;
    if (isNaN(mapHeight) || isNaN(mapWidth) || !selectedMap.imageUrl) {
        console.error(`Invalid dimensions or missing imageUrl for map ID ${mapId}`);
        mapBlurbElement.classList.remove('visible');
        toggleMarkersBtn.style.display = 'none';
        measureToolBtn.style.display = 'none';
        toggleFiltersBtn.style.display = 'none';
        searchControlContainer.style.display = 'none';
        currentlyLoadedMapId = null;
        if (updateHash) {
            // --- FIX: Update history with search params and new hash ---
            const newHash = generateHash('', currentSidebarState);
            const currentSearch = window.location.search;
            history.pushState(null, '', `${currentSearch}${newHash}`);
        }

        if (loadingIndicator) {
            if (loadingProgressInterval) clearInterval(loadingProgressInterval);
            const loadingTextEl = loadingIndicator.querySelector('.loading-text');
            const progressBarEl = loadingIndicator.querySelector('.progress-bar');
            const spinnerEl = loadingIndicator.querySelector('.spinner');
            if (loadingTextEl) loadingTextEl.textContent = "Error: Invalid map data.";
            if (progressBarEl) progressBarEl.style.width = '0%';
            if (spinnerEl) spinnerEl.style.display = 'none';
            setTimeout(() => { loadingIndicator.style.display = 'none'; }, 3000);
        }
        return;
    }
    currentBounds = [[0, 0], [mapHeight, mapWidth]];

    currentImageLayer = L.imageOverlay(selectedMap.imageUrl, currentBounds);

    const preloadImg = new Image();
    let loadingComplete = false;
    let loadingTimeout = null;

    function finishLoading() {
        if (loadingComplete) return;
        loadingComplete = true;
        clearTimeout(loadingTimeout);

        if (loadingIndicator) {
            const progressBarEl = loadingIndicator.querySelector('.progress-bar');
            if (progressBarEl) {
                progressBarEl.style.width = '100%';
                setTimeout(() => {
                    if (loadingProgressInterval) clearInterval(loadingProgressInterval);
                    loadingProgressInterval = null;
                    loadingIndicator.style.display = 'none';
                }, 300);
            } else {
                if (loadingProgressInterval) clearInterval(loadingProgressInterval);
                loadingProgressInterval = null;
                loadingIndicator.style.display = 'none';
            }
        }
        map.fitBounds(currentBounds);
    }

    preloadImg.onload = function () { finishLoading(); };
    currentImageLayer.on('load', function () { finishLoading(); });
    currentImageLayer.on('error', function () {
        if (loadingComplete) return;
        loadingComplete = true;
        clearTimeout(loadingTimeout);
        console.error("Image overlay failed to load:", selectedMap.imageUrl);
        if (loadingIndicator) {
            if (loadingProgressInterval) clearInterval(loadingProgressInterval);
            loadingProgressInterval = null;
            const progressBarEl = loadingIndicator.querySelector('.progress-bar');
            const loadingTextEl = loadingIndicator.querySelector('.loading-text');
            const spinnerEl = loadingIndicator.querySelector('.spinner');
            if (progressBarEl) progressBarEl.style.width = '0%';
            if (loadingTextEl) loadingTextEl.textContent = "Error loading map image.";
            if (spinnerEl) spinnerEl.style.display = 'none';
            setTimeout(() => { loadingIndicator.style.display = 'none'; }, 3000);
        }
        if (currentImageLayer) map.removeLayer(currentImageLayer);
        currentImageLayer = null;
        currentlyLoadedMapId = null;
        toggleMarkersBtn.style.display = 'none';
        measureToolBtn.style.display = 'none';
        toggleFiltersBtn.style.display = 'none';
        searchControlContainer.style.display = 'none';
    });

    loadingTimeout = setTimeout(() => {
        console.warn("Loading fallback timer triggered.");
        finishLoading();
    }, 8000);

    preloadImg.src = selectedMap.imageUrl;
    currentImageLayer.addTo(map);

    const points = selectedMap.pointsOfInterest || []; //
    populateFilters(points, mapId); //

    points.forEach(point => { //
        try { // START OF ADDED TRY BLOCK
            if (point.coords && point.coords.length === 2 && !isNaN(point.coords[0]) && !isNaN(point.coords[1])) { //
                // mapHeight and mapWidth are defined earlier in loadMap
                if (point.coords[0] >= 0 && point.coords[0] <= mapHeight && point.coords[1] >= 0 && point.coords[1] <= mapWidth) { //
                    const marker = L.marker(point.coords); //

                    // It's good practice to check if marker was created, though L.marker usually throws its own error if L is undefined.
                    // The ReferenceError for 'marker' is unusual here unless L.marker itself has an issue.
                    if (marker) {
                        marker.poiData = point; //
                        const popupContent = createPopupContent(point);
                        marker.bindPopup(popupContent, {
                            minWidth: 250 // Set a min-width for consistency
                        });
                        allMapMarkers.push(marker); //
                    } else {
                        // This case is unlikely if L.marker is standard Leaflet, but good for robustness
                        console.warn(`L.marker call returned undefined for POI: ${point.name || 'Unnamed POI'} at coords:`, point.coords);
                    }
                } else {
                    console.warn(`POI coordinates out of bounds for map ${selectedMap.name}: ${point.name}`, point.coords);  //
                }
            } else {
                console.warn(`Invalid coordinates for POI: ${point.name}`, point.coords);  //
            }
        } catch (e) {
            // Log the error and the POI that caused it
            console.error(`Error processing POI: ${point ? (point.name || JSON.stringify(point)) : 'Unknown POI'}. Error: ${e.message}`, e);
            // This will help identify if a specific POI's data is causing L.marker() to fail.
            // The original ReferenceError might be a symptom of L.marker() failing internally due to bad data.
        } // END OF ADDED TRY BLOCK
    });

    currentMarkerGroup.addTo(map); // Add populated marker group to map //
    updateVisibleMarkersAndSearch(); //

    addRegionsToMap(mapId); // Populates currentRegionGroup //
    updateVisibleRegions(); //

    addRoadsToMap(mapId); // Populates currentRoadGroup //
    // updateVisibleLines(); // This was added in the previous step, ensure it's still here.
    // Check if updateVisibleLines is present; if not, re-add it from the previous response.
    // Based on the provided file, it seems you might be merging changes.
    // Ensure this line is present if you implemented line filtering:
    if (typeof updateVisibleLines === "function") {
        updateVisibleLines();
    }
    updateVisibleRegions();

    addRoadsToMap(mapId); // Populates currentRoadGroup


    // Adjust layering order as desired
    if (currentRegionGroup && typeof currentRegionGroup.bringToBack === 'function') {
        currentRegionGroup.bringToBack(); // Regions furthest back
    } else {
        console.warn("currentRegionGroup not valid for bringToBack or method missing");
    }

    if (currentRoadGroup && typeof currentRoadGroup.bringToBack === 'function') {
        currentRoadGroup.bringToBack(); // Roads will also go to back, potentially over regions if pane is same.
        // To ensure roads are above regions, you might need separate panes or careful ordering.
        // For now, let's assume default pane; this will place roads at the bottom, then regions above them (if also sent to back).
        // If you want roads ON TOP of regions:
        // currentRegionGroup.bringToBack();
        // (roads are already added, they will be above regions unless also sent to back AFTER regions)
    } else {
        console.error("loadMap: currentRoadGroup.bringToBack is not a function!", currentRoadGroup);
    }

    // Markers are added to currentMarkerGroup which is then added to map. They usually appear on top by default.
    // If explicit control is needed:
    // if (currentMarkerGroup && typeof currentMarkerGroup.bringToFront === 'function') {
    //   currentMarkerGroup.bringToFront();
    // }


    const hasPOIs = allMapMarkers.length > 0;
    // Adjust control visibility based on whether POIs, Regions, or Roads exist
    const hasRegions = selectedMap.regions && selectedMap.regions.length > 0;
    const hasRoads = selectedMap.roads && selectedMap.roads.length > 0;

    toggleMarkersBtn.style.display = (hasPOIs || hasRegions) ? 'block' : 'none'; // Show if POIs or Regions exist
    searchControlContainer.style.display = hasPOIs ? 'block' : 'none'; // Search for POIs

    const hasValidScale = typeof selectedMap.scalePixels === 'number' && selectedMap.scalePixels > 0 &&
        typeof selectedMap.scaleKilometers === 'number' && selectedMap.scaleKilometers > 0;
    measureToolBtn.style.display = hasValidScale ? 'block' : 'none';

    // --- Coordinate Display Logic ---
    const toggleCoordsBtn = document.getElementById('toggle-coords-btn');
    const coordsControl = document.querySelector('.coordinate-control');

    if (selectedMap.latLonBounds) {
        currentLatLonBounds = selectedMap.latLonBounds;
        toggleCoordsBtn.style.display = 'block';
        coordsControl.style.display = 'block';
        map.on('mousemove', updateCoordinates);
    } else {
        currentLatLonBounds = null;
        toggleCoordsBtn.style.display = 'none';
        coordsControl.style.display = 'none';
        map.off('mousemove', updateCoordinates);
    }


    toggleMarkersBtn.classList.toggle('markers-hidden', !markersVisible);
    toggleMarkersBtn.title = markersVisible ? "Hide Markers & Regions" : "Show Markers & Regions";

    // --- Blurb Handling ---
    if (selectedMap.blurb) {
        mapBlurbElement.innerHTML = selectedMap.blurb;
        toggleBlurbBtn.style.display = 'block'; // Show the button
        // Ensure blurb is hidden on map load
        mapBlurbElement.classList.remove('visible');
        toggleBlurbBtn.classList.remove('active');
    } else {
        mapBlurbElement.innerHTML = '';
        toggleBlurbBtn.style.display = 'none'; // Hide the button
        mapBlurbElement.classList.remove('visible');
        toggleBlurbBtn.classList.remove('active');
    }

    document.querySelectorAll('#map-list .map-item, #map-list .folder-header').forEach(item => item.classList.remove('active'));
    const activeMapItem = document.querySelector(`#map-list .map-item[data-map-id="${mapId}"]`);
    const activeFolderHeader = document.querySelector(`#map-list .folder-header[data-map-id="${mapId}"]`);
    if (activeMapItem) {
        activeMapItem.classList.add('active');
        let parent = activeMapItem.closest('.nested-list');
        while (parent) {
            const folderLi = parent.closest('.folder');
            if (folderLi && folderLi.classList.contains('closed')) { folderLi.classList.remove('closed'); }
            parent = folderLi?.parentElement.closest('.nested-list');
        }
    } else if (activeFolderHeader) {
        activeFolderHeader.classList.add('active');
        const folderLi = activeFolderHeader.closest('.folder');
        if (folderLi && folderLi.classList.contains('closed')) { folderLi.classList.remove('closed'); }
    }

    currentlyLoadedMapId = mapId;
    if (updateHash) {
        // --- FIX: Update history with search params and new hash ---
        const newHash = generateHash(mapId, currentSidebarState);
        const currentSearch = window.location.search;
        history.pushState(
            { mapId: mapId, sidebarState: currentSidebarState },
            selectedMap.name,
            `${currentSearch}${newHash}`
        );
    }
}

// --- Function to add regions to map ---
function addRegionsToMap(mapId) {
    if (!currentRegionGroup) {
        currentRegionGroup = L.layerGroup().addTo(map);
    } else {
        currentRegionGroup.clearLayers();
    }

    const selectedMap = findMapRecursive(mapData, mapId);
    if (!selectedMap || !selectedMap.regions || !Array.isArray(selectedMap.regions)) {
        return;
    }

    selectedMap.regions.forEach(region => {
        if (!region.coordinates || region.coordinates.length < 3) {
            console.warn(`Invalid coordinates for region: ${region.name}`);
            return;
        }

        const polygon = L.polygon(region.coordinates, {
            color: region.color || '#3388ff',
            fillColor: region.fillColor || '#3388ff',
            fillOpacity: regionsVisible ? (region.fillOpacity || 0.2) : 0, // Initial opacity based on toggle
            weight: 2,
            opacity: regionsVisible ? 1 : 0, // Initial opacity based on toggle
            interactive: true // Make regions clickable
        });

        let popupContent = '';
        if (region.wikiLink) {
            popupContent += `<h3><a href="${region.wikiLink}" target="_blank" rel="noopener noreferrer" title="Visit wiki page for ${region.name}">${region.name}</a></h3>`;
        } else {
            popupContent += `<h3>${region.name}</h3>`;
        }

        // NEW: Display type and value in popup
        if (region.type && region.value) {
            popupContent += `<p><em>${region.type}: ${region.value}</em></p>`;
        } else if (region.type) {
            popupContent += `<p><em>Type: ${region.type}</em></p>`;
        }

        popupContent += formatPropertiesForPopup(region.properties, !!region.description);
        if (region.description) {
            popupContent += `<p>${region.description}</p>`;
        }
        polygon.bindPopup(createPopupContent(region), {
            minWidth: 250 // Set a min-width for consistency
        });

        polygon.regionData = region; // Store data for filtering
        currentRegionGroup.addLayer(polygon);
        polygon.bringToBack(); // Ensure regions are behind markers
    });
}

// --- Update region visibility based on main toggle and filters ---
function updateVisibleRegions() {
    if (!currentRegionGroup) return;

    // Get the currently checked region type filters (the individual values)
    const valueFilters = poiFilterContainer.querySelectorAll('.region-type-filter:checked');
    const valueFilterValues = new Set(Array.from(valueFilters).map(cb => cb.value));

    // Check the master toggle state
    const allTypesChecked = filterToggleAllCheckbox.checked && !filterToggleAllCheckbox.indeterminate;

    currentRegionGroup.eachLayer(layer => {
        const region = layer.regionData;
        if (!region || !region.type || !region.value) return;

        // A region is visible if the master toggle is checked OR its specific value is in the checked set.
        const typeMatch = allTypesChecked || valueFilterValues.has(region.value);

        // Apply visibility and interactivity based on *both* the overall toggle AND the type filter match
        if (regionsVisible && typeMatch) { // regionsVisible is synced with markersVisible
            layer.setStyle({
                stroke: true,
                fill: true,
                opacity: 1,
                fillOpacity: region.fillOpacity || 0.2
            });
            layer.bringToBack();
        } else {
            layer.setStyle({
                stroke: false,
                fill: false
            });
        }
    });
}

// --- Populate Sidebar (Recursive Function) ---
function populateSidebar(parentElement, items) {
    // Add this log at the start of the function

    parentElement.innerHTML = '';
    items.forEach(item => {
        // Add this log inside the loop

        const listItem = document.createElement('li');

        if (item.type === 'folder') {
            // Add this log for folders

            listItem.classList.add('folder', 'closed');
            const header = document.createElement('div');
            header.classList.add('folder-header');
            // This line includes the fix from before
            header.innerHTML = `<span class="folder-toggle-icon"></span><span>${item.name || 'Unnamed Folder!'}</span>`; // Add fallback text
            const nestedList = document.createElement('ul');
            nestedList.classList.add('nested-list');

            if (item.children && item.children.length > 0) {
                // Log before recursion
                populateSidebar(nestedList, item.children);
            } else {
                // Log if no children
            }

            header.addEventListener('click', (e) => {
                e.stopPropagation();
                listItem.classList.toggle('closed');
            });

            if (item.id && item.status !== 'coming-soon') {
                header.dataset.mapId = item.id;
                header.title = `Click to toggle '${item.name}', double-click to load map.`;
                header.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    loadMap(item.id, true);
                });
            } else if (item.status === 'coming-soon') {
                header.classList.add('coming-soon');
                // Apply the (Soon) text suffix and title
                header.innerHTML = `<span class="folder-toggle-icon"></span><span>${item.name || 'Unnamed Folder!'} (Soon)</span>`;
                header.title = `${item.name || 'Coming Soon!'} - Coming Soon!`;
                header.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    alert(`The map "${item.name || 'this map'}" is coming soon!`);
                });
            } else {
                header.title = `Click to toggle '${item.name || 'Unnamed Folder!'}'.`;
            }
            listItem.appendChild(header);
            listItem.appendChild(nestedList);

        } else { // Map Item
            // Add this log for map items

            listItem.classList.add('map-item');
            listItem.textContent = item.name || 'Unnamed Map!'; // Add fallback text
            listItem.dataset.mapId = item.id;

            if (item.status === 'coming-soon') {
                listItem.classList.add('coming-soon');
                listItem.textContent = `${item.name || 'Unnamed Map!'} (Soon)`;
                listItem.title = `${item.name || 'Coming Soon!'} - Coming Soon!`;
                listItem.addEventListener('click', (e) => {
                    e.stopPropagation();
                    alert(`The map "${item.name || 'this map'}" is coming soon!`);
                });
            } else {
                listItem.title = `Load map: ${item.name || 'Unnamed Map!'}`;
                listItem.addEventListener('click', (e) => {
                    e.stopPropagation();
                    loadMap(item.id, true);
                });
            }
        }
        parentElement.appendChild(listItem);
    });
}
// populateSidebar is now called within initializeApp after data is loaded

// --- Sidebar Toggle Button Logic ---
toggleBtn.addEventListener('click', () => {
    const newState = container.classList.contains('sidebar-collapsed') ? 'o' : 'c';
    setSidebarState(newState, true);
});

// --- Theme Toggle Logic ---
function applyTheme(theme) {
    if (theme === 'dark') { bodyElement.classList.add('dark-theme'); themeToggle.checked = true; }
    else { bodyElement.classList.remove('dark-theme'); themeToggle.checked = false; }
    // Update divider color in filter panel
    const divider = poiFilterContainer.querySelector('hr');
    if (divider) {
        divider.style.borderColor = theme === 'dark' ? 'var(--glass-border-dark)' : 'var(--glass-border-light)';
    }
}

// --- Sound Control Logic ---
function fadeAudio(audioElement, targetVolume, duration = 1500) { // Shorter fade
    const startVolume = audioElement.volume;
    const volumeChange = targetVolume - startVolume;
    if (volumeChange === 0 && (targetVolume === 0 || !audioElement.paused)) return; // No change needed

    const startTime = Date.now();

    function updateVolume() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(1, elapsed / duration);
        audioElement.volume = Math.max(0, Math.min(1, startVolume + (volumeChange * progress))); // Clamp volume

        if (progress < 1) {
            requestAnimationFrame(updateVolume);
        } else {
            if (targetVolume === 0 && !audioElement.paused) {
                audioElement.pause();
            }
        }
    }

    if (targetVolume > 0 && audioElement.paused) {
        audioElement.volume = 0; // Start from silent
        audioElement.play().then(() => {
            requestAnimationFrame(updateVolume);
        }).catch(e => console.warn('Audio play prevented:', e));
    } else if (targetVolume > 0 && !audioElement.paused) {
        requestAnimationFrame(updateVolume); // Already playing, just adjust volume
    } else if (targetVolume === 0) {
        requestAnimationFrame(updateVolume); // Fading out
    }
}
// --- Function to add roads to map ---
function addRoadsToMap(mapId) {
    if (!currentRoadGroup) {
        currentRoadGroup = L.layerGroup().addTo(map);
    } else {
        currentRoadGroup.clearLayers();
    }

    const selectedMap = findMapRecursive(mapData, mapId);
    if (!selectedMap || !selectedMap.roads || !Array.isArray(selectedMap.roads)) {
        return;
    }

    selectedMap.roads.forEach(road => {
        if (!road.coordinates || road.coordinates.length < 2) {
            console.warn(`Invalid coordinates for road: ${road.name}`);
            return;
        }

        const polyline = L.polyline(road.coordinates, {
            color: road.color || '#ffffff',
            weight: road.weight || 3,
            opacity: road.opacity || 0.8,
            dashArray: road.dashArray || null,
            interactive: true // Make roads clickable
        });

        // Store original opacity for filtering
        polyline.originalOpacity = road.opacity || 0.8;

        let popupContent = '';
        if (road.name) {
            if (road.wikiLink) {
                popupContent += `<h3><a href="${road.wikiLink}" target="_blank" rel="noopener noreferrer" title="Visit wiki page for ${road.name}">${road.name}</a></h3>`;
            } else {
                popupContent += `<h3>${road.name}</h3>`;
            }
        }

        // NEW: Display type and value in popup
        if (road.type) {
            const typeString = road.type.charAt(0).toUpperCase() + road.type.slice(1);
            popupContent += `<p><em>Type: ${typeString}</em></p>`;
        }

        popupContent += formatPropertiesForPopup(road.properties, !!road.description);
        if (road.description) {
            popupContent += `<p>${road.description}</p>`;
        }

        if (popupContent) {
            polyline.bindPopup(createPopupContent(road), { // Use unified creator
                minWidth: 250
            });
        }

        polyline.roadData = road; // Store data for filtering
        currentRoadGroup.addLayer(polyline);
    });
}

function initializeSoundState() {
    // --- NEW: Check for embedded mode ---
    const urlParams = getUrlParameters(); // Need to get params here too
    if (urlParams.embed === 'true' || urlParams.hideUI === 'true') {
        soundEnabled = false; // Ensure state reflects no sound
        // Set icon/title to muted state (even though button is hidden)
        soundIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" x2="17" y1="9" y2="15"/><line x1="17" x2="23" y1="9" y2="15"/></svg>`;
        if (toggleSoundBtn) toggleSoundBtn.title = "Unmute Sound"; // Check if button exists before setting title
        return; // Exit early, do not proceed with sound logic
    }
    // --- END: Embedded mode check ---


    const savedSoundState = localStorage.getItem('soundEnabled');
    // Only proceed if not in embedded mode (checked above)
    soundEnabled = savedSoundState === 'true'; // Convert string to boolean

    // Set initial volume to 0 to prevent autoplay issues on load
    lightAmbient.volume = 0;
    darkAmbient.volume = 0;

    if (soundEnabled) {
        soundIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
        if (toggleSoundBtn) toggleSoundBtn.title = "Mute Sound";
        // Start playing the correct track based on the current theme
        const currentTheme = bodyElement.classList.contains('dark-theme') ? 'dark' : 'light';
        if (currentTheme === 'dark') {
            fadeAudio(darkAmbient, 0.3);
        } else {
            fadeAudio(lightAmbient, 0.3);
        }
    } else {
        soundIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" x2="17" y1="9" y2="15"/><line x1="17" x2="23" y1="9" y2="15"/></svg>`;
        if (toggleSoundBtn) toggleSoundBtn.title = "Unmute Sound";
    }
    // Make button visible now that state is set (only if not embedded)
    if (toggleSoundBtn) toggleSoundBtn.style.display = 'block';
}


// Apply initial theme from storage
const savedTheme = localStorage.getItem('theme') || 'light';
applyTheme(savedTheme);

// --- NEW: Expand/Collapse Popup Logic ---
function togglePopupExpand(button) {
    const container = button.previousElementSibling;
    const isExpanded = container.classList.contains('expanded');

    if (isExpanded) {
        container.classList.remove('expanded');
        button.textContent = 'Read More';
    } else {
        container.classList.add('expanded');
        button.textContent = 'Read Less';
    }
}

function updateCoordinates(e) {
    if (coordsLocked) return;
    if (!currentLatLonBounds || !currentBounds) return;

    const mapWidth = currentBounds[1][1];
    const mapHeight = currentBounds[1][0];
    const { north, south, east, west } = currentLatLonBounds;

    const lon = west + (e.latlng.lng / mapWidth) * (east - west);
    const lat = south + (e.latlng.lat / mapHeight) * (north - south);
    lockedCoords = { lat, lon };
    coords.update(lat, lon);
}

// --- Map Click Handler ---
map.on('click', function (e) {
    if (!isMeasuring && currentBounds) {
    }
});
map.on('dblclick', function (e) {
    coordsLocked = !coordsLocked;
    if (coordsLocked) {
        updateCoordinates(e); // one last update to lock in the current coords
    }
    // Hide filter panel if clicking outside
    if (filtersPanelVisible && !poiFilterContainer.contains(e.originalEvent.target) && e.originalEvent.target !== toggleFiltersBtn && !toggleFiltersBtn.contains(e.originalEvent.target)) {
        toggleFilterPanel();
    }
    // Hide search results if clicking outside
    if (searchResultsContainer.style.display === 'block' && !searchResultsContainer.contains(e.originalEvent.target) && e.originalEvent.target !== poiSearchInput) {
        searchResultsContainer.style.display = 'none';
    }
    // Measurement logic handled separately
    // --- Hide Blurb on Map Click ---
    if (mapBlurbElement.classList.contains('visible')) {
        mapBlurbElement.classList.remove('visible');
        toggleBlurbBtn.classList.remove('active');
    }
});

// --- Blurb Element Click Stop ---
mapBlurbElement.addEventListener('click', (e) => e.stopPropagation());

// --- Coordinate Toggle Button Logic ---
document.getElementById('toggle-coords-btn').addEventListener('click', function () {
    const coordsControl = document.querySelector('.coordinate-control');
    const isVisible = coordsControl.style.display === 'block';
    coordsControl.style.display = isVisible ? 'none' : 'block';
});

// --- Handle Hash Changes / Back/Forward Navigation ---
window.addEventListener('popstate', (event) => {
    const { mapId: hashMpId, sidebarState: hashSidebarState } = parseHash(); // Re-parse hash
    const targetMapId = event.state?.mapId || hashMpId;
    const targetSidebarState = event.state?.sidebarState || hashSidebarState;


    if (targetMapId && targetMapId !== currentlyLoadedMapId) {
        loadMap(targetMapId, false); // Load map without pushing new state
    }
    if (targetSidebarState && targetSidebarState !== currentSidebarState) {
        setSidebarState(targetSidebarState, false); // Set sidebar without updating hash
    }
});
window.addEventListener('beforeunload', () => {
    if (loadingProgressInterval) clearInterval(loadingProgressInterval);
});


// --- Marker Toggle Button Logic ---
toggleMarkersBtn.addEventListener('click', () => {
    markersVisible = !markersVisible;
    regionsVisible = markersVisible; // Sync regions with markers

    toggleMarkersBtn.title = markersVisible ? "Hide Markers & Regions" : "Show Markers & Regions";
    toggleMarkersBtn.classList.toggle('markers-hidden', !markersVisible);

    updateVisibleRegions(); // Update regions visibility
    updateVisibleMarkersAndSearch(); // Update marker visibility

});
// --- Blurb Toggle Button Logic ---
toggleBlurbBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent map click event
    mapBlurbElement.classList.toggle('visible');
    toggleBlurbBtn.classList.toggle('active');
});

// --- Filter Panel Toggle Logic ---
function toggleFilterPanel() {
    filtersPanelVisible = !filtersPanelVisible;
    poiFilterContainer.classList.toggle('visible', filtersPanelVisible);
    toggleFiltersBtn.classList.toggle('active', filtersPanelVisible);
    toggleFiltersBtn.title = filtersPanelVisible ? "Hide Filters" : "Show Filters";
}
toggleFiltersBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFilterPanel();
});

// --- Search Input Logic ---
poiSearchInput.addEventListener('input', updateVisibleMarkersAndSearch);
poiSearchInput.addEventListener('click', (e) => e.stopPropagation());
searchResultsContainer.addEventListener('click', (e) => e.stopPropagation());

// --- Update line visibility based on filters ---
function updateVisibleLines() {
    if (!currentRoadGroup) return;

    const typeFilters = poiFilterContainer.querySelectorAll('.line-type-filter:checked');
    const typeFilterValues = Array.from(typeFilters).map(cb => cb.value);
    const allTypesChecked = filterToggleAllCheckbox.checked && !filterToggleAllCheckbox.indeterminate;

    currentRoadGroup.eachLayer(layer => {
        const road = layer.roadData;
        if (!road) return;

        const roadType = road.type || "Unnamed Road Type"; // Match the logic in populateFilters
        const typeMatch = allTypesChecked || typeFilterValues.includes(roadType);

        // Lines are always "visible" in terms of the master toggle (markersVisible)
        // Their appearance is solely based on type filters.
        if (typeMatch) {
            layer.setStyle({
                opacity: layer.originalOpacity === undefined ? 0.8 : layer.originalOpacity // Restore original or default
            });
        } else {
            layer.setStyle({
                opacity: 0 // Hide
            });
        }
    });
}

// --- Combined Filter Panel Logic ---
poiFilterContainer.addEventListener('change', (e) => {
    const target = e.target;
    if (target.type !== 'checkbox') return;

    // Handle parent group checkbox for regions
    if (target.classList.contains('region-group-filter')) {
        const isChecked = target.checked;
        const groupName = target.value;
        const nestedCheckboxes = target.closest('.filter-group-container').querySelectorAll('.region-type-filter');
        nestedCheckboxes.forEach(checkbox => {
            if (checkbox.dataset.group === groupName) {
                checkbox.checked = isChecked;
            }
        });
    }

    // Handle master "Show All / Hide All" checkbox
    if (target.id === 'filter-toggle-all') {
        const isChecked = target.checked;
        poiFilterContainer.querySelectorAll('.poi-filter-checkbox, .region-group-filter, .region-type-filter, .line-type-filter').forEach(checkbox => {
            if (checkbox.id !== 'filter-toggle-all') {
                checkbox.checked = isChecked;
            }
        });
        filterToggleAllCheckbox.indeterminate = false;
    }

    // Update parent and master toggles' indeterminate states
    updateToggleAllCheckboxState();

    // Trigger visibility updates
    if (target.classList.contains('poi-filter-checkbox') || target.id === 'filter-toggle-all') {
        updateVisibleMarkersAndSearch();
    }
    if (target.classList.contains('region-type-filter') || target.classList.contains('region-group-filter') || target.id === 'filter-toggle-all') {
        updateVisibleRegions();
    }
    if (target.classList.contains('line-type-filter') || target.id === 'filter-toggle-all') {
        updateVisibleLines();
    }
});
// Prevent map click when clicking inside filter panel
poiFilterContainer.addEventListener('click', (e) => {
    const header = e.target.closest('.filter-group-header');
    if (header) {
        const group = header.closest('.filter-group');
        if (group) {
            group.classList.toggle('closed');
        }
    }
    e.stopPropagation();
});


// --- Measurement Tool Logic ---
function handleMeasurementClick(e) {
    if (!isMeasuring || !currentlyLoadedMapId) return;
    if (e.originalEvent.target.closest('.leaflet-control')) return; // Ignore clicks on controls

    const clickPoint = e.latlng;
    const currentMapInfo = findMapRecursive(mapData, currentlyLoadedMapId);
    const scalePx = currentMapInfo?.scalePixels;
    const scaleKm = currentMapInfo?.scaleKilometers;
    const hasValidScale = typeof scalePx === 'number' && scalePx > 0 &&
        typeof scaleKm === 'number' && scaleKm > 0;

    measurementLayerGroup.eachLayer(layer => {
        if (layer instanceof L.Polyline || (layer.options && layer.options.isEndPoint)) {
            measurementLayerGroup.removeLayer(layer);
        }
    });

    if (!measurementStartPoint) {
        measurementStartPoint = clickPoint;
        L.circleMarker(measurementStartPoint, {
            radius: 5, color: 'red', fillColor: '#f03', fillOpacity: 0.8, interactive: false
        }).addTo(measurementLayerGroup)
            .bindTooltip("Start point. Click second point.", { permanent: false, direction: 'top', className: 'measure-tooltip', offset: L.point(0, -5) })
            .openTooltip();
    } else {
        const endPoint = clickPoint;
        const pixelDistance = map.distance(measurementStartPoint, endPoint);
        let distanceString = ""; // Will be constructed based on scale availability
        let kmDistance = null;   // Will store distance in the map's defined units (e.g., km)
        let tooltipContent = '';

        // These lines should already be present just before this 'else' block,
        // but ensure they are correctly fetching scale info for the current map.
        // const currentMapInfo = findMapRecursive(mapData, currentlyLoadedMapId);
        // const scalePx = currentMapInfo?.scalePixels;
        // const scaleKm = currentMapInfo?.scaleKilometers; // Represents the unit value for scale, e.g., km, miles
        // const hasValidScale = typeof scalePx === 'number' && scalePx > 0 &&
        //                         typeof scaleKm === 'number' && scaleKm > 0;

        if (hasValidScale) {
            kmDistance = (pixelDistance / scalePx) * scaleKm;
            // The unit (e.g., "km") is assumed from your JSON's "scaleKilometers" field.
            // If your "scaleKilometers" field actually represents miles, you can change "km" to "miles" here.
            distanceString = `${kmDistance.toFixed(2)} ${currentMapInfo.scaleUnitName || 'units'}`; // Assuming you might add a 'scaleUnitName' to your map JSON, otherwise defaults to 'units'

            // --- ADJUST THESE PACE VALUES FOR YOUR GAME ---
            const normalPaceUnitsPerDay = 25; // e.g., 25 km per day or 25 miles per day
            const fastPaceUnitsPerDay = 40;   // e.g., 40 km per day or 40 miles per day
            // ---

            let daysNormalPace = (kmDistance / normalPaceUnitsPerDay).toFixed(1);
            let daysFastPace = (kmDistance / fastPaceUnitsPerDay).toFixed(1);

            tooltipContent = `Distance: ${distanceString}<br>Normal Pace: ${daysNormalPace} Day(s)<br>Fast Pace: ${daysFastPace}Day(s)`;
        } else {
            // If no valid scale, distance is in pixels.
            distanceString = `${pixelDistance.toFixed(0)} pixels (Scale unknown)`;
            tooltipContent = `Distance: ${distanceString}<br>Days at Normal Pace: N/A (scale unknown)<br>Days at Fast Pace: N/A (scale unknown)`;
        }

        L.circleMarker(endPoint, {
            radius: 5, color: 'blue', fillColor: '#30f', fillOpacity: 0.8, interactive: false, isEndPoint: true
        }).addTo(measurementLayerGroup);

        L.polyline([measurementStartPoint, endPoint], {
            color: 'yellow', weight: 2, dashArray: '5, 5', interactive: false
        }).addTo(measurementLayerGroup)
            .bindTooltip(tooltipContent, { permanent: true, direction: 'center', className: 'measure-tooltip' })
            .openTooltip();

        measurementStartPoint = null; // Reset
    }
}

function toggleMeasurementTool() {
    isMeasuringMultiPoint = !isMeasuringMultiPoint; // Use the new state variable
    measureToolBtn.classList.toggle('active', isMeasuringMultiPoint);
    mapElement.classList.toggle('measuring-cursor', isMeasuringMultiPoint);

    if (isMeasuringMultiPoint) {
        measureToolBtn.title = "Measuring Path... Click to add points. Double-click or Esc to finish.";
        map.on('click', handleMultiPointMeasureClick);
        map.on('mousemove', handleMultiPointMouseMove);
        map.on('dblclick', finalizeMultiPointMeasure); // Add dblclick listener
        document.addEventListener('keydown', handleMeasureKeyDown); // For Esc key

        // Clear previous measurement layers (if any)
        measurementLayerGroup.clearLayers();
        multiPointPath = [];
        multiPointVertexMarkers = [];
        if (multiPointPolyline) map.removeLayer(multiPointPolyline);
        multiPointPolyline = null;
        if (multiPointTotalTooltip) map.removeLayer(multiPointTotalTooltip);
        multiPointTotalTooltip = null;
        // Clear other related layers/tooltips if you add them

        if (filtersPanelVisible) toggleFilterPanel();
    } else {
        measureToolBtn.title = "Measure Distance";
        finalizeMultiPointMeasure(false); // Clean up without making permanent
    }
}

function handleMultiPointMeasureClick(e) {
    if (!isMeasuringMultiPoint || !currentlyLoadedMapId) return;
    if (e.originalEvent.target.closest('.leaflet-control')) return;

    const clickPoint = e.latlng;
    multiPointPath.push(clickPoint);

    // Add a vertex marker
    const vertexMarker = L.circleMarker(clickPoint, {
        radius: 5,
        color: 'cyan', // Or your preferred color
        fillColor: '#0ff',
        fillOpacity: 0.7,
        interactive: false
    }).addTo(measurementLayerGroup);
    multiPointVertexMarkers.push(vertexMarker);

    // Update the polyline
    if (multiPointPolyline) {
        multiPointPolyline.setLatLngs(multiPointPath);
    } else if (multiPointPath.length >= 2) {
        multiPointPolyline = L.polyline(multiPointPath, {
            color: 'yellow',
            weight: 3,
            dashArray: '5, 5',
            interactive: false
        }).addTo(measurementLayerGroup);
    }

    updateMeasurementTooltips(); // New function to handle tooltips
}

function handleMultiPointMouseMove(e) {
    if (!isMeasuringMultiPoint || multiPointPath.length === 0 || !currentlyLoadedMapId) return;

    const currentMapInfo = findMapRecursive(mapData, currentlyLoadedMapId);
    const scalePx = currentMapInfo?.scalePixels;
    const scaleKm = currentMapInfo?.scaleKilometers;

    const lastFixedPoint = multiPointPath[multiPointPath.length - 1];
    const currentMousePos = e.latlng;

    if (temporaryMouseMoveLine) {
        measurementLayerGroup.removeLayer(temporaryMouseMoveLine);
    }
    temporaryMouseMoveLine = L.polyline([lastFixedPoint, currentMousePos], {
        color: 'lime',
        weight: 2,
        dashArray: '3, 3',
        interactive: false
    }).addTo(measurementLayerGroup);

    if (temporaryMouseMoveTooltip) {
        map.removeLayer(temporaryMouseMoveTooltip); // Or measurementLayerGroup.removeLayer
    }

    const pixelDistance = map.distance(lastFixedPoint, currentMousePos);
    let segmentDistanceString = `${pixelDistance.toFixed(0)} px`;
    if (scalePx && scaleKm) {
        const kmDistance = (pixelDistance / scalePx) * scaleKm;
        segmentDistanceString = `${kmDistance.toFixed(2)} km`;
    }

    temporaryMouseMoveTooltip = L.tooltip({
        permanent: true,
        direction: 'top',
        className: 'measure-tooltip',
        offset: L.point(0, -10)
    })
        .setLatLng(currentMousePos)
        .setContent(`Segment: ${segmentDistanceString}`)
        .addTo(map); // Add to map to follow mouse, or to measurementLayerGroup
}

function updateMeasurementTooltips() {
    // Ensure the function doesn't run if not measuring or no path exists
    if (!currentlyLoadedMapId || multiPointPath.length < 1) {
        // Clean up any leftover tooltip if the path becomes empty
        if (multiPointTotalTooltip) {
            map.removeLayer(multiPointTotalTooltip);
            multiPointTotalTooltip = null;
        }
        return;
    }

    // Get map scale information
    const currentMapInfo = findMapRecursive(mapData, currentlyLoadedMapId);
    const scalePx = currentMapInfo?.scalePixels;
    // Assuming scaleKilometers in JSON truly represents kilometers for this calculation
    const scaleKmValue = currentMapInfo?.scaleKilometers;
    // Use 'km' as the unit name if scaleUnitName is not set or is generic,
    // but prefer scaleUnitName if it's specific (e.g. "miles" and you adjusted paces accordingly)
    const scaleUnitName = (currentMapInfo?.scaleUnitName && currentMapInfo.scaleUnitName !== 'units') ? currentMapInfo.scaleUnitName : 'km';

    const hasValidScale = typeof scalePx === 'number' && scalePx > 0 &&
        typeof scaleKmValue === 'number' && scaleKmValue > 0;

    // Calculate total pixel distance
    let totalPixelDistance = 0;
    if (multiPointPath.length >= 2) {
        for (let i = 0; i < multiPointPath.length - 1; i++) {
            totalPixelDistance += map.distance(multiPointPath[i], multiPointPath[i + 1]);
        }
    }

    // --- Build the Tooltip Content String ---
    let tooltipContent = '';
    let displayDistanceString = '';

    if (hasValidScale) {
        // Calculate distance in kilometers (or the unit defined by scaleKmValue)
        const totalDistanceInKm = (totalPixelDistance / scalePx) * scaleKmValue;
        displayDistanceString = `${totalDistanceInKm.toFixed(2)} ${scaleUnitName}`;

        // --- Updated Pace Values in Kilometers per Day ---
        const fastPaceKmPerDay = 48.28;
        const normalPaceKmPerDay = 38.62;
        const slowPaceKmPerDay = 28.97;
        // ---

        // Calculate days for each pace
        const daysFastPace = (totalDistanceInKm / fastPaceKmPerDay).toFixed(1);
        const daysNormalPace = (totalDistanceInKm / normalPaceKmPerDay).toFixed(1);
        const daysSlowPace = (totalDistanceInKm / slowPaceKmPerDay).toFixed(1);

        // Construct the multi-line tooltip content
        tooltipContent = `Total ≈ ${displayDistanceString}<br>Fast ≈ ${daysFastPace} Day(s)<br>Normal ≈ ${daysNormalPace} Day(s)<br>Slow ≈ ${daysSlowPace} Day(s)`;

    } else {
        // Scale is unknown or distance is zero
        if (totalPixelDistance > 0) {
            displayDistanceString = `${totalPixelDistance.toFixed(0)} pixels (Scale unknown)`;
            tooltipContent = `Total: ${displayDistanceString}<br>Days at Fast Pace: N/A<br>Days at Normal Pace: N/A<br>Days at Slow Pace: N/A`;
        } else if (multiPointPath.length === 1) {
            displayDistanceString = "Start point";
            tooltipContent = displayDistanceString; // Only show "Start point"
        } else {
            displayDistanceString = "0 pixels";
            tooltipContent = `Total: ${displayDistanceString}<br>Days at Fast Pace: N/A<br>Days at Normal Pace: N/A<br>Days at Slow Pace: N/A`;
        }
    }
    // --- Tooltip Content String is now built ---

    // Remove the previous total tooltip (if it exists)
    if (multiPointTotalTooltip) {
        map.removeLayer(multiPointTotalTooltip);
    }

    // Create and add the new total tooltip using the constructed content
    if (multiPointPath.length > 0) {
        multiPointTotalTooltip = L.tooltip({
            permanent: true,
            direction: 'right',
            className: 'measure-tooltip',
            offset: L.point(10, 0) // Position offset from the point
        })
            .setLatLng(multiPointPath[multiPointPath.length - 1]) // Position at the last point
            .setContent(tooltipContent) // Use the full tooltipContent string
            .addTo(map);
    } else {
        multiPointTotalTooltip = null; // Ensure it's null if path is empty
    }
}

function finalizeMultiPointMeasure(makePermanent = true) {
    if (!isMeasuringMultiPoint && !makePermanent) { // If called to just clean up
        measurementLayerGroup.clearLayers();
        if (multiPointPolyline) map.removeLayer(multiPointPolyline);
        if (multiPointTotalTooltip) map.removeLayer(multiPointTotalTooltip);
        if (temporaryMouseMoveLine) measurementLayerGroup.removeLayer(temporaryMouseMoveLine);
        if (temporaryMouseMoveTooltip) map.removeLayer(temporaryMouseMoveTooltip);
        multiPointPath = [];
        multiPointVertexMarkers = [];
        multiPointPolyline = null;
        multiPointTotalTooltip = null;
        temporaryMouseMoveLine = null;
        temporaryMouseMoveTooltip = null;
    }

    isMeasuringMultiPoint = false;
    map.off('click', handleMultiPointMeasureClick);
    map.off('mousemove', handleMultiPointMouseMove);
    map.off('dblclick', finalizeMultiPointMeasure);
    document.removeEventListener('keydown', handleMeasureKeyDown);
    mapElement.classList.remove('measuring-cursor');
    measureToolBtn.classList.remove('active');
    measureToolBtn.title = "Measure Distance";


    if (temporaryMouseMoveLine) {
        measurementLayerGroup.removeLayer(temporaryMouseMoveLine);
        temporaryMouseMoveLine = null;
    }
    if (temporaryMouseMoveTooltip) {
        map.removeLayer(temporaryMouseMoveTooltip);
        temporaryMouseMoveTooltip = null;
    }

    if (!makePermanent || multiPointPath.length < 2) {
        measurementLayerGroup.clearLayers();
        if (multiPointPolyline) map.removeLayer(multiPointPolyline);
        multiPointPolyline = null;
        if (multiPointTotalTooltip) map.removeLayer(multiPointTotalTooltip);
        multiPointTotalTooltip = null;
        multiPointPath = [];
        multiPointVertexMarkers = [];
    } else {
        // Path and markers are already on measurementLayerGroup.
        // Make the total tooltip permanent on the polyline itself.
        if (multiPointPolyline && multiPointTotalTooltip) {
            // The multiPointTotalTooltip already has the full content
            // from the last call to updateMeasurementTooltips.
            // We just need to re-bind it or ensure it stays.
            // For simplicity, let's ensure it uses the latest content if it was removed and re-added.
            const finalContent = multiPointTotalTooltip.getContent(); // Get the already formatted content
            map.removeLayer(multiPointTotalTooltip); // Remove the one that was following the mouse

            multiPointPolyline.bindTooltip(finalContent, { // Use the captured finalContent
                permanent: true,
                direction: 'center',
                className: 'measure-tooltip',
                sticky: true // Make it sticky to the line
            }).openTooltip();
            // Ensure the individual vertex markers are cleared if they are not desired permanently
            multiPointVertexMarkers.forEach(marker => measurementLayerGroup.removeLayer(marker));
            multiPointVertexMarkers = [];
        }
    }
}

function handleMeasureKeyDown(e) {
    if (e.key === 'Escape' && isMeasuringMultiPoint) {
        e.preventDefault();
        finalizeMultiPointMeasure(false); // Cancel measurement
    }
}

measureToolBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMeasurementTool(); // This should now call the multi-point version
});

// --- Inject Map Icon CSS ---
// REMOVED: Icons are now inline SVGs.

// --- NEW: Data Loading Functions ---
async function loadMapData() {
    try {
        // Show loading indicator for data fetch
        if (loadingIndicator) {
            loadingIndicator.style.display = 'flex';
            const progressBar = loadingIndicator.querySelector('.progress-bar');
            const loadingText = loadingIndicator.querySelector('.loading-text');
            if (progressBar) progressBar.style.width = '10%'; // Initial progress
            if (loadingText) loadingText.textContent = "Loading Map Index...";
        }

        const response = await fetch('maps/maps.json');
        if (!response.ok) throw new Error(`Failed to load maps.json: ${response.statusText}`);
        const maps = await response.json();

        if (loadingIndicator && loadingIndicator.querySelector('.progress-bar')) {
            loadingIndicator.querySelector('.progress-bar').style.width = '30%';
            loadingIndicator.querySelector('.loading-text').textContent = "Processing Map Data...";
        }

        // Process map data (fetch children, etc.)
        mapData = await processMapData(maps);

        if (loadingIndicator && loadingIndicator.querySelector('.progress-bar')) {
            loadingIndicator.querySelector('.progress-bar').style.width = '100%';
        }

        // Hide loading indicator *before* initializing the rest of the app
        if (loadingIndicator) {
            setTimeout(() => { loadingIndicator.style.display = 'none'; }, 200); // Short delay
        }

        // --- Keyboard Shortcut Logic ---
        const keyboardHelpModal = document.getElementById('keyboard-help-modal');
        const closeKeyboardHelpBtn = document.getElementById('close-keyboard-help-btn');

        if (closeKeyboardHelpBtn) { // Check if modal exists
            closeKeyboardHelpBtn.addEventListener('click', () => {
                if (keyboardHelpModal) keyboardHelpModal.style.display = 'none';
            });
        }

        function isInputFocused() {
            const activeElement = document.activeElement;
            return activeElement && (activeElement.tagName === 'INPUT' ||
                activeElement.tagName === 'TEXTAREA' ||
                activeElement.isContentEditable);
        }

        document.addEventListener('keydown', function (e) {
            // Handle modal display first
            if (e.key === '?') {
                if (!isInputFocused()) { // Don't trigger if typing '?' in search
                    e.preventDefault();
                    if (keyboardHelpModal) {
                        keyboardHelpModal.style.display = keyboardHelpModal.style.display === 'none' ? 'flex' : 'none';
                    }
                    return;
                }
            }

            // If help modal is open, Esc should close it
            if (keyboardHelpModal && keyboardHelpModal.style.display !== 'none' && e.key === 'Escape') {
                e.preventDefault();
                keyboardHelpModal.style.display = 'none';
                return;
            }

            // Handle Escape for other UI elements
            if (e.key === 'Escape') {
                if (map.getPanes().popupPane.firstChild) { // Check if a Leaflet popup is open
                    map.closePopup();
                    e.preventDefault();
                } else if (filtersPanelVisible) {
                    toggleFilterPanel(); // Your existing function
                    e.preventDefault();
                } else if (searchResultsContainer.style.display === 'block') {
                    searchResultsContainer.style.display = 'none';
                    if (poiSearchInput) poiSearchInput.blur();
                    e.preventDefault();
                } else if (isMeasuringMultiPoint) { // For the new measurement tool
                    finalizeMultiPointMeasure(false); // Cancel measurement
                    e.preventDefault();
                }
                // Add other Escape handlers here if needed
                return; // Processed Escape, no further checks for this key press
            }

            // For other shortcuts, don't act if an input is focused or help modal is open
            if (isInputFocused() || (keyboardHelpModal && keyboardHelpModal.style.display !== 'none')) {
                return;
            }

            // Non-input-focused shortcuts
            switch (e.key.toLowerCase()) {
                case '+':
                case '=':
                    if (map) map.zoomIn();
                    e.preventDefault();
                    break;
                case '-':
                    if (map) map.zoomOut();
                    e.preventDefault();
                    break;
                case 's':
                    if (toggleBtn) toggleBtn.click(); // Toggle Sidebar
                    e.preventDefault();
                    break;
                case 't':
                    if (themeToggle) themeToggle.click(); // Toggle Theme
                    e.preventDefault();
                    break;
                case 'm':
                    if (measureToolBtn && measureToolBtn.style.display !== 'none') {
                        measureToolBtn.click();
                        e.preventDefault();
                    }
                    break;
                case 'h': // Toggle Markers/Regions
                    if (toggleMarkersBtn && toggleMarkersBtn.style.display !== 'none') {
                        toggleMarkersBtn.click();
                        e.preventDefault();
                    }
                    break;
                case 'f': // Toggle Filters Panel
                    if (toggleFiltersBtn && toggleFiltersBtn.style.display !== 'none') {
                        toggleFiltersBtn.click();
                        e.preventDefault();
                    }
                    break;
                case '/':
                    if (searchControlContainer && searchControlContainer.style.display !== 'none' && poiSearchInput) {
                        poiSearchInput.focus();
                        e.preventDefault();
                    }
                    break;
            }

            // Example for Ctrl/Cmd + F (if you want to override browser find for your search)
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
                if (searchControlContainer && searchControlContainer.style.display !== 'none' && poiSearchInput) {
                    poiSearchInput.focus();
                    e.preventDefault(); // Prevent browser's default find
                }
            }
        });


        // Now that data is loaded, initialize the application
        initializeApp();

    } catch (error) {
        console.error('Error loading map data:', error);
        if (loadingIndicator) {
            const loadingText = loadingIndicator.querySelector('.loading-text');
            const spinner = loadingIndicator.querySelector('.spinner');
            const progressContainer = loadingIndicator.querySelector('.progress-container');
            if (loadingText) loadingText.textContent = "Error loading map data. Please check console.";
            if (spinner) spinner.style.display = 'none';
            if (progressContainer) progressContainer.style.display = 'none';
            // Keep indicator visible for a bit longer on error
            // setTimeout(() => { loadingIndicator.style.display = 'none'; }, 5000);
        }
        // Optionally display an error message to the user in the UI
        sidebar.innerHTML = '<h2>Error</h2><p>Could not load map data. Please try refreshing the page or check the console for details.</p>';
    }
}

// --- NEW Recursive Helper Function ---
async function processChild(childId, level = 0) {
    // Base case for recursion depth limit or invalid ID
    if (level > 5 || !childId || typeof childId !== 'string') {
        // console.warn(`Skipping child processing for: ${childId} at level ${level}`);
        // Return a placeholder that populateSidebar can handle as coming soon/error
        return { id: childId, name: String(childId || 'Invalid Child'), status: 'coming-soon', error: true };
    }

    try {
        // Optional: Handle known 'coming-soon' IDs directly if needed
        // if (childId === 'some-known-coming-soon-id') {
        //     return { id: childId, name: 'Known Coming Soon Item', status: 'coming-soon' };
        // }

        // Fetch the child map data
        const response = await fetch(`maps/${childId}.json`);

        if (response.ok) {
            let childData = await response.json();

            // *** RECURSIVE STEP ***
            // Check if the fetched child ALSO has children that are string IDs
            if (childData.children && Array.isArray(childData.children) && childData.children.length > 0 && typeof childData.children[0] === 'string') {
                const subChildIds = childData.children;
                childData.children = []; // Prepare for processed sub-children
                const subChildPromises = subChildIds.map(subId => processChild(subId, level + 1)); // Recursive call
                childData.children = await Promise.all(subChildPromises);
            }
            // *** END RECURSIVE STEP ***

            // Ensure basic properties exist if fetched data is incomplete
            childData.id = childData.id || childId;
            childData.name = childData.name || childId; // Use ID as fallback name

            return childData; // Return the processed child data

        } else if (response.status === 404) {
            console.warn(`Child map file not found: maps/${childId}.json - Marking as 'coming-soon'`);
            // File not found, treat as coming soon
            return { id: childId, name: childId, status: 'coming-soon', error: 'not found' };
        } else {
            console.warn(`Failed to load child map: ${childId} (${response.statusText}) - Marking as 'coming-soon'`);
            // Other fetch error, treat as coming soon
            return { id: childId, name: childId, status: 'coming-soon', error: `Workspace failed (${response.status})` };
        }
    } catch (error) {
        console.error(`Error processing child ${childId}:`, error);
        // Error during fetch/parse, treat as coming soon
        return { id: childId, name: childId, status: 'coming-soon', error: error.message };
    }
}
async function processMapData(maps) {
    const processedMaps = [];

    for (let map of maps) {
        if (map.children && Array.isArray(map.children) && map.children.length > 0 && typeof map.children[0] === 'string') {
            const childIds = map.children;
            map.children = [];
            const childPromises = childIds.map(childId => processChild(childId, 1));
            map.children = await Promise.all(childPromises);
        }
        processedMaps.push(map);
    }
    return processedMaps;
}

function initializeApp() {
    const urlParams = getUrlParameters();

    // Handle embedded view - hide UI elements
    if (urlParams.embed === 'true' || urlParams.hideUI === 'true') {
        const wipPopup = document.getElementById('wip-popup');
        if (wipPopup) wipPopup.style.display = 'none';

        const bottomLinkBar = document.getElementById('bottom-link-bar');
        if (bottomLinkBar) bottomLinkBar.style.display = 'none';

        if (toggleBlurbBtn) toggleBlurbBtn.style.display = 'none';
        if (mapBlurbElement) mapBlurbElement.classList.remove('visible');

        // Hide the sidebar toggle button
        const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
        if (toggleSidebarBtn) toggleSidebarBtn.style.display = 'none';

        // --- ADD THIS LINE ---
        // Hide the sound toggle button
        const toggleSoundBtn = document.getElementById('toggle-sound-btn');
        if (toggleSoundBtn) toggleSoundBtn.style.display = 'none';
        // --- END ADDED LINE ---

        // Force sidebar to be collapsed initially
        setSidebarState('c', false);

        // Optional: Add a class to the body for additional styling
        document.body.classList.add('embedded-view');

        if (window.innerWidth <= 600) { // Or your preferred mobile breakpoint
            const wipPopup = document.getElementById('wip-popup');
            if (wipPopup) {
                setTimeout(() => {
                    wipPopup.classList.add('fade-out');
                }, 7000); // 7 seconds delay
            }
        }
    }
    // --- END: Embedding Check ---


    // Populate sidebar now that mapData is ready
    populateSidebar(mapListElement, mapData);

    // Determine initial map and sidebar state
    const { mapId: initialMapIdFromHash, sidebarState: initialSidebarState } = parseHash();
    let mapIdToLoad = initialMapIdFromHash;
    let mapToLoadData = null;

    // If hash points to a valid map, try to load it
    if (mapIdToLoad) {
        mapToLoadData = findMapRecursive(mapData, mapIdToLoad);
    }

    // If hash map is invalid/missing/coming-soon, or no hash map, find the default
    if (!mapToLoadData || mapToLoadData.status === 'coming-soon') {
        mapIdToLoad = findFirstLoadableIdRecursive(mapData);
        mapToLoadData = findMapRecursive(mapData, mapIdToLoad);
    }


    setSidebarState(initialSidebarState, false); // Set sidebar state without updating hash yet

    // Hide controls initially (loadMap will show them if needed)
    toggleMarkersBtn.style.display = 'none';
    toggleFiltersBtn.style.display = 'none';
    measureToolBtn.style.display = 'none';
    // toggleSoundBtn is handled above for embed mode, otherwise shown by initializeSoundState
    searchControlContainer.style.display = 'none';
    searchResultsContainer.style.display = 'none';
    poiFilterContainer.classList.remove('visible');

    // Load the determined map
    if (mapIdToLoad && mapToLoadData && mapToLoadData.status !== 'coming-soon') {
        markersVisible = true; // Default to visible
        regionsVisible = true;  // <--- ADD THIS LINE TO ENSURE REGIONS ARE ALSO VISIBLE BY DEFAULT
        loadMap(mapIdToLoad, false); // Load map, don't update hash yet
    } else {
        console.error("No loadable map data found for initialization.");
        sidebar.innerHTML = '<h2>Select Map</h2><p>No maps available.</p>';
        mapBlurbElement.classList.remove('visible');
        // Ensure loading indicator is hidden if it somehow wasn't
        if (loadingIndicator) loadingIndicator.style.display = 'none';
        // Set a clean hash state
        history.replaceState(null, '', generateHash('', initialSidebarState));
        return; // Stop initialization
    }

    // Initialize sound state (after theme is applied)
    // This will now check for embed mode internally
    initializeSoundState();

    // Set the correct initial history state *after* loading the map
    const correctInitialHash = generateHash(currentlyLoadedMapId, currentSidebarState);
    const currentSearch = window.location.search; // Get current search params like ?embed=true
    const finalUrl = `${currentSearch}${correctInitialHash}`;
    history.replaceState({ mapId: currentlyLoadedMapId, sidebarState: currentSidebarState }, mapToLoadData?.name || '', finalUrl);
}

// --- Start the application by loading data ---
loadMapData();
