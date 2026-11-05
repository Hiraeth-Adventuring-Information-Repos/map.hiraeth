const assert = require('node:assert/strict');
const {
    MAX_LOGIN_ATTEMPTS,
    SESSION_COOKIE,
    createLocalSessionManager,
    createSessionManager,
    parseCookies,
    secureEqual
} = require('../scripts/map_studio_auth.js');

assert.deepEqual(parseCookies('one=1; encoded=hello%20world'), { one: '1', encoded: 'hello world' });
assert.equal(secureEqual('same', 'same'), true);
assert.equal(secureEqual('same', 'different'), false);

const manager = createSessionManager({ password: 'correct horse', secureCookies: false });
const request = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
assert.equal(manager.authenticate(request), null);
assert.equal(manager.login(request, 'wrong').ok, false);
const login = manager.login(request, 'correct horse');
assert.equal(login.ok, true);
const cookie = manager.getSessionCookie(login.session);
assert.match(cookie, new RegExp(`^${SESSION_COOKIE}=`));
assert.match(cookie, /HttpOnly/);
assert.match(cookie, /SameSite=Strict/);
assert.doesNotMatch(cookie, /Secure/);

const authenticatedRequest = {
    headers: {
        cookie,
        'x-csrf-token': login.session.csrfToken
    },
    socket: { remoteAddress: '127.0.0.1' }
};
assert.equal(manager.authenticate(authenticatedRequest).id, login.session.id);
assert.equal(manager.hasValidCsrf(authenticatedRequest), true);
assert.equal(manager.hasValidCsrf({ ...authenticatedRequest, headers: { cookie } }), false);
manager.logout(authenticatedRequest);
assert.equal(manager.authenticate(authenticatedRequest), null);

const limitedManager = createSessionManager({ password: 'secret', secureCookies: true });
for (let index = 0; index < MAX_LOGIN_ATTEMPTS; index += 1) {
    limitedManager.login(request, 'wrong');
}
assert.equal(limitedManager.isRateLimited(request), true);
assert.equal(limitedManager.login(request, 'secret').rateLimited, true);

const localManager = createLocalSessionManager({ csrfToken: 'local-csrf' });
const localSession = localManager.authenticate(request);
assert.equal(localManager.authenticationDisabled, true);
assert.equal(localSession.id, 'local-testing');
assert.equal(localManager.login(request, '').ok, true);
assert.equal(localManager.getSessionCookie(localSession), '');
assert.equal(localManager.hasValidCsrf({ headers: { 'x-csrf-token': 'local-csrf' } }, localSession), true);
assert.equal(localManager.hasValidCsrf({ headers: {} }, localSession), false);

console.log('map studio authentication checks passed');
