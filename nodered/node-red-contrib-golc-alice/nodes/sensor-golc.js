/**
 * sensor-golc — нода датчиков устройства Алисы
 *
 * Тип: devices.properties.float
 *
 * Входящий msg:
 *   msg.payload = number (значение датчика)
 *   msg.deviceId = string (опционально, переопределить ID устройства)
 *
 * Логика:
 *   - проверяет что payload число
 *   - округляет значение по типу unit
 *   - не отправляет повтор того же значения чаще, чем раз в 10 минут
 *   - отправляет в backend: POST /internal/devices/:id/state
 *   - при timeout 2 сек и включённом alwaysSuccess отправляет авто-ответ Алисе
 */

const http = require('http');
const https = require('https');

function requestJson(method, targetUrl, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const parsed = new URL(targetUrl);
    const lib = parsed.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        reject(new Error('TIMEOUT'));
      }
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
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          if (finished) return;
          clearTimeout(timer);
          finished = true;
          try {
            resolve({ statusCode: res.statusCode, body: raw ? JSON.parse(raw) : {} });
          } catch (error) {
            reject(error);
          }
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

function roundByUnit(value, unit) {
  if (unit === 'unit.temperature.celsius' || unit === 'unit.ampere' || unit === 'unit.pressure.bar') {
    return +Number(value).toFixed(1);
  }
  return +Number(value).toFixed(0);
}

module.exports = function (RED) {
  function SensorGolcNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    const profile = RED.nodes.getNode(config.deviceProfile);

    node.instance = config.instance || 'temperature';
    node.unit = config.unit || 'unit.temperature.celsius';
    node.alwaysSuccess = config.alwaysSuccess === true || config.alwaysSuccess === 'true';

    let currentValue = null;
    let lastUpdateTime = 0;
    const UPDATE_INTERVAL = 10 * 60 * 1000;

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
        url: (profile.credentials.backendUrl || 'http://localhost:3000').replace(/\/$/, ''),
        token: profile.credentials.internalToken || 'local-internal-token'
      };
    }

    node.on('input', async (msg, send, done) => {
      const sender = send || node.send.bind(node);
      const backend = resolveBackend();
      const deviceId = resolveDeviceId(msg);

      if (!deviceId) {
        node.status({ fill: 'red', shape: 'ring', text: 'нет ID устройства' });
        return done(new Error('Не задан ID устройства. Проверьте профиль device-profile-golc.'));
      }

      if (typeof msg.payload !== 'number') {
        node.status({ fill: 'yellow', shape: 'ring', text: 'payload не число' });
        return done(new Error(`msg.payload должен быть number, получено: ${typeof msg.payload}`));
      }

      const roundedValue = roundByUnit(msg.payload, node.unit);
      const timeSinceLastUpdate = Date.now() - lastUpdateTime;

      if (currentValue === roundedValue && timeSinceLastUpdate < UPDATE_INTERVAL) {
        node.debug('Значение не изменилось, отправка пропущена');
        return done();
      }

      node.status({ fill: 'blue', shape: 'dot', text: 'отправка...' });

      try {
        const state = {};
        state[node.instance] = roundedValue;

        const url = `${backend.url}/internal/devices/${encodeURIComponent(deviceId)}/state`;
        const response = await requestJson(
          'POST',
          url,
          { 'X-Internal-Token': backend.token },
          { state },
          2000
        );

        currentValue = roundedValue;
        lastUpdateTime = Date.now();

        node.status({ fill: 'green', shape: 'dot', text: `${node.instance}: ${roundedValue}` });

        msg.payload = roundedValue;
        msg.statusCode = response.statusCode;
        msg.backendResponse = response.body;
        sender(msg);
        done();
      } catch (error) {
        if (error.message === 'TIMEOUT' && node.alwaysSuccess) {
          currentValue = roundedValue;
          lastUpdateTime = Date.now();

          node.status({ fill: 'yellow', shape: 'ring', text: 'авто-ответ Алисе' });
          msg.payload = roundedValue;
          msg.statusCode = 200;
          msg.aliceResponse = { status: 'ok' };
          sender(msg);
          done();
        } else {
          node.status({ fill: 'red', shape: 'ring', text: 'ошибка' });
          done(error);
        }
      }
    });

    node.on('close', () => {
      node.status({});
    });
  }

  RED.nodes.registerType('sensor-golc', SensorGolcNode);
};
