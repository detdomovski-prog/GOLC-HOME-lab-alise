/**
 * Яндекс OAuth + Smart Home API Backend
 * 
 * Архитектура:
 * Яндекс Алиса → OAuth endpoints → API для Алисы → Node-RED
 */

const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const http = require('http');
const https = require('https');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// ========================================
// КОНФИГУРАЦИЯ
// ========================================

const CONFIG = {
  // Яндекс OAuth credentials (получишь при регистрации в Яндекс Диалоги)
  YANDEX_CLIENT_ID: process.env.YANDEX_CLIENT_ID || 'your-client-id-from-yandex',
  YANDEX_CLIENT_SECRET: process.env.YANDEX_CLIENT_SECRET || 'your-client-secret-from-yandex',
  YANDEX_CLIENT_ID_ALLOWLIST: (process.env.YANDEX_CLIENT_ID_ALLOWLIST || process.env.YANDEX_CLIENT_ID || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
  YANDEX_REDIRECT_URI_WHITELIST: (process.env.YANDEX_REDIRECT_URI_WHITELIST || 'https://oauth.yandex.ru/codes,https://social.yandex.net/broker/redirect,https://social.yandex.ru/broker/redirect')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
  
  // Твой backend
  BACKEND_URL: process.env.BACKEND_URL || 'https://alice.golchomelab.kz',
  SMART_HOME_URL: process.env.SMART_HOME_URL || 'http://127.0.0.1:3000',
  SMART_HOME_TOKEN: process.env.SMART_HOME_TOKEN || process.env.AUTH_TOKEN || 'test-token',
  YANDEX_OAUTH_REDIRECT_URI: process.env.YANDEX_OAUTH_REDIRECT_URI || '',
  
  // Node-RED
  NODERED_URL: process.env.NODERED_URL || 'http://localhost:1880',
  NODERED_TOKEN: process.env.NODERED_TOKEN || 'your-nodered-token',
  
  // JWT для внутреннего токена
  JWT_SECRET: process.env.JWT_SECRET || 'super-secret-jwt-key-change-in-prod',
  JWT_EXPIRES_IN: '24h',
};

function requestJson(method, targetUrl, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const parsed = new URL(targetUrl);
    const lib = parsed.protocol === 'https:' ? https : http;
    const payload = typeof body === 'string' ? body : (body ? JSON.stringify(body) : null);

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setNoStoreHeaders(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
}

// ========================================
// STORAGE (в продакшене → БД)
// ========================================

// Хранилище пользователей и их авторизационных кодов
const users = new Map();
const authCodes = new Map();
const accessTokens = new Map();
const refreshTokens = new Map();
const linkedDevices = new Map(); // user_id → [device_id, device_id, ...]
const yandexLinkedAccounts = new Map(); // key -> yandex oauth payload
let lastYandexLinkedAccount = null;

// Пример пользователя
users.set('user123', {
  id: 'user123',
  username: 'admin',
  password: crypto.createHash('sha256').update('admin123').digest('hex'),
  email: 'admin@golc.kz'
});

function isAllowedRedirectUri(redirectUri) {
  if (!redirectUri) {
    return false;
  }

  return CONFIG.YANDEX_REDIRECT_URI_WHITELIST.includes(String(redirectUri).trim());
}

function isAllowedClientId(clientId) {
  const normalized = String(clientId || '').trim();
  if (!normalized) {
    return false;
  }

  return CONFIG.YANDEX_CLIENT_ID_ALLOWLIST.includes(normalized);
}

function resolveInternalToken(req) {
  const authHeader = String(req.headers.authorization || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  return String(
    req.headers['x-token']
    || req.headers['x-internal-token']
    || ''
  ).trim();
}

function requireInternalAuth(req, res, next) {
  const allowedTokens = [
    process.env.AUTH_TOKEN,
    process.env.INTERNAL_TOKEN,
    process.env.INTERNAL_AUTH_TOKEN,
    CONFIG.NODERED_TOKEN,
    'local-internal-token'
  ].map((item) => String(item || '').trim()).filter(Boolean);

  if (allowedTokens.length === 0) {
    next();
    return;
  }

  const token = resolveInternalToken(req);
  if (!token || !allowedTokens.includes(token)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  next();
}

function hasInternalAccess(req) {
  const allowedTokens = [
    process.env.AUTH_TOKEN,
    process.env.INTERNAL_TOKEN,
    process.env.INTERNAL_AUTH_TOKEN,
    CONFIG.NODERED_TOKEN,
    'local-internal-token'
  ].map((item) => String(item || '').trim()).filter(Boolean);

  if (allowedTokens.length === 0) {
    return true;
  }

  const token = resolveInternalToken(req);
  return Boolean(token && allowedTokens.includes(token));
}

function storeYandexLinkedAccount(key, payload) {
  const normalizedKey = String(key || '').trim() || 'latest';
  const record = {
    key: normalizedKey,
    linked_at: Date.now(),
    ...payload
  };

  yandexLinkedAccounts.set(normalizedKey, record);
  lastYandexLinkedAccount = record;
  return record;
}

function resolveRequestId(req) {
  return String((req.headers && req.headers['x-request-id']) || '').trim() || uuid();
}

async function exchangeYandexCodeByServerCredentials(code) {
  if (
    !CONFIG.YANDEX_CLIENT_ID ||
    !CONFIG.YANDEX_CLIENT_SECRET ||
    CONFIG.YANDEX_CLIENT_ID === 'your-client-id-from-yandex' ||
    CONFIG.YANDEX_CLIENT_SECRET === 'your-client-secret-from-yandex'
  ) {
    return { ok: false, error: 'server_client_credentials_not_configured', statusCode: 400 };
  }

  const params = new URLSearchParams();
  params.set('grant_type', 'authorization_code');
  params.set('code', code);
  params.set('client_id', CONFIG.YANDEX_CLIENT_ID);
  params.set('client_secret', CONFIG.YANDEX_CLIENT_SECRET);

  const redirectUri = String(CONFIG.YANDEX_OAUTH_REDIRECT_URI || '').trim();
  if (redirectUri) {
    params.set('redirect_uri', redirectUri);
  }

  const tokenResponse = await requestJson(
    'POST',
    'https://oauth.yandex.ru/token',
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    params.toString(),
    10000
  );

  if (tokenResponse.statusCode >= 400 || !tokenResponse.body || !tokenResponse.body.access_token) {
    const errorText = tokenResponse.body && tokenResponse.body.error
      ? tokenResponse.body.error
      : `HTTP ${tokenResponse.statusCode}`;
    return { ok: false, error: `token_exchange_failed:${errorText}`, statusCode: 400 };
  }

  const accessToken = tokenResponse.body.access_token;

  const profileResponse = await requestJson(
    'GET',
    'https://login.yandex.ru/info?format=json',
    { Authorization: `OAuth ${accessToken}` },
    null,
    10000
  );

  const profile = (profileResponse.statusCode < 400 && profileResponse.body) ? profileResponse.body : {};
  return {
    ok: true,
    access_token: accessToken,
    refresh_token: tokenResponse.body.refresh_token || '',
    expires_in: tokenResponse.body.expires_in || 0,
    user_id: profile.id || profile.uid || '',
    profile
  };
}

// ========================================
// 1️⃣ OAUTH ENDPOINTS
// ========================================

/**
 * GET /oauth/authorize
 * 
 * Яндекс → Пользователь → Твой backend
 * Пользователь вводит логин/пароль, получает authorization code
 */
app.get('/oauth/authorize', (req, res) => {
  const {
    client_id,
    redirect_uri,
    response_type = 'code',
    state,
    scope
  } = req.query;

  // Проверяем, что это Яндекс
  if (!isAllowedClientId(client_id)) {
    return res.status(400).json({ error: 'invalid_client' });
  }

  if (!redirect_uri) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  if (response_type !== 'code') {
    return res.status(400).json({ error: 'unsupported_response_type' });
  }

  if (!isAllowedRedirectUri(redirect_uri)) {
    return res.status(400).json({ error: 'invalid_redirect_uri' });
  }

  // TODO: тут должна быть ссылка на страницу логина
  // Для простоты → вернём код сразу (в реальности нужна UI с формой)

  // Генерируем код
  const code = crypto.randomBytes(32).toString('hex');
  const codeData = {
    code,
    client_id,
    redirect_uri,
    scope,
    user_id: null, // заполнится после логина пользователя
    expires_at: Date.now() + 10 * 60 * 1000, // 10 минут
  };

  authCodes.set(code, codeData);

  // Редирект на UI логина (здесь должна быть форма)
  const safeState = typeof state === 'string' ? state : '';
  const loginUrl = `/login?code=${code}&redirect_uri=${encodeURIComponent(redirect_uri)}&state=${encodeURIComponent(safeState)}`;
  res.redirect(loginUrl);
});

/**
 * POST /oauth/token
 * 
 * Яндекс приходит сюда с кодом → получает access_token
 */
app.post('/oauth/token', (req, res) => {
  const {
    grant_type,
    code,
    refresh_token,
    redirect_uri,
    client_id,
    client_secret,
    username,
    password
  } = req.body;

  // Проверяем credentials
  if (!isAllowedClientId(client_id) || client_secret !== CONFIG.YANDEX_CLIENT_SECRET) {
    return res.status(401).json({ error: 'invalid_client' });
  }

  // 🔹 Режим 1: Authorization Code (от Яндекса)
  if (grant_type === 'authorization_code') {
    const codeData = authCodes.get(code);

    if (!codeData || codeData.expires_at < Date.now()) {
      return res.status(400).json({ error: 'invalid_grant' });
    }

    if (codeData.redirect_uri !== redirect_uri) {
      return res.status(400).json({ error: 'invalid_grant' });
    }

    if (!isAllowedRedirectUri(redirect_uri)) {
      return res.status(400).json({ error: 'invalid_redirect_uri' });
    }

    // Код использован, удаляем
    authCodes.delete(code);

    if (!codeData.user_id) {
      return res.status(400).json({ error: 'authorization_pending' });
    }

    // Генерируем access_token
    const user_id = codeData.user_id;
    const accessToken = jwt.sign(
      { user_id, type: 'access_token' },
      CONFIG.JWT_SECRET,
      { expiresIn: CONFIG.JWT_EXPIRES_IN }
    );
    const refreshToken = crypto.randomBytes(48).toString('hex');

    accessTokens.set(accessToken, { user_id, created_at: Date.now() });
    refreshTokens.set(refreshToken, { user_id, created_at: Date.now() });
    storeYandexLinkedAccount(`oauth_user:${user_id}`, {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 86400,
      user_id,
      profile: { id: user_id },
      source: 'oauth_authorization_code'
    });

    return res.json({
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: 86400, // 24h
      refresh_token: refreshToken
    });
  }

  // 🔹 Режим 2: Refresh Token (для Яндекс re-link/renew)
  if (grant_type === 'refresh_token') {
    const tokenData = refreshTokens.get(refresh_token);
    if (!tokenData) {
      return res.status(400).json({ error: 'invalid_grant' });
    }

    const accessToken = jwt.sign(
      { user_id: tokenData.user_id, type: 'access_token' },
      CONFIG.JWT_SECRET,
      { expiresIn: CONFIG.JWT_EXPIRES_IN }
    );
    const nextRefreshToken = crypto.randomBytes(48).toString('hex');

    refreshTokens.delete(refresh_token);
    refreshTokens.set(nextRefreshToken, { user_id: tokenData.user_id, created_at: Date.now() });
    accessTokens.set(accessToken, { user_id: tokenData.user_id, created_at: Date.now() });
    storeYandexLinkedAccount(`oauth_user:${tokenData.user_id}`, {
      access_token: accessToken,
      refresh_token: nextRefreshToken,
      expires_in: 86400,
      user_id: tokenData.user_id,
      profile: { id: tokenData.user_id },
      source: 'oauth_refresh_token'
    });

    return res.json({
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: 86400,
      refresh_token: nextRefreshToken
    });
  }

  // 🔹 Режим 3: Resource Owner Password (для Node-RED / простого логина)
  if (grant_type === 'password') {
    const user = Array.from(users.values()).find(u => u.username === username);

    if (!user || user.password !== crypto.createHash('sha256').update(password).digest('hex')) {
      return res.status(401).json({ error: 'invalid_grant' });
    }

    const accessToken = jwt.sign(
      { user_id: user.id, type: 'access_token' },
      CONFIG.JWT_SECRET,
      { expiresIn: CONFIG.JWT_EXPIRES_IN }
    );
    const refreshToken = crypto.randomBytes(48).toString('hex');

    accessTokens.set(accessToken, { user_id: user.id, created_at: Date.now() });
    refreshTokens.set(refreshToken, { user_id: user.id, created_at: Date.now() });
    storeYandexLinkedAccount(`oauth_user:${user.id}`, {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 86400,
      user_id: user.id,
      profile: { id: user.id, username: user.username, email: user.email },
      source: 'oauth_password'
    });

    return res.json({
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: 86400,
      refresh_token: refreshToken,
      user_id: user.id
    });
  }

  res.status(400).json({ error: 'unsupported_grant_type' });
});

/**
 * GET /oauth/userinfo
 * 
 * Вернуть информацию о пользователе по токену
 */
app.get('/oauth/userinfo', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const decoded = jwt.verify(token, CONFIG.JWT_SECRET);
    const user = users.get(decoded.user_id);

    if (!user) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    res.json({
      user_id: user.id,
      username: user.username,
      email: user.email
    });
  } catch (error) {
    res.status(401).json({ error: 'invalid_token' });
  }
});

// ========================================
// 2️⃣ ЯНДЕКС SMART HOME API
// ========================================

/**
 * Middleware: проверка access_token
 */
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error_code: 'UNAUTHORIZED' });
  }

  try {
    const decoded = jwt.verify(token, CONFIG.JWT_SECRET);
    req.user_id = decoded.user_id;
    next();
  } catch (error) {
    res.status(401).json({ error_code: 'UNAUTHORIZED' });
  }
}

