# Hiraeth Interactive World Map Viewer

This project is an interactive map viewer designed to display custom world maps, specifically for the world of Hiraeth. It allows users to explore different regions, view points of interest (POIs), and interact with map features.

## Description

Built using Leaflet.js, this tool provides a dynamic way to navigate and visualize the various locations within the Hiraeth setting. It loads map configurations and points of interest from JSON data files, offering features like zooming, panning, marker popups, region overlays, filtering, and searching. The project also includes an editing tool (`point-finder.html`) for managing map data.

## Features

* **Interactive Map Display:** Uses Leaflet.js to display map tiles with smooth zooming and panning.
* **Dynamic Data Loading:** Loads map configurations (`maps.json`) and detailed map data (individual map JSON files like `icebeach.json`, `Fair-Content.json`) dynamically.
* **Sidebar Navigation:** A collapsible sidebar lists available maps, organized into folders, including indicators for maps that are "coming soon".
* **Points of Interest (POIs):** Displays markers for POIs defined in the map data, with popups showing details (name, type, description, wiki link).
* **Region Overlays:** Displays configurable colored polygon regions on the map with popups for details.
* **Marker & Region Toggling:** Allows users to show or hide markers and regions globally.
* **Filtering:** A filter panel allows users to toggle the visibility of POIs by type group and regions by type.
* **Search Functionality:** Users can search for POIs by name, with results displayed dynamically.
* **Dark Mode:** Includes a theme toggle for switching between light and dark modes, saved using localStorage.
* **Measurement Tool:** Allows users to measure distances on the map in pixels and configured units (e.g., kilometers).
* **Ambient Sound:** Plays different ambient background sounds depending on the selected theme (light/dark), with a mute toggle.
* **Embeddable View:** Supports URL parameters (`?embed=true` or `?hideUI=true`) to hide UI elements for embedding.
* **Map Blurb:** Displays a short description or note for the currently loaded map.
* **Map Data Editor:** A separate tool (`point-finder.html`) for creating and editing map points and regions, and exporting the data as JSON.
* **About Page:** A simple page providing context about the Hiraeth world and the map project.

## Technology Stack

* HTML5
* CSS3
* JavaScript (ES6+)
* [Leaflet.js](https://leafletjs.com/) (Interactive Map Library)

## Project Structure

```
maps.hiraeth.wiki/
├── index.html          # Main map viewer application
├── about.html          # About page providing context
├── point-finder.html   # Tool for editing map data
├── maps/
│   ├── maps.json       # Index file listing available maps and folders
│   ├── icebeach.json   # Example map data file
│   ├── Fair-Content.json # Example map data file
│   └── *.webp          # Map image files (referenced in JSON)
├── sounds/
│   ├── *.mp3           # Ambient sound files
└── *.png               # Favicons and touch icons
```

## How to Use/Run

1.  Clone the repository.
2.  Open the `index.html` file in a modern web browser.
3.  **Note:** Due to browser security restrictions (CORS) when fetching local JSON files (`Workspace` API), you might need to run this project from a local web server. Many simple options exist (e.g., Python's `http.server`, Node.js `http-server`, VS Code Live Server extension).

## Data Format

* **`maps/maps.json`**: An array of map/folder objects. Folders contain a `children` array listing IDs of child maps/folders. Maps have `id`, `name`, `width`, `height`, `imageUrl`, etc..
* **Individual Map JSON (`maps/<map_id>.json`)**: Contains metadata for a specific map:
    * `id`, `name`, `width`, `height`, `imageUrl`
    * `scalePixels`, `scaleKilometers`: For the measurement tool
    * `blurb`: Short HTML description displayed on the map
    * `pointsOfInterest`: Array of POI objects (`coords`, `name`, `type`, `description`, `wikiLink`)
    * `regions`: Array of region objects (`id`, `name`, `description`, `type`, `color`, `fillColor`, `fillOpacity`, `wikiLink`, `coordinates` array)

## Author/Credits

* Created by Jax SN Johnson for the world of Hiraeth.