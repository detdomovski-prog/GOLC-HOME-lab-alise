const http = require('http');
const https = require('https');

function resolveUrl(baseUrl, pathOrUrl) {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  const cleanBase = (baseUrl || '').replace(/\/$/, '');
  const cleanPath = (pathOrUrl || '').startsWith('/') ? pathOrUrl : `/${pathOrUrl || ''}`;
  return `${cleanBase}${cleanPath}`;
}

function requestJson(method, targetUrl, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const lib = parsed.protocol === 'https:' ? https : http;

    const payload = typeof body === 'string' ? body : null;

    const req = lib.request(
      {
        method,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        headers: {
          Accept: 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(headers || {}),
        },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            const json = raw ? JSON.parse(raw) : {};
            resolve({ statusCode: res.statusCode, body: json });
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = function (RED) {
  function GolcAliceAuthNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.backendUrl = (config.backendUrl || 'http://localhost:3000').replace(/\/$/, '');
    node.action = config.action || 'get_token';
    node.authEndpoint = config.authEndpoint || '/endpoint/auth';
    node.tokenEndpoint = config.tokenEndpoint || '/endpoint/token';

    node.clientId = config.clientId || '';
    node.clientSecret = (node.credentials && node.credentials.clientSecret) || '';
    node.redirectUri = config.redirectUri || '';
    node.scope = config.scope || '';
    node.code = config.code || '';
    node.state = config.state || '';
    node.grantType = config.grantType || 'authorization_code';
    node.includeAuthHeader = config.includeAuthHeader !== false;

    function pick(msg, payload, key, fallback) {
      if (msg[key] !== undefined && msg[key] !== null && msg[key] !== '') return msg[key];
      if (payload[key] !== undefined && payload[key] !== null && payload[key] !== '') return payload[key];
      return fallback;
    }

    async function buildAuthUrl(msg, payload) {
      const authEndpoint = pick(msg, payload, 'authEndpoint', node.authEndpoint);
      const clientId = pick(msg, payload, 'clientId', node.clientId);
      const redirectUri = pick(msg, payload, 'redirectUri', node.redirectUri);
      const scope = pick(msg, payload, 'scope', node.scope);
      const state = pick(msg, payload, 'state', node.state);

      const baseUrl = resolveUrl(node.backendUrl, authEndpoint);
      const url = new URL(baseUrl);
      url.searchParams.set('response_type', 'code');
      if (clientId) url.searchParams.set('client_id', clientId);
      if (redirectUri) url.searchParams.set('redirect_uri', redirectUri);
      if (scope) url.searchParams.set('scope', scope);
      if (state) url.searchParams.set('state', state);

      msg.authUrl = url.toString();
      msg.payload = { authUrl: msg.authUrl };
      return msg;
    }

    async function getToken(msg, payload) {
      const tokenEndpoint = pick(msg, payload, 'tokenEndpoint', node.tokenEndpoint);
      const clientId = pick(msg, payload, 'clientId', node.clientId);
      const clientSecret = pick(msg, payload, 'clientSecret', node.clientSecret);
      const redirectUri = pick(msg, payload, 'redirectUri', node.redirectUri);
      const scope = pick(msg, payload, 'scope', node.scope);
      const state = pick(msg, payload, 'state', node.state);
      const code = pick(msg, payload, 'code', node.code);
      const grantType = pick(msg, payload, 'grantType', node.grantType);
      const refreshToken = pick(msg, payload, 'refreshToken', '');
      const includeAuthHeader = pick(msg, payload, 'includeAuthHeader', node.includeAuthHeader) !== false;

      const params = new URLSearchParams();
      if (grantType) params.set('grant_type', grantType);
      if (clientId) params.set('client_id', clientId);
      if (clientSecret) params.set('client_secret', clientSecret);
      if (redirectUri) params.set('redirect_uri', redirectUri);
      if (scope) params.set('scope', scope);
      if (state) params.set('state', state);
      if (code) params.set('code', code);
      if (refreshToken) params.set('refresh_token', refreshToken);

      const url = resolveUrl(node.backendUrl, tokenEndpoint);
      const response = await requestJson(
        'POST',
        url,
        { 'Content-Type': 'application/x-www-form-urlencoded' },
        params.toString()
      );

      if (response.statusCode >= 400) {
        const errorText = response.body && response.body.error ? response.body.error : `HTTP ${response.statusCode}`;
        throw new Error(`Token request failed: ${errorText}`);
      }

      const token = response.body && response.body.access_token;
      if (!token) {
        throw new Error('No access_token in token response');
      }

      msg.oauth = response.body;
      msg.access_token = token;
      msg.payload = response.body;
      msg.statusCode = response.statusCode;

      if (includeAuthHeader) {
        msg.headers = msg.headers || {};
        msg.headers.Authorization = `Bearer ${token}`;
      }

      return msg;
    }

    node.on('input', async (msg, send, done) => {
      const sender = send || node.send.bind(node);
      const payload = msg.payload && typeof msg.payload === 'object' && !Array.isArray(msg.payload)
        ? msg.payload
        : {};

      try {
        const action = (pick(msg, payload, 'action', node.action) || 'get_token').toLowerCase();
        node.status({ fill: 'blue', shape: 'dot', text: `auth ${action}...` });

        const outMsg = action === 'build_auth_url'
          ? await buildAuthUrl(msg, payload)
          : await getToken(msg, payload);

        node.status({ fill: 'green', shape: 'dot', text: `ok ${action}` });
        sender(outMsg);
        done();
      } catch (error) {
        node.status({ fill: 'red', shape: 'ring', text: 'auth error' });
        done(error);
      }
    });
  }

  RED.nodes.registerType('golchomelab-auth', GolcAliceAuthNode, {
    credentials: {
      clientSecret: { type: 'password' },
    },
  });
};
