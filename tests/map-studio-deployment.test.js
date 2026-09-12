const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const compose = fs.readFileSync(path.join(root, 'compose.yaml'), 'utf8');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
const caddyfile = fs.readFileSync(path.join(root, 'deploy/Caddyfile'), 'utf8');
const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

assert.match(envExample, /^MAP_STUDIO_LAN_IP=/m);
assert.match(gitignore, /^\.env$/m);
assert.match(compose, /MAP_STUDIO_ALLOWED_HOSTS:.*\$\{MAP_STUDIO_LAN_IP/);
assert.match(compose, /MAP_STUDIO_LAN_IP: \$\{MAP_STUDIO_LAN_IP:-127\.0\.0\.1\}/);
assert.match(compose, /MAP_STUDIO_AUTH_DISABLED: "true"/);
assert.doesNotMatch(compose, /MAP_STUDIO_PASSWORD_FILE|map_studio_password/);
assert.match(compose, /MAP_STUDIO_DRAFTS_ROOT: \/var\/lib\/map-studio\/drafts/);
assert.match(compose, /map_studio_drafts:\/var\/lib\/map-studio\/drafts/);
assert.match(compose, /target: \/workspace\n\s+read_only: true/);
assert.match(compose, /- "80:80"/);
assert.doesNotMatch(compose, /443:443/);
assert.match(dockerfile, /MAP_STUDIO_DRAFTS_ROOT=\/var\/lib\/map-studio\/drafts/);
assert.match(dockerfile, /chown -R node:node[^\n]*\/var\/lib\/map-studio/);
assert.match(caddyfile, /http:\/\/\{\$MAP_STUDIO_HOSTNAME:map-studio\.local\}, http:\/\/\{\$MAP_STUDIO_LAN_IP:127\.0\.0\.1\}/);
assert.doesNotMatch(caddyfile, /tls internal|Strict-Transport-Security|default_sni/);

console.log('map studio deployment checks passed');
