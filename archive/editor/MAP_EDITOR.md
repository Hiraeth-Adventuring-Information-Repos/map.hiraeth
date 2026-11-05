# Hiraeth download-only editor

**Open a map → edit in the browser → Download changes.** No password is needed.

## Start

The public editor is available at **https://maps.hiraeth.wiki/map-editor.html**.
Choose **Editor** in the viewer, select a map, then edit its features.
Travel-network editing is experimental: add `?routing=1` to the editor URL (or `&routing=1` after another query parameter). The viewer's experimental Editor link carries the flag automatically.
It uses the viewer's native-resolution map tiles and needs no local server or login.
Edits stay in your browser; **Download changes** saves a map JSON or ZIP to your device.
Published source maps are changed only through the repository release process.

Run `npm ci`, then `npm run editor` (or `npm run studio`) and open `http://127.0.0.1:8010/studio`.

For LAN access, set `HOST` to the computer's LAN address and `MAP_STUDIO_ALLOWED_HOSTS` to the comma-separated addresses/hostnames visitors use. `PORT` defaults to `8010`. The server serves map files and the editor without authentication, and rejects all write requests. Existing password files are unused and are not deleted.

Startup shows which resource is loading. Required files and map-catalog requests time out after 20 seconds; a failed startup shows an error and **Retry loading editor** instead of leaving the spinner running. Retry reloads the page and keeps the saved browser draft.

## Editing and downloads

Click a POI, region, or line to edit its details. **Edit on map** closes the form so you can move markers or vertices. **Edit details** reopens it. Use **+ Place**, **+ Region**, and **+ Line** for new features; finish or cancel a shape before downloading. Undo/redo, unsaved-change prompts, and the DM-only theme remain available.

Regions and lines can mix sharp corners and cubic **Bézier curves**. Click to place points, then select an orange point and choose **Curve point**. Drag its blue diamond handles independently to shape the incoming and outgoing curves. The outline passes through the orange point; **Make corner** removes that point's handles. Points without handles remain sharp, and edges between two sharp points stay straight. Dragging an orange point moves its handles with it. Polygon closing edges also support curves.

**Undo point** (Backspace/Delete) removes the last draft point. **Finish shape** (Enter with the canvas focused) keeps both the editable anchors/handles and a sampled outline that existing viewers can display. After finishing, use **Edit on map** to select points and adjust their curves; these edits support undo/redo. Bézier handles survive JSON downloads and reopening the downloaded map. Editing the raw Coordinates field replaces the curve with the entered straight segments. **Cancel drawing** or Escape discards a draft; unfinished drafts recover after reloading the tab.

In the public viewer, **Measure Distance** keeps POIs, regions, and lines visible while clicks place measurement points. Double-click or Enter finishes; Backspace/Delete removes the last point; Escape cancels. Measurements follow the straight segments you place, preserving exact waypoint distances.

**Download changes** downloads the current map JSON. When map-index settings also changed, it downloads a ZIP containing both the map JSON and `maps/maps.json`, using their existing paths and formats. Export options also let you download JSON separately. “Download requested” means the browser was asked to save a copy; it does not mean server files were replaced.

All edits remain in your browser until downloaded. To install them, compare your download against the latest originals and copy the intended files into the maps folder yourself. Reopening a map loads the server's original file, not a previous download.

New map prepares a ZIP in the browser containing JSON, WebP artwork, a thumbnail, and the updated map index. Artwork is not uploaded. Add the downloaded files to the maps folder yourself, then refresh the editor to work on the new map. WebP export support is required for the thumbnail and for converting PNG/JPEG artwork.

## Campaign journeys

Open **Journeys** in the editor toolbar, then **New journey**. Give it a name and campaign, choose a route color, and use **Add stop on map** to place each moment. Each numbered stop has a name, a free-text in-universe date (including approximate dates or ranges), an optional session, notes, and a full HTTP/HTTPS wiki link. The journey can also link to the campaign wiki. Drag numbered pins to move stops; **Move earlier**, **Move later**, and **Remove stop** change their travel order. Undo/redo and tab recovery cover journey changes. **Cancel stop** or Escape cancels stop placement.