app.head('/v1.0', (_req, res) => {
  res.status(200).end();
});

app.get('/v1.0', (_req, res) => {
  res.status(200).json({ ok: true });
});

async function buildDevicesPayload(user_id) {
  let devices = [];

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await requestJson(
      'GET',
      `${CONFIG.SMART_HOME_URL.replace(/\/$/, '')}/v1.0/user/devices`,
      { Authorization: `Bearer ${CONFIG.SMART_HOME_TOKEN}` },
      null,
      10000
    );

    if (response.statusCode >= 400) {
      throw new Error(`Smart Home backend error: HTTP ${response.statusCode}`);
    }

    const payload = response.body && response.body.payload ? response.body.payload : {};
    devices = Array.isArray(payload.devices) ? payload.devices : [];

    if (devices.length > 0 || attempt === 3) {
      break;
    }

    console.log(`[oauth] empty devices list for user ${user_id}, retry ${attempt}/3`);
    await sleep(400);
  }

  return {
    user_id,
    devices: devices.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description || '',
      room: d.room || '',
      type: d.type,
      capabilities: d.capabilities || [],
      properties: d.properties || []
    }))
  };
}

/**
 * GET/POST /v1.0/user/devices
 * 
 * Яндекс: "Дай мне список устройств пользователя"
 * → Мы идём в Node-RED и берём оттуда список
 */
