(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
        return;
    }
    root.SharedUtils = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function isRoutingExperimentEnabled(search = '') {
        return new URLSearchParams(search).get('routing') === '1';
    }

    function withRoutingExperiment(url, search = '') {
        const value = String(url);
        if (!isRoutingExperimentEnabled(search)) return value;
        const hashIndex = value.indexOf('#');
        const pathAndQuery = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
        const hash = hashIndex >= 0 ? value.slice(hashIndex) : '';
        const queryIndex = pathAndQuery.indexOf('?');
        const pathname = queryIndex >= 0 ? pathAndQuery.slice(0, queryIndex) : pathAndQuery;
        const params = new URLSearchParams(queryIndex >= 0 ? pathAndQuery.slice(queryIndex + 1) : '');
        params.set('routing', '1');
        return `${pathname}?${params}${hash}`;
    }

    function preserveRoutingExperimentLinks(document, search = '') {
        document.querySelectorAll('a[data-routing-link]').forEach(link => {
            link.setAttribute('href', withRoutingExperiment(link.getAttribute('href'), search));
        });
    }

    function withAssetVersion(url, versionOverride = '') {
        const fallbackVersion = typeof window !== 'undefined' && window.APP_ASSET_VERSION
            ? window.APP_ASSET_VERSION
            : '0';
        const version = encodeURIComponent(String(versionOverride || fallbackVersion));
        const rawUrl = String(url);
        const hashIndex = rawUrl.indexOf('#');
        const pathAndQuery = hashIndex >= 0 ? rawUrl.slice(0, hashIndex) : rawUrl;
        const hash = hashIndex >= 0 ? rawUrl.slice(hashIndex) : '';
        if (/[?&]v=[^&#]*/.test(pathAndQuery)) {
            return `${pathAndQuery.replace(/([?&])v=[^&#]*/, `$1v=${version}`)}${hash}`;
        }
        const separator = pathAndQuery.includes('?') ? '&' : '?';
        return `${pathAndQuery}${separator}v=${version}${hash}`;
    }

    async function fetchJsonAsset(url) {
        const response = await fetch(withAssetVersion(url));
        if (!response.ok) {
            throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }


    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), wait);
        };
    }

    return {
        isRoutingExperimentEnabled,
        withRoutingExperiment,
        preserveRoutingExperimentLinks,
        debounce,
        withAssetVersion,
        fetchJsonAsset
    };
}));