In the viewer, open **Map Layers** (the filter control) and find **Campaign journeys**. Toggle the whole group, or individual journeys; **Show All / Hide All** includes journeys. New journeys start hidden unless **Show by default in viewer** is enabled in the editor. The viewer remembers each visitor's choices per map and journey. Hidden layers are still public map data, so use player-safe notes and links.

Journeys are stored in the map JSON's optional `journeys` array. Each journey has a stable `id`, `name`, `campaign`, `color`, `visibleByDefault`, optional `description`/`wikiLink`, and an ordered `stops` array. Stops have stable `id`, `name`, `[Y, X]` `coords`, and optional `date`, `session`, `description`, and `wikiLink`. Stops connect directly with dotted segments in array order, independent of date text. Journeys belong to their current map; cross-map travel and custom route bends are not yet supported. Download changes includes journeys in the existing map file. No example campaign events are added to published maps.

## Preservation and publication

The download serializer preserves existing custom fields, nested section metadata, precise untouched coordinates, feature IDs, filter options, and `roads` collection names. The server does not save, upload, generate, recover write journals, or publish anything. All non-GET/HEAD requests are rejected, including requests using old login cookies.

Publishing remains the existing repository review/deployment process after you manually install the downloaded changes. Public/player assets and generated output are unchanged by using this editor.

The older authenticated services remain explicitly available via `npm run studio:legacy` and `npm run editor:legacy`; they are separate from this download-only server.

## Verification

`npm run test:unit` includes read-only server checks and preservation tests. `npm run test:files:e2e` verifies password-free access, actual JSON/ZIP downloads, browser-only new-map creation, mobile layout, and unchanged server files in an isolated fixture.

## POI marker types

POIs use the same AI-generated markers in the editor and viewer. In the POI inspector, the Type field suggests the available types and also accepts custom text. Unknown types use the gray question-mark pin. Existing type names and aliases remain supported.

New types include Library, Guildhall, Hospital, Cemetery, Prison, Farm, Mill, Watchtower, Waterfall, Volcano, Island, Oasis, Inn, Shop, Blacksmith, Apothecary, Ferry, Shipwreck, Battlefield, Encounter, and Quest.

Markers remain 36 × 48 pixels on the map, anchored at [18, 47]. The artwork, original prompts, and a light/dark preview catalog are in `design/poi-markers/`. To rebuild the 384 × 512 PNG exports and 72 × 96 WebP assets from the retained originals, install `scripts/requirements-poi-markers.txt` with pip and run `python3 scripts/prepare_poi_markers.py`. Preparation repairs generated transparency holes and fuzzy fills while preserving the original symbols.

## Travel directions: roads, trails, trains and boats

Open the editor with `routing=1`, select a map and choose **Travel network** in the toolbar (or workspace tabs in the full editor). The viewer's Directions button, address clicks and routing shortcuts use the same opt-in. Removing the flag disables the experiment; no preference is saved. Normal and experimental editor sessions keep separate recovery drafts, and earlier drafts are retained. The map needs a positive **Scale Pixels / Scale Kilometers** calibration under Artwork & scale.

1. Choose **Add point**, select Junction, Town, Station, Port, or Landmark, then click the map. Give each point a distinct name in the panel.
2. Choose **Draw connection**, select Road, Trail, Train, Sailing, or Ferry, then click a start point. Click any bends you need and click another point to finish. **Finish connection** creates a new point at an empty endpoint. Nearby points and links snap automatically.
3. To branch from an existing road, use **Add point** on the road to insert a junction, then **Connect from here**. Drawing to the middle of a link also inserts a junction. Crossings alone do not connect: bridges and intersecting transport lines stay separate until you explicitly join them.
4. Select a link to edit its speed, fares, delay, endpoints, direction, or public visibility. Drag an interior bend to reshape a straight-segment link. Drag a connection point to move every attached link together; renaming it preserves its connections.
5. Open **Test a journey**, choose start/destination and fastest, cheapest known fare, or shortest distance, then **Calculate journey**. The result highlights the path across the network and totals its distance, hours and fare.

All network links are visible while editing, even when hidden in the public map. Undo/redo and tab recovery cover network edits and unfinished connections. Finish or cancel a connection before saving. **Download changes** exports the network in the map JSON; in download-only mode it does not change the server's files. Delete attached links before deleting a connection point.

