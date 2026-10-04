# World transportation review

Fair, Astrousia and IceBeach originally had no authored travel network. Their
new networks are **atlas proposals**, not recovered setting canon or operating
services. Original lore, place coordinates, regions, decorative lines, artwork
and world scales are preserved. Namar's Compact and Old Sounder's Passage remain
water/encounter areas, rather than invented settlements or ports. IceBeach's
closed Whitedrift–Thrawbreak ferry is not reinstated.

| Map | Destinations | Nodes | Links | Modes |
| --- | ---: | ---: | ---: | --- |
| Fair | 22 | 31 | 38 | Road, trail, train, sailing, ferry |
| Astrousia | 11 | 18 | 22 | Road, trail, train, sailing, ferry |
| IceBeach | 19 retained places | 47 | 49 (41 active) | Trail, proposed landing road, sailing, ferry |

IceBeach's corrected source inventory contains 23 printed dotted trail legs,
split into 27 active walking links at the drawn forks and safe bank approaches.
Eight unresolved river/town access spans remain closed. Six retained places have
no depicted spur; Gernerum's trail component stops at the unbridged Thrawbreak
north bank. The planner respects those gaps. Seven unsupported glacier, mountain
and local spurs from the initial proposal were removed. All 19 original place
records and all 14 earlier boat/landing records are preserved.

Source controls, overlays, per-leg provenance and example journeys are in
`design/icebeach-correction/`. Availability of a drawn trail remains proposed;
tracing the artwork does not establish an operating service.

`corridor-plan.json` contains source-image X/Y waypoints and the intended links.
Illustration-derived water masks keep boat corridors in painted water and land
corridors on land. Small land-water crossings are explicitly proposed bridges
or landing structures. Three road/rail overpasses are also proposed. These small
footprints are schematic drawing symbols; they do not assert real bridge widths.
Rails retain their full distance beneath visual covers. Geometric crossings do
not add graph interchanges. Planned coastal/lake landings have walking approaches;
local boarding points at settlements remain unresolved.

Two Astrousian place pins lie on shoreline paint. Their original POI coordinates
remain unchanged, and the route nodes use recorded nearby dry anchors. Boat and
train fares remain unknown. Editable speeds estimate moving time; overnight rest,
weather, timetables, departure frequency and cross-map services are not inferred.

Current evidence is `geometry-audit.json`, `routing-audit.json` and the correction
reports in `design/data-correction/` and `design/data-correction-review/`.
Fair and Astrousia retain their proposed connected networks; IceBeach has
source-reviewed disconnected components. Geometry checks sample native artwork
pixels, including proposed crossing footprints. They validate the authored
constraints; they do not turn an illustration into surveyed terrain.

To audit the canonical data:

```bash
PYTHONPATH=/tmp/stomion-cv /home/codex/tools/artifacts/bin/python scripts/audit_transport_geometry.py
node scripts/audit_authored_transport.js
node scripts/audit_route_data.js
```

The historical integration and crossing generators refuse to replace a curated
map and preflight the entire selected batch before writing any map. Use the
targeted IceBeach controls or the visual editor for later corrections.
The native masks require Pillow, numpy and OpenCV. `/tmp/stomion-cv` is the current
VM dependency location and may need reinstalling on another host.

Files prefixed `before-` are immutable pre-survey references. Candidate/failure
images and logs are diagnostic history. The canonical map JSON and current
verification files describe the completed pass. Earlier screenshots and manifests
in `design/transport-ux/` remain historical evidence. Changes remain local.
