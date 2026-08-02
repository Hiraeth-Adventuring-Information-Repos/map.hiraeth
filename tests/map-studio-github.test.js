const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createGitHubAppJwt, createGitHubClient } = require('../scripts/map_studio_github.js');

(async () => {

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const jwt = createGitHubAppJwt({ appId: '12345', privateKey: pem, now: 1_800_000_000 });
const parts = jwt.split('.');
assert.equal(parts.length, 3);
const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
assert.equal(payload.iss, '12345');
assert.equal(payload.iat, 1_799_999_940);
assert.equal(payload.exp, 1_800_000_540);

const requests = [];
const client = createGitHubClient({
    owner: 'hiraeth',
    repo: 'maps',
    token: 'fine-grained-token',
    fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return new Response(JSON.stringify({ number: 42, html_url: 'https://github.test/pr/42' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' }
        });
    }
});
assert.equal(client.getConfiguration().mode, 'token');
const pullRequest = await client.createDraftPullRequest({
    branch: 'map-studio/new-map',
    title: 'Add map',
    body: 'Review it'
});
assert.equal(pullRequest.number, 42);
assert.equal(requests.length, 1);
const sentBody = JSON.parse(requests[0].options.body);
assert.equal(sentBody.draft, true);
assert.equal(sentBody.base, 'main');

console.log('map studio GitHub checks passed');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