Existing travel lines appear as a network without changing the document. On the first point edit they acquire stable references to connection points in `travelNodes`; each point stores an ID, name, kind, and coordinates. Links retain their existing line fields and add `travelFromNode` / `travelToNode`. Legacy named endpoints remain supported. Decorative lines can still be enabled for travel through **Features → Lines → Travel routing**.

Inserting a junction preserves the complete link's original total distance, fare and delay. Its fixed fare and wait remain on the first half in drawing order; the continuation gets zero fixed fare and delay, with the per-kilometer rate unchanged. Review those charges if the new junction is a boarding location. Splitting a curved link retains its sampled outline as editable straight segments.

Each segment has an editable speed in km/h, an optional fixed fare/toll in gp, an additional fare per kilometer, an optional wait/boarding delay, and a one-way setting. The initial speed estimates are 5 km/h on roads, 3 on trails, 40 by train, 10 sailing, and 8 by ferry; change them to match your setting and intended transport. A blank fare means **unknown**; enter **0** for a free segment. Fixed fares and delays apply once per segment traversed, so charge a through-ticket or boarding delay on only the appropriate segment when splitting a service.

**Show route on map by default** controls only the line's appearance. Routes start hidden and remain usable for directions. In the viewer, open **Plan a journey** (the route icon; **Directions** in mobile tools), select connected start and end places, choose fastest, cheapest known fare, or shortest distance, and enable the travel modes you want. The chosen trip is highlighted even when its underlying roads are hidden. **Show the whole travel network** reveals every available route; switching it off restores each route's default visibility. Closing the panel keeps the chosen trip visible; changing inputs or maps clears it.

The network inspector shows mode counts and filters for viewing one transport layer at a time. These filters change the canvas only; downloads retain every link. **Service status** distinguishes Available, Proposed and Closed. Closed links remain editable and never enter directions. Proposed links are usable for exploring the atlas, with a notice in the viewer and itinerary. Blank boat/train fares remain unknown. Both editor and viewer accept typed place names; cities also accept addresses. The viewer groups start/destination fields with a swap button, then offers Suggested, Walk, Train + walk and Boat + walk choices when supported. Route options hold detailed mode restrictions and preference settings. Distinct fastest, shortest and lowest known fare results appear as selectable cards; identical paths are shown once. Step-by-step directions are collapsed until needed, and selecting a step focuses that section of the map. On mobile, Expand and Show map control the sheet; opening the steps temporarily tucks away the form, and Edit journey restores it.

Fair and Astrousia have proposed connected land, boat and train corridors. IceBeach's walking graph follows its printed dotted trails, with unresolved water spans closed and places without depicted spurs left unrouted; its boat services remain proposals. These networks do not establish operating services or surveyed roads. Illustration-derived coast masks constrain land and water routes. Proposed landing structures and bridges remain identified explicitly; road/rail crossings have proposed overpasses, with rails drawn beneath them while their full geometry still determines distance. Interchanges exist at authored nodes, not at incidental crossings. The closed Whitedrift–Thrawbreak ferry is not restored. Namar's Compact and Old Sounder's Passage are not invented port towns.

World inputs, source overlays and audit results live in `design/world-transport/`. Rebuild with `scripts/world_transport_source.py`, `scripts/integrate_world_transport.py`, then `scripts/world_transport_crossings.py`. Run `scripts/audit_transport_geometry.py` and `node scripts/audit_authored_transport.js` independently afterward. Python scripts use the artifact runtime and OpenCV described in the design README. Masks constrain illustrations; they do not establish a timetable, safe real crossing, overnight rests or operating services.

Results show the distance along the complete drawn line, moving hours plus configured delays, and per-traveler fares, with a breakdown for each street. Unknown fares are shown explicitly and excluded from cheapest-route searches. These are editable estimates, with no timetable, overnight-rest, weather, supplies or lodging model. Routes stay within a single map; crossings connect only through authored junctions.

## City addresses

