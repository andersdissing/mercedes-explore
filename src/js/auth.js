/**
 * Mercedes-Benz OAuth2 Authentication Client (Browser version)
 * All requests go through /api/proxy to avoid CORS issues
 */

const PROXY_BASE = (typeof PROXY_CONFIG !== 'undefined' && PROXY_CONFIG.proxyUrl) || '/api/proxy';

/**
 * Make a proxied fetch request to a Mercedes endpoint
 */
async function proxyFetch(url, options = {}) {
  const sessionId = sessionStorage.getItem('mercedes_device_guid') || 'default';
  let proxyUrl = `${PROXY_BASE}?url=${encodeURIComponent(url)}&session=${encodeURIComponent(sessionId)}`;

  const headers = { ...(options.headers || {}) };

  const fetchOptions = {
    method: options.method || 'GET',
    headers,
  };

  if (options.body) {
    fetchOptions.body = options.body;
  }

  const response = await fetch(proxyUrl, fetchOptions);
  return response;
}


class MercedesAuth {
  static CLIENT_ID = '62778dc4-1de3-44f4-af95-115f06a3a008';
  static REDIRECT_URI = 'rismycar://login-callback';
  static SCOPE = 'email profile ciam-uid phone openid offline_access';

  static ENDPOINTS = {
    'Europe': {
      login: 'https://id.mercedes-benz.com',
      rest: 'https://bff.emea-prod.mobilesdk.mercedes-benz.com',
    },
    'North America': {
      login: 'https://id.mercedes-benz.com',
      rest: 'https://bff.amap-prod.mobilesdk.mercedes-benz.com',
    },
    'Asia-Pacific': {
      login: 'https://id.mercedes-benz.com',
      rest: 'https://bff.amap-prod.mobilesdk.mercedes-benz.com',
    },
    'China': {
      login: 'https://ciam-1.mercedes-benz.com.cn',
      rest: 'https://bff.cn-prod.mobilesdk.mercedes-benz.com',
    }
  };

  constructor(region = 'Europe') {
    this.region = region;
    this.endpoints = MercedesAuth.ENDPOINTS[region];
    if (!this.endpoints) throw new Error(`Invalid region: ${region}`);

    this.token = null;
    this.codeVerifier = null;
    this.codeChallenge = null;
    this.deviceGuid = this._getOrCreateDeviceGuid();
  }

  _getOrCreateDeviceGuid() {
    let guid = sessionStorage.getItem('mercedes_device_guid');
    if (!guid) {
      guid = crypto.randomUUID();
      sessionStorage.setItem('mercedes_device_guid', guid);
    }
    return guid;
  }

  async _generatePKCE() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    this.codeVerifier = this._base64UrlEncode(bytes);

