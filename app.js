require('dotenv').config();
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const devicesRouter = require('./routes/devices');
const authRouter = require('./routes/auth');
const internalRouter = require('./routes/internal');
const apiYandexBridge = require('./routes/apiYandexBridge');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));

function isPublicYandexBridgeRequest(req) {
  if (req.path === '/api/yandex/auth-url') {
    return true;
  }

  if (req.path === '/api/yandex/exchange-code') {
    return true;
  }

  if (req.path.startsWith('/api/yandex/oauth-callback')) {
    return true;
  }

  if (req.path === '/api/yandex/latest-link') {
    return Boolean(String((req.query && req.query.state) || '').trim());
  }

  return false;
}

// Logging middleware - logs X-Request-Id, request body and response
app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] || uuidv4();
  req.requestId = requestId;
  const start = Date.now();

  console.log(`[${new Date().toISOString()}] --> ${req.method} ${req.originalUrl} request_id=${requestId}`);
  console.log(`headers: ${JSON.stringify(req.headers)}`);
  if (req.body && Object.keys(req.body).length) {
    console.log(`body: ${JSON.stringify(req.body)}`);
  }

  // Capture JSON responses to log them
  const originalJson = res.json;
  res.json = function (body) {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] <-- ${req.method} ${req.originalUrl} request_id=${requestId} status=${res.statusCode} duration=${duration}ms`);
    try { console.log(`response: ${JSON.stringify(body)}`); } catch (e) { console.log('response: <unserializable>'); }
    return originalJson.call(this, body);
  };

  next();
});

// Simple auth middleware: require Authorization: Bearer <AUTH_TOKEN> for protected endpoints
app.use((req, res, next) => {
  // Allow token endpoint without Authorization
  if (
    req.path === '/token' ||
    req.path === '/endpoint/token' ||
    req.path === '/auth' ||
    req.path === '/endpoint/auth' ||
    req.path === '/v1.0' ||
    (req.method === 'HEAD' && req.path === '/v1.0') ||
    isPublicYandexBridgeRequest(req) ||
    req.path.startsWith('/oauth/') ||
    req.path === '/ping' ||
    req.path.startsWith('/internal/')
  ) return next();

  const auth = req.headers['authorization'];
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Missing Authorization header' });
  }
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (!match) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid Authorization format' });
  }

  const receivedToken = match[1].trim();
  const validTokens = new Set(
    [
      process.env.AUTH_TOKEN,
      process.env.INTERNAL_TOKEN,
      process.env.INTERNAL_AUTH_TOKEN,
      'alice-oauth-token-valid',
      'local-internal-token',
      'test-token',
    ].filter(Boolean)
  );

  if (!validTokens.has(receivedToken)) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid token' });
  }
  return next();
});

app.get('/ping', (req, res) => res.send('ok'));
app.head('/v1.0', (req, res) => res.sendStatus(200));
app.get('/v1.0', (req, res) => {
  res.json({
    status: 'ok',
    service: 'golc-home-lab',
    api: 'v1.0'
  });
});
app.use('/', authRouter);
app.use('/', internalRouter);
app.use('/api/yandex', apiYandexBridge);
app.use('/v1.0', devicesRouter);

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
