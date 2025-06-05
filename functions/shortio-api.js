// functions/shortio-api.js

const BASE_API_URL = 'https://api.short.io';
const BASE_STATS_URL = 'https://statistics.short.io';

const corsHeadersBase = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Shortio-Api-Key',
  'Access-Control-Max-Age': '86400',
};

function getCorsHeaders(request, currentFunctionUrl) {
  const requestOrigin = request.headers.get('Origin'); // e.g., https://track.domain.com or https://preview-branch.project.pages.dev
  const functionOrigin = new URL(currentFunctionUrl).origin; // e.g., https://track.domain.com or https://project.pages.dev (for functions)

  // For local development (e.g., from http://localhost:xxxx), you might want to allow explicitly.
  // For Cloudflare Pages, preview URLs often have a unique subdomain.
  // The primary check is if the requestOrigin matches the function's host domain.
  // Or, if the requestOrigin is a *.pages.dev URL and the function is also on *.pages.dev (covers preview deploys)
  
  let allowedOrigin = null;

  if (requestOrigin) {
    const requestOriginHostname = new URL(requestOrigin).hostname;
    const functionHostname = new URL(currentFunctionUrl).hostname;

    // 1. Direct match (e.g., custom domain track.domain.com requests track.domain.com/shortio-api)
    if (requestOrigin === functionOrigin) {
      allowedOrigin = requestOrigin;
    } 
    // 2. Allow requests from the same root pages.dev domain for preview URLs
    // e.g. preview-xyz.myproject.pages.dev can call myproject.pages.dev/api
    //    or function.myproject.pages.dev can call myproject.pages.dev/api
    //    This logic assumes functions are at the root .pages.dev domain, which is typical.
    //    If your functions have a different structure, this might need adjustment.
    else if (requestOriginHostname.endsWith('.pages.dev') && functionHostname.endsWith('.pages.dev')) {
        // Check if the base project name matches (e.g., "myproject" in "myproject.pages.dev")
        const requestProjectName = requestOriginHostname.split('.pages.dev')[0].split('.').pop(); // Gets 'myproject' from 'branch.myproject.pages.dev'
        const functionProjectName = functionHostname.split('.pages.dev')[0].split('.').pop(); // Gets 'myproject' from 'myproject.pages.dev'

        if (requestProjectName === functionProjectName) {
            allowedOrigin = requestOrigin;
        }
    }
    // 3. For local development convenience - BE CAREFUL WITH THIS IN PRODUCTION
    //    Only enable if you are sure about your local testing environment.
    //    You might pass an ENV var to enable this only in a dev environment.
    // else if (requestOriginHostname === 'localhost' || requestOriginHostname === '127.0.0.1') {
    //   allowedOrigin = requestOrigin; // e.g. http://localhost:8000
    // }
  }


  if (allowedOrigin) {
    return { ...corsHeadersBase, 'Access-Control-Allow-Origin': allowedOrigin };
  } else {
    // If no origin or origin not allowed, don't send Access-Control-Allow-Origin
    // The browser will then block the request if it's a cross-origin request.
    // For same-origin requests, this header is not strictly necessary.
    return { ...corsHeadersBase }; 
  }
}


