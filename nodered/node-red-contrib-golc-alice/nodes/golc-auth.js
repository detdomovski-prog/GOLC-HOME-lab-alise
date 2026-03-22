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
    node.passwordEndpoint = config.passwordEndpoint || '/alice/auth';
    node.includeAuthHeader = config.includeAuthHeader !== false;
    node.alwaysSuccess = config.alwaysSuccess === true || config.alwaysSuccess === 'true';
    node.login = (node.credentials && node.credentials.login) || '';
    node.password = (node.credentials && node.credentials.password) || '';

    function pick(msg, payload, key, fallback) {
      if (msg[key] !== undefined && msg[key] !== null && msg[key] !== '') return msg[key];
      if (payload[key] !== undefined && payload[key] !== null && payload[key] !== '') return payload[key];
      return fallback;
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

      if (node.includeAuthHeader && token) {
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
        node.status({ fill: 'blue', shape: 'dot', text: 'auth login...' });
        const outMsg = await backendLogin(msg, payload);
        node.status({ fill: 'green', shape: 'dot', text: `вошли: ${outMsg.account_email || 'ok'}` });
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
  }

  RED.nodes.registerType('golchomelab-auth', GolcAliceAuthNode, {
    credentials: {
      login: { type: 'text' },
      password: { type: 'password' }
    }
  });
};