app.get('/v1.0/user/devices', authMiddleware, async (req, res) => {
  const user_id = req.user_id;
  const request_id = resolveRequestId(req);
  setNoStoreHeaders(res);

  try {
    const payload = await buildDevicesPayload(user_id);

    res.json({
      request_id,
      payload
    });
  } catch (error) {
    console.error('devices error:', error);
    res.status(500).json({
      request_id,
      payload: { error_code: 'INTERNAL_ERROR' }
    });
  }
});

app.post('/v1.0/user/devices', authMiddleware, async (req, res) => {
  const user_id = req.user_id;
  const request_id = resolveRequestId(req);
  setNoStoreHeaders(res);

  try {
    const payload = await buildDevicesPayload(user_id);
    res.json({ request_id, payload });
  } catch (error) {
    console.error('devices error:', error);
    res.status(500).json({ request_id, payload: { error_code: 'INTERNAL_ERROR' } });
  }
});

/**
 * POST /v1.0/user/devices/query
 * 
 * Яндекс: "Дай мне состояние этих устройств"
 */
app.post('/v1.0/user/devices/query', authMiddleware, async (req, res) => {
  const devices = Array.isArray(req.body && req.body.devices) ? req.body.devices : [];
  const user_id = req.user_id;
  const request_id = resolveRequestId(req);
  setNoStoreHeaders(res);

  try {
    const response = await requestJson(
      'POST',
      `${CONFIG.SMART_HOME_URL.replace(/\/$/, '')}/v1.0/user/devices/query`,
      {
        Authorization: `Bearer ${CONFIG.SMART_HOME_TOKEN}`,
        'Content-Type': 'application/json'
      },
      { devices },
      10000
    );

    if (response.statusCode >= 400) {
      throw new Error(`Smart Home backend error: HTTP ${response.statusCode}`);
    }

    const payload = response.body && response.body.payload ? response.body.payload : {};
    const states = Array.isArray(payload.devices) ? payload.devices : [];

    res.json({
      request_id,
      payload: {
        devices: states.map(s => ({
          id: s.id,
          capabilities: s.capabilities || [],
          properties: s.properties || []
        }))
      }
    });
  } catch (error) {
    console.error('query error:', error);
    res.status(500).json({
      request_id,
      payload: { error_code: 'INTERNAL_ERROR' }
    });
  }
});