function handleOptions(request, currentFunctionUrl) {
  const currentCorsHeaders = getCorsHeaders(request, currentFunctionUrl);

  if (
    request.headers.get('Origin') !== null &&
    request.headers.get('Access-Control-Request-Method') !== null &&
    request.headers.get('Access-Control-Request-Headers') !== null
  ) {
    return new Response(null, { headers: currentCorsHeaders });
  } else {
    return new Response(null, {
      headers: { Allow: 'GET, POST, OPTIONS' },
    });
  }
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const currentFunctionUrl = request.url;

  if (request.method === 'OPTIONS') {
    return handleOptions(request, currentFunctionUrl);
  }

  const currentCorsHeaders = getCorsHeaders(request, currentFunctionUrl);

  const userApiKey = request.headers.get('X-Shortio-Api-Key');
  if (!userApiKey) {
    return new Response(JSON.stringify({ error: "X-Shortio-Api-Key header is missing." }), {
      status: 400,
      headers: { ...currentCorsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const domainId = url.searchParams.get('domainId');
  const linkId = url.searchParams.get('linkId');
  const period = url.searchParams.get('period') || 'last30';
  const tz = url.searchParams.get('tz') || 'UTC';
  // For list-domain-links, we might want pagination params in the future
  const limit = url.searchParams.get('limit') || '50'; // Default to 50 links, adjust as needed
  const pageToken = url.searchParams.get('pageToken');


  let apiUrl = '';
  let apiOptions = {
    method: 'GET',
    headers: {
      'accept': 'application/json',
      'Authorization': userApiKey
    }
  };

  try {
    switch (action) {
      case 'list-domains':
        apiUrl = `${BASE_API_URL}/api/domains?limit=100&offset=0`;
        break;
      case 'get-domain-stats':
        if (!domainId) return new Response(JSON.stringify({ error: "domainId parameter is required." }), { status: 400, headers: { ...currentCorsHeaders, 'Content-Type': 'application/json' } });
        apiUrl = `${BASE_STATS_URL}/statistics/domain/${domainId}?period=${period}&tz=${tz}`;
        apiOptions.headers.accept = '*/*';
        break;
      // 'get-domain-link-clicks' can be kept if we want to show quick click counts later,
      // but not the primary source for the link list anymore.
      // case 'get-domain-link-clicks': 
      //   if (!domainId) return new Response(JSON.stringify({ error: "domainId parameter is required." }), { status: 400, headers: { ...currentCorsHeaders, 'Content-Type': 'application/json' } });
      //   apiUrl = `${BASE_STATS_URL}/statistics/domain/${domainId}/link_clicks`;
      //   apiOptions.headers.accept = '*/*';
      //   break;
      case 'list-domain-links': // NEW ACTION
        if (!domainId) return new Response(JSON.stringify({ error: "domain_id parameter is required for list-domain-links." }), { status: 400, headers: { ...currentCorsHeaders, 'Content-Type': 'application/json' } });
        apiUrl = `${BASE_API_URL}/api/links?domain_id=${domainId}&limit=${limit}`;
        if (pageToken) {
          apiUrl += `&pageToken=${pageToken}`;
        }
        // Default 'accept: application/json' is fine
        break;
      case 'get-link-stats':
        if (!linkId) return new Response(JSON.stringify({ error: "linkId parameter is required." }), { status: 400, headers: { ...currentCorsHeaders, 'Content-Type': 'application/json' } });
        apiUrl = `${BASE_STATS_URL}/statistics/link/${linkId}?period=${period}&tz=${tz}`;
        apiOptions.headers.accept = '*/*';
        break;
      case 'get-link-info':
        if (!linkId) return new Response(JSON.stringify({ error: "linkId parameter is required." }), { status: 400, headers: { ...currentCorsHeaders, 'Content-Type': 'application/json' } });
        apiUrl = `${BASE_API_URL}/links/${linkId}`;
        break;
      default:
        return new Response(JSON.stringify({ error: "Invalid action parameter." }), {
          status: 400,
          headers: { ...currentCorsHeaders, 'Content-Type': 'application/json' }
        });
    }

    const response = await fetch(apiUrl, apiOptions);
    const responseBody = await response.text();

    if (!response.ok) {
      console.error(`Short.io API Error (Action: ${action}, URL: ${apiUrl}, Status: ${response.status}): ${responseBody}`);
      let errorDetails = responseBody;
      try { errorDetails = JSON.parse(responseBody); } catch (e) { /* ignore */ }
      return new Response(JSON.stringify({ error: `Short.io API request failed for ${action}`, status: response.status, details: errorDetails }), {
        status: response.status,
        headers: { ...currentCorsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    const data = JSON.parse(responseBody);
    return new Response(JSON.stringify(data), {
      headers: { ...currentCorsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error(`Cloudflare Function Error (Action: ${action}):`, error);
    return new Response(JSON.stringify({ error: `Function error processing ${action}: ${error.message || error.toString()}` }), {
      status: 500,
      headers: { ...currentCorsHeaders, 'Content-Type': 'application/json' }
    });
  }
}