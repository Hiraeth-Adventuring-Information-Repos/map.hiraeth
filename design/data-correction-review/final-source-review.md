# Independent native-source correction review

IceBeach is approved within the source-review scope below and frozen at SHA256 `4137afe945d9a192247a595ed14d3b052c04b9e6cf58176bf8e8a7966ced9887`. Castgate is also approved within that scope and frozen at SHA256 `fa744d7eb6c6c09a43946be7427deda64379d4a51142e22ea2d61d9b27f61e47`. All independently confirmed source defects in this correction pass are resolved.

This reviewer inspected the native `maps/castgate.webp` and `maps/IceBeach.webp` artwork, followed by source closeups and independent geometric/runtime graph checks. Authored obstacle masks and connectivity were not accepted as proof of alignment. The review created evidence files only; it did not edit canonical maps, runtime code or source artwork.

## Castgate buildings

The user's concern was supported by the source. The southwest palace had been represented by interior rooftop features while most of the joined building was missing. Some other detections followed decorative objects, garden walls or shoreline instead of roofs.

The following corrections were reviewed against native artwork:

| Record | Source-supported correction |
|---|---|
| **0340, Chai en' Steep Inn** | One connected architectural silhouette, including its attached blue crescent canopies. Interior skylight 0321 is absorbed. The visible northern cobbled garden stays outside the outline. |
| **0031 and new southern harbor roof** | The northern joined roof is restored; the physically separate southern group receives its own outline. The tiled terrace between them stays open. |
| **0087** | Shoreline, harbor water, piers and ordinary ground are excluded. Joined glazing and cream roof surfaces remain included. |
| **0091, embassy** | Perimeter walls, ornamental pavement and trees do not enlarge the roof. A genuine open garden within the annular wing is retained as a courtyard hole. The rim hidden by palms is explicitly approximate. |
| **New eastern pink roof** | A previously missed connected roof is included, retaining its open courtyard as an exterior concavity. |
| **0323, market stall** | Actual roof retained; exposed barrels and goods excluded. False goods entry 0336 removed. |
| **New eastern snowy roof** | The previously missed joined roof is traced as an unlabeled physical compound. Tenant identity is not inferred. Generated junction 0304 and the two associated approaches move onto clear snow/cobbles around it; the original lore pin remains. |

Seven false records are retired: tree 0002; decorative pond 0068; moored ships 0077/0113; perimeter-wall/garden fragment 0074; interior skylight 0321; and open goods 0336. The two absorbed fragments retain their former addresses as aliases on the surviving buildings. Retirement reasons remain in provenance.

Existing large roofs 0001,0028/0042,0261/0304 and 0243 remain intact. Their visible open courtyards are already exterior concavities, so holes were not invented. Roofs 0419/0434 are visibly detached from adjacent green compounds and retain separate addresses. Physical roof connections, rather than enclosure within a walled site, determine merging. The small palm-covered southeast palace rectangle remains visually ambiguous; it is not promoted to an invented public ground courtyard.

Evidence: implementation `*-comparison.png` panels in `../castgate/correction-pass/`; [detached wings](detached-wings-source.png); [final canopy paths](Castgate-final-palace-blue-crescents.png); [new snowy roof access](Castgate-final-snow-roof-access.png).

Independent geometric checks cover every current footprint and address, including courtyard exclusion: **442 buildings, one explicit courtyard hole**, no invalid/duplicate IDs, duplicate addresses, degenerate/self-crossing rings, centers outside physical roofs, inter-building roof overlaps, streets intersecting roof interiors or entrance paths crossing neighboring roofs. This establishes geometric consistency. The targeted native reviews establish the source corrections listed above; they do not establish tenants, parcels or a complete inventory of every unlabeled object in the illustration.

## Castgate paths and water

Two genuine wooden T-piers were disconnected because their routes stopped short of the depicted shore approaches. New links follow their actual timber and clear shore. Source inspection also found a phantom 110-pixel horizontal arm connecting separate pier heads over harbor water, and a vertical line outside the slanted eastern timber stem. The false arm is removed, and the stems are retraced along actual timber centers. The reviewed deck mask is narrowed to physical timber rather than preserving the original mistaken control geometry.

The final changed-panel scan also caught a small repaired palace segment crossing the ornamental fountain's blue interior. The final segment follows clear cobbles east of the curb, with an explicit fountain obstacle and no building address.