Maps with a `buildings` inventory keep house numbers and roof outlines hidden in the viewer. Transparent roof hit areas remain clickable as you zoom in; the editor retains visible survey geometry. Select a roof to see its full address and choose **Directions from here** or **Directions to here**. Named location popups also show their mapped address and direction buttons. **Plan a journey** accepts typed addresses and named places, with keyboard suggestions; partial names and common street abbreviations work. The trip includes the walk from each entrance to its exact position on a street, and uses that street's actual bends for distance and time. The itinerary combines consecutive sections of one street. Route endpoints use A/B markers without filling or outlining the selected buildings. Mobile directions keep inputs and route cards together, and focus the map above the sheet.

Each building has a stable ID, street name and number, center, roof footprint, entrance, and access point referencing a road or trail. Addresses do not connect to elevated rail merely because it crosses nearby. In **Travel network → Building addresses**, search/select a house to edit its address, name, aliases, center, entrance, footprint and street access. **Add address** draws a new roof from two opposite corners and assigns an available number on its street. **Delete address** removes the selected record; undo restores it. Dragging its center moves its footprint; dragging its entrance updates street access. Streets referenced by addresses cannot be deleted until those references are moved. Downloads preserve all address and custom metadata. Named landmark entrances remain searchable destinations without inventing a house number for an open bath or waterwork.

An entrance walk can bend around neighboring roofs. Its optional `access.path` stores ordered map coordinates from the entrance to the exact street access point; distance and time include every segment. The editor displays this walk and accepts replacement coordinates. Renaming a building preserves the walk, while moving its geometry or connected street clears an outdated walk for recalculation.

The Stomion inventory is authored from `maps/The-Port-City-of-Stomion.webp`. Its new street names and odd/even numbers are atlas additions; existing lore is preserved. A connected compound receives one address, while separate terrace houses receive separate numbers. The raster cannot establish occupancy or household counts. Scale remains **4080 pixels = 13 km**, so the displayed distances retain the map's existing calibration. Roads default to 5 km/h, narrow paths to 3 km/h. The isolated river building has an explicitly proposed ferry connection at 8 km/h with unknown fare; the artwork depicts no bridge or established ferry service.

Survey inputs and visual review evidence live in `design/stomion/`. Its reviewed canonical geometry is authoritative; follow `design/stomion/README.md` before any regeneration. The full street refiner can overwrite curated roof and bridge corrections. `node scripts/audit_stomion_addresses.js` checks address references, graph reachability and route totals. `python scripts/audit_stomion_water.py --strict` independently samples pedestrian paths and entrance walks against reviewed water pixels and bridge openings. A connected graph alone is not evidence that the physical survey is complete. Run the data/build checks and the real-map browser suite `tests/stomion-addresses.spec.mjs` after a reviewed survey update.

Castgate's inventory traces connected physical roofs and the illustrated street grid, with walking access constrained by roof footprints and harbor water. Separate detached wings keep separate addresses. Its street labels and address numbers are atlas additions. The provisional calibration is **6630 pixels = 2 km**, measured approximately between opposite north/south dome walls, excluding image margins. This replaces the old placeholder and is editable under Artwork & scale. Existing lore and place pins remain preserved where the illustration does not establish an unambiguous alternative. Inputs and source review panels live in `design/castgate/`. The source correction pass is recorded under `addressReview.correctionReview`; the historical bulk survey refuses to replace this curated inventory. Use the targeted correction controls or the editor, then rerun geometry/route audits and actual-map browser checks.

Connected roofs can retain open courtyards using `building.footprintHoles`, an optional array of coordinate rings in the same `[y, x]` format as `footprint`. Each court must stay inside the outer outline, without overlapping other courts. **Open courtyards** in the building inspector lets you edit these rings, with a blank line separating courts. Rendering and roof click areas exclude this open ground; moving the building moves its courts with it. Physical-roof audits subtract the rings as well, so a street or entrance in a courtyard is not mistaken for a path through a building.

IceBeach's source correction pass records the dotted trails and real branch junctions under `transportReview.correctionReview`. Source-traced trail geometry remains distinct from proposed boat services. A printed trail crossing water without an evidenced bridge has a closed crossing span and a recorded reason; approaches remain mapped, but the planner cannot cross that span. The historical world integrator preflights curated maps before replacing any part of a batch.
