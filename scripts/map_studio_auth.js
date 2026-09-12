const crypto = require('node:crypto');
const fs = require('node:fs');

const SESSION_COOKIE = 'hiraeth_map_studio_session';
const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 8;

function parseCookies(cookieHeader) {
    return String(cookieHeader || '').split(';').reduce((cookies, part) => {
        const separator = part.indexOf('=');
        if (separator < 0) return cookies;
        const name = part.slice(0, separator).trim();
        const value = part.slice(separator + 1).trim();
        if (!name) return cookies;
        try {
            cookies[name] = decodeURIComponent(value);
        } catch (error) {
            cookies[name] = value;
        }
        return cookies;
    }, {});
}

function readSecret({ value, filePath, label }) {
    if (String(value || '').trim()) return String(value).trim();
    if (String(filePath || '').trim()) {
        const secret = fs.readFileSync(String(filePath).trim(), 'utf8').trim();
        if (secret) return secret;
    }
    throw new Error(`${label} is required. Set the direct value or mount its secret file.`);
}

function digest(value) {
    return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest();
}

function secureEqual(left, right) {
    return crypto.timingSafeEqual(digest(left), digest(right));
}

function requestAddress(request) {
    return String(request.socket?.remoteAddress || 'unknown');
}

function createSessionManager(options = {}) {
    const password = readSecret({
        value: options.password,
        filePath: options.passwordFile,
        label: 'Map Studio password'
    });
    const secureCookies = options.secureCookies !== false;
    const sessionTtlMs = Number(options.sessionTtlMs) > 0
        ? Number(options.sessionTtlMs)
        : DEFAULT_SESSION_TTL_MS;
    const sessions = new Map();
    const loginAttempts = new Map();

    function prune(now = Date.now()) {
        sessions.forEach((session, id) => {
            if (session.expiresAt <= now) sessions.delete(id);
        });
        loginAttempts.forEach((attempt, address) => {
            if (attempt.windowStartedAt + LOGIN_WINDOW_MS <= now) loginAttempts.delete(address);
        });
    }

    function authenticate(request) {
        prune();
        const sessionId = parseCookies(request.headers.cookie)[SESSION_COOKIE];
        const session = sessionId ? sessions.get(sessionId) : null;
        if (!session || session.expiresAt <= Date.now()) return null;
        session.expiresAt = Date.now() + sessionTtlMs;
        return session;
    }

    function noteFailedLogin(request) {
        const now = Date.now();
        const address = requestAddress(request);
        const existing = loginAttempts.get(address);
        const attempt = !existing || existing.windowStartedAt + LOGIN_WINDOW_MS <= now
            ? { count: 0, windowStartedAt: now }
            : existing;
        attempt.count += 1;
        loginAttempts.set(address, attempt);
        return attempt.count;
    }

    function isRateLimited(request) {
        prune();
        const attempt = loginAttempts.get(requestAddress(request));
        return Boolean(attempt && attempt.count >= MAX_LOGIN_ATTEMPTS);
    }

    function login(request, submittedPassword) {
        if (isRateLimited(request)) {
            return { ok: false, rateLimited: true };
        }
        if (!secureEqual(password, submittedPassword)) {
            noteFailedLogin(request);
            return { ok: false, rateLimited: false };
        }

        loginAttempts.delete(requestAddress(request));
        const id = crypto.randomBytes(32).toString('base64url');
        const session = {
            id,
            csrfToken: crypto.randomBytes(32).toString('base64url'),
            createdAt: Date.now(),
            expiresAt: Date.now() + sessionTtlMs
        };
        sessions.set(id, session);
        return { ok: true, session };
    }

    function logout(request) {
        const sessionId = parseCookies(request.headers.cookie)[SESSION_COOKIE];
        if (sessionId) sessions.delete(sessionId);
    }

    function hasValidCsrf(request, session = authenticate(request)) {
        if (!session) return false;
        const supplied = String(request.headers['x-csrf-token'] || '');
        return Boolean(supplied && secureEqual(session.csrfToken, supplied));
    }

    function getSessionCookie(session) {
        const parts = [
            `${SESSION_COOKIE}=${encodeURIComponent(session.id)}`,
            'Path=/',
            'HttpOnly',
            'SameSite=Strict',
            `Max-Age=${Math.floor(sessionTtlMs / 1000)}`
        ];
        if (secureCookies) parts.push('Secure');
        return parts.join('; ');
    }

    function getExpiredCookie() {
        const parts = [
            `${SESSION_COOKIE}=`,
            'Path=/',
            'HttpOnly',
            'SameSite=Strict',
            'Max-Age=0'
        ];
        if (secureCookies) parts.push('Secure');
        return parts.join('; ');
    }

    return {
        authenticate,
        getExpiredCookie,
        getSessionCookie,
        hasValidCsrf,
        isRateLimited,
        login,
        logout,
        prune
    };
}

function createLocalSessionManager(options = {}) {
    const session = Object.freeze({
        id: 'local-testing',
        csrfToken: String(options.csrfToken || crypto.randomBytes(32).toString('base64url')),
        createdAt: Date.now(),
        expiresAt: Number.POSITIVE_INFINITY
    });

    return {
        authenticationDisabled: true,
        authenticate: () => session,
        getExpiredCookie: () => '',
        getSessionCookie: () => '',
        hasValidCsrf(request, candidate = session) {
            const supplied = String(request.headers['x-csrf-token'] || '');
            return candidate === session && Boolean(supplied && secureEqual(session.csrfToken, supplied));
        },
        isRateLimited: () => false,
        login: () => ({ ok: true, session }),
        logout: () => {},
        prune: () => {}
    };
}

module.exports = {
    MAX_LOGIN_ATTEMPTS,
    SESSION_COOKIE,
    createLocalSessionManager,
    createSessionManager,
    parseCookies,
    readSecret,
    secureEqual
};
