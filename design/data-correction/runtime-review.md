# Independent runtime and visual review

Reviewed 2026-10-04. Scope: the new open-courtyard representation, viewer/editor behavior, and fresh corrected-map screenshots. Read-only review; only this report is written by the reviewer. Artwork/source tracing is audited separately.

## Courtyard runtime: bounded pass

No substantive runtime or data-preservation defect found in `js/travel-network.js`, `js/city-addresses.js`, or `js/travel-network-editor.js`.

- Building roof hit areas and editor polygons contain the outer ring plus courtyard rings. Leaflet's polygon handling excludes the courtyard from the filled/clickable roof.
- Courtyard validation rejects malformed, external, self-crossing, touching or overlapping holes and a building marker placed in a courtyard. Explicitly closed rings are supported.
- Metadata edits retain courtyard rings and verified entrance paths. Moving a building marker translates the outer roof and its courtyards together. Invalid edits are checked before committing to the building.
- Recalculating an entrance considers both the outer roof and courtyard boundaries. Access from a court terminates on the courtyard edge rather than an interior roof point.
- The editor loads and exports the optional `footprintHoles` field through a labeled courtyard textarea; clearing it removes the holes.

Evidence: reviewer independently reran `tests/building-courtyards.test.js` and `tests/source-map-corrections.test.js`; both passed. Additional read-only probes cloned the actual corrected Castgate embassy (`castgate-building-0091`) and confirmed full graph validation, garden exclusion, exact metadata-edit preservation, translation of its real courtyard with the roof, and an unchanged canonical map. The focused browser test also exercises clicking the roof versus the courtyard, editing the ring, downloading, and rebuilding a valid route; the parent owns the browser-suite result.

This review does not establish the physical validity of arbitrary new entrance paths drawn by future editors. Source-aware route and footprint audits cover the authored map corrections.

## Initial visual findings

The initial source desktop/mobile captures were inspected for Castgate and IceBeach in Chromium; IceBeach's Firefox mobile capture was also inspected. Both courtyard editor screenshots were inspected.

1. **Mobile IceBeach destination badge obscured by toolbar.** In `source-IceBeach-chromium-mobile.png` and `source-IceBeach-firefox-mobile.png`, the Icemoor B marker lies at x16, y121, with a 28px box. The left Directions toolbar button occupies the same screen area and obscures the badge. The endpoint is within viewport bounds, so the original capture assertions did not detect the overlap. Reported to the parent for camera padding and verification correction.
2. **Mobile courtyard screenshot scrolled past the courtyard editor.** `editor-castgate-courtyard-mobile.png` initially showed the selected roof and the lower inspector actions, but not the Open courtyards textarea. The field's serialized value was verified by the capture, yet the screenshot did not visually demonstrate it. Reported to the parent for a mobile scroll/capture correction.

Castgate desktop/mobile route badges, hidden street/building overlays, connection line, route summary and readable inputs looked correct. The desktop embassy editor visibly excludes the garden/pond from the contiguous roof and preserves the selected courtyard ring.

## Final visual resolution: pass

All eight final source viewer screenshots (Castgate/IceBeach, Chromium/Firefox, desktop/mobile), both courtyard editor screenshots, and all eight built viewer screenshots were visually inspected after the final source corrections. The final runs are recorded in `source-runtime-verification.json` at `2026-10-04T07:22:26.307Z` and `built-runtime-verification.json` at `2026-10-04T07:24:56.815Z`. Both manifests were independently checked against all five current canonical map hashes; they match exactly.

- The mobile IceBeach B badge is now fully visible at x64, y134, and A at x346, y278 in both browser engines. Both clear the left toolbar and the directions panel. Runtime camera padding measures the visible Directions toolbar's right edge; verification requires two endpoints and checks toolbar overlap.
- The mobile editor now visibly shows the Open courtyards heading, coordinate textarea and explanatory text beneath the selected embassy roof. The entire textarea's bounding box is checked within the viewport. The desktop field and courtyard exclusion remain readable and correct.
- Castgate desktop/mobile retains visible A/B badges, readable inputs, a connection line ending at its field markers, and a `1.98 km · Free` route. IceBeach shows the actual walking trail with `284.62 km · Free` and `3 days 23 hr`. No new building numbers, bounding boxes or roof outlines appear in the ordinary viewer captures. Outlines remain available in the authoring editor.
- No clipping or horizontal overflow defect was found in these final captures. Desktop and mobile routes remain visually clear of their directions panels.
- The built viewer retains the same route summaries, visible endpoint badges and clean ordinary map artwork in Chromium and Firefox on desktop and mobile. Data fields used for routing are checked against their canonical counterparts by the capture workflow.

The two initial visual findings are resolved. No blocking finding remains within this review's scope.

