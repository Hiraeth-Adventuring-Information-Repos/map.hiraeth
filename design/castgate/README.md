# Castgate survey

The current map contains 442 addressed physical roofs, 444 pedestrian links and
319 connection points. Every address and each of the 11 original named places
has connected walking access. There is no invented local railway or ferry.
The Crystal Needle's open basin is retained as a walking obstacle, without a
house number. Dock timber, ships, trees and open plazas are excluded from the
building inventory.

The provisional scale is **6630 native pixels = 2 km**, approximately between
opposite north/south dome walls. Image margins are excluded. This replaces the
old placeholder of 50 pixels = 3600 km. The user authorized a reasonable scale
estimate; it remains explicitly provisional and editable in Artwork & scale.

`street-controls.json` guides the street grid and six depicted piers. Native
roof outlines constrain street geometry and entrance walks; harbor water is
blocked except along depicted deck masks. Connected roof compounds receive one
address. Native roof footprints, entrance walks and actual street bends feed
directions. Numbers and street labels are new atlas conveniences, and do not
establish occupancy, household counts or historical street names.

Original lore, pins, regions and the Firmament outline are preserved. Some pins
have no unambiguous alternative location in the unlabeled artwork. Their route
anchors and aliases are recorded in `addressReview.poiReview`; source ambiguity
is not evidence for silently moving a named location.

The October 3 correction pass removed seven false or duplicate records, corrected
five existing roofs and restored three missing roofs. The southwest palace now has
one connected outline instead of addresses for rooftop details. The embassy's
garden and pond are excluded by an explicit `footprintHoles` ring. Open-sided
courts retain concave outlines, and detached wings keep separate addresses.
Former addresses for the two absorbed fragments remain aliases of the surviving
buildings. The connected palace outline includes its attached blue architectural
surfaces, and the snow-covered roof near the Brewery pin remains unlabeled.
Twenty-one entrances and fourteen existing street segments were repaired.
Two real timber piers now connect through their depicted deck and clear shore
approaches. A phantom extension of another pier across open water was trimmed.
The reviewed deck mask retains the source controls and exact artifact/artwork
hashes; the earlier survey mask remains historical evidence. The garden fountain
is a physical walking obstacle without an address. The original basin obstacle
is retained.

Current controls, before/after source panels and quantitative results are under
`correction-pass/`; current independent checks are under
`design/data-correction/` and `design/data-correction-review/`. The earlier survey
overlay, `integration.json`, candidate images and `design/transport-ux/` captures
describe the initial survey and are retained as history.

```bash
PYTHONPATH=/tmp/stomion-cv /home/codex/tools/artifacts/bin/python scripts/castgate_correction_pass.py
PYTHONPATH=/tmp/stomion-cv /home/codex/tools/artifacts/bin/python scripts/audit_transport_geometry.py
PYTHONPATH=/tmp/stomion-cv /home/codex/tools/artifacts/bin/python scripts/audit_castgate_footprints.py
node scripts/audit_authored_transport.js
```

The historical bulk generator refuses to replace this curated map. The targeted
correction script retains its inputs and guards against overwriting subsequent
manual edits. The canonical JSON is authoritative after curation. Pixel
checks establish consistency with authored footprints, masks and deck openings;
they do not prove every unlabeled object is a building or identify its occupants.
