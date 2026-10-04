# Castgate source correction, 2026-10-03

This pass replaces specific rejected/fragmentary survey detections with native
roof silhouettes. The canonical map now has **442** addressed roof compounds,
**444** links and **319** graph points. These are atlas addresses, not a census
of individual households or a claim about occupants.

The largest correction is the southwest palace: two interior roof ornaments
had received independent addresses while the surrounding joined roofs were
missing. `castgate-building-0340` now follows the full joined building, including
its attached blue crescent glazing/awnings. The open cobbled garden remains
outside the roof. Its Chai en' Steep Inn alias and address remain stable; the
retired skylight record 0321 is retained as the lookup alias
**22 South Market Street** on 0340.

The northern harbor roof0031 and a separate southern harbor roof are recovered;
open tiled terrace and sea stay outside them. Building0087 no longer includes
the shoreline, sea or neighboring piers. Building0091 follows the embassy roof
instead of garden walls, decorative paving and pools. Its genuine enclosed
garden uses one `footprintHoles` ring; the palm-occluded stone rim is approximate.
The perimeter-wall fragment0074 is retired, with **7 Eastern Lane** retained as
an alias on0091. A missing joined pink roof on the east wall is restored.
Market roof 0323 is trimmed to exclude open-air goods. The missing snow-covered
roof near the Dwarf Brewery lore pin is restored as an unlabeled physical roof;
its actual tenant is unconfirmed. The original lore pin is preserved, and its
street junction and walking approach now use clear snow beside the roof.

The ornamental fountain in the palace garden is an explicit walking obstacle,
without a building address. Streets use the surrounding cobbles. The original
northern basin obstacle is preserved exactly. Actual door positions are not
established by the artwork; address entrances are roof-edge routing approximations.

Seven records are retired: tree0002, decorative pond0068, moored ships0077 and
0113, perimeter fragment0074, palace skylight0321, and barrel display0336.
Retirement reasons, former addresses and surviving IDs are recorded in
`maps/castgate.json` at `addressReview.correctionReview.retiredBuildings`.

Existing blue courtyard roofs0261/0304 and pink0243 already retain their open
courtyards as exterior concavities. They are unchanged. Source roof wings0419
and0434 are genuinely detached; they remain separate records. An enclosed site
is not sufficient evidence to merge neighboring physical roofs.

Two genuine T-piers had disconnected routes because their authored stems stopped
short of land. Two source-guided timber/shore approach links now attach them to
existing street nodes. The first pier also had a 110px phantom T-head arm over
open harbor; its stable terminal node is moved to the actual timber endpoint,
and the vertical route follows the timber center. The eastern stem follows the
actual slanted timber rather than cutting vertically through open water. The
reviewed deck mask removes those false allowances and follows independently
reviewed timber centers through both real landings. All 1183 derived graph nodes
now belong to one connected walking network. The cumulative pass changes
5 graph points, 14 existing street geometries and 21 entrances, plus the two new
pier approach links. `pier-approaches-comparison.png` shows the harbor correction.
The `*-final-routes.png` panels show the repaired palace, eastern pier and snowy roof.

`controls.json` contains the authoritative literal native X/Y control rings,
artwork SHA256, immutable input SHA256 and source-review rationale. The targeted
script applies only those corrections and retirement decisions to the current
map; it retains all other IDs, original POI lore, pins, regions, Firmament,
scale and street labels. It repairs affected street geometry and building
approaches against all retained roofs, the explicit courtyard, harbor mask and
pier deck mask. It does not rerun the original bulk detector.

```sh
PYTHONPATH=/tmp/stomion-cv /home/codex/tools/artifacts/bin/python scripts/castgate_correction_pass.py
```

The script refuses to overwrite later editor/manual changes: the input must
match this pass's immutable baseline or its last exact reviewed output. Its
final topology, overlap and route-mask checks must pass before canonical JSON
is written. `report.json` derives cumulative changes from the immutable baseline,
so an audit rerun does not erase the change inventory.
`verify-repeatability.py` proves byte-for-byte repeat application and refuses a
temporary fixture containing a later manual edit; `repeatability.json` records
that evidence. The immutable original harbor/water masks remain untouched.

Each `*-comparison.png` shows native artwork before/after with roof edges in
teal, explicit courtyard in orange, and corrected address approach in salmon.
`corrected-roof-overview.png` shows the complete inventory. Other crop, contour,
mask and draft files here are investigation evidence; they do not constitute
an alternate canonical map or approved replacement controls.

This targeted correction fixes independently identified major defects and
checks every final walking approach against the resulting authored mask. It
cannot establish occupancy, ownership, interiors or exact outlines hidden by
foliage. The remaining small unlabeled roof compounds are not a surveyed real
estate inventory.
