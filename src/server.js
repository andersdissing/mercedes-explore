const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

const PORT = process.env.PORT || 3000;

// Per-session cookie jars
const cookieJars = new Map();

function getCookieJar(sessionId) {
  if (!cookieJars.has(sessionId)) {
    const jar = new CookieJar();
    cookieJars.set(sessionId, { jar, lastUsed: Date.now() });
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

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.proto': 'text/plain',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'x-final-url, x-redirect-location, location',
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...CORS_HEADERS, 'Access-Control-Max-Age': '86400' });
    res.end();
    return;
  }

  if (req.url.startsWith('/api/proxy')) {
    await handleProxy(req, res);
    return;
  }

  serveStatic(req, res);
});

async function handleProxy(req, res) {
  const setCors = () => {
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
      res.setHeader(k, v);
    }
  };

  try {
    const urlObj = new URL(req.url, `http://localhost:${PORT}`);
    const targetUrl = urlObj.searchParams.get('url');

    if (!targetUrl) {
      setCors();
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing url parameter' }));
      return;
    }

    // Only allow Mercedes domains
    const targetHost = new URL(targetUrl).hostname;
    if (!targetHost.endsWith('mercedes-benz.com') && !targetHost.endsWith('mercedes-benz.com.cn')) {
      setCors();
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Only mercedes-benz.com domains are allowed' }));
      return;
    }

    const body = await readBody(req);
    const sessionId = urlObj.searchParams.get('session') || req.headers['x-proxy-session'] || 'default';
    const jar = getCookieJar(sessionId);
    const noRedirect = urlObj.searchParams.get('noRedirect') === 'true' || req.headers['x-proxy-no-redirect'] === 'true';

    // Build forwarded headers - skip proxy-specific and browser-specific headers
    const forwardHeaders = {};
    const skipHeaders = new Set([
      'host', 'connection', 'content-length', 'x-proxy-session',
      'x-proxy-no-redirect', 'origin', 'referer', 'accept-encoding'
    ]);
    for (const [key, value] of Object.entries(req.headers)) {
      if (!skipHeaders.has(key.toLowerCase()) && !key.startsWith('sec-')) {
        forwardHeaders[key] = value;
      }
    }

    // Set CIAM.DEVICE cookie if not already set
    const loginDomain = targetUrl.includes('mercedes-benz.com.cn')
      ? 'https://ciam-1.mercedes-benz.com.cn'
      : 'https://id.mercedes-benz.com';
    try {
      const cookies = await jar.getCookies(loginDomain);
      const hasCiamDevice = cookies.some(c => c.key === 'CIAM.DEVICE');
      if (!hasCiamDevice) {
        await jar.setCookie(`CIAM.DEVICE=${sessionId}; Domain=.mercedes-benz.com; Path=/`, loginDomain);
      }
    } catch (e) { /* ignore cookie errors */ }

    const client = wrapper(axios.create({
      jar,
      withCredentials: true,
      timeout: 30000,
      decompress: true,
    }));

    // Use a custom beforeRedirect to intercept rismycar:// redirects
    // before axios tries to follow them
    let interceptedRedirectUrl = null;

    const config = {
      method: req.method || 'GET',
      url: targetUrl,
      headers: forwardHeaders,
      responseType: 'arraybuffer',
      maxRedirects: noRedirect ? 0 : 10,
      validateStatus: () => true,
      beforeRedirect: (options, { headers: responseHeaders }) => {
        // Check if the redirect target is a non-HTTP scheme (e.g. rismycar://)
        const redirectTo = options.href || '';
        if (redirectTo.startsWith('rismycar://') || (!redirectTo.startsWith('http://') && !redirectTo.startsWith('https://'))) {
          interceptedRedirectUrl = redirectTo;
          // Throw to abort the redirect - axios will catch this
          throw new Error(`INTERCEPTED_REDIRECT:${redirectTo}`);
        }
      },
    };

    if (body && body.length > 0) {
      config.data = body;
    }

    let response;
    try {
      response = await client.request(config);
    } catch (axiosError) {
      // Check if we intercepted a rismycar:// redirect
      if (interceptedRedirectUrl) {
        setCors();
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'x-redirect-location': interceptedRedirectUrl,
        });
        res.end(JSON.stringify({ redirect: interceptedRedirectUrl }));
        return;
      }

      // Check error message for intercepted redirect marker
      const errMsg = axiosError.message || '';
      const interceptMatch = errMsg.match(/INTERCEPTED_REDIRECT:(.+)$/);
      if (interceptMatch) {
        setCors();
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'x-redirect-location': interceptMatch[1],
        });
        res.end(JSON.stringify({ redirect: interceptMatch[1] }));
        return;
      }

      // Check for rismycar:// in config url (axios may have resolved the redirect URL)
      const configUrl = axiosError.config?.url || '';
      if (configUrl.startsWith('rismycar://')) {
        setCors();
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'x-redirect-location': configUrl,
        });
        res.end(JSON.stringify({ redirect: configUrl }));
        return;
      }

      // Check the response if available (e.g. maxRedirects: 0 case)
      if (axiosError.response) {
        const location = axiosError.response.headers['location'];
        if (location && location.startsWith('rismycar://')) {
          setCors();
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'x-redirect-location': location,
          });
          res.end(JSON.stringify({ redirect: location }));
          return;
        }
        response = axiosError.response;
      } else {
        throw axiosError;
      }
    }

    setCors();

    // Build response headers
    const responseHeaders = { 'Content-Type': response.headers['content-type'] || 'application/octet-stream' };

    // Forward Location header for redirects
    if (response.headers['location']) {
      responseHeaders['location'] = response.headers['location'];
      responseHeaders['x-redirect-location'] = response.headers['location'];
    }

    // Forward the final URL after redirects
    const finalUrl = response.request?.res?.responseUrl || response.config?.url;
    if (finalUrl) {
      responseHeaders['x-final-url'] = finalUrl;
      console.log(`[PROXY] Final URL: ${finalUrl}`);
    }

    res.writeHead(response.status, responseHeaders);
    res.end(Buffer.from(response.data));

  } catch (error) {
    setCors();
    console.error('[PROXY ERROR]', error.message);

    // Last resort: check for rismycar:// anywhere in error chain
    const fullMsg = [error.message, error.cause?.message, JSON.stringify(error.config?.url)].join(' ');
    const rismycarMatch = fullMsg.match(/rismycar:\/\/[^\s'"]+/);
    if (rismycarMatch) {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'x-redirect-location': rismycarMatch[0],
      });
      res.end(JSON.stringify({ redirect: rismycarMatch[0] }));
      return;
    }

    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function serveStatic(req, res) {
  let filePath = req.url.split('?')[0];
  if (filePath === '/') filePath = '/index.html';

  const fullPath = path.join(__dirname, filePath);

  const srcDir = __dirname;
  if (!fullPath.startsWith(srcDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(fullPath);
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

server.listen(PORT, () => {
  console.log(`Mercedes-Benz Data Explorer running at http://localhost:${PORT}`);
  console.log(`Proxy endpoint: http://localhost:${PORT}/api/proxy?url=<target>`);
});