/**
 * POST /v1.0/user/devices/action
 * 
 * Яндекс: "Включи свет!" → мы выполняем команду через Node-RED
 */
app.post('/v1.0/user/devices/action', authMiddleware, async (req, res) => {
  const devices = Array.isArray(req.body && req.body.devices)
    ? req.body.devices
    : Array.isArray(req.body && req.body.payload && req.body.payload.devices)
      ? req.body.payload.devices
      : [];
  const request_id = resolveRequestId(req);
  setNoStoreHeaders(res);

  try {
    const response = await requestJson(
      'POST',
      `${CONFIG.SMART_HOME_URL.replace(/\/$/, '')}/v1.0/user/devices/action`,
      {
        Authorization: `Bearer ${CONFIG.SMART_HOME_TOKEN}`,
        'Content-Type': 'application/json'
      },
      { payload: { devices } },
      10000
    );

    if (response.statusCode >= 400) {
      throw new Error(`Smart Home backend error: HTTP ${response.statusCode}`);
    }

    const resultPayload = response.body && response.body.payload ? response.body.payload : {};
    const result = Array.isArray(resultPayload.devices) ? resultPayload.devices : [];

    res.json({
      request_id,
      payload: {
        devices: result
      }
    });
  } catch (error) {
    console.error('action error:', error);
    res.status(500).json({
      request_id,
      payload: { error_code: 'INTERNAL_ERROR' }
    });
  }
});

