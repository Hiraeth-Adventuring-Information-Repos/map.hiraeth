# IceBeach printed-trail correction

The earlier world-network generator routed proposed corridors through terrain masks. It did not trace IceBeach's printed dotted trails faithfully, omitted their shared junctions, and invented several glacier and mountain spurs.

This pass traces the burgundy dotted walking trails from the original 7016 × 4960 artwork. Reviewed native control corridors constrain color detection; no route or bridge is inferred from a color mask alone. An independent source reviewer checked the complete trail inventory, the southern trunk, and the ambiguous river approaches.

## Result

- 23 printed trail legs now use `travelMode: trail` and shared graph junctions. Splitting their water approaches produces 27 active trail links.
- Six real shared junctions connect the northern fork, Fractured Point fork, two lake forks, Nil Buldin branch, and Shiverwallow/Houlen Top southern trunk.
- Four source trail river spans and four town access gaps are explicitly closed until a usable bridge is confirmed: the Cursed Run west of Whitedrift, Foaming Runs, Ottiker's west lake outlet, Wynwood River, Quilt's west-bank town access, the internal Winrich Fortress river crossing, Houlen Top's northern cove, and Thrawbreak's northern river approach.
- Seven unsupported generated links were removed, including Castgate–Gernerum across Winrich Glacier and guessed mountain/local spurs.
- 49 mapped links and 47 connection points remain. All 19 original place records, every other original map field, and the 14 existing sailing/ferry/landing records are preserved.
- The closed Whitedrift–Thrawbreak ferry remains absent. Existing boats still have their original proposed status and unknown fares.

Flamore, Morana's Fang, Mt. Solaria, The Foaming Burrow, The Hope Tree, and Wynwood Peak retain their place records. Their previous walking spurs have no visible source support, so directions no longer invent access to them.

Gernerum has a usable printed coastal trail to Thrawbreak's dry north bank. Its component remains disconnected from the rest of the network because no usable bridge into Thrawbreak is established; the previous glacier shortcut is not restored to force universal connectivity.

The original regional scale remains unchanged. Trail geometry follows the source; availability and moving speeds remain proposed estimates. The fortress icon straddles a river but does not prove a usable bridge. Winrich therefore has separate dry north/east and west trail access points; the original POI pin is preserved. Quilt's generated connection point was moved to the dry upper town symbol where its northern trails arrive, before the river outlet beneath the symbol. Its original POI pin is also preserved.

## Review artifacts

- [Before and after](before-after.png): yellow is the earlier generated network, green is the corrected source trail, red is a closed gap, white circles are connection points.
- [Junction details](junction-details.png): blue traces show the actual graph over the printed dots.
- [Trail provenance](trail-provenance.json): each drawn trail, native controls, fitted vertices, detected dot count, graph IDs, removed links, and withheld crossing reason.
- [Route evidence](route-evidence.json): eight real trail-only journeys, four blocked crossing journeys, preserved-record assertions, active components, and isolated destinations.
- [Independent final source review](source-review.json): approved frozen map hash, resolved findings, and small native fork-placement tolerance.
- [Repeatability proof](repeatability.json): isolated regeneration reproduces the exact frozen map hash without rewriting the canonical file, and the later-editor-change guard rejects an unrelated mutation.
- [Native source crops](source/): river and junction review panels. Blue text outlines and tundra shading produced eight reviewed false water-mask regions; each exception has a narrow native bounding box and source explanation under `transportReview.correctionReview.artworkMaskExceptions`. Independent native review distinguished real coves beneath the Houlen Top and Thrawbreak lettering, which remain closed.

## Reproduce this targeted pass

The fixed baseline is `design/data-correction/before/IceBeach.json`. The control inventory is `trail-controls.json`. This script edits only `maps/IceBeach.json` and its own correction artifacts, preserving unrelated fields and the original water-service records. It verifies the immutable baseline and artwork hashes, and refuses to overwrite later editor changes unless the current map matches the baseline or the exact previous correction output.

```sh
PYTHONPATH=/tmp/stomion-cv /home/codex/tools/artifacts/bin/python scripts/icebeach_trail_correction.py
node design/icebeach-correction/route-evidence.cjs
```

Do not rerun the old bulk world generator over this source-reviewed network. Its generated corridors would replace these trail junctions and closed crossing decisions.
