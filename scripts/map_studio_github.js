const crypto = require('node:crypto');
const fs = require('node:fs');

function base64UrlJson(value) {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createGitHubAppJwt({ appId, privateKey, now = Math.floor(Date.now() / 1000) }) {
    if (!String(appId || '').trim()) throw new Error('GitHub App ID is required.');
    if (!String(privateKey || '').trim()) throw new Error('GitHub App private key is required.');
    const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' });
    const payload = base64UrlJson({
        iat: now - 60,
        exp: now + (9 * 60),
        iss: String(appId).trim()
    });
    const unsignedToken = `${header}.${payload}`;
    const signature = crypto.sign('RSA-SHA256', Buffer.from(unsignedToken), privateKey).toString('base64url');
    return `${unsignedToken}.${signature}`;
}

function readOptionalSecret(value, filePath) {
    if (String(value || '').trim()) return String(value).trim();
    const normalizedPath = String(filePath || '').trim();
    if (!normalizedPath || !fs.existsSync(normalizedPath)) return '';
    return fs.readFileSync(normalizedPath, 'utf8').trim();
}

function createGitHubClient(options = {}) {
    const fetchImpl = options.fetchImpl || global.fetch;
    const owner = String(options.owner || process.env.MAP_STUDIO_GITHUB_OWNER || '').trim();
    const repo = String(options.repo || process.env.MAP_STUDIO_GITHUB_REPO || '').trim();
    const appId = String(options.appId || process.env.MAP_STUDIO_GITHUB_APP_ID || '').trim();
    const installationId = String(
        options.installationId || process.env.MAP_STUDIO_GITHUB_INSTALLATION_ID || ''
    ).trim();
    const privateKeyFile = options.privateKeyFile || process.env.MAP_STUDIO_GITHUB_PRIVATE_KEY_FILE;
    const directTokenFile = options.tokenFile || process.env.MAP_STUDIO_GITHUB_TOKEN_FILE;
    const apiBaseUrl = String(options.apiBaseUrl || 'https://api.github.com').replace(/\/$/, '');
    let cachedInstallationToken = null;

    function getConfiguration() {
        const directToken = readOptionalSecret(options.token || process.env.MAP_STUDIO_GITHUB_TOKEN, directTokenFile);
        const privateKey = readOptionalSecret(options.privateKey, privateKeyFile);
        const mode = directToken ? 'token' : (appId && installationId && privateKey ? 'app' : 'unconfigured');
        return {
            configured: Boolean(owner && repo && mode !== 'unconfigured'),
            mode,
            owner,
            repo
        };
    }

    async function request(pathname, requestOptions = {}) {
        const token = requestOptions.token || await getToken();
        const response = await fetchImpl(`${apiBaseUrl}${pathname}`, {
            ...requestOptions,
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${token}`,
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'hiraeth-map-studio',
                ...(requestOptions.headers || {})
            }
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(payload?.message || `GitHub request failed with HTTP ${response.status}.`);
        }
        return payload;
    }

    async function getToken() {
        const directToken = readOptionalSecret(options.token || process.env.MAP_STUDIO_GITHUB_TOKEN, directTokenFile);
        if (directToken) return directToken;

        const privateKey = readOptionalSecret(options.privateKey, privateKeyFile);
        if (!appId || !installationId || !privateKey) {
            throw new Error('GitHub publishing is not configured. Supply a GitHub App or fine-grained token.');
        }

        const now = Date.now();
        if (cachedInstallationToken && cachedInstallationToken.expiresAt > now + 60_000) {
            return cachedInstallationToken.token;
        }

        const jwt = createGitHubAppJwt({ appId, privateKey });
        const response = await fetchImpl(
            `${apiBaseUrl}/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
            {
                method: 'POST',
                headers: {
                    Accept: 'application/vnd.github+json',
                    Authorization: `Bearer ${jwt}`,
                    'X-GitHub-Api-Version': '2022-11-28',
                    'User-Agent': 'hiraeth-map-studio'
                }
            }
        );
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.token) {
            throw new Error(payload?.message || `Could not create GitHub installation token (HTTP ${response.status}).`);
        }
        cachedInstallationToken = {
            token: payload.token,
            expiresAt: Date.parse(payload.expires_at) || now + (50 * 60 * 1000)
        };
        return cachedInstallationToken.token;
    }

    async function createDraftPullRequest({ branch, title, body, base = 'main' }) {
        const config = getConfiguration();
        if (!config.configured) throw new Error('GitHub repository publishing is not configured.');
        return request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title,
                head: branch,
                base,
                body,
                draft: true
            })
        });
    }

    return {
        createDraftPullRequest,
        getConfiguration,
        getToken,
        request
    };
}

module.exports = {
    createGitHubAppJwt,
    createGitHubClient,
    readOptionalSecret
};