app.post('/v1.0/user/unlink', authMiddleware, (req, res) => {
  const request_id = resolveRequestId(req);
  return res.json({ request_id });
});

// ========================================
// 3️⃣ ВНУТРЕННИЙ API ДЛЯ NODE-RED
// ========================================

/**
 * POST /api/devices/add
 * 
 * Node-RED: "Добавь новое устройство для пользователя"
 */
app.post('/api/devices/add', (req, res) => {
  const { token, device } = req.body;

  // Проверяем Node-RED token
  if (token !== CONFIG.NODERED_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (!device || !device.id || !device.user_id) {
    return res.status(400).json({ error: 'invalid_device' });
  }

  // Сохраняем устройство (в БД)
  if (!linkedDevices.has(device.user_id)) {
    linkedDevices.set(device.user_id, []);
  }

  linkedDevices.get(device.user_id).push(device.id);

  res.json({ ok: true, device_id: device.id });
});

/**
 * POST /api/login
 * 
 * Node-RED: "Авторизуй пользователя (простой логин)"
 */
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  const user = Array.from(users.values()).find(u => u.username === username);

  if (!user || user.password !== crypto.createHash('sha256').update(password).digest('hex')) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const accessToken = jwt.sign(
    { user_id: user.id, type: 'access_token' },
    CONFIG.JWT_SECRET,
    { expiresIn: CONFIG.JWT_EXPIRES_IN }
  );

  res.json({
    ok: true,
    user_id: user.id,
    access_token: accessToken,
    username: user.username,
    email: user.email
  });
});

