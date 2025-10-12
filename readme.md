# Hiraeth Interactive World Map Viewer

An interactive map viewer for the world of Hiraeth, built with Leaflet.js.

**[Live Demo](http://maps.hiraeth.wiki)**

## About The Project

This project is an interactive map viewer designed to display custom world maps, specifically for the world of Hiraeth. It allows users to explore different regions, view points of interest (POIs), and interact with map features.

Built with vanilla JavaScript and Leaflet.js, this tool provides a dynamic way to navigate and visualize the various locations within the Hiraeth setting. It loads map configurations and points of interest from JSON data files, offering features like zooming, panning, marker popups, region overlays, filtering, and searching.

## Getting Started

To get a local copy up and running, follow these simple steps.

### Prerequisites

You need a modern web browser and a local web server to run this project. Due to browser security restrictions (CORS) when fetching local JSON files, you cannot simply open `index.html` from the file system.

### Installation

1. Clone the repo
   ```sh
   git clone https://github.com/jaxsnjohnson/map.hiraeth.git
   ```
2. Start a local web server. For example, using Python:
   ```sh
   python -m http.server
   ```
   Or, if you have Node.js installed:
   ```sh
   npx http-server
   ```
3. Open your browser and navigate to `http://localhost:8000` (or the port your server is running on).

## Project Architecture

### Technology Stack

*   **HTML5 & CSS3**: For the structure and styling of the web pages.
*   **Vanilla JavaScript (ES6+)**: Powers the application logic, including data loading, UI interactions, and Leaflet.js integration.
*   **[Leaflet.js](https://leafletjs.com/)**: A lightweight, open-source library for interactive maps. It was chosen for its simplicity, performance, and ease of use with custom map tiles and overlays.

### Project Structure

```
.
├── index.html          # Main map viewer application
├── about.html          # About page providing context
├── point-finder.html   # Tool for creating and editing map data
├── maps/
│   ├── maps.json       # Index file listing available maps and folders
│   ├── [map_id].json   # Map data files (points, regions, etc.)
│   └── [map_id].webp   # Map image files
├── sounds/
│   └── *.mp3           # Ambient sound files
└── images/
    └── *.png           # UI images and screenshots
```

### Data Format

The map data is stored in JSON files within the `maps/` directory.

*   **`maps/maps.json`**: This file acts as an index of all available maps and how they are organized in the sidebar. It contains an array of map and folder objects.
*   **`<map_id>.json`**: Each map has its own JSON file containing its metadata:
    *   `id`, `name`, `width`, `height`, `imageUrl`
    *   `scalePixels`, `scaleKilometers`: For the measurement tool.
    *   `blurb`: A short HTML description displayed on the map.
    *   `pointsOfInterest`: An array of POI objects (`coords`, `name`, `type`, `description`, `wikiLink`).
    *   `regions`: An array of region objects (`id`, `name`, `description`, `type`, `color`, `fillColor`, `fillOpacity`, `wikiLink`, `coordinates`).

## Features

*   **Interactive Map Display**: Smooth zooming and panning with Leaflet.js.
*   **Dynamic Data Loading**: Maps and POIs are loaded from JSON files.
*   **Sidebar Navigation**: Collapsible sidebar with a list of available maps.
*   **Markers & Regions**: Toggleable markers for POIs and colored polygon regions.
*   **Filtering & Search**: Filter POIs and regions by type, and search for POIs by name.
*   **Dark Mode**: Switch between light and dark themes.
*   **Measurement Tool**: Measure distances on the map.
*   **Ambient Sounds**: Background sounds that change with the theme.
*   **Embeddable View**: UI can be hidden for embedding in other websites.
*   **Map Data Editor**: A separate tool (`point-finder.html`) for creating and editing map data.