    const encoder = new TextEncoder();
    const data = encoder.encode(this.codeVerifier);
    const hash = await crypto.subtle.digest('SHA-256', data);
    this.codeChallenge = this._base64UrlEncode(new Uint8Array(hash));
  }

  _base64UrlEncode(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  _generateRid() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return this._base64UrlEncode(bytes);
  }

  _getMobileSafariHeaders(accept = 'application/json, text/plain, */*', includeReferer = true) {
    const headers = {
      'accept': accept,
      'content-type': 'application/json',
      'origin': this.endpoints.login,
      'accept-language': 'de-DE,de;q=0.9',
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6.6 Mobile/15E148 Safari/604.1'
    };
    if (includeReferer) {
      headers['referer'] = `${this.endpoints.login}/ciam/auth/login`;
    }
    return headers;
  }

  /**
   * Step 1: Get authorization URL and extract resume parameter
   */
  async _getAuthorizationResume() {
    await this._generatePKCE();

    const params = new URLSearchParams({
      client_id: MercedesAuth.CLIENT_ID,
      code_challenge: this.codeChallenge,
      code_challenge_method: 'S256',
      redirect_uri: MercedesAuth.REDIRECT_URI,
      response_type: 'code',
      scope: MercedesAuth.SCOPE
    });

    const authUrl = `${this.endpoints.login}/as/authorization.oauth2?${params.toString()}`;

    const response = await proxyFetch(authUrl, {
      method: 'GET',
      headers: {
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6.6 Mobile/15E148 Safari/604.1',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'de-DE,de;q=0.9'
      }
    });

    const finalUrl = response.headers.get('x-final-url');
    const redirectLocation = response.headers.get('x-redirect-location');
    const bodyText = await response.text();

    progressLog(`Auth response status: ${response.status}`);

    // Check if we got a direct redirect to rismycar:// with a code
    // This happens when there's an existing session in the cookie jar
    const allSources = [finalUrl, redirectLocation, bodyText].filter(Boolean).join(' ');
    const codeMatch = allSources.match(/rismycar:\/\/login-callback\?code=([^&"'\s}]+)/);
    if (codeMatch) {
      progressLog('Existing session detected - got authorization code directly');
      // Return special object to signal we already have a code
      return { directCode: codeMatch[1] };
    }

    // Try to extract resume from the final URL header
    if (finalUrl) {
      try {
        const url = new URL(finalUrl);
        const resume = url.searchParams.get('resume');
        if (resume) return resume;
      } catch (e) { /* fall through */ }

      const finalMatch = finalUrl.match(/[?&]resume=([^&"'\s]+)/);
      if (finalMatch) return decodeURIComponent(finalMatch[1]);
    }

    // Try to extract resume from the response body
    const resumeMatch = bodyText.match(/[?&]resume=([^&"'\s<>]+)/);
    if (resumeMatch) {
      return decodeURIComponent(resumeMatch[1]);
    }

    // Also look for resume in action URLs in forms
    const actionMatch = bodyText.match(/action="([^"]*resume[^"]*)"/i);
    if (actionMatch) {
      const resumeFromAction = actionMatch[1].match(/[?&]resume=([^&"'\s]+)/);
      if (resumeFromAction) return decodeURIComponent(resumeFromAction[1]);
    }

    progressLog(`Response body (first 500 chars): ${bodyText.substring(0, 500)}`);
    throw new Error('Resume parameter not found in authorization response');
  }

  /**
   * Step 2: Send user agent information
   */
  async _sendUserAgentInfo() {
    const headers = this._getMobileSafariHeaders('*/*', false);
    const url = `${this.endpoints.login}/ciam/auth/ua`;

    try {
      await proxyFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          browserName: 'Mobile Safari',
          browserVersion: '15.6.6',
          osName: 'iOS'
        })
      });
    } catch (e) {
      // Non-critical
    }
  }

  /**
   * Step 3: Submit username
   */
  async _submitUsername(email) {
    const headers = this._getMobileSafariHeaders();
    const url = `${this.endpoints.login}/ciam/auth/login/user`;

    const response = await proxyFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ username: email })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Username submission failed: ${response.status} - ${text}`);
    }

    return await response.json();
  }

  /**
   * Step 4: Submit password and get pre-login token
   */
  async _submitPassword(email, password) {
    const rid = this._generateRid();
    const headers = this._getMobileSafariHeaders();
    const url = `${this.endpoints.login}/ciam/auth/login/pass`;

    const response = await proxyFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        username: email,
        password: password,
        rememberMe: false,
        rid: rid
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Password submission failed: ${response.status} - ${text}`);
    }

    return await response.json();
  }

  /**
   * Step 4b: Submit legal consent (if required)
   */
  async _submitLegalConsent(homeCountry, consentCountry) {
    const headers = this._getMobileSafariHeaders();
    const url = `${this.endpoints.login}/ciam/auth/toas/saveLoginConsent`;

    const response = await proxyFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        texts: {},
        homeCountry: homeCountry,
        consentCountry: consentCountry
      })
    });

    if (!response.ok) {
      throw new Error(`Legal consent submission failed: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Step 5: Resume authorization and get code
   */
  async _resumeAuthorization(resumeUrl, token) {
    const headers = this._getMobileSafariHeaders('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
    headers['content-type'] = 'application/x-www-form-urlencoded';

    const body = new URLSearchParams({ token: token }).toString();
    const url = `${this.endpoints.login}${resumeUrl}`;

    const response = await proxyFetch(url, {
      method: 'POST',
      headers,
      body,
    });

    // Check x-redirect-location header (set by proxy for redirect responses)
    const redirectLocation = response.headers.get('x-redirect-location');
    if (redirectLocation && redirectLocation.startsWith('rismycar://')) {
      return this._extractCodeFromUrl(redirectLocation);
    }

    // Check Location header directly
    const location = response.headers.get('location');
    if (location && location.startsWith('rismycar://')) {
      return this._extractCodeFromUrl(location);
    }

    // Check response body for redirect info (proxy may return JSON with redirect)
    try {
      const data = await response.json();
      if (data.redirect && data.redirect.startsWith('rismycar://')) {
        return this._extractCodeFromUrl(data.redirect);
      }
    } catch (e) { /* not JSON */ }

    throw new Error('Failed to get authorization code from redirect');
  }

  _extractCodeFromUrl(redirectUrl) {
    const url = new URL(redirectUrl);
    const code = url.searchParams.get('code');
    if (!code) throw new Error('Authorization code not found in redirect URL');
    return code;
  }

  /**
   * Step 6: Exchange authorization code for tokens
   */
  async _exchangeCodeForTokens(code) {
    if (!this.codeVerifier) throw new Error('Code verifier not available');

    const url = `${this.endpoints.login}/as/token.oauth2`;

    const response = await proxyFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: MercedesAuth.CLIENT_ID,
        code: code,
        code_verifier: this.codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: MercedesAuth.REDIRECT_URI
      }).toString()
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token exchange failed: ${response.status} - ${text}`);
    }

    const tokenInfo = await response.json();
    tokenInfo.expires_at = Math.floor(Date.now() / 1000) + tokenInfo.expires_in;
    return tokenInfo;
  }

  /**
   * Main login method - performs complete OAuth2 PKCE flow
   */
  async login(email, password) {
    let authCode;

    // Step 1
    progressLog('Starting authorization...');
    const resumeResult = await this._getAuthorizationResume();

    // Check if we got a direct code (existing session)
    if (resumeResult && resumeResult.directCode) {
      progressLog('Using existing session - skipping login steps');
      authCode = resumeResult.directCode;
    } else {
      const resumeUrl = resumeResult;
      progressLog('Authorization resume obtained');

      // Step 2
      progressLog('Sending user agent info...');
      await this._sendUserAgentInfo();

      // Step 3
      progressLog('Submitting username...');
      await this._submitUsername(email);
      progressLog('Username accepted');

      // Step 4
      progressLog('Submitting password...');
      let preLoginData = await this._submitPassword(email, password);
      progressLog('Password accepted');

      // Handle special cases
      if (preLoginData.result !== 'RESUME2OIDCP') {
        if (preLoginData.result === 'GOTO_LOGIN_OTP') {
          throw new Error('Two-factor authentication (2FA) is not supported. Please disable 2FA on your Mercedes Me account.');
        }
        if (preLoginData.result === 'GOTO_LOGIN_LEGAL_TEXTS') {
          progressLog('Accepting legal consent...');
          preLoginData = await this._submitLegalConsent(
            preLoginData.homeCountry || '',
            preLoginData.consentCountry || ''
          );
          if (preLoginData.result !== 'RESUME2OIDCP') {
            throw new Error('Problem accepting legal terms during login');
          }
        } else {
          throw new Error(`Unexpected login result: ${preLoginData.result}`);
        }
      }

      // Step 5
      progressLog('Resuming authorization...');
      authCode = await this._resumeAuthorization(resumeUrl, preLoginData.token);
      progressLog('Authorization code obtained');
    }

    // Step 6
    progressLog('Exchanging code for tokens...');
    const tokenInfo = await this._exchangeCodeForTokens(authCode);
    progressLog('Login successful!');

    this.token = tokenInfo;
    this.codeVerifier = null;
    this.codeChallenge = null;

    sessionStorage.setItem('mercedes_token', JSON.stringify(tokenInfo));
    return tokenInfo;
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken() {
    if (!this.token || !this.token.refresh_token) {
      throw new Error('No refresh token available. Please login again.');
    }

    const url = `${this.endpoints.login}/as/token.oauth2`;

    const response = await proxyFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Device-Id': this.deviceGuid,
        'X-Request-Id': crypto.randomUUID()
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.token.refresh_token
      }).toString()
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const tokenInfo = await response.json();
    if (!tokenInfo.refresh_token) {
      tokenInfo.refresh_token = this.token.refresh_token;
    }
    tokenInfo.expires_at = Math.floor(Date.now() / 1000) + tokenInfo.expires_in;

    this.token = tokenInfo;
    sessionStorage.setItem('mercedes_token', JSON.stringify(tokenInfo));
    return tokenInfo;
  }

  async getAccessToken() {
    if (!this.token) {
      const stored = sessionStorage.getItem('mercedes_token');
      if (stored) {
        this.token = JSON.parse(stored);
      } else {
        throw new Error('Not authenticated. Please login first.');
      }
    }

    const now = Math.floor(Date.now() / 1000);
    if (!this.token.expires_at || this.token.expires_at - now < 60) {
      await this.refreshAccessToken();
    }

    return this.token.access_token;
  }

  isAuthenticated() {
    return !!this.token || !!sessionStorage.getItem('mercedes_token');
  }
}