Evidence: [original disconnected piers](Castgate-isolated-piers.png), [false arm](Castgate-left-T-phantom-arm-source.png), [eastern upper stem](Castgate-east-T-native-grid.png), [eastern lower centerline](Castgate-east-T-lower-centerline.png), [native before/current pier approaches](Castgate-final-three-pier-approaches.png), [fountain defect](Castgate-palace-fountain-terminal.png).

The other independent blue-color candidates were classified from source. Blue surfaces on the city perimeter belong to the documented magical Firmament rather than a river. The original Castgate blurb describes a dome that holds winter at bay; it does not establish a solid impassable wall. Ordinary street crossings of that outline remain inferred atlas access, not independently surveyed doors. The grove structure plausibly covers a depicted gateway; its floor is obscured by its roof. A short 0031 entrance contact is a facade detail, not harbor water. These limits are recorded in `Castgate-color-candidate-review.json` with native comparison crops.

## IceBeach printed trails

All **23 identifiable printed trail legs** and shared branch points are represented, including the southern Houlen–Quilt trunk, both Shiverwallow arms, the lake fork, Nil Buldin branch and northern Icemoor–Winrich–Castgate fork. Independent southern control tracing and native fork crops remain in this directory. Tiny fork-center offsets stay within the same continuous printed branch stems and are treated as tracing tolerance, not survey coordinates.

Seven previous spurs had no printed path and are excluded from navigation: Castgate–Gernerum; Houlen Top–Wynwood Peak; Ottiker–Mt. Solaria; Quilt–Foaming Burrow; Sleetmond–Hope Tree; Gernerum–Flamore; Flamore–Morana's Fang. Original places and lore pins remain.

Eight genuine river/town-access spans are closed in routing: Cursed Run; two Fractured–Ottiker crossings; Wynwood River; the lower Quilt west-bank approach; the schematic river-spanning Winrich fortress access; and the Houlen/Thrawbreak approaches. A castle icon or dotted continuation through water does not establish a usable bridge. Usable dry trail approaches remain.

Independent source review caught actual water beneath the Thrawbreak lettering and a Houlen cove that had initially been mistaken for label-color hits. Both are now explicit closed gaps. Evidence: [Thrawbreak river](Thrawbreak-source-grid.png), [Houlen cove](Houlen-approach-source-review.png), [Quilt dry terminal](Quilt-terminal-source-grid.png).

All remaining **eight narrow artwork-mask exceptions** were inspected and are dry letter outlines or tundra texture. The final exception sheets are rendered from the frozen data: [sheet 1](IceBeach-exceptions-sheet-1.png), [sheet 2](IceBeach-exceptions-sheet-2.png). The second sheet also retains the independent dry tundra-color candidate.

The actual runtime graph contains no edges for any of the eight closed services. Six named places remain without an evidenced trail connection: **Flamore, Morana's Fang, Mt. Solaria, The Foaming Burrow, The Hope Tree and Wynwood Peak**. Two additional dry approach components are separated by unresolved crossings. They are retained honestly rather than given invented paths.

The 14 pre-existing proposed boat/landing links are preserved. Some boarding approaches reach a few native pixels over the illustrated shoreline. They remain proposed boarding geometry and do not establish verified piers or scheduled services.

## Reproducible evidence and final status

- `audit_independent.py` → `final-mechanical.json`: every physical roof, courtyard, entrance, exact trail endpoint and independent deep-blue source candidate.
- `audit_runtime_graph.cjs` → `final-independent-graph.json`: actual runtime graph errors/components, address connectivity and closed-service exclusion.
- `audit_castgate_source_water.py` → `Castgate-source-water-candidates.json`: independent native-color candidates, followed by semantic source inspection.
- `render_final_castgate_paths.py`: native source/baseline/current route comparison panels.
- `semantic-source-findings.json`: initial independently identified defects.

Both maps are approved and frozen at the hashes above. Castgate has 444 active travel links and 319 authored travel nodes; its actual runtime graph has one 1183-node component, 442 address nodes and all six reviewed pier nodes reachable. IceBeach has 49 authored links / 47 nodes, eight closed services absent from its actual runtime graph, and the intentionally isolated locations described above. The final independent geometry report has no failures or roof overlaps/intersections. Castgate's remaining native-color candidates are only the reviewed dome, covered gate and facade contacts.

The reviewed entrances are routing approximations at suitable roof boundaries, not verified door positions. Native tracing hidden by foliage, covered gateway clearance, ordinary access through the magical dome, tenant attribution and the completeness of unlabeled roof inventory remain explicit limits. No confirmed source defect from this pass remains pending. A zero authored-mask or polygon failure count alone is not treated as proof that every illustrated object was correctly classified.
