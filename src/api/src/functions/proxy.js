const { app } = require('@azure/functions');
const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

// In-memory cookie jars — works on Consumption plan because the OAuth flow
// completes in seconds and the same instance stays warm.
const cookieJars = new Map();

function getCookieJar(sessionId) {
  if (!cookieJars.has(sessionId)) {
    cookieJars.set(sessionId, { jar: new CookieJar(), lastUsed: Date.now() });
  }
  const entry = cookieJars.get(sessionId);
  entry.lastUsed = Date.now();
  return entry.jar;
}

// Clean up old sessions every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [id, entry] of cookieJars) {
    if (entry.lastUsed < cutoff) cookieJars.delete(id);
  }
}, 10 * 60 * 1000);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'x-final-url, x-redirect-location, location',
};

app.http('proxy', {
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'proxy',
  handler: async (request, context) => {
    if (request.method === 'OPTIONS') {
      return { status: 204, headers: { ...CORS_HEADERS, 'Access-Control-Max-Age': '86400' } };
    }

    try {
      const url = new URL(request.url);
      const targetUrl = url.searchParams.get('url');

      if (!targetUrl) {
        return { status: 400, headers: CORS_HEADERS, jsonBody: { error: 'Missing url parameter' } };
      }

      // Only allow Mercedes domains
      const targetHost = new URL(targetUrl).hostname;
      if (!targetHost.endsWith('mercedes-benz.com') && !targetHost.endsWith('mercedes-benz.com.cn')) {
        return { status: 403, headers: CORS_HEADERS, jsonBody: { error: 'Only mercedes-benz.com domains are allowed' } };
      }

      const sessionId = url.searchParams.get('session') || 'default';
      const jar = getCookieJar(sessionId);
      // Build forwarded headers - skip proxy-specific, browser, and Azure headers
      const forwardHeaders = {};
      const skipHeaders = new Set([
        'host', 'connection', 'content-length',
        'origin', 'referer', 'accept-encoding'
      ]);
      for (const [key, value] of request.headers) {
        const lower = key.toLowerCase();
        if (!skipHeaders.has(lower) && !lower.startsWith('sec-') && !lower.startsWith('x-forwarded') && !lower.startsWith('x-azure')) {
          forwardHeaders[key] = value;
        }
      }

      // Set CIAM.DEVICE cookie if not already set
      const loginDomain = targetUrl.includes('mercedes-benz.com.cn')
        ? 'https://ciam-1.mercedes-benz.com.cn'
        : 'https://id.mercedes-benz.com';
      try {
        const cookies = await jar.getCookies(loginDomain);
        if (!cookies.some(c => c.key === 'CIAM.DEVICE')) {
          await jar.setCookie(`CIAM.DEVICE=${sessionId}; Domain=.mercedes-benz.com; Path=/`, loginDomain);
        }
      } catch (e) { /* ignore cookie errors */ }

      const client = wrapper(axios.create({
        jar,
        withCredentials: true,
        timeout: 30000,
        decompress: true,
      }));

      let interceptedRedirectUrl = null;

      const config = {
        method: request.method,
        url: targetUrl,
        headers: forwardHeaders,
        responseType: 'arraybuffer',
        maxRedirects: 10,
        validateStatus: () => true,
        beforeRedirect: (options) => {
          const redirectTo = options.href || '';
          if (redirectTo.startsWith('rismycar://') || (!redirectTo.startsWith('http://') && !redirectTo.startsWith('https://'))) {
            interceptedRedirectUrl = redirectTo;
            throw new Error(`INTERCEPTED_REDIRECT:${redirectTo}`);
          }
        },
      };

      const body = await request.arrayBuffer();
      if (body && body.byteLength > 0) {
        config.data = Buffer.from(body);
      }

      let response;
      try {
        response = await client.request(config);
      } catch (axiosError) {
        // Check for intercepted rismycar:// redirect
        if (interceptedRedirectUrl) {
          return {
            status: 200,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'x-redirect-location': interceptedRedirectUrl },
            jsonBody: { redirect: interceptedRedirectUrl },
          };
        }

        const errMsg = axiosError.message || '';
        const interceptMatch = errMsg.match(/INTERCEPTED_REDIRECT:(.+)$/);
        if (interceptMatch) {
          return {
            status: 200,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'x-redirect-location': interceptMatch[1] },
            jsonBody: { redirect: interceptMatch[1] },
          };
        }

        const configUrl = axiosError.config?.url || '';
        if (configUrl.startsWith('rismycar://')) {
          return {
            status: 200,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'x-redirect-location': configUrl },
            jsonBody: { redirect: configUrl },
          };
        }

        if (axiosError.response) {
          const location = axiosError.response.headers['location'];
          if (location && location.startsWith('rismycar://')) {
            return {
              status: 200,
              headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'x-redirect-location': location },
              jsonBody: { redirect: location },
            };
          }
          response = axiosError.response;
        } else {
          throw axiosError;
        }
      }

      // Build response
      const responseHeaders = {
        ...CORS_HEADERS,
        'Content-Type': response.headers['content-type'] || 'application/octet-stream',
      };

      if (response.headers['location']) {
        responseHeaders['location'] = response.headers['location'];
        responseHeaders['x-redirect-location'] = response.headers['location'];
      }

      const finalUrl = response.request?.res?.responseUrl || response.config?.url;
      if (finalUrl) {
        responseHeaders['x-final-url'] = finalUrl;
      }

      return {
        status: response.status,
        headers: responseHeaders,
        body: Buffer.from(response.data),
      };

    } catch (error) {
      context.log('Proxy error:', error.message);

      // Last resort: check for rismycar:// anywhere in error chain
      const fullMsg = [error.message, error.cause?.message, JSON.stringify(error.config?.url)].join(' ');
      const rismycarMatch = fullMsg.match(/rismycar:\/\/[^\s'"]+/);
      if (rismycarMatch) {
        return {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'x-redirect-location': rismycarMatch[0] },
          jsonBody: { redirect: rismycarMatch[0] },
        };
      }

      return { status: 502, headers: CORS_HEADERS, jsonBody: { error: error.message } };
    }
  }
});
