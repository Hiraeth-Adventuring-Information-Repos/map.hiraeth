const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const compose = fs.readFileSync(path.join(root, 'compose.yaml'), 'utf8');
const caddyfile = fs.readFileSync(path.join(root, 'deploy/Caddyfile'), 'utf8');
const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

assert.match(envExample, /^MAP_STUDIO_LAN_IP=/m);
assert.match(gitignore, /^\.env$/m);
assert.match(compose, /MAP_STUDIO_ALLOWED_HOSTS:.*\$\{MAP_STUDIO_LAN_IP/);
assert.match(compose, /MAP_STUDIO_LAN_IP: \$\{MAP_STUDIO_LAN_IP:-127\.0\.0\.1\}/);
assert.match(caddyfile, /default_sni \{\$MAP_STUDIO_LAN_IP:127\.0\.0\.1\}/);
assert.match(caddyfile, /\{\$MAP_STUDIO_HOSTNAME:map-studio\.local\}, \{\$MAP_STUDIO_LAN_IP:127\.0\.0\.1\}/);

console.log('map studio deployment checks passed');