/**
 * GET /api/yandex/auth-url
 *
 * Отдаёт URL авторизации Яндекса с server-side client_id.
 */
app.get('/api/yandex/auth-url', (_req, res) => {
  if (!CONFIG.YANDEX_CLIENT_ID || CONFIG.YANDEX_CLIENT_ID === 'your-client-id-from-yandex') {
    return res.status(400).json({ ok: false, error: 'server_client_id_not_configured' });
  }

  const state = String((_req.query && _req.query.state) || crypto.randomBytes(16).toString('hex')).trim();
  const redirectUri = String(CONFIG.YANDEX_OAUTH_REDIRECT_URI || `${CONFIG.BACKEND_URL.replace(/\/$/, '')}/api/yandex/oauth-callback`).trim();

  const params = new URLSearchParams();
  params.set('response_type', 'code');
  params.set('client_id', CONFIG.YANDEX_CLIENT_ID);
  params.set('state', state);
  params.set('redirect_uri', redirectUri);

  const authUrl = `https://oauth.yandex.ru/authorize?${params.toString()}`;
  res.json({ ok: true, auth_url: authUrl, state, redirect_uri: redirectUri });
});

/**
 * POST /api/yandex/exchange-code
 *
 * Обменивает authorization code на access_token и возвращает профиль.
 */
app.post('/api/yandex/exchange-code', async (req, res) => {
  try {
    const code = String((req.body && req.body.code) || '').trim();
    const state = String((req.body && req.body.state) || '').trim();
    if (!code) {
      return res.status(400).json({ ok: false, error: 'missing_code' });
    }
    const exchangeResult = await exchangeYandexCodeByServerCredentials(code);
    if (!exchangeResult.ok) {
      return res.status(exchangeResult.statusCode || 400).json({ ok: false, error: exchangeResult.error });
    }

    const storageKey = state || exchangeResult.user_id || crypto.randomBytes(8).toString('hex');
    const stored = storeYandexLinkedAccount(storageKey, {
      access_token: exchangeResult.access_token,
      refresh_token: exchangeResult.refresh_token,
      expires_in: exchangeResult.expires_in,
      user_id: exchangeResult.user_id,
      profile: exchangeResult.profile,
      source: 'manual_code'
    });

    return res.json({
      ok: true,
      access_token: stored.access_token,
      refresh_token: stored.refresh_token,
      expires_in: stored.expires_in,
      user_id: stored.user_id,
      profile: stored.profile,
      state: stored.key
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'exchange_failed' });
  }
});

