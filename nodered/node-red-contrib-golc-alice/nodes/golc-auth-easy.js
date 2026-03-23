const http = require('http');
const https = require('https');
const crypto = require('crypto');

const deviceFlows = new Map();
const EASY_CLIENT_ID = 'golc.daniar2017';
const EASY_SCOPE = '';
const DEVICE_ENDPOINT = 'https://oauth.yandex.ru/device/code';
const TOKEN_ENDPOINT = 'https://oauth.yandex.ru/token';

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
        path: `${parsed.pathname}${parsed.search || ''}`,
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
            } catch (_error) {
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

function cleanupFlows() {
  const now = Date.now();
  for (const [flowId, flow] of deviceFlows.entries()) {
    if (now - flow.createdAt > 15 * 60 * 1000) {
      deviceFlows.delete(flowId);
    }
  }
}

async function requestDeviceCode() {
  const params = new URLSearchParams();
  params.set('client_id', EASY_CLIENT_ID);
  if (EASY_SCOPE) params.set('scope', EASY_SCOPE);

  const response = await requestJson(
    'POST',
    DEVICE_ENDPOINT,
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    params.toString(),
    10000
  );

  if (response.statusCode >= 400) {
    const errorText = response.body && response.body.error ? response.body.error : `HTTP ${response.statusCode}`;
    throw new Error(`Не удалось получить код: ${errorText}`);
  }

  if (!response.body || !response.body.device_code || !response.body.user_code) {
    throw new Error('Яндекс не вернул device_code/user_code');
  }

  return response.body;
}

async function waitForToken(flow, timeoutMs) {
  const started = Date.now();
  let intervalMs = flow.intervalMs;

  while (Date.now() - started < timeoutMs) {
    const params = new URLSearchParams();
    params.set('grant_type', 'device_code');
    params.set('code', flow.device_code);
    params.set('client_id', flow.clientId);

    const response = await requestJson(
      'POST',
      TOKEN_ENDPOINT,
      { 'Content-Type': 'application/x-www-form-urlencoded' },
      params.toString(),
      10000
    );

    if (response.statusCode < 400 && response.body && response.body.access_token) {
      return response.body;
    }

    const oauthError = response.body && response.body.error ? response.body.error : `HTTP ${response.statusCode}`;
    if (oauthError === 'authorization_pending') {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      continue;
    }

    if (oauthError === 'slow_down') {
      intervalMs += 5000;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      continue;
    }

    throw new Error(`Авторизация не завершена: ${oauthError}`);
  }

  throw new Error('Истекло время ожидания подтверждения');
}

async function fetchYandexUserInfo(accessToken) {
  const response = await requestJson(
    'GET',
    'https://login.yandex.ru/info?format=json',
    {
      Authorization: `OAuth ${accessToken}`
    },
    null,
    10000
  );

  if (response.statusCode >= 400) {
    const errorText = response.body && response.body.error ? response.body.error : `HTTP ${response.statusCode}`;
    throw new Error(`Не удалось получить профиль: ${errorText}`);
  }

  return response.body || {};
}

module.exports = function (RED) {
  const adminWritePermission = (RED.auth && RED.auth.needsPermission)
    ? RED.auth.needsPermission('flows.write')
    : function (_req, _res, next) { next(); };

  RED.httpAdmin.post('/golchomelab/auth/easy/start', adminWritePermission, async (_req, res) => {
    try {
      cleanupFlows();

      const codeData = await requestDeviceCode();
      const flowId = crypto.randomBytes(12).toString('hex');

      const verificationUrl = codeData.verification_url || 'https://oauth.yandex.ru/device';
      const verificationUrlWithCode = `${verificationUrl}?code=${encodeURIComponent(codeData.user_code)}&cid=${encodeURIComponent(EASY_CLIENT_ID)}`;

      deviceFlows.set(flowId, {
        flowId,
        clientId: EASY_CLIENT_ID,
        device_code: codeData.device_code,
        user_code: codeData.user_code,
        intervalMs: Math.max(Number(codeData.interval) || 5, 3) * 1000,
        createdAt: Date.now()
      });

      res.json({
        ok: true,
        flowId,
        user_code: codeData.user_code,
        verification_url: verificationUrl,
        verification_url_with_code: verificationUrlWithCode,
        expires_in: codeData.expires_in || 0
      });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message || 'Ошибка запуска авторизации' });
    }
  });

  RED.httpAdmin.post('/golchomelab/auth/easy/finish', adminWritePermission, async (req, res) => {
    try {
      const flowId = String((req.body && req.body.flowId) || '').trim();
      if (!flowId || !deviceFlows.has(flowId)) {
        res.status(400).json({ ok: false, error: 'Сессия авторизации не найдена. Нажмите Yandex Authentication снова.' });
        return;
      }

      const flow = deviceFlows.get(flowId);
      const tokenData = await waitForToken(flow, 120000);
      const profile = await fetchYandexUserInfo(tokenData.access_token);
      deviceFlows.delete(flowId);

      res.json({
        ok: true,
        id: profile.id || profile.uid || '',
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || '',
        expires_in: tokenData.expires_in || 0
      });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message || 'Ошибка подтверждения авторизации' });
    }
  });

  function GolcAuthEasyNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.accessToken = (node.credentials && node.credentials.accessToken) || '';
    node.userId = (node.credentials && node.credentials.userId) || '';

    node.on('input', (msg, send, done) => {
      const sender = send || node.send.bind(node);

      if (!node.accessToken) {
        done(new Error('Нет токена. Откройте golc-auth-easy, нажмите Yandex Authentication и Submit.'));
        return;
      }

      msg.access_token = node.accessToken;
      msg.user_id = node.userId;
      msg.payload = {
        access_token: node.accessToken,
        user_id: node.userId,
        status: 'authorized'
      };

      node.status({
        fill: 'green',
        shape: 'dot',
        text: node.userId ? `✓ ${node.userId}` : '✓ authorized'
      });

      sender(msg);
      done();
    });

    node.status({
      fill: node.accessToken ? 'green' : 'yellow',
      shape: 'ring',
      text: node.accessToken ? (node.userId ? `✓ ${node.userId}` : '✓ token') : 'ожидание авторизации'
    });
  }

  RED.nodes.registerType('golc-auth-easy', GolcAuthEasyNode, {
    credentials: {
      accessToken: { type: 'password' },
      userId: { type: 'text' }
    }
  });
};
