// Retained command name for existing workflows. Artwork is generated with ImageGen;
// this command cleans and resizes recorded originals and never writes dist/.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('./prepare_poi_markers.py', import.meta.url));
const result = spawnSync(process.env.POI_MARKER_PYTHON || 'python3', [script, ...process.argv.slice(2)], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
