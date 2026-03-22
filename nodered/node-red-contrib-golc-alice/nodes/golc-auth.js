const http = require('http');
const https = require('https');

function resolveUrl(baseUrl, pathOrUrl) {
  if (/^https?:\/\//i.test(pathOrUrl || '')) {
    return pathOrUrl;
  }
  const cleanBase = (baseUrl || '').replace(/\/$/, '');
  const cleanPath = (pathOrUrl || '').startsWith('/') ? pathOrUrl : `/${pathOrUrl || ''}`;
  return `${cleanBase}${cleanPath}`;
}

function requestJson(method, targetUrl, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const parsed = new URL(targetUrl);
    const lib = parsed.protocol === 'https:' ? https : http;
    const payload = typeof body === 'string' ? body : body ? JSON.stringify(body) : null;

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        reject(new Error('TIMEOUT'));
      }
    }, timeoutMs || 10000);

    const req = lib.request(
      {
        method,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        headers: {
          Accept: 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(headers || {})
        }
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          if (finished) return;
          clearTimeout(timer);
          finished = true;

          let bodyJson = {};
          if (raw) {
            try {
              bodyJson = JSON.parse(raw);
            } catch (error) {
              bodyJson = { raw };
            }
          }

          resolve({ statusCode: res.statusCode, body: bodyJson });
        });
      }
    );

    req.on('error', (error) => {
      if (finished) return;
      clearTimeout(timer);
      finished = true;
      reject(error);
    });

    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = function (RED) {
  function GolcAliceAuthNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.backendUrl = (config.backendUrl || 'http://localhost:3000').replace(/\/$/, '');
    node.action = config.action || 'device_code';
    node.passwordEndpoint = config.passwordEndpoint || '/alice/auth';
    node.authEndpoint = config.authEndpoint || 'https://oauth.yandex.ru/authorize';
    node.deviceEndpoint = config.deviceEndpoint || 'https://oauth.yandex.ru/device/code';
    node.tokenEndpoint = config.tokenEndpoint || 'https://oauth.yandex.ru/token';
    node.clientId = config.clientId || '';
    node.redirectUri = config.redirectUri || '';
    node.scope = config.scope || '';
    node.code = config.code || '';
    node.state = config.state || '';
    node.grantType = config.grantType || 'authorization_code';
    node.includeAuthHeader = config.includeAuthHeader !== false;
    node.autoPoll = config.autoPoll !== false;
    node.pollInterval = Number(config.pollInterval) > 0 ? Number(config.pollInterval) : 5;
    node.alwaysSuccess = config.alwaysSuccess === true || config.alwaysSuccess === 'true';
    node.clientSecret = (node.credentials && node.credentials.clientSecret) || '';
    node.login = (node.credentials && node.credentials.login) || '';
    node.password = (node.credentials && node.credentials.password) || '';

    let pollTimer = null;
    let activeFlow = null;

    function pick(msg, payload, key, fallback) {
      if (msg[key] !== undefined && msg[key] !== null && msg[key] !== '') return msg[key];
      if (payload[key] !== undefined && payload[key] !== null && payload[key] !== '') return payload[key];
      return fallback;
    }

    function stopPolling() {
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      activeFlow = null;
    }

    async function buildAuthUrl(msg, payload) {
      const authEndpoint = pick(msg, payload, 'authEndpoint', node.authEndpoint);
      const clientId = pick(msg, payload, 'clientId', node.clientId);
      const redirectUri = pick(msg, payload, 'redirectUri', node.redirectUri);
      const scope = pick(msg, payload, 'scope', node.scope);
      const state = pick(msg, payload, 'state', node.state);

      const url = new URL(authEndpoint);
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

      const response = await requestJson(
        'POST',
        tokenEndpoint,
        { 'Content-Type': 'application/x-www-form-urlencoded' },
        params.toString(),
        10000
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

    async function backendLogin(msg, payload) {
      const login = String(pick(msg, payload, 'login', node.login) || '').trim();
      const password = String(pick(msg, payload, 'password', node.password) || '').trim();
      const endpoint = pick(msg, payload, 'passwordEndpoint', node.passwordEndpoint);

      if (!login || !password) {
        throw new Error('Нужно заполнить логин и пароль в ноде или передать их в msg.payload');
      }

      const response = await requestJson(
        'POST',
        resolveUrl(node.backendUrl, endpoint),
        { 'Content-Type': 'application/json' },
        { login, password },
        10000
      );

      if (response.statusCode >= 400) {
        const errorText = response.body && (response.body.error || response.body.message)
          ? (response.body.error || response.body.message)
          : `HTTP ${response.statusCode}`;
        throw new Error(`Авторизация не удалась: ${errorText}`);
      }

      const token = response.body && (response.body.access_token || response.body.token);
      if (!token) {
        throw new Error('Бэкенд не вернул access_token/token');
      }

      msg.token = token;
      msg.access_token = token;
      msg.user_id = response.body.user_id || response.body.uid || '';
      msg.account_email = response.body.account_email || response.body.email || login;
      msg.authResult = response.body;
      msg.statusCode = response.statusCode;
      msg.payload = response.body;
      return msg;
    }

    async function requestDeviceCode(msg, payload) {
      const clientId = pick(msg, payload, 'clientId', node.clientId);
      const scope = pick(msg, payload, 'scope', node.scope);
      const endpoint = pick(msg, payload, 'deviceEndpoint', node.deviceEndpoint);

      if (!clientId) {
        throw new Error('Для device flow нужен client_id');
      }

      const params = new URLSearchParams();
      params.set('client_id', clientId);
      if (scope) params.set('scope', scope);

      const response = await requestJson(
        'POST',
        endpoint,
        { 'Content-Type': 'application/x-www-form-urlencoded' },
        params.toString(),
        10000
      );

      if (response.statusCode >= 400) {
        const errorText = response.body && response.body.error ? response.body.error : `HTTP ${response.statusCode}`;
        throw new Error(`Device code request failed: ${errorText}`);
      }

      if (!response.body || !response.body.device_code || !response.body.user_code) {
        throw new Error('Яндекс не вернул device_code/user_code');
      }

      return response.body;
    }

    function scheduleDevicePolling(flow, originalMsg, sender) {
      const poll = async () => {
        const params = new URLSearchParams();
        params.set('grant_type', 'device_code');
        params.set('code', flow.device_code);
        params.set('client_id', flow.clientId);
        if (flow.clientSecret) params.set('client_secret', flow.clientSecret);

        try {
          const response = await requestJson(
            'POST',
            flow.tokenEndpoint,
            { 'Content-Type': 'application/x-www-form-urlencoded' },
            params.toString(),
            10000
          );

          if (response.statusCode < 400 && response.body && response.body.access_token) {
            stopPolling();
            const outMsg = RED.util.cloneMessage(originalMsg);
            outMsg.payload = response.body;
            outMsg.oauth = response.body;
            outMsg.access_token = response.body.access_token;
            outMsg.statusCode = response.statusCode;
            outMsg.step = 'authorized';
            if (node.includeAuthHeader) {
              outMsg.headers = outMsg.headers || {};
              outMsg.headers.Authorization = `Bearer ${response.body.access_token}`;
            }
            node.status({ fill: 'green', shape: 'dot', text: 'вход подтверждён' });
            sender(outMsg);
            return;
          }

          const oauthError = response.body && response.body.error ? response.body.error : `HTTP ${response.statusCode}`;
          if (oauthError === 'authorization_pending') {
            node.status({ fill: 'yellow', shape: 'dot', text: `ждём вход: ${flow.user_code}` });
            pollTimer = setTimeout(poll, flow.intervalMs);
            return;
          }

          if (oauthError === 'slow_down') {
            flow.intervalMs += 5000;
            node.status({ fill: 'yellow', shape: 'ring', text: `замедляем опрос: ${flow.user_code}` });
            pollTimer = setTimeout(poll, flow.intervalMs);
            return;
          }

          stopPolling();
          const errorMsg = RED.util.cloneMessage(originalMsg);
          errorMsg.step = 'error';
          errorMsg.oauthError = oauthError;
          errorMsg.statusCode = response.statusCode;
          errorMsg.payload = { error: oauthError, user_code: flow.user_code, verification_url: flow.verification_url };
          node.status({ fill: 'red', shape: 'ring', text: oauthError });
          sender(errorMsg);
        } catch (error) {
          stopPolling();
          node.status({ fill: 'red', shape: 'ring', text: 'ошибка device flow' });
          const errorMsg = RED.util.cloneMessage(originalMsg);
          errorMsg.step = 'error';
          errorMsg.oauthError = error.message;
          sender(errorMsg);
        }
      };

      pollTimer = setTimeout(poll, flow.intervalMs);
    }

    async function startDeviceFlow(msg, payload, sender) {
      stopPolling();
      const clientId = pick(msg, payload, 'clientId', node.clientId);
      const clientSecret = pick(msg, payload, 'clientSecret', node.clientSecret);
      const tokenEndpoint = pick(msg, payload, 'tokenEndpoint', node.tokenEndpoint);
      const autoPoll = pick(msg, payload, 'autoPoll', node.autoPoll) !== false;

      const flowResponse = await requestDeviceCode(msg, payload);
      activeFlow = {
        clientId,
        clientSecret,
        tokenEndpoint,
        device_code: flowResponse.device_code,
        user_code: flowResponse.user_code,
        verification_url: flowResponse.verification_url || 'https://oauth.yandex.ru/device',
        intervalMs: Math.max(node.pollInterval, Number(flowResponse.interval) || node.pollInterval) * 1000,
        expires_in: flowResponse.expires_in || 0
      };

      msg.step = 'device_code';
      msg.user_code = activeFlow.user_code;
      msg.device_code = activeFlow.device_code;
      msg.verification_url = activeFlow.verification_url;
      msg.qrText = activeFlow.verification_url;
      msg.expires_in = activeFlow.expires_in;
      msg.payload = {
        step: 'device_code',
        user_code: activeFlow.user_code,
        verification_url: activeFlow.verification_url,
        qrText: activeFlow.verification_url,
        expires_in: activeFlow.expires_in
      };

      node.status({ fill: 'yellow', shape: 'dot', text: `код: ${activeFlow.user_code}` });
      sender(msg);

      if (autoPoll) {
        scheduleDevicePolling(activeFlow, msg, sender);
      }
    }

    node.on('input', async (msg, send, done) => {
      const sender = send || node.send.bind(node);
      const payload = msg.payload && typeof msg.payload === 'object' && !Array.isArray(msg.payload)
        ? msg.payload
        : {};

      try {
        const action = String(pick(msg, payload, 'action', node.action) || 'device_code').toLowerCase();

        if (action === 'cancel_device_flow') {
          stopPolling();
          node.status({ fill: 'grey', shape: 'ring', text: 'device flow остановлен' });
          msg.payload = { cancelled: true };
          sender(msg);
          done();
          return;
        }

        node.status({ fill: 'blue', shape: 'dot', text: `auth ${action}...` });

        if (action === 'backend_login') {
          const outMsg = await backendLogin(msg, payload);
          node.status({ fill: 'green', shape: 'dot', text: `вошли: ${outMsg.account_email || 'ok'}` });
          sender(outMsg);
          done();
          return;
        }

        if (action === 'device_code') {
          await startDeviceFlow(msg, payload, sender);
          done();
          return;
        }

        const outMsg = action === 'build_auth_url'
          ? await buildAuthUrl(msg, payload)
          : await getToken(msg, payload);

        node.status({ fill: 'green', shape: 'dot', text: `ok ${action}` });
        sender(outMsg);
        done();
      } catch (error) {
        if (error.message === 'TIMEOUT' && node.alwaysSuccess) {
          node.status({ fill: 'yellow', shape: 'ring', text: 'таймаут, авто-ответ' });
          msg.statusCode = 200;
          msg.payload = { status: 'ok' };
          sender(msg);
          done();
          return;
        }

        node.status({ fill: 'red', shape: 'ring', text: 'auth error' });
        done(error);
      }
    });

    node.on('close', () => {
      stopPolling();
    });
  }

  RED.nodes.registerType('golchomelab-auth', GolcAliceAuthNode, {
    credentials: {
      clientSecret: { type: 'password' },
      login: { type: 'text' },
      password: { type: 'password' }
    }
  });
};
