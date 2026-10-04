# Stomion navigation survey

The local geometry audit currently covers **1,568 addressed structures**, four
landmark entrances, five railway routes and one proposed islet ferry. Type
addresses or named places in **Plan a journey** to see a connected route,
distance and estimated time. Select a numbered roof to choose an endpoint.
Some bank and dock frontages have no source-supported connection to the city;
`access-review.json` records those exact addresses and their evidence. Search
retains them and directions explain that access is still being checked.

The [geometry audit](review/geometry-audit/README.md) records the corrected roofs,
remeasured bridge decks, independent physical crossing checks, graph
connectivity and browser proof. Surviving building IDs and address labels are
preserved; eight merged records retain their former addresses as aliases.
One bridge parapet was retired as a phantom house, and one previously merged
independent roof was restored. Two additional visible roofs without inventory
identities are navigation obstacles, without a newly invented address.

The audit screened every baseline footprint and reviewed all 33 populated
source tiles. It does not certify every untouched roof vertex. Many rectangular
bounds and exterior hulls remain approximate, and the artwork often leaves
exact doors and narrow ground passages unresolved. Nothing has been published.
The [journey UX preview](../journey-ux/README.md) records the desktop/mobile
toolbar and typed address/place search implementation.

The 4096×3072 existing map artwork is the source. Coordinates exported to the
atlas are `[3072 - imageY, imageX]`; roof seed coordinates remain original image
`[x, y]` pixels. Street names and addresses are newly authored map labels, not
assertions of preexisting campaign lore.

## Regeneration

Use a Python environment with `requirements.txt` installed. The curated
`streets.json` is the current reviewed graph. Ordinary roof or water revisions
regenerate their derived evidence and reimport addresses while retaining
existing labels:

```sh
python scripts/stomion_buildings.py
python scripts/stomion_waterways.py
python scripts/stomion_water_index.py
node scripts/integrate_stomion_addresses.js --keep-addresses
node scripts/audit_stomion_addresses.js
node scripts/audit_stomion_rail.js --strict
python scripts/audit_stomion_water.py --strict
npm run generate:atlas
npm run validate:data
```

`stomion_streets.py` and `stomion_refine_streets.py` generate draft street
geometry. A full run replaces curated corrections and needs a fresh source
review before promotion. `stomion_buildings.py --tiles` replaces review tiles;
keep the historical audit panels when regenerating evidence.

The bridge revision is reproducible from the preserved pre-bridge source and
its reviewed proposal records:

```sh
node scripts/stomion_apply_bridge_review.js /tmp/stomion-reviewed-streets.json
```

Inspect and audit this output before replacing `streets.json`. The builder cuts
unsupported rail crossings into separate frontages and joins only exact street
projections to individually reviewed bridge decks. Roof covers alone never
permit a walking crossing. The importer rejects approaches through reviewed
water, neighboring roofs, ordinary own-roof wings or railway barriers. Explicit source
frontage restrictions preserve reviewed local entrances where a possible
connection is not established by the artwork. Only the explicitly named
unmapped records in `access-review.json` can retain an address without a route.

For a rail-only revision, preserve the refined walking network and numbered
addresses with:

```sh
python scripts/stomion_streets.py --rail-only
node scripts/integrate_stomion_addresses.js --rail-only
npm run generate:atlas
```

The [current geometry audit](review/geometry-audit/README.md) supersedes the
walking crossings and twelve upper bridge-cover positions from the earlier
[rail crossing pass](review/rail-crossings/verification.json). All 150 rail
coordinate arrays remain unchanged. Covered track stays continuous for routing;
viewer, selected journeys and network editor omit its overlay where an upper
structure hides it. The revised walking graph uses the actual transverse decks
and the depicted gray cobbled halves of the river bridges, with no track-level
transfers. A deck ending at a river pillar does not establish a route to shore.

`rail-structures.json` records the reviewed native-image cover polygons and
river bridge footprints. Regeneration retains these annotations. The
[previous rail alignment pass](review/rail-revision/verification.json) and
[initial survey](verification/initial-verification.json) retain historical
snapshots; their northern and eastern endpoint interpretations are superseded.

### Pedestrian refinement

The pedestrian refiner relocates shared junctions within 24 original pixels and follows source-image
surface costs inside 44-pixel corridors across city and rural walking paths.
Failed corridors can expand to 88 pixels and are reported separately. Reviewed
roof outlines protect their occupied wings after a two-pixel erosion; approximate
rectangles and exterior hulls use their inner 55 percent intersected with the
original occupied polygon. Open courtyards remain open. Water and ordinary roof
cores are excluded; depicted gatehouses permit their through passages. The
refiner preserves verified bridge landings, merges coincident vertices only on
the same level, and drops zero-distance edges. Junctions remain on their original
connected walking ground, so a cheaper pixel across a canal cannot move a dry
junction to the other bank. Approximate outer footprints add a soft surface cost;
reviewed occupied outlines receive a stronger cost at their outer margins.
Source-reviewed narrow deck centerlines replace constant contour offsets where
the available paving is only a few pixels wide.

## Sources and review

- `streets.json` preserves named logical centerlines, junctions and graph edges.
- `street-names.json` gives readable newly authored display names while preserving
  stable logical IDs and the original tracing labels.
- `streets-overlay.png` and `streets-overlay-half.png` show tracing over the source.
- `streets-refinement-qa.json` records movement, fallbacks and roof-core hits.
- `streets-qa.json` records graph components and dead ends.
- `water-mask.png` records independently traced canals and conservative sea cores,
  with depicted bridge corridors removed. `water-index.json` exports the same
  reviewed pixels as row intervals; the importer refuses a stale index.
- `water-audit.json` checks every complete pedestrian line and entrance walk
  against that mask. Unclassified pixels still require visual source review.
- `landmarks.json` records reviewed approaches to named open baths and waterworks,
  without assigning those places a house number.
- `address-integration-qa.json` records address assignment and entrance checks.
  A short walk may bend around mapped roofs; its optional `access.path` retains
  the entire estimated approach for routing distance and time.
- `verification/` contains the current map/build hashes, independent routing,
  preservation checks, test logs and desktop/mobile/Firefox/editor screenshots.
- `seeds-shores.json` is the reproducible off-city roof inventory. Its stable IDs
  survive centroid corrections; each seed records its current review confidence.
- `shores-final-review.json` independently reviewed all 119 initially provisional
  shoreline roof centers. Its corrections and exclusions are consumed by the
  seed generator; retained roof rectangles remain approximate.
- `seeds-shores-review-*.png` provide detailed visual review panels.

Raised rail uses a distinct graph layer; crossings of surface streets do not join
rail to streets. Source-reviewed bridge deck centerlines represent assumed pedestrian access,
because the image does not resolve permission or separate sidewalks. The isolated
river building has a source-traced roof, entrance and local eastern landing walk;
its ferry connection is a newly authored access proposal, without a timetable.
Rural access paths follow depicted pale dirt approaches and open field margins.

This source-reviewed navigation survey includes native-image checks of channel
bands, actual bridge spans, rural approaches, roof centers, and collision cases.
Roof rectangles and some compound hulls remain approximate; source-visible
approaches represent entrances where the artwork cannot resolve an exact door.
Wooded and field-margin paths retain the image's limited surface detail, and
pedestrian access on drawn road bridges is an explicit navigation assumption.
The sole authored ferry is a proposal with an unknown fare and timetable.
The independent city/water audits and final verification manifest record
integrated checks; successful graph routing alone cannot prove every physical
detail.
