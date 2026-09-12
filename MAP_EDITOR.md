# Hiraeth download-only editor

**Open a map → edit in the browser → Download changes.** No password is needed.

## Start

Run `npm ci`, then `npm run editor` (or `npm run studio`) and open `http://127.0.0.1:8010/studio`.

For LAN access, set `HOST` to the computer's LAN address and `MAP_STUDIO_ALLOWED_HOSTS` to the comma-separated addresses/hostnames visitors use. `PORT` defaults to `8010`. The server serves map files and the editor without authentication, and rejects all write requests. Existing password files are unused and are not deleted.

## Editing and downloads

Click a POI, region, or line to edit its details. **Edit on map** closes the form so you can move markers or vertices. **Edit details** reopens it. Use **+ Place**, **+ Region**, and **+ Line** for new features; finish or cancel a shape before downloading. Undo/redo, unsaved-change prompts, and the DM-only theme remain available.

Regions and lines can mix sharp corners and cubic **Bézier curves**. Click to place points, then select an orange point and choose **Curve point**. Drag its blue diamond handles independently to shape the incoming and outgoing curves. The outline passes through the orange point; **Make corner** removes that point's handles. Points without handles remain sharp, and edges between two sharp points stay straight. Dragging an orange point moves its handles with it. Polygon closing edges also support curves.

**Undo point** (Backspace/Delete) removes the last draft point. **Finish shape** (Enter with the canvas focused) keeps both the editable anchors/handles and a sampled outline that existing viewers can display. After finishing, use **Edit on map** to select points and adjust their curves; these edits support undo/redo. Bézier handles survive JSON downloads and reopening the downloaded map. Editing the raw Coordinates field replaces the curve with the entered straight segments. **Cancel drawing** or Escape discards a draft; unfinished drafts recover after reloading the tab.

In the public viewer, **Measure Distance** keeps POIs, regions, and lines visible while clicks place measurement points. Double-click or Enter finishes; Backspace/Delete removes the last point; Escape cancels. Measurements follow the straight segments you place, preserving exact waypoint distances.

**Download changes** downloads the current map JSON. When map-index settings also changed, it downloads a ZIP containing both the map JSON and `maps/maps.json`, using their existing paths and formats. Export options also let you download JSON separately. “Download requested” means the browser was asked to save a copy; it does not mean server files were replaced.

All edits remain in your browser until downloaded. To install them, compare your download against the latest originals and copy the intended files into the maps folder yourself. Reopening a map loads the server's original file, not a previous download.

New map prepares a ZIP in the browser containing JSON, WebP artwork, a thumbnail, and the updated map index. Artwork is not uploaded. Add the downloaded files to the maps folder yourself, then refresh the editor to work on the new map. WebP export support is required for the thumbnail and for converting PNG/JPEG artwork.

## Preservation and publication

The download serializer preserves existing custom fields, nested section metadata, precise untouched coordinates, feature IDs, filter options, and `roads` collection names. The server does not save, upload, generate, recover write journals, or publish anything. All non-GET/HEAD requests are rejected, including requests using old login cookies.

Publishing remains the existing repository review/deployment process after you manually install the downloaded changes. Public/player assets and generated output are unchanged by using this editor.

The older authenticated services remain explicitly available via `npm run studio:legacy` and `npm run editor:legacy`; they are separate from this download-only server.

## Verification

`npm run test:unit` includes read-only server checks and preservation tests. `npm run test:files:e2e` verifies password-free access, actual JSON/ZIP downloads, browser-only new-map creation, mobile layout, and unchanged server files in an isolated fixture.