Bounded editor follow-up: a new courtyard can only be committed if the building marker already lies on its roof. The current coordinate/marker UI moves the marker and roof together; placing only the marker elsewhere within an existing roof is not exposed as a separate control. The corrected embassy already has a valid marker, and editing its existing courtyard is verified. An explicit marker-only placement control would simplify authoring a future courtyard whose starting marker lies in the intended opening.

### Exact reviewed map and proof hashes

These final map hashes replace the interim Castgate snapshots. Both source and built capture manifests record the same canonical hashes:

| Canonical map | SHA-256 |
| --- | --- |
| `maps/Fair-Content.json` | `e8fff76b87c84945910d12572d0fdd45638fc82f6f645fea2c363600bf6a2d43` |
| `maps/Astrousia.json` | `9a0fad5b1ebe1d796893174aa495609ea64384243f6b83a397e580b275b24351` |
| `maps/IceBeach.json` | `4137afe945d9a192247a595ed14d3b052c04b9e6cf58176bf8e8a7966ced9887` |
| `maps/castgate.json` | `fa744d7eb6c6c09a43946be7427deda64379d4a51142e22ea2d61d9b27f61e47` |
| `maps/The-Port-City-of-Stomion.json` | `a8fe135b430fa95429de6c8c909b6f4a210205465227eccea6ffa1bbd6eb4651` |

SHA-256 values for all eighteen visually reviewed screenshots and their two manifests:

| Artifact | SHA-256 |
| --- | --- |
| `source-runtime-verification.json` | `38a9d443e305e06f676a0fb685c01fc2e678680dd168e83e02a6e38a762b0da0` |
| `source-castgate-chromium-desktop.png` | `22ed113022f29226bc1c8d6ffe4f309cf5372a7d1fdafdb787db9abb79240374` |
| `source-IceBeach-chromium-desktop.png` | `36be6be1a49f9fd18034f579936687556d25f584009d382a0d05cb74e3b52269` |
| `source-castgate-chromium-mobile.png` | `8a79175b2be80eac573ded066b32513da0e9253a8f3b67be2f9e5b0ce586912f` |
| `source-IceBeach-chromium-mobile.png` | `91ba819ea3fed36bf3a0c7c1e032d0ea46692b54340c2648e7d44af548f943a2` |
| `source-castgate-firefox-desktop.png` | `9de45488b514c581cb170094792a6563fe49a8747fb582e1f4477acdf2c60df8` |
| `source-IceBeach-firefox-desktop.png` | `44445ba9dbd0c7ac0cd64de9388d4d5c975e72d85e99ee9f91af41034e0da66a` |
| `source-castgate-firefox-mobile.png` | `b27eeb4cfb22de2e14d1d75264d60b2475bbee176cd7dce3d9a47c5050101488` |
| `source-IceBeach-firefox-mobile.png` | `0ecef08cfb8fd5fdfb6ec7aa66c957b86f8274b32fe6e5898932f606b293c048` |
| `editor-castgate-courtyard-desktop.png` | `259bbaab4b48948058e517fa459cb23d5006e94ca60ad64e56ab21633babe0e8` |
| `editor-castgate-courtyard-mobile.png` | `b3a6d4da2b8499dda47dbfb7f3dadbeef2edb03527b8d511305ffdf0642e8d8d` |
| `built-runtime-verification.json` | `44d6f828ba26032891045304a1dc9fe52b734bcc7a17b6587bb007c2738509df` |
| `built-castgate-chromium-desktop.png` | `22ed113022f29226bc1c8d6ffe4f309cf5372a7d1fdafdb787db9abb79240374` |
| `built-IceBeach-chromium-desktop.png` | `7b0dc2f11f952ccb0a20cc380aec2654ea709a4770fd58a323fcc851a1dc32cf` |
| `built-castgate-chromium-mobile.png` | `9aaff26d39652408598285a38ebe92868f016c3d6c76740e519cb9f475b1986f` |
| `built-IceBeach-chromium-mobile.png` | `e5f49cb04cc29f2fe391d38fad04c5e48e3db99a5c51cfe61e78a52c9e8fac8c` |
| `built-castgate-firefox-desktop.png` | `9de45488b514c581cb170094792a6563fe49a8747fb582e1f4477acdf2c60df8` |
| `built-IceBeach-firefox-desktop.png` | `6f409a29286cbf6fc705c11a6a5d0d12249b824edc053ece3f0101a624524adc` |
| `built-castgate-firefox-mobile.png` | `504b8b0f78935e10b8788fb70ef6573a9c0bb9c6a5690b79024cc77bba7109c8` |
| `built-IceBeach-firefox-mobile.png` | `0ecef08cfb8fd5fdfb6ec7aa66c957b86f8274b32fe6e5898932f606b293c048` |
