# AI-generated POI markers

The replacement markers use the built-in ImageGen tool, with one generated image per design. The original City generation establishes the style; the remaining designs edit that template's pictogram and category color.

Map display size stays **36 × 48 CSS pixels**, anchored at **[18, 47]**, with popup anchor **[0, -40]**. Archival PNG exports stay **384 × 512 pixels**. Optimized transparent WebP markers are **72 × 96 pixels**, providing 2× resolution at the existing display size.

Full prompts, type mappings, and source filenames are recorded in `generation-manifest.json`. Generated originals are preserved unchanged in `sources/`.

The originals had unwanted alpha holes, mottled fills, and stray edge pixels. `scripts/prepare_poi_markers.py` repairs those defects with Pillow: it fills the existing pin silhouette, removes detached pixels, retains the AI-generated light pictogram, and restores the flat category color and ivory artwork. The transparent exterior and antialiased edges are preserved. This cleanup does not regenerate or substitute symbols.

To rebuild the assets:

```sh
python3 -m pip install -r scripts/requirements-poi-markers.txt
python3 scripts/prepare_poi_markers.py
```

Use `--force` to rebuild unchanged inputs. The legacy Node command `node scripts/generate_poi_type_icons.mjs` runs the same preparation; `POI_MARKER_PYTHON` can select a Python virtual environment. Pillow is only needed when preparing artwork, not when running or building the website.

`quality-report.json` records the review of all 70 designs. `preview.png` shows every repaired marker at its actual map size against light and dark backgrounds. Browser tests check all runtime images for opaque interiors, a single pin silhouette, and unchanged dimensions.

Category colors remain blue for settlements, purple for structures, green for natural features, amber for other locations, and gray for unknown types. Existing map content is not reclassified. Additional types are available as suggestions in the editor.
