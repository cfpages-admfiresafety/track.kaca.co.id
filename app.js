// app.js
document.addEventListener('DOMContentLoaded', () => {
    // Assumes your Cloudflare Function is at /shortio-api relative to your Pages site
    const CLOUDFLARE_WORKER_URL = '/shortio-api';

    // Views
    const apiKeyView = document.getElementById('apiKeyView');
    const mainContentView = document.getElementById('mainContentView');
    const domainsView = document.getElementById('domainsView');
    const domainDetailView = document.getElementById('domainDetailView');
    const linkDetailView = document.getElementById('linkDetailView');

    // API Key Elements
    const apiKeyInput = document.getElementById('apiKeyInput');
    const saveApiKeyButton = document.getElementById('saveApiKeyButton');
    const apiKeyError = document.getElementById('apiKeyError');
    
    // Main Content Elements
    const homeButton = document.getElementById('homeButton');
    const refreshDataButton = document.getElementById('refreshDataButton');
    const lastRetrievedTimestampEl = document.getElementById('lastRetrievedTimestamp');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const globalErrorEl = document.getElementById('globalError');
    const breadcrumbsEl = document.getElementById('breadcrumbs');

    // Domains View Elements
    const domainsListContainer = document.getElementById('domainsListContainer');
    
    // Domain Detail View Elements
    const selectedDomainHostnameEl = document.getElementById('selectedDomainHostname');
    const domainStatsContainer = document.getElementById('domainStatsContainer');
    const linksListContainer = document.getElementById('linksListContainer');

    // Link Detail View Elements
    const selectedLinkPathDisplayEl = document.getElementById('selectedLinkPathDisplay');
    const linkDetailShortUrlEl = document.getElementById('linkDetailShortUrl');
    const linkDetailOriginalUrlEl = document.getElementById('linkDetailOriginalUrl');
    const linkDetailIdDisplayEl = document.getElementById('linkDetailIdDisplay');
    const linkStatsContainer = document.getElementById('linkStatsContainer');

    let currentApiKey = null;
    let currentView = 'apiKey';
    let currentDomainId = null;
    let currentDomainHostname = null;
    let currentLinkId = null;
    let currentLinkPath = null; // For breadcrumbs

    let chartInstances = {};

    function destroyChart(chartId) {
        if (chartInstances[chartId]) {
            chartInstances[chartId].destroy();
            delete chartInstances[chartId];
        }
    }

    function renderBarChart(canvasId, labels, data, dataLabel = 'Count', chartLabel = 'Chart') {
        destroyChart(canvasId);
        const ctx = document.getElementById(canvasId)?.getContext('2d');
        if (!ctx) return;
        chartInstances[canvasId] = new Chart(ctx, {
            type: 'bar',
            data: { labels, datasets: [{ label: dataLabel, data, backgroundColor: 'rgba(54, 162, 235, 0.6)', borderColor: 'rgba(54, 162, 235, 1)', borderWidth: 1 }] },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, suggestedMax: Math.max(...data) + 1  } }, plugins: { legend: { display: true, position: 'top' }, title: { display: false, text: chartLabel} } }
        });
    }

    function renderLineChart(canvasId, label, timeData) {
        destroyChart(canvasId);
        const ctx = document.getElementById(canvasId)?.getContext('2d');
        if (!ctx) return;
        chartInstances[canvasId] = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [{
                    label: label,
                    data: timeData.map(d => ({ x: d.x, y: d.y })), // Ensure date-fns adapter handles string dates
                    fill: false, borderColor: 'rgb(75, 192, 192)', tension: 0.1
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { type: 'time', time: { unit: 'day', tooltipFormat: 'MMM d, yyyy', displayFormats: { day: 'MMM d' } }, title: { display: true, text: 'Date' } },
                    y: { beginAtZero: true, title: { display: true, text: 'Clicks' }, suggestedMax: Math.max(...timeData.map(d => d.y)) + 1 }
                }
            }
        });
    }

    async function shortIOApiCall(action, params = {}, forceRefresh = false) {
        if (!currentApiKey) {
            showError("API Key is not set.");
            switchToView('apiKey');
            return null;
        }
        if (CLOUDFLARE_WORKER_URL.startsWith('YOUR_')) {
             showError('Cloudflare Worker URL is not configured in app.js.');
             return null;
        }

        const cacheKey = `shortio_cache_${action}_${JSON.stringify(params)}`;
        const lastRetrievedKey = `shortio_last_retrieved_${action}_${JSON.stringify(params)}`;

        if (!forceRefresh) {
            const cachedData = localStorage.getItem(cacheKey);
            if (cachedData) {
                try {
                    const data = JSON.parse(cachedData);
                    const lastRetrieved = localStorage.getItem(lastRetrievedKey);
                    if (lastRetrieved && document.getElementById('lastRetrievedTimestamp').offsetParent !== null) { // only update if visible
                         updateLastRetrievedTimestamp(new Date(lastRetrieved).toLocaleString());
                    }
                    return data;
                } catch (e) { localStorage.removeItem(cacheKey); localStorage.removeItem(lastRetrievedKey); }
            }
        }

        showLoading(true);
        showError(null);

        let queryParams = new URLSearchParams();
        queryParams.append('action', action);
        for (const key in params) {
            if (params[key] !== undefined && params[key] !== null) {
                 queryParams.append(key, params[key]);
            }
        }
        
        try {
            const response = await fetch(`${CLOUDFLARE_WORKER_URL}?${queryParams.toString()}`, {
                method: 'GET',
                headers: { 'X-Shortio-Api-Key': currentApiKey, 'Content-Type': 'application/json' }
            });

            const responseData = await response.json(); // Try to parse JSON first

            if (!response.ok) {
                const errorMsg = responseData.error + (responseData.details ? `: ${typeof responseData.details === 'string' ? responseData.details : JSON.stringify(responseData.details)}` : ` (Status: ${response.status})`);
                console.error('API Error:', errorMsg);
                showError(errorMsg);
                if (response.status === 401 || response.status === 403) {
                    clearApiKey();
                    switchToView('apiKey');
                    showError("Invalid API Key or insufficient permissions. Please check your key.");
                }
                return null;
            }
            
            localStorage.setItem(cacheKey, JSON.stringify(responseData));
            const now = new Date();
            localStorage.setItem(lastRetrievedKey, now.toISOString());
             if (document.getElementById('lastRetrievedTimestamp').offsetParent !== null) { // only update if visible
                updateLastRetrievedTimestamp(now.toLocaleString());
             }
            return responseData;
        } catch (err) {
            console.error('Fetch Error:', err);
            showError(`Network error or worker issue: ${err.message}. Check browser console & worker logs.`);
            return null;
        } finally {
            showLoading(false);
        }
    }

    function showLoading(isLoading) { loadingIndicator.style.display = isLoading ? 'block' : 'none'; }
    
    function showError(message) {
        const targetErrorEl = currentView === 'apiKey' ? apiKeyError : globalErrorEl;
        if (message) {
            targetErrorEl.textContent = message;
            targetErrorEl.style.display = 'block';
            if (targetErrorEl === globalErrorEl && apiKeyError) apiKeyError.style.display = 'none'; // hide specific if global shown
        } else {
            globalErrorEl.textContent = ''; globalErrorEl.style.display = 'none';
            if (apiKeyError) { apiKeyError.textContent = ''; apiKeyError.style.display = 'none'; }
        }
    }

    function updateLastRetrievedTimestamp(timestampStr) {
        lastRetrievedTimestampEl.textContent = timestampStr ? `Last retrieved: ${timestampStr}` : '';
    }
    
    function updateBreadcrumbs() {
        let html = '<a href="#" data-view="apiKey" class="text-blue-600 hover:underline">API Key</a>';
        if (currentView !== 'apiKey' && currentApiKey) { // only show beyond API key if key exists
            html += ` » <a href="#" data-view="domains" class="text-blue-600 hover:underline">Domains</a>`;
        }
        if (currentDomainHostname && (currentView === 'domainDetail' || currentView === 'linkDetail')) {
            html += ` » <a href="#" data-view="domainDetail" data-domainid="${currentDomainId}" data-hostname="${currentDomainHostname}" class="text-blue-600 hover:underline">${currentDomainHostname}</a>`;
        }
        if (currentLinkId && currentView === 'linkDetail') {
            html += ` » ${currentLinkPath || `Link ID: ${currentLinkId}`}`; // Use path if available
        }
        breadcrumbsEl.innerHTML = html;

        breadcrumbsEl.querySelectorAll('a').forEach(a => {
            a.addEventListener('click', (e) => {
                e.preventDefault();
                const view = e.target.dataset.view;
                if (view === 'apiKey') switchToView('apiKey', true);
                else if (view === 'domains') loadDomains();
                else if (view === 'domainDetail') loadDomainDetails(e.target.dataset.domainid, e.target.dataset.hostname);
            });
        });
    }

    function switchToView(view, forceApiKeyView = false) {
        currentView = view;
        [apiKeyView, mainContentView, domainsView, domainDetailView, linkDetailView].forEach(el => el.style.display = 'none');
        showError(null);

        if (forceApiKeyView) {
            clearApiKey(); currentApiKey = null; view = 'apiKey';
        }
        
        switch (view) {
            case 'apiKey': apiKeyView.style.display = 'block'; break;
            case 'domains': mainContentView.style.display = 'block'; domainsView.style.display = 'block'; break;
            case 'domainDetail': mainContentView.style.display = 'block'; domainDetailView.style.display = 'block'; break;
            case 'linkDetail': mainContentView.style.display = 'block'; linkDetailView.style.display = 'block'; break;
        }
        updateBreadcrumbs();
    }

    function loadApiKey() {
        currentApiKey = localStorage.getItem('shortio_apiKey');
        if (currentApiKey) {
            apiKeyInput.value = currentApiKey; return true;
        }
        return false;
    }

    function saveApiKey() {
        const key = apiKeyInput.value.trim();
        if (!key.startsWith('sk_')) {
            showError('Invalid API Key format. It should start with "sk_".'); return;
        }
        currentApiKey = key;
        localStorage.setItem('shortio_apiKey', currentApiKey);
        showError(null);
        loadDomains(true);
    }
    
    function clearApiKey() {
        localStorage.removeItem('shortio_apiKey');
        Object.keys(localStorage).forEach(key => { if (key.startsWith('shortio_')) localStorage.removeItem(key); });
        currentApiKey = null; currentDomainId = null; currentDomainHostname = null; currentLinkId = null; currentLinkPath = null;
        apiKeyInput.value = '';
        updateLastRetrievedTimestamp('');
    }

    async function loadDomains(forceRefresh = false) {
        if (!currentApiKey) { switchToView('apiKey'); return; }
        switchToView('domains');
        const domains = await shortIOApiCall('list-domains', {}, forceRefresh);
        if (domains && Array.isArray(domains)) renderDomainsList(domains);
    }

    function renderDomainsList(domains) {
        domainsListContainer.innerHTML = '';
        if (domains.length === 0) {
            domainsListContainer.innerHTML = '<p class="text-gray-600">No domains found.</p>'; return;
        }
        domains.forEach(domain => {
            const card = document.createElement('div');
            card.className = 'bg-gray-50 p-4 rounded-lg shadow hover:shadow-lg transition-shadow cursor-pointer border border-gray-200';
            card.innerHTML = `<h3 class="text-lg font-semibold text-blue-600">${domain.hostname}</h3><p class="text-sm text-gray-500">ID: ${domain.id}</p>`;
            card.addEventListener('click', () => loadDomainDetails(domain.id, domain.hostname));
            domainsListContainer.appendChild(card);
        });
    }

    async function loadDomainDetails(domainId, hostname, forceRefresh = false) {
        currentDomainId = domainId; currentDomainHostname = hostname;
        currentLinkId = null; currentLinkPath = null; // Reset link context
        switchToView('domainDetail');
        selectedDomainHostnameEl.textContent = hostname;

        const [stats, linksData] = await Promise.all([
            shortIOApiCall('get-domain-stats', { domainId }, forceRefresh),
            shortIOApiCall('get-domain-link-clicks', { domainId }, forceRefresh)
        ]);

        if (stats) renderDomainStats(stats);
        if (linksData) renderLinksList(linksData);
    }

    function renderDomainStats(stats) {
        domainStatsContainer.innerHTML = `
            <div class="p-3 bg-indigo-50 rounded-md"><span class="font-bold text-indigo-700">Total Clicks:</span> ${stats.clicks?.toLocaleString() || 0}</div>
            <div class="p-3 bg-purple-50 rounded-md"><span class="font-bold text-purple-700">Human Clicks:</span> ${stats.humanClicks?.toLocaleString() || 0}</div>
            <div class="p-3 bg-pink-50 rounded-md"><span class="font-bold text-pink-700">Total Links:</span> ${stats.links?.toLocaleString() || 0}</div>`;
        
        if (stats.clickStatistics?.datasets?.[0]?.data?.length) renderLineChart('domainClicksChart', 'Clicks', stats.clickStatistics.datasets[0].data); else destroyChart('domainClicksChart');
        if (stats.referer?.length) renderBarChart('domainReferrersChart', stats.referer.map(r => r.referer || 'Direct'), stats.referer.map(r => r.score), 'Clicks', 'Referrers'); else destroyChart('domainReferrersChart');
        if (stats.browser?.length) renderBarChart('domainBrowsersChart', stats.browser.map(b => b.browser), stats.browser.map(b => b.score), 'Sessions', 'Browsers'); else destroyChart('domainBrowsersChart');
        if (stats.country?.length) renderBarChart('domainCountriesChart', stats.country.map(c => c.countryName || c.country), stats.country.map(c => c.score), 'Clicks', 'Countries'); else destroyChart('domainCountriesChart');
        if (stats.os?.length) renderBarChart('domainOsChart', stats.os.map(o => o.os), stats.os.map(o => o.score), 'Sessions', 'Operating Systems'); else destroyChart('domainOsChart');
    }

    function renderLinksList(linksData) {
        linksListContainer.innerHTML = '';
        const linkIds = Object.keys(linksData);
        if (linkIds.length === 0) {
            linksListContainer.innerHTML = '<p class="text-gray-600">No links with clicks found in this domain (for the selected period).</p>'; return;
        }
        linkIds.forEach(linkId => {
            const linkItem = document.createElement('div');
            linkItem.className = 'bg-gray-50 p-3 rounded-md shadow-sm hover:shadow-md transition-shadow flex justify-between items-center border';
            linkItem.innerHTML = `<div><span class="font-semibold">Link ID: ${linkId}</span> <span class="text-sm text-gray-500 ml-2">(Clicks: ${linksData[linkId].toLocaleString()})</span></div>
                                  <button data-linkid="${linkId}" class="text-sm bg-blue-500 hover:bg-blue-600 text-white py-1 px-3 rounded">View Stats</button>`;
            linkItem.querySelector('button').addEventListener('click', (e) => loadLinkDetails(e.target.dataset.linkid));
            linksListContainer.appendChild(linkItem);
        });
    }

    async function loadLinkDetails(linkId, forceRefresh = false) {
        currentLinkId = linkId;
        switchToView('linkDetail');
        
        linkDetailIdDisplayEl.textContent = linkId; // Show ID immediately
        selectedLinkPathDisplayEl.textContent = `ID: ${linkId}`; // Placeholder
        linkDetailShortUrlEl.textContent = 'Loading...';
        linkDetailOriginalUrlEl.textContent = 'Loading...';
        linkDetailOriginalUrlEl.removeAttribute('href');


        const [stats, linkInfo] = await Promise.all([
            shortIOApiCall('get-link-stats', { linkId }, forceRefresh),
            shortIOApiCall('get-link-info', { linkId }, forceRefresh)
        ]);

        if (linkInfo) {
            currentLinkPath = linkInfo.path ? `/${linkInfo.path}` : (linkInfo.shortURL ? new URL(linkInfo.shortURL).pathname : `ID: ${linkId}`);
            selectedLinkPathDisplayEl.textContent = currentLinkPath;
            linkDetailShortUrlEl.textContent = linkInfo.shortURL || 'N/A';
            if (linkInfo.originalURL) {
                linkDetailOriginalUrlEl.href = linkInfo.originalURL;
                linkDetailOriginalUrlEl.textContent = linkInfo.originalURL;
            } else {
                linkDetailOriginalUrlEl.textContent = 'N/A';
            }
            updateBreadcrumbs(); // Update breadcrumb with path
        } else {
            currentLinkPath = `ID: ${linkId}`; // Fallback for breadcrumb
             selectedLinkPathDisplayEl.textContent = currentLinkPath;
            linkDetailShortUrlEl.textContent = 'Error loading info';
            linkDetailOriginalUrlEl.textContent = 'Error loading info';
            updateBreadcrumbs();
        }
        
        if (stats) renderLinkStats(stats); else {
            // Clear charts if stats fail to load
            ['linkClicksChart', 'linkReferrersChart', 'linkBrowsersChart', 'linkCountriesChart', 'linkOsChart'].forEach(destroyChart);
            linkStatsContainer.innerHTML = '<p class="text-red-500 col-span-full">Failed to load link statistics.</p>';
        }
    }

    function renderLinkStats(stats) {
        linkStatsContainer.innerHTML = `
            <div class="p-3 bg-teal-50 rounded-md"><span class="font-bold text-teal-700">Total Clicks:</span> ${stats.totalClicks?.toLocaleString() || 0}</div>
            <div class="p-3 bg-cyan-50 rounded-md"><span class="font-bold text-cyan-700">Human Clicks:</span> ${stats.humanClicks?.toLocaleString() || 0}</div>`;

        if (stats.clickStatistics?.datasets?.[0]?.data?.length) renderLineChart('linkClicksChart', 'Clicks', stats.clickStatistics.datasets[0].data); else destroyChart('linkClicksChart');
        if (stats.referer?.length) renderBarChart('linkReferrersChart', stats.referer.map(r => r.referer || 'Direct'), stats.referer.map(r => r.score), 'Clicks', 'Referrers'); else destroyChart('linkReferrersChart');
        if (stats.browser?.length) renderBarChart('linkBrowsersChart', stats.browser.map(b => b.browser), stats.browser.map(b => b.score), 'Sessions', 'Browsers'); else destroyChart('linkBrowsersChart');
        if (stats.country?.length) renderBarChart('linkCountriesChart', stats.country.map(c => c.countryName || c.country), stats.country.map(c => c.score), 'Clicks', 'Countries'); else destroyChart('linkCountriesChart');
        if (stats.os?.length) renderBarChart('linkOsChart', stats.os.map(o => o.os), stats.os.map(o => o.score), 'Sessions', 'Operating Systems'); else destroyChart('linkOsChart');
    }
    
    saveApiKeyButton.addEventListener('click', saveApiKey);
    apiKeyInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') saveApiKey(); });
    homeButton.addEventListener('click', () => switchToView('apiKey', true));
    refreshDataButton.addEventListener('click', () => {
        showError(null);
        if (currentView === 'domains') loadDomains(true);
        else if (currentView === 'domainDetail' && currentDomainId) loadDomainDetails(currentDomainId, currentDomainHostname, true);
        else if (currentView === 'linkDetail' && currentLinkId) loadLinkDetails(currentLinkId, true);
        else if (currentApiKey) loadDomains(true);
        else switchToView('apiKey');
    });

    function init() {
        if (CLOUDFLARE_WORKER_URL.startsWith('YOUR_')) {
             switchToView('apiKey');
             showError('CRITICAL: Cloudflare Worker URL is not configured in app.js.');
             return;
        }
        if (loadApiKey()) loadDomains();
        else switchToView('apiKey');
        updateBreadcrumbs();
    }
    init();
});
