/**
 * range-golc — нода управления диапазонными параметрами устройства Алисы
 *
 * Поддерживает: яркость, громкость, канал, влажность, открытие, температура
 *
 * Алиса может отправить:
 *  - абсолютное значение: { value: 50 }
 *  - относительное: { value: 10, relative: true } → "прибавь на 10"
 *
 * Входящий msg:
 *   msg.payload  = число (абсолютное значение для отчёта устройства)
 *   msg.deviceId = переопределить ID устройства из профиля
 *
 * Исходящий msg:
 *   msg.payload  = абсолютное число (уже вычисленное если было relative)
 *   msg.relative = true/false — была ли команда относительной
 */

const http  = require('http');
const https = require('https');

function requestJson(method, targetUrl, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const parsed  = new URL(targetUrl);
    const lib     = parsed.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;

    const timer = setTimeout(() => {
      if (!finished) { finished = true; reject(new Error('TIMEOUT')); }
    }, timeoutMs || 5000);

    const req = lib.request(
      {
        method,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        headers: {
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
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
          try { resolve({ statusCode: res.statusCode, body: raw ? JSON.parse(raw) : {} }); }
          catch (e) { reject(e); }
        });
      }
    );
    req.on('error', (err) => {
      if (finished) return;
      clearTimeout(timer);
      finished = true;
      reject(err);
    });
    if (payload) req.write(payload);
    req.end();
  });
}

// Конфигурация по умолчанию для каждого типа диапазона
const INSTANCE_DEFAULTS = {
  brightness:  { unit: 'unit.percent',             min: 0,   max: 100,  precision: 10 },
  volume:      { unit: 'unit.number',              min: 0,   max: 100,  precision: 10 },
  channel:     { unit: 'unit.number',              min: 1,   max: 1000, precision: 1  },
  humidity:    { unit: 'unit.percent',             min: 0,   max: 100,  precision: 10 },
  open:        { unit: 'unit.percent',             min: 0,   max: 100,  precision: 10 },
  temperature: { unit: 'unit.temperature.celsius', min: 0,   max: 100,  precision: 1  }
};

module.exports = function (RED) {
  function RangeGolcNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    const profile = RED.nodes.getNode(config.deviceProfile);

    node.instance     = config.instance     || 'brightness';
    node.retrievable  = config.retrievable  !== false; // true = хранить значение
    node.alwaysSuccess = config.alwaysSuccess === true || config.alwaysSuccess === 'true';

    // min / max / precision / unit — берём из конфига или defaults
    const def = INSTANCE_DEFAULTS[node.instance] || INSTANCE_DEFAULTS.brightness;
    node.unit      = config.unit      || def.unit;
    node.min       = parseFloat(config.min)       || def.min;
    node.max       = parseFloat(config.max)       || def.max;
    node.precision = parseFloat(config.precision) || def.precision;

    // текущее сохранённое значение (для вычисления relative)
    let currentValue = null;

    function resolveDeviceId(msg) {
      if (msg.deviceId) return String(msg.deviceId).trim();
      if (!profile) return '';
      const room = (profile.deviceRoom || 'room').toLowerCase().replace(/\s+/g, '_');
      const name = (profile.deviceName || 'device').toLowerCase().replace(/\s+/g, '_');
      return `${room}_${name}`;
    }

    function resolveBackend() {
      if (!profile) return { url: 'http://localhost:3000', token: 'local-internal-token' };
      return {
        url:   (profile.credentials.backendUrl    || 'http://localhost:3000').replace(/\/$/, ''),
        token: (profile.credentials.internalToken || 'local-internal-token')
      };
    }

    // Нода получила команду от Алисы (через backend → Node-RED)
    // msg.payload = абсолютное значение которое нужно отправить в flow
    // msg.payload + msg.relative = true → относительное, нода вычисляет абсолют

    node.on('input', async (msg, send, done) => {
      const sender   = send || node.send.bind(node);
      const backend  = resolveBackend();
      const deviceId = resolveDeviceId(msg);

      if (!deviceId) {
        node.status({ fill: 'red', shape: 'ring', text: 'нет ID устройства' });
        return done(new Error('Не задан ID устройства. Проверьте профиль device-profile-golc.'));
      }

      const rawValue = msg.payload;
      if (typeof rawValue !== 'number') {
        node.status({ fill: 'yellow', shape: 'ring', text: 'payload не число' });
        return done(new Error(`msg.payload должен быть числом, получено: ${typeof rawValue}`));
      }

      // Вычисляем абсолютное значение (если команда относительная)
      let absValue = rawValue;
      const isRelative = msg.relative === true;

      if (isRelative && node.retrievable && currentValue !== null) {
        absValue = currentValue + rawValue;
        if (rawValue < 0 && absValue < node.min) absValue = node.min;
        if (rawValue > 0 && absValue > node.max) absValue = node.max;
      }

      node.status({ fill: 'blue', shape: 'dot', text: 'отправка...' });

      try {
        const state = {};
        state[node.instance] = absValue;

        const url = `${backend.url}/internal/devices/${encodeURIComponent(deviceId)}/state`;
        const response = await requestJson(
          'POST', url,
          { 'X-Internal-Token': backend.token },
          { state },
          2000
        );

        if (node.retrievable) currentValue = absValue;

        node.status({ fill: 'green', shape: 'dot', text: `${node.instance}: ${absValue}` });
        msg.payload    = absValue;
        msg.relative   = isRelative;
        msg.statusCode = response.statusCode;
        msg.backendResponse = response.body;
        sender(msg);
        done();

      } catch (err) {
        if (err.message === 'TIMEOUT' && node.alwaysSuccess) {
          node.status({ fill: 'yellow', shape: 'ring', text: 'авто-ответ Алисе' });
          msg.payload       = absValue;
          msg.relative      = isRelative;
          msg.aliceResponse = { status: 'ok' };
          msg.statusCode    = 200;
          sender(msg);
          done();
        } else {
          node.status({ fill: 'red', shape: 'ring', text: 'ошибка' });
          done(err);
        }
      }
    });

    node.on('close', () => { node.status({}); });
  }

  RED.nodes.registerType('range-golc', RangeGolcNode);
};
