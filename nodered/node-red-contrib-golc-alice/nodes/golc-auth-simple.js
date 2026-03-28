const http = require('http');
const https = require('https');

/**
 * Универсальный HTTP JSON запрос (работает на Node >= 14, без fetch).
 */
function requestJson(method, targetUrl, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const parsed = new URL(targetUrl);
    const lib = parsed.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        req.destroy();
        reject(new Error('TIMEOUT'));
      }
    }, timeoutMs || 10000);

    const req = lib.request(
      {
        method,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search || ''}`,
        headers: {
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(headers || {})
        }
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          if (finished) return;
          clearTimeout(timer);
          finished = true;

          let bodyJson = {};
          if (raw) {
            try { bodyJson = JSON.parse(raw); } catch (_e) { bodyJson = { raw }; }
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
  function GolcAuthSimpleNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.backendUrl = (config.backendUrl || 'https://alice.golchomelab.kz').trim();
    node.username = (config.username || '').trim();

    node.password = (node.credentials && node.credentials.password) || '';
    node.accessToken = (node.credentials && node.credentials.accessToken) || '';
    node.userId = (node.credentials && node.credentials.userId) || '';
    node.tokenTimestamp = node.accessToken ? Date.now() : 0;

    // Максимальное время жизни токена (23 часа) — после этого re-auth
    const TOKEN_MAX_AGE_MS = 23 * 60 * 60 * 1000;

    let closed = false;

    function isTokenExpired() {
      if (!node.accessToken) return true;
      if (!node.tokenTimestamp) return true;
      return (Date.now() - node.tokenTimestamp) > TOKEN_MAX_AGE_MS;
    }

    async function authenticate() {
      if (closed) return null;

      if (!node.username || !node.password) {
        node.status({ fill: 'red', shape: 'ring', text: 'нужны логин/пароль' });
        return null;
      }

      const baseUrl = (node.backendUrl || 'https://alice.golchomelab.kz').replace(/\/$/, '');

      try {
        node.status({ fill: 'blue', shape: 'dot', text: 'авторизация...' });

        const response = await requestJson(
          'POST',
          `${baseUrl}/api/login`,
          {},
          { username: node.username, password: node.password },
          10000
        );

        if (response.statusCode >= 400) {
          throw new Error((response.body && response.body.error) || `HTTP ${response.statusCode}`);
        }

        const data = response.body || {};

        if (!data.ok || !data.access_token) {
          throw new Error('Неверный ответ от backend');
        }

        node.credentials.accessToken = data.access_token;
        node.credentials.userId = data.user_id || '';
        node.accessToken = data.access_token;
        node.userId = data.user_id || '';
        node.tokenTimestamp = Date.now();
        RED.nodes.addCredentials(node.id, node.credentials);

        node.status({
          fill: 'green',
          shape: 'dot',
          text: node.userId ? `✓ ${node.userId}` : '✓ authorized'
        });

        return data;
      } catch (error) {
        node.accessToken = '';
        node.tokenTimestamp = 0;
        node.status({ fill: 'red', shape: 'ring', text: `auth error: ${error.message}` });
        return null;
      }
    }

    node.on('input', async (msg, send, done) => {
      if (closed) { done(); return; }

      const sender = send || node.send.bind(node);

      try {
        // Re-auth если токена нет или он истёк
        if (!node.accessToken || isTokenExpired()) {
          const authResult = await authenticate();
          if (!authResult) {
            done(new Error('Не удалось авторизоваться'));
            return;
          }
        }

        msg.access_token = node.accessToken;
        msg.user_id = node.userId;
        msg.payload = {
          access_token: node.accessToken,
          user_id: node.userId,
          status: 'authorized'
        };

        sender(msg);
        done();
      } catch (error) {
        done(error);
      }
    });

    // Cleanup при удалении/редеплое ноды
    node.on('close', (done) => {
      closed = true;
      node.status({});
      done();
    });

    node.status({
      fill: node.accessToken ? 'green' : 'yellow',
      shape: 'ring',
      text: node.accessToken ? (node.userId ? `✓ ${node.userId}` : '✓ token') : 'ожидание логина'
    });
  }

  RED.nodes.registerType('golc-auth-simple', GolcAuthSimpleNode, {
    credentials: {
      password: { type: 'password' },
      accessToken: { type: 'password' },
      userId: { type: 'text' }
    }
  });
};
