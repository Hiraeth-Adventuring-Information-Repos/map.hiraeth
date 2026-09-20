#!/usr/bin/env python3
"""Clean and resize the recorded ImageGen markers, preserving their pictograms."""
import argparse
import json
from pathlib import Path
import shutil

try:
    from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps, features
except ImportError:
    raise SystemExit('Install marker preparation dependencies: python3 -m pip install -r scripts/requirements-poi-markers.txt')

ROOT = Path(__file__).resolve().parents[1]
DESIGN = ROOT / 'design' / 'poi-markers'
PNG_SIZE = (384, 512)
WEBP_SIZE = (72, 96)


def clean_marker(source, color):
    """Repair alpha damage and flat fills without inventing replacement symbols.

    These sources all use one ivory pictogram on a solid, convex pin. Their
    transparent holes and mottled colors are generation defects. Extract the
    existing silhouette and light artwork, then restore the requested palette.
    Work at twice the export resolution to retain smooth, antialiased edges.
    """
    with Image.open(source) as original:
        raw = original.convert('RGBA')
    raw.thumbnail((PNG_SIZE[0] * 2, PNG_SIZE[1] * 2), Image.Resampling.LANCZOS)
    red, green, blue, alpha = raw.split()

    # Flood only the exterior, leaving an opaque mask inside the original pin.
    # Padding keeps the exterior connected even when a source touches its canvas.
    mask = ImageOps.expand(alpha.point(lambda p: 255 if p >= 128 else 0), border=1)
    ImageDraw.floodfill(mask, (0, 0), 128)
    mask = mask.point(lambda p: 0 if p == 128 else 255)
    mask = mask.crop((1, 1, raw.width + 1, raw.height + 1))
    mask = mask.filter(ImageFilter.MinFilter(9)).filter(ImageFilter.MaxFilter(9))

    # Keep the main pin and discard detached speckles. All recorded originals
    # have their head centered here; fail rather than exporting an empty marker.
    seed = (raw.width // 2, raw.height // 3)
    if mask.getpixel(seed) != 255:
        raise ValueError(f'{source}: the expected marker silhouette was not found')
    ImageDraw.floodfill(mask, seed, 128)
    mask = mask.point(lambda p: 255 if p == 128 else 0)
    mask = mask.filter(ImageFilter.GaussianBlur(1.5)).point(lambda p: 255 if p >= 128 else 0)

    # The original light pictogram and border survive as a mask. Thresholding
    # removes the fuzzy tint left by the damaged alpha; slight blur retains AA.
    light = ImageChops.darker(ImageChops.darker(red, green), blue)
    light = light.point(lambda p: 255 if p >= 180 else 0).filter(ImageFilter.GaussianBlur(0.55))
    inner = mask.filter(ImageFilter.GaussianBlur(2)).point(lambda p: 255 if p >= 254 else 0)
    light = ImageChops.lighter(light, ImageChops.subtract(mask, inner))
    cleaned = Image.composite(
        Image.new('RGBA', raw.size, '#fbf8e8'),
        Image.new('RGBA', raw.size, color),
        light,
    )
    cleaned.putalpha(mask)
    return cleaned.crop(mask.getbbox())


def fit_export(marker):
    marker.thumbnail(PNG_SIZE, Image.Resampling.LANCZOS)
    exported = Image.new('RGBA', PNG_SIZE)
    exported.alpha_composite(marker, ((PNG_SIZE[0] - marker.width) // 2, PNG_SIZE[1] - marker.height))
    return exported


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--import-records', type=Path, help='Import ImageGen output paths and prompts.')
    parser.add_argument('--force', action='store_true', help='Rebuild even when the existing exports are up to date.')
    args = parser.parse_args()
    manifest_path = DESIGN / 'generation-manifest.json'
    if args.import_records:
        manifest = json.loads(args.import_records.read_text())
        assets = json.loads((ROOT / 'site.config.json').read_text())['assets']
        (DESIGN / 'sources').mkdir(parents=True, exist_ok=True)
        for icon in manifest['icons']:
            runtime_path = 'images/poi-icons/' + icon['slug'] + '.webp'
            icon['types'] = [name for name, value in assets['poiTypeIcons'].items() if value == runtime_path]
            icon['groupFallbacks'] = [name for name, value in assets['poiIcons'].items() if value == runtime_path]
            if not icon.get('generatedPath'):
                continue
            source = DESIGN / 'sources' / (icon['slug'] + '.png')
            shutil.copyfile(icon.pop('generatedPath'), source)
            icon['source'] = str(source.relative_to(DESIGN))
        manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    else:
        manifest = json.loads(manifest_path.read_text())
    if not features.check('webp'):
        raise SystemExit('Pillow with WebP support is required to prepare markers.')
    output = ROOT / 'images' / 'poi-icons'
    output.mkdir(parents=True, exist_ok=True)
    count = 0
    for icon in manifest['icons']:
        if not icon.get('source'):
            continue
        source = DESIGN / icon['source']
        png = output / (icon['slug'] + '.png')
        webp = output / (icon['slug'] + '.webp')
        newest_input = max(source.stat().st_mtime, manifest_path.stat().st_mtime, Path(__file__).stat().st_mtime)
        if not args.force and png.exists() and webp.exists() and min(png.stat().st_mtime, webp.stat().st_mtime) > newest_input:
            continue
        exported = fit_export(clean_marker(source, icon['color']))
        exported.save(png, optimize=True)
        exported.resize(WEBP_SIZE, Image.Resampling.LANCZOS).save(webp, lossless=True, method=6)
        count += 1
        print(f"Prepared {icon['slug']}", flush=True)
    print(f'Prepared {count} clean markers: 384x512 PNG exports and 72x96 transparent WebP assets.')


if __name__ == '__main__':
    main()
