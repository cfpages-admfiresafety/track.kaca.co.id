// app.js v.0.5 dynamic custom date function
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
    const resetDataButton = document.getElementById('resetDataButton');

    // Period Selection & Picker
    const periodSelect = document.getElementById('periodSelect');
    const customDateRangeContainer = document.getElementById('customDateRangeContainer');
    const startDateInput = document.getElementById('startDateInput');
    const endDateInput = document.getElementById('endDateInput');
    const applyCustomDateRangeButton = document.getElementById('applyCustomDateRangeButton');

    let currentPeriod = 'total'; // Default period
    let customStartDate = ''; // Store custom start date
    let customEndDate = '';   // Store custom end date

    let currentApiKey = null;
    let currentView = 'apiKey';
    let currentDomainId = null;
    let currentDomainHostname = null;
    let currentLinkId = null;
    let currentLinkPath = null; // For breadcrumbs
    let activeLoadCounter = 0;
    let totalLinksInDomain = 0;

    let chartInstances = {};

    // --- Chart Helper ---
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
            data: { 
                labels, 
                datasets: [{ 
                    label: dataLabel, 
                    data, 
                    backgroundColor: 'rgba(54, 162, 235, 0.6)', 
                    borderColor: 'rgba(54, 162, 235, 1)', 
                    borderWidth: 1 
                }] 
            },
            options: { 
                responsive: true, 
                maintainAspectRatio: false, // This allows the chart to use the full height of chart-container
                scales: { 
                    y: { 
                        beginAtZero: true, 
                        suggestedMax: data.length > 0 ? Math.max(...data) + 1 : 1 // Prevent error on empty data
                    } 
                }, 
                plugins: { 
                    legend: { display: true, position: 'top' }, 
                    title: { display: false, text: chartLabel} 
                } 
            }
        });
    }

    function renderLineChart(canvasId, label, timeData) {
        destroyChart(canvasId);
        const ctx = document.getElementById(canvasId)?.getContext('2d');
        if (!ctx) return;
        const yData = timeData.map(d => d.y);
        chartInstances[canvasId] = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [{
                    label: label,
                    data: timeData.map(d => ({ x: d.x, y: d.y })),
                    fill: false, borderColor: 'rgb(75, 192, 192)', tension: 0.1
                }]
            },
            options: {
                responsive: true, 
                maintainAspectRatio: false, // This allows the chart to use the full height of chart-container
                scales: {
                    x: { 
                        type: 'time', 
                        time: { unit: 'day', tooltipFormat: 'MMM d, yyyy', displayFormats: { day: 'MMM d' } }, 
                        title: { display: true, text: 'Date' } 
                    },
                    y: { 
                        beginAtZero: true, 
                        title: { display: true, text: 'Clicks' }, 
                        suggestedMax: yData.length > 0 ? Math.max(...yData) + 1 : 1 // Prevent error on empty data
                    }
                }
            }
        });
    }

    function getPeriodDisplayName(periodValue, startDate, endDate) {
        if (periodValue === 'custom' && startDate && endDate) {
            // Format dates for display (e.g., "MMM D, YYYY")
            const options = { year: 'numeric', month: 'short', day: 'numeric' };
            const displayStart = new Date(startDate + 'T00:00:00').toLocaleDateString(undefined, options); // Add T00:00:00 to avoid timezone issues with just date
            const displayEnd = new Date(endDate + 'T00:00:00').toLocaleDateString(undefined, options);
            return `Custom: ${displayStart} - ${displayEnd}`;
        }
        // Find the text of the selected option in the dropdown
        const selectedOption = periodSelect.querySelector(`option[value="${periodValue}"]`);
        return selectedOption ? selectedOption.textContent : periodValue;
    }

    function updateLoadingIndicator(operation) { // operation is 'start' or 'end'
        if (operation === 'start') {
            activeLoadCounter++;
        } else if (operation === 'end') {
            activeLoadCounter--;
        }

        if (activeLoadCounter < 0) {
            activeLoadCounter = 0; // Safety net, should not happen with correct usage
        }

        console.log("Active loads:", activeLoadCounter); // Optional: for debugging

        if (activeLoadCounter > 0) {
            loadingIndicator.style.display = 'block';
        } else {
            loadingIndicator.style.display = 'none';
        }
    }

    async function shortIOApiCall(action, params = {}, forceRefresh = false) {
        if (!currentApiKey) {
            showError("API Key is not set.");
            switchToView('apiKey'); // This will also attempt to clear data.
            return null;
        }
        if (CLOUDFLARE_WORKER_URL.startsWith('YOUR_')) {
             showError('Cloudflare Worker URL is not configured in app.js.');
             return null;
        }

        let cacheKeyParams = { ...params }; 
        if (action === 'get-domain-stats' || action === 'get-link-stats') {
            cacheKeyParams.period = params.period || currentPeriod; // Ensure period is included
            if (cacheKeyParams.period === 'custom') {
                cacheKeyParams.startDate = params.startDate || customStartDate;
                cacheKeyParams.endDate = params.endDate || customEndDate;
            }
        }
        Object.keys(cacheKeyParams).forEach(key => {
            if (cacheKeyParams[key] === undefined || cacheKeyParams[key] === null) {
                delete cacheKeyParams[key];
            }
        });

        const cacheKey = `shortio_cache_${action}_${JSON.stringify(cacheKeyParams)}`;
        const lastRetrievedKey = `shortio_last_retrieved_${action}_${JSON.stringify(cacheKeyParams)}`;

        if (!forceRefresh) {
            const cachedData = localStorage.getItem(cacheKey);
            if (cachedData) {
                try {
                    const data = JSON.parse(cachedData);
                    const lastRetrieved = localStorage.getItem(lastRetrievedKey);
                    if (lastRetrieved && document.getElementById('lastRetrievedTimestamp').offsetParent !== null) {
                         updateLastRetrievedTimestamp(new Date(lastRetrieved).toLocaleString());
                    }
                    console.log(`Cache hit for ${action} with params:`, cacheKeyParams); // Cache hit log
                    return data;
                } catch (e) { localStorage.removeItem(cacheKey); localStorage.removeItem(lastRetrievedKey); }
            }
        }
        console.log(`Cache miss or force refresh for ${action} with params:`, cacheKeyParams); // Cache miss log

        updateLoadingIndicator('start');
        showError(null);

        let queryParamsForApi = new URLSearchParams();
        queryParamsForApi.append('action', action);
        for (const key in params) { // params already contains period, startDate, endDate if applicable
            if (params[key] !== undefined && params[key] !== null) {
                 queryParamsForApi.append(key, params[key]);
            }
        }
        
        try {
            const response = await fetch(`${CLOUDFLARE_WORKER_URL}?${queryParamsForApi.toString()}`, {
                method: 'GET',
                headers: { 'X-Shortio-Api-Key': currentApiKey, 'Content-Type': 'application/json' }
            });

            const responseData = await response.json();

            if (!response.ok) {
                const errorMsgBase = responseData.error || `Request failed with status ${response.status}`;
                const errorDetails = responseData.details ? (typeof responseData.details === 'string' ? responseData.details : JSON.stringify(responseData.details)) : '';
                const errorMsg = errorDetails ? `${errorMsgBase}: ${errorDetails}` : errorMsgBase;

                console.error('API Error from shortIOApiCall:', errorMsg);
                showError(errorMsg); // Show error in the UI
                if (response.status === 401 || response.status === 403) {
                    // clearApiKey() is now more thorough via clearAllAppData()
                    clearApiKey(); // This will also call clearAllAppData()
                    switchToView('apiKey'); // Navigate to API key entry
                    // The showError above would have already set the message.
                    // We can enhance it here if needed for auth errors.
                    showError("Invalid API Key or insufficient permissions. Please re-enter your key.");
                }
                return null;
            }
            
            localStorage.setItem(cacheKey, JSON.stringify(responseData));
            const now = new Date();
            localStorage.setItem(lastRetrievedKey, now.toISOString());
            if (document.getElementById('lastRetrievedTimestamp').offsetParent !== null) {
                updateLastRetrievedTimestamp(now.toLocaleString());
            }
            return responseData;
        } catch (err) {
            // This catch is for network errors or if response.json() fails
            console.error('Fetch/Network Error in shortIOApiCall:', err);
            showError(`Network error or problem processing API response: ${err.message}. Check browser console & worker logs.`);
            return null;
        } finally {
            updateLoadingIndicator('end'); // Indicate a load operation has ended
        }
    }

    function showLoading(isLoading) {
        console.log("showLoading called with:", isLoading); // DEBUG LINE
        loadingIndicator.style.display = isLoading ? 'block' : 'none';
    }
    
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
        clearAllAppData(); 
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

    // --- Domain Details & Link Listing ---
    let currentDomainLinks = []; // To store all links for current domain for pagination
    let currentPageToken = null;
    let prevPageToken = null; // For "Previous" button logic if needed

    async function loadDomainDetails(domainId, hostname, forceRefresh = false, pageToken = null) {
        currentDomainId = domainId; currentDomainHostname = hostname;
        currentLinkId = null; currentLinkPath = null;
        switchToView('domainDetail');
        selectedDomainHostnameEl.textContent = hostname;

        const paramsForLinks = { domainId };
        if (pageToken) {
            paramsForLinks.pageToken = pageToken;
        } else {
            // Reset totalLinksInDomain when loading the first page of a domain
            totalLinksInDomain = 0; 
        }

        const apiParamsForStats = { domainId, period: currentPeriod };
        if (currentPeriod === 'custom' && customStartDate && customEndDate) {
            apiParamsForStats.startDate = customStartDate;
            apiParamsForStats.endDate = customEndDate;
        }

        const [stats, linksResponse] = await Promise.all([
            shortIOApiCall('get-domain-stats', apiParamsForStats, forceRefresh),
            shortIOApiCall('list-domain-links', paramsForLinks, forceRefresh)
        ]);

        console.log("linksResponse from API:", linksResponse);

        if (stats) {
            // We'll pass the actual total link count to renderDomainStats
        }
        if (linksResponse && linksResponse.links) {
            console.log("Actual links array:", linksResponse.links);
            currentDomainLinks = linksResponse.links;
            currentPageToken = linksResponse.nextPageToken || null;
            
            // If it's the first page load for this domain, use the count from the response.
            // For subsequent pages, this count is for the whole domain, not just the page.
            if (!pageToken) { // Only set total count on first page load
                 totalLinksInDomain = linksResponse.count || 0;
            }
            renderLinksList(currentDomainLinks, linksResponse.nextPageToken);
        } else {
            console.error("linksResponse was not as expected or links array is missing/empty", linksResponse);
            linksListContainer.innerHTML = '<p class="text-gray-600">No links found in this domain or failed to load them.</p>';
            document.getElementById('linksPaginationContainer').innerHTML = '';
            if (!pageToken) totalLinksInDomain = 0; // Reset if initial load fails
        }
        
        // Render domain stats AFTER we have the totalLinksInDomain from linksResponse (if first page)
        // or ensure stats are rendered even if linksResponse is slower.
        if (stats) {
             renderDomainStats(stats, totalLinksInDomain);
        } else if (totalLinksInDomain > 0 && !stats) { // If stats failed but we have link count
             renderDomainStats({}, totalLinksInDomain); // Render with available link count
        }
    }

    function renderDomainStats(stats, actualTotalLinks) {
        const periodDisplay = getPeriodDisplayName(currentPeriod, customStartDate, customEndDate);
        const domainDetailViewTitleEl = document.getElementById('domainDetailView'); // Assuming this is the main container
        const existingSubtitle = domainDetailViewTitleEl.querySelector('.domain-stats-subtitle');
        if (existingSubtitle) {
            existingSubtitle.textContent = `(${periodDisplay}, UTC)`;
        } else {
            const statsTitleH3 = domainDetailViewTitleEl.querySelector('h3'); // First h3 in domainDetailView
             if (statsTitleH3 && statsTitleH3.textContent.includes('Domain Statistics')) {
                // Ensure we're targeting the correct H3
                let currentText = statsTitleH3.innerHTML;
                // Remove old subtitle if present
                currentText = currentText.replace(/\s*<span class="text-base font-normal text-gray-500">.*?<\/span>/, '');
                statsTitleH3.innerHTML = `${currentText.trim()} <span class="text-base font-normal text-gray-500 domain-stats-subtitle">(${periodDisplay}, UTC)</span>`;
            }
        }
        domainStatsContainer.innerHTML = `
            <div class="p-3 bg-indigo-50 rounded-md"><span class="font-bold text-indigo-700">Total Clicks:</span> ${stats.clicks?.toLocaleString() || 0}</div>
            <div class="p-3 bg-purple-50 rounded-md"><span class="font-bold text-purple-700">Human Clicks:</span> ${stats.humanClicks?.toLocaleString() || 0}</div>
            <div class="p-3 bg-pink-50 rounded-md"><span class="font-bold text-pink-700">Total Links in Domain:</span> ${actualTotalLinks.toLocaleString()}</div>`;
        if (stats.clickStatistics?.datasets?.[0]?.data?.length) renderLineChart('domainClicksChart', 'Clicks', stats.clickStatistics.datasets[0].data); else destroyChart('domainClicksChart');
        if (stats.referer?.length) renderBarChart('domainReferrersChart', stats.referer.map(r => r.referer || 'Direct'), stats.referer.map(r => r.score), 'Clicks', 'Referrers'); else destroyChart('domainReferrersChart');
        if (stats.browser?.length) renderBarChart('domainBrowsersChart', stats.browser.map(b => b.browser), stats.browser.map(b => b.score), 'Sessions', 'Browsers'); else destroyChart('domainBrowsersChart');
        if (stats.country?.length) renderBarChart('domainCountriesChart', stats.country.map(c => c.countryName || c.country), stats.country.map(c => c.score), 'Clicks', 'Countries'); else destroyChart('domainCountriesChart');
        if (stats.os?.length) renderBarChart('domainOsChart', stats.os.map(o => o.os), stats.os.map(o => o.score), 'Sessions', 'Operating Systems'); else destroyChart('domainOsChart');
    }

    function renderLinksList(links, nextPageTokenForPagination) {
        linksListContainer.innerHTML = '';
        const paginationContainer = document.getElementById('linksPaginationContainer');
        paginationContainer.innerHTML = '';

        if (!links || links.length === 0) {
            linksListContainer.innerHTML = '<p class="text-gray-600">No links found in this domain.</p>';
            return;
        }

        links.forEach(link => { // link is now a full link object
            const linkItem = document.createElement('div');
            linkItem.className = 'bg-gray-50 p-3 rounded-md shadow-sm hover:shadow-md transition-shadow flex justify-between items-center border border-gray-200';
            
            // Display link path and original URL
            const pathDisplay = link.path ? `/${link.path}` : (link.shortURL ? new URL(link.shortURL).pathname : 'N/A');
            const originalUrlDisplay = link.originalURL || 'N/A';

            linkItem.innerHTML = `
                <div class="flex-grow mr-4 overflow-hidden">
                    <p class="font-semibold text-gray-800 truncate" title="${pathDisplay}">Path: ${pathDisplay}</p>
                    <p class="text-sm text-blue-600 truncate" title="${originalUrlDisplay}">
                        Original: <a href="${link.originalURL}" target="_blank" class="hover:underline">${originalUrlDisplay}</a>
                    </p>
                    <p class="text-xs text-gray-500">ID: ${link.idString || link.id}</p>
                </div>
                <button data-linkid="${link.idString || link.id}" class="text-sm bg-blue-500 hover:bg-blue-600 text-white py-1 px-3 rounded whitespace-nowrap">View Stats</button>
            `;
            linkItem.querySelector('button').addEventListener('click', (e) => {
                loadLinkDetails(e.target.dataset.linkid);
            });
            linksListContainer.appendChild(linkItem);
        });

        // Basic "Next" pagination
        if (nextPageTokenForPagination) {
            const nextButton = document.createElement('button');
            nextButton.textContent = 'Next Page';
            nextButton.className = 'bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline';
            nextButton.addEventListener('click', () => {
                loadDomainDetails(currentDomainId, currentDomainHostname, true, nextPageTokenForPagination); // forceRefresh true to get new page
            });
            paginationContainer.appendChild(nextButton);
        }
         // TODO: Add "Previous" button if desired, would require storing previous tokens.
    }

    async function loadLinkDetails(linkId, forceRefresh = false) {
        currentLinkId = linkId;
        switchToView('linkDetail');
        
        linkDetailIdDisplayEl.textContent = linkId;
        selectedLinkPathDisplayEl.textContent = `ID: ${linkId}`;
        linkDetailShortUrlEl.textContent = 'Loading...';
        linkDetailOriginalUrlEl.textContent = 'Loading...';
        linkDetailOriginalUrlEl.removeAttribute('href');

        const apiParamsForStats = { linkId, period: currentPeriod };
        if (currentPeriod === 'custom' && customStartDate && customEndDate) {
            apiParamsForStats.startDate = customStartDate;
            apiParamsForStats.endDate = customEndDate;
        }

        const [stats, linkInfo] = await Promise.all([
            shortIOApiCall('get-link-stats', apiParamsForStats, forceRefresh),
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
            updateBreadcrumbs();
        } else {
            currentLinkPath = `ID: ${linkId}`;
            selectedLinkPathDisplayEl.textContent = currentLinkPath;
            linkDetailShortUrlEl.textContent = 'Error loading info';
            linkDetailOriginalUrlEl.textContent = 'Error loading info';
            updateBreadcrumbs();
        }
        
        if (stats) renderLinkStats(stats); else {
            ['linkClicksChart', 'linkReferrersChart', 'linkBrowsersChart', 'linkCountriesChart', 'linkOsChart'].forEach(destroyChart);
            linkStatsContainer.innerHTML = '<p class="text-red-500 col-span-full">Failed to load link statistics.</p>';
        }
    }

    function renderLinkStats(stats) {
        const periodDisplay = getPeriodDisplayName(currentPeriod, customStartDate, customEndDate);
        const linkDetailViewTitleEl = document.getElementById('linkDetailView');
        const existingSubtitle = linkDetailViewTitleEl.querySelector('.link-stats-subtitle');
         if (existingSubtitle) {
            existingSubtitle.textContent = `(${periodDisplay}, UTC)`;
        } else {
            const statsTitleH3 = linkDetailViewTitleEl.querySelector('h3'); // First h3
            if (statsTitleH3 && statsTitleH3.textContent.includes('Link Statistics')) {
                let currentText = statsTitleH3.innerHTML;
                currentText = currentText.replace(/\s*<span class="text-base font-normal text-gray-500">.*?<\/span>/, '');
                statsTitleH3.innerHTML = `${currentText.trim()} <span class="text-base font-normal text-gray-500 link-stats-subtitle">(${periodDisplay}, UTC)</span>`;
            }
        }
        linkStatsContainer.innerHTML = `
            <div class="p-3 bg-teal-50 rounded-md"><span class="font-bold text-teal-700">Total Clicks:</span> ${stats.totalClicks?.toLocaleString() || 0}</div>
            <div class="p-3 bg-cyan-50 rounded-md"><span class="font-bold text-cyan-700">Human Clicks:</span> ${stats.humanClicks?.toLocaleString() || 0}</div>`;

        if (stats.clickStatistics?.datasets?.[0]?.data?.length) renderLineChart('linkClicksChart', 'Clicks', stats.clickStatistics.datasets[0].data); else destroyChart('linkClicksChart');
        if (stats.referer?.length) renderBarChart('linkReferrersChart', stats.referer.map(r => r.referer || 'Direct'), stats.referer.map(r => r.score), 'Clicks', 'Referrers'); else destroyChart('linkReferrersChart');
        if (stats.browser?.length) renderBarChart('linkBrowsersChart', stats.browser.map(b => b.browser), stats.browser.map(b => b.score), 'Sessions', 'Browsers'); else destroyChart('linkBrowsersChart');
        if (stats.country?.length) renderBarChart('linkCountriesChart', stats.country.map(c => c.countryName || c.country), stats.country.map(c => c.score), 'Clicks', 'Countries'); else destroyChart('linkCountriesChart');
        if (stats.os?.length) renderBarChart('linkOsChart', stats.os.map(o => o.os), stats.os.map(o => o.score), 'Sessions', 'Operating Systems'); else destroyChart('linkOsChart');
    }

    function renderPeriodSelector() {
        if (periodSelect) {
            periodSelect.value = currentPeriod;
            if (currentPeriod === 'custom') {
                customDateRangeContainer.classList.remove('hidden');
                customDateRangeContainer.classList.add('flex'); // Use flex for alignment
                startDateInput.value = customStartDate || ''; // Restore saved/previous values
                endDateInput.value = customEndDate || '';
            } else {
                customDateRangeContainer.classList.add('hidden');
                customDateRangeContainer.classList.remove('flex');
            }
        }
    }

    function applyDateFiltersAndRefresh() {
        // This function will be called by periodSelect change (if not custom)
        // or by applyCustomDateRangeButton
        console.log("Applying filters. Period:", currentPeriod, "Start:", customStartDate, "End:", customEndDate);

        // Persist choices
        localStorage.setItem('shortio_selectedPeriod', currentPeriod);
        if (currentPeriod === 'custom') {
            localStorage.setItem('shortio_customStartDate', customStartDate);
            localStorage.setItem('shortio_customEndDate', customEndDate);
        } else {
            localStorage.removeItem('shortio_customStartDate');
            localStorage.removeItem('shortio_customEndDate');
        }

        // Re-fetch data for the current view
        if (currentView === 'domainDetail' && currentDomainId) {
            ['domainClicksChart', 'domainReferrersChart', 'domainBrowsersChart', 'domainCountriesChart', 'domainOsChart'].forEach(destroyChart);
            domainStatsContainer.innerHTML = '<p>Loading new period data...</p>';
            loadDomainDetails(currentDomainId, currentDomainHostname, true, null);
        } else if (currentView === 'linkDetail' && currentLinkId) {
            ['linkClicksChart', 'linkReferrersChart', 'linkBrowsersChart', 'linkCountriesChart', 'linkOsChart'].forEach(destroyChart);
            linkStatsContainer.innerHTML = '<p>Loading new period data...</p>';
            loadLinkDetails(currentLinkId, true);
        }
    }

    // --- Helper function to clear all app-specific localStorage data ---
    function clearAllAppData() {
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('shortio_')) {
                localStorage.removeItem(key);
            }
        });
        // Also reset in-memory state
        currentApiKey = null;
        currentDomainId = null;
        currentDomainHostname = null;
        currentLinkId = null;
        currentLinkPath = null;
        currentDomainLinks = [];
        currentPageToken = null;
        prevPageToken = null;
        activeLoadCounter = 0; // Reset load counter if you've implemented it

        apiKeyInput.value = '';
        updateLastRetrievedTimestamp('');
        showError(null); // Clear any errors
        updateLoadingIndicator('end'); // Ensure loader is hidden if it was stuck
        console.log("All app data and local storage cleared.");
    }

    saveApiKeyButton.addEventListener('click', saveApiKey);
    apiKeyInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') saveApiKey(); });
    homeButton.addEventListener('click', () => switchToView('apiKey', true));
    refreshDataButton.addEventListener('click', () => {
        showError(null);
        if (currentView === 'domains') loadDomains(true);
        else if (currentView === 'domainDetail' && currentDomainId) {
             // For domain detail, refresh fetches the first page of links again
            loadDomainDetails(currentDomainId, currentDomainHostname, true, null);
        }
        else if (currentView === 'linkDetail' && currentLinkId) loadLinkDetails(currentLinkId, true);
        else if (currentApiKey) loadDomains(true);
        else switchToView('apiKey');
    });

    resetDataButton.addEventListener('click', () => { // New listener
        if (confirm("Are you sure you want to reset all stored data (API key, cached stats)? This will require you to re-enter your API key.")) {
            clearAllAppData();
            switchToView('apiKey', true); // true to ensure API key view and further cleanup
        }
    });

    if (periodSelect) {
        periodSelect.addEventListener('change', (event) => {
            currentPeriod = event.target.value;
            renderPeriodSelector(); // Show/hide custom date inputs

            if (currentPeriod !== 'custom') {
                // If a predefined period is selected, clear custom dates and apply immediately
                customStartDate = '';
                customEndDate = '';
                applyDateFiltersAndRefresh();
            }
        });
    }

    if (applyCustomDateRangeButton) {
        applyCustomDateRangeButton.addEventListener('click', () => {
            const start = startDateInput.value;
            const end = endDateInput.value;

            if (!start || !end) {
                showError("Please select both a start and an end date for the custom range.");
                // Alternatively, alert("Please select both a start and an end date.");
                return;
            }
            if (new Date(start) > new Date(end)) {
                showError("Start date cannot be after end date.");
                // Alternatively, alert("Start date cannot be after end date.");
                return;
            }
            customStartDate = start;
            customEndDate = end;
            // currentPeriod should already be 'custom' if this button is visible and clicked
            applyDateFiltersAndRefresh();
        });
    }

    function init() {
        if (CLOUDFLARE_WORKER_URL.startsWith('YOUR_')) {
             switchToView('apiKey');
             showError('CRITICAL: Cloudflare Worker URL is not configured in app.js.');
             return;
        }

        const urlParams = new URLSearchParams(window.location.search);
        const apiKeyFromParam = urlParams.get('apikey');

        if (apiKeyFromParam) {
            console.log("API Key found in URL parameter.");
            apiKeyInput.value = apiKeyFromParam; // Populate the input for consistency
            saveApiKey(); // This will save to localStorage and load domains
            // Remove the apikey from URL to prevent it from being bookmarked or shared accidentally
            window.history.replaceState({}, document.title, window.location.pathname); 
        } else if (loadApiKey()) { // loadApiKey just reads from localStorage
            loadDomains(); // Attempt to load domains if API key exists from storage
        } else {
            // If no API key from param or storage, ensure we are on the API key view and state is clean
            clearAllAppData(); // Make sure everything is reset if no key found
            switchToView('apiKey');
        }

        const savedPeriod = localStorage.getItem('shortio_selectedPeriod');
        const validPeriods = Array.from(periodSelect.options).map(opt => opt.value);
        if (savedPeriod && validPeriods.includes(savedPeriod)) {
            currentPeriod = savedPeriod;
            if (currentPeriod === 'custom') {
                customStartDate = localStorage.getItem('shortio_customStartDate') || '';
                customEndDate = localStorage.getItem('shortio_customEndDate') || '';
                // Pre-fill date inputs if custom was saved (renderPeriodSelector will do this)
            }
        } // else currentPeriod remains 'total' (default)

        renderPeriodSelector(); // Set the visual state of the dropdown
        updateBreadcrumbs(); // Initial breadcrumb
    }
    init();
});