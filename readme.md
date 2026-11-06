# Hiraeth Interactive World Map Viewer

An interactive map viewer for the world of Hiraeth, built with Leaflet.js.

**[Live maps](https://maps.hiraeth.wiki)**

## About The Project

This project is an interactive map viewer designed to display custom world maps, specifically for the world of Hiraeth. It allows users to explore different regions, view points of interest (POIs), and interact with map features.

Built with vanilla JavaScript and Leaflet.js, this tool provides a dynamic way to navigate and visualize the various locations within the Hiraeth setting. It loads map configurations and points of interest from JSON data files, offering features like zooming, panning, marker popups, region overlays, filtering, and searching.

## Getting Started

To get a local copy up and running, follow these simple steps.

### Prerequisites

You need a modern web browser, Node.js 22 or newer, and a local web server. ImageMagick with WebP support is required to build the production map tiles. On macOS, install the image tools with `brew install imagemagick webp`.

### Installation

1. Clone the repo
   ```sh
   git clone https://github.com/Hiraeth-Adventuring-Information-Repos/map.hiraeth.git
   cd map.hiraeth
   ```
2. Install dependencies and build the production bundle:
   ```sh
   npm ci
   npm run build:pages
   ```
3. Serve the generated bundle. For example, using Python:
   ```sh
   python3 -m http.server 8000 --directory dist
   ```
   Or with Node.js:
   ```sh
   npx http-server dist -p 8000
   ```
4. Open your browser and navigate to `http://localhost:8000`.

## Validation And Deployment

Routing is an experimental URL opt-in. Add `?routing=1` before the map hash, for example `/index.html?routing=1#Astrousia-s=o`. Normal URLs hide Directions, building address hit areas and routing shortcuts, and skip loading the routing scripts and address stylesheet. Embedded views also skip these assets. Routing assets are cached for offline reuse after an opted-in visit; installation does not download them. The flag is retained during map navigation and sharing; it is never saved as a browser preference.

The editor is archived for now. Its source and restoration notes are in [archive/editor](archive/editor/README.md).

Install dependencies and run the complete local release check:

```sh
npm ci
npm run publish:check
```

The publish check regenerates the atlas index, validates map data, runs the unit suite, and builds the optimized GitHub Pages artifact in `dist/`. The Pages build minifies owned JS/CSS, compacts JSON, and moves cross-map search data into a lazy payload while preserving native-resolution map tiles. Generated tiles are reused from `.cache/pages-tiles` and only stale map fingerprints are rebuilt. Share JPEGs are reused from `.cache/pages-share-thumbnails` when source bytes and rendering settings match; cached bytes are checked for damage, and metadata HTML is regenerated every run. Both Pages workflows persist these caches separately. Both directories are generated and ignored by Git for new files; existing legacy files in `dist/` remain tracked.

Run `npm run validate:dist` to check an existing `dist/` artifact without rebuilding or changing files. To check another build, use `npm run validate:dist -- /path/to/dist`. This checks required and forbidden files, tile fingerprints and native detail, runtime budgets, compact JSON, deferred search, and routing payload integrity. Both Pages workflows run this check before uploading their artifacts.

Run `npx playwright install chromium firefox` once, then `npm run test:pages` to exercise the built artifact in both browsers. For an isolated build, use `PAGES_TEST_ROOT=/path/to/dist npm run test:pages`. The command requires an existing artifact and never rebuilds it. It checks map artwork and the Firefox canvas path, search, sharing, navigation, routing opt-in, failed-load recovery, and map-switch races. Both workflows require these checks before upload and retain failure traces and screenshots.

Pushes to `main` are deployed by `.github/workflows/pages-deploy.yml`. The workflow restores map tiles by source fingerprint, regenerates only changed maps, uploads `dist/` as the Pages artifact, and deploys it through GitHub Actions. The repository's Pages source must be set to **GitHub Actions** rather than branch publishing.

When changing browser-delivered JavaScript, CSS, map data, or tiles, bump `assets.version` in `site.config.json` and the matching default version in `js/app-config.js` so versioned URLs and service-worker caches advance together.

## Project Architecture

### Technology Stack

*   **HTML5 & CSS3**: For the structure and styling of the web pages.
*   **Vanilla JavaScript (ES6+)**: Powers the application logic, including data loading, UI interactions, and Leaflet.js integration.
*   **[Leaflet.js](https://leafletjs.com/)**: A lightweight, open-source library for interactive maps. It was chosen for its simplicity, performance, and ease of use with custom map tiles and overlays.

### Project Structure

```
.
├── index.html          # Main map viewer application
├── maps/
│   ├── maps.json       # Flat authoring manifest for map order and hierarchy
│   ├── atlas-index.json# Generated runtime atlas/search index
│   ├── [map_id].json   # Map data files (points, regions, etc.)
│   └── [map_id].webp   # Map image files
├── scripts/            # Atlas, tile, validation, and Pages build tooling
├── dist/               # Generated Pages artifact; some legacy files are tracked
├── sounds/
│   └── *.mp3           # Ambient sound files
└── images/
    └── *.png           # UI images and screenshots
```

### Data Format

The map data is stored in JSON files within the `maps/` directory.

*   **`maps/maps.json`**: This file is the flat authoring manifest for map order and hierarchy. Each entry describes one map or folder, and relationships are expressed with `parentId`, `order`, and `dataUrl` instead of nested child objects.
*   **`maps/atlas-index.json`**: This generated file is the runtime atlas manifest. The app boots from it, builds atlas search from it, and uses its `dataUrl` entries to lazy-load full map definitions.
*   **`<map_id>.json`**: Each map has its own JSON file containing its metadata:
    *   `id`, `name`, `width`, `height`, `imageUrl`
    *   `scalePixels`, `scaleKilometers`: For the measurement tool.
    *   `blurb`: A short HTML description displayed on the map.
    *   `pointsOfInterest`: An array of POI objects (`coords`, `name`, `type`, `description`, `wikiLink`, optional `linkedMapId`).
    *   `regions`: An array of region objects (`id`, `name`, `description`, `type`, `color`, `fillColor`, `fillOpacity`, `wikiLink`, `coordinates`, optional `linkedMapId`).

## Features

*   **Interactive Map Display**: Smooth zooming and panning with Leaflet.js.
*   **Dynamic Data Loading**: The app boots from a generated atlas index, then lazy-loads each full map JSON on demand.
*   **Atlas Navigation**: A dedicated collapsible Atlas for browsing maps and hierarchy.
*   **Feature Details**: Compact map popups open a larger desktop sheet or mobile full-screen detail view.
*   **Markers & Regions**: Toggleable markers for POIs and colored polygon regions.
*   **Filtering & Search**: Filter POIs and regions by type, and search for POIs by name.
*   **Dark Mode**: Switch between light and dark themes.
*   **Measurement Tool**: Measure distances on the map.
*   **Ambient Sounds**: Background sounds that change with the theme.
*   **Embeddable View**: UI can be hidden for embedding in other websites.

### Map link previews

The Pages build generates `/share/<map-id>/index.html` and a 1200 × 630 JPEG for every image-backed atlas map, including parent maps. The Share controls use these URLs automatically. Each page includes static Open Graph and Twitter metadata using the map name, description, and artwork; thumbnails fit the whole image without cropping. Descriptions prefer `selectorDescription`, then `summary`, `blurb`, and `description`, with a generated fallback.

Browsers immediately open the atlas at the matching `#map-id`, retaining shared points, regions, lines, viewport coordinates, and closed-sidebar state. Existing hash links still work, but cannot have distinct previews because URL fragments are not sent to servers. Copy the Share link to get a map-specific preview. `brand.publicUrl` supplies the public origin and base path, including when sharing from a local viewer.

Preview pages and images are generated during `npm run build:pages` and checked through `npm run publish:check`. They become available after deploying the Pages bundle. Messaging apps control presentation and may cache older previews.
