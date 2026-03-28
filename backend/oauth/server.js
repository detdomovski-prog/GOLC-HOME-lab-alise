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

const app = express();
app.use(express.json());
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
  
  // Твой backend
  BACKEND_URL: process.env.BACKEND_URL || 'https://alice.golchomelab.kz',
  
  // Node-RED
  NODERED_URL: process.env.NODERED_URL || 'http://localhost:1880',
  NODERED_TOKEN: process.env.NODERED_TOKEN || 'your-nodered-token',
  
  // JWT для внутреннего токена
  JWT_SECRET: process.env.JWT_SECRET || 'super-secret-jwt-key-change-in-prod',
  JWT_EXPIRES_IN: '24h',
};

// ========================================
// STORAGE (в продакшене → БД)
// ========================================

// Хранилище пользователей и их авторизационных кодов
const users = new Map();
const authCodes = new Map();
const accessTokens = new Map();
const linkedDevices = new Map(); // user_id → [device_id, device_id, ...]

// Пример пользователя
users.set('user123', {
  id: 'user123',
  username: 'admin',
  password: crypto.createHash('sha256').update('admin123').digest('hex'),
  email: 'admin@golc.kz'
});

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
  if (client_id !== CONFIG.YANDEX_CLIENT_ID) {
    return res.status(400).json({ error: 'invalid_client' });
  }

  if (!redirect_uri) {
    return res.status(400).json({ error: 'invalid_request' });
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
  const loginUrl = `/login?code=${code}&redirect_uri=${encodeURIComponent(redirect_uri)}&state=${state}`;
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
    redirect_uri,
    client_id,
    client_secret,
    username,
    password
  } = req.body;

  // Проверяем credentials
  if (client_id !== CONFIG.YANDEX_CLIENT_ID || client_secret !== CONFIG.YANDEX_CLIENT_SECRET) {
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

    // Код использован, удаляем
    authCodes.delete(code);

    // Генерируем access_token
    const user_id = codeData.user_id || 'default_user_id';
    const accessToken = jwt.sign(
      { user_id, type: 'access_token' },
      CONFIG.JWT_SECRET,
      { expiresIn: CONFIG.JWT_EXPIRES_IN }
    );

    accessTokens.set(accessToken, { user_id, created_at: Date.now() });

    return res.json({
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: 86400, // 24h
      refresh_token: null // пока не реализуем
    });
  }

  // 🔹 Режим 2: Resource Owner Password (для Node-RED / простого логина)
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

    accessTokens.set(accessToken, { user_id: user.id, created_at: Date.now() });

    return res.json({
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: 86400,
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

/**
 * POST /v1.0/user/devices
 * 
 * Яндекс: "Дай мне список устройств пользователя"
 * → Мы идём в Node-RED и берём оттуда список
 */
app.post('/v1.0/user/devices', authMiddleware, async (req, res) => {
  const user_id = req.user_id;

  try {
    // Запрашиваем список устройств у Node-RED
    const response = await fetch(`${CONFIG.NODERED_URL}/api/devices?user_id=${user_id}`, {
      headers: { 'X-Token': CONFIG.NODERED_TOKEN }
    });

    if (!response.ok) {
      throw new Error('Node-RED error');
    }

    const devices = await response.json();

    res.json({
      request_id: uuid(),
      payload: {
        devices: devices.map(d => ({
          id: d.id,
          name: d.name,
          description: d.description || '',
          room: d.room || '',
          type: d.type, // например: 'devices.types.light'
          capabilities: d.capabilities || [], // [{ type: 'on_off', retrievable: true, ... }]
          properties: d.properties || []
        }))
      }
    });
  } catch (error) {
    console.error('devices error:', error);
    res.status(500).json({
      request_id: uuid(),
      payload: { error_code: 'INTERNAL_ERROR' }
    });
  }
});

/**
 * POST /v1.0/user/devices/query
 * 
 * Яндекс: "Дай мне состояние этих устройств"
 */
app.post('/v1.0/user/devices/query', authMiddleware, async (req, res) => {
  const { devices } = req.body;
  const user_id = req.user_id;

  try {
    const deviceIds = devices.map(d => d.id);

    // Запрашиваем состояние у Node-RED
    const response = await fetch(`${CONFIG.NODERED_URL}/api/devices/state`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Token': CONFIG.NODERED_TOKEN
      },
      body: JSON.stringify({ device_ids: deviceIds })
    });

    if (!response.ok) {
      throw new Error('Node-RED error');
    }

    const states = await response.json();

    res.json({
      request_id: uuid(),
      payload: {
        devices: states.map(s => ({
          id: s.id,
          capabilities: s.capabilities || []
        }))
      }
    });
  } catch (error) {
    console.error('query error:', error);
    res.status(500).json({
      request_id: uuid(),
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
  const { devices } = req.body;
  const user_id = req.user_id;

  try {
    // Пересылаем команду Node-RED
    const response = await fetch(`${CONFIG.NODERED_URL}/api/devices/action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Token': CONFIG.NODERED_TOKEN
      },
      body: JSON.stringify({ devices })
    });

    if (!response.ok) {
      throw new Error('Node-RED error');
    }

    const result = await response.json();

    res.json({
      request_id: uuid(),
      payload: {
        devices: result.devices || []
      }
    });
  } catch (error) {
    console.error('action error:', error);
    res.status(500).json({
      request_id: uuid(),
      payload: { error_code: 'INTERNAL_ERROR' }
    });
  }
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
  console.log(`   POST /v1.0/user/devices`);
  console.log(`   POST /v1.0/user/devices/query`);
  console.log(`   POST /v1.0/user/devices/action`);
});

module.exports = app;