app.get('/api/yandex/oauth-callback', async (req, res) => {
  try {
    const code = String((req.query && req.query.code) || '').trim();
    const state = String((req.query && req.query.state) || '').trim();
    if (!code) {
      return res.status(400).send('missing code');
    }

    const exchangeResult = await exchangeYandexCodeByServerCredentials(code);
    if (!exchangeResult.ok) {
      return res.status(exchangeResult.statusCode || 400).send(`oauth callback error: ${exchangeResult.error}`);
    }

    const storageKey = state || exchangeResult.user_id || crypto.randomBytes(8).toString('hex');
    storeYandexLinkedAccount(storageKey, {
      access_token: exchangeResult.access_token,
      refresh_token: exchangeResult.refresh_token,
      expires_in: exchangeResult.expires_in,
      user_id: exchangeResult.user_id,
      profile: exchangeResult.profile,
      source: 'oauth_callback'
    });

    return res.send(`
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><title>Yandex linked</title></head>
      <body style="font-family:Arial,sans-serif;padding:24px;">
        <h3>Авторизация Яндекс выполнена</h3>
        <p>Данные сохранены на сервере. Вернитесь в Node-RED и нажмите Submit без ввода code.</p>
      </body>
      </html>
    `);
  } catch (error) {
    return res.status(500).send(`oauth callback failed: ${error.message || 'internal_error'}`);
  }
});

app.get('/api/yandex/latest-link', (req, res) => {
  const key = String((req.query && req.query.state) || '').trim();
  const record = key ? yandexLinkedAccounts.get(key) : null;

  if (!record && !hasInternalAccess(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const selected = record || lastYandexLinkedAccount;

  if (!selected) {
    return res.status(404).json({ ok: false, error: 'no_linked_account' });
  }

  return res.json({
    ok: true,
    state: selected.key,
    linked_at: selected.linked_at,
    source: selected.source || '',
    access_token: selected.access_token || '',
    refresh_token: selected.refresh_token || '',
    expires_in: selected.expires_in || 0,
    user_id: selected.user_id || '',
    profile: selected.profile || {}
  });
});

// ========================================
// LOGIN UI (для Яндекса)
// ========================================

app.get('/login', (req, res) => {
  const { code, redirect_uri, state } = req.query;

  // HTML форма логина
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>GOLC HOME - Login</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 400px; margin: 100px auto; }
        input { width: 100%; padding: 10px; margin: 5px 0; }
        button { width: 100%; padding: 10px; background: #007AFF; color: white; border: none; cursor: pointer; }
      </style>
    </head>
    <body>
      <h2>GOLC HOME Login</h2>
      <form method="POST" action="/login/process">
        <input type="hidden" name="code" value="${code}">
        <input type="hidden" name="redirect_uri" value="${redirect_uri}">
        <input type="hidden" name="state" value="${state || ''}">
        
        <label>Username:</label>
        <input type="text" name="username" required>
        
        <label>Password:</label>
        <input type="password" name="password" required>
        
        <button type="submit">Login</button>
      </form>
    </body>
    </html>
  `);
});

app.post('/login/process', (req, res) => {
  const { code, redirect_uri, state, username, password } = req.body;

  // Проверяем логин/пароль
  const user = Array.from(users.values()).find(u => u.username === username);

  if (!user || user.password !== crypto.createHash('sha256').update(password).digest('hex')) {
    return res.status(401).send('Invalid credentials');
  }

  // Заполняем user_id в коде
  const codeData = authCodes.get(code);
  if (codeData) {
    codeData.user_id = user.id;
  }

  // Редирект обратно на Яндекс с кодом
  const redirectUrl = `${redirect_uri}?code=${code}&state=${state || ''}`;
  res.redirect(redirectUrl);
});

// ========================================
// ЗАПУСК СЕРВЕРА
// ========================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 OAuth Backend running on port ${PORT}`);
  console.log(`📡 OAuth endpoints:`);
  console.log(`   GET  /oauth/authorize`);
  console.log(`   POST /oauth/token`);
  console.log(`   GET  /oauth/userinfo`);
  console.log(`📱 Yandex Smart Home API:`);
  console.log(`   HEAD /v1.0`);
  console.log(`   GET  /v1.0/user/devices`);
  console.log(`   POST /v1.0/user/devices`);
  console.log(`   POST /v1.0/user/devices/query`);
  console.log(`   POST /v1.0/user/devices/action`);
  console.log(`   POST /v1.0/user/unlink`);
});

module.exports = app;
