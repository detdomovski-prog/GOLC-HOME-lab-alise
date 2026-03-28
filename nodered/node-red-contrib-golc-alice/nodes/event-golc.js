/**
 * event-golc — нода событий устройства Алисы
 *
 * Тип: devices.properties.event
 * Отправляет события датчиков встроенных в устройство:
 *   кнопка (click, double_click, long_press),
 *   движение (detected, not_detected),
 *   открытие (opened, closed),
 *   вибрация (tilt, fall, vibration),
 *   дым, газ, утечка воды и уровни батареи/воды
 *
 * Входящий msg:
 *   msg.payload = событие из списка разрешённых (строка)
 *   msg.deviceId — переопределить ID из профиля
 *
 * Исходящий msg:
 *   msg.payload    = событие (строка)
 *   msg.statusCode = HTTP статус ответа бэкенда
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

module.exports = function (RED) {
  function EventGolcNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    const profile = RED.nodes.getNode(config.deviceProfile);

    node.instance   = config.instance || 'button';
    node.events     = config.events   || [];
    node.alwaysSuccess = config.alwaysSuccess === true || config.alwaysSuccess === 'true';

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

    node.on('input', async (msg, send, done) => {
      const sender   = send || node.send.bind(node);
      const backend  = resolveBackend();
      const deviceId = resolveDeviceId(msg);

      if (!deviceId) {
        node.status({ fill: 'red', shape: 'ring', text: 'нет ID устройства' });
        return done(new Error('Не задан ID устройства. Проверьте профиль device-profile-golc.'));
      }

      const val = String(msg.payload).trim();

      // Валидация события: должно быть из списка разрешённых
      if (!node.events.includes(val)) {
        node.status({ fill: 'yellow', shape: 'ring', text: 'событие не в списке' });
        return done(new Error(`Событие "${val}" не в списке разрешённых для ${node.instance}`));
      }

      node.status({ fill: 'blue', shape: 'dot', text: `отправка: ${val}` });

      try {
        const state = {};
        state[node.instance] = val;

        const url = `${backend.url}/internal/devices/${encodeURIComponent(deviceId)}/state`;
        const response = await requestJson(
          'POST', url,
          { 'X-Internal-Token': backend.token },
          { state },
          2000
        );

        node.status({ fill: 'green', shape: 'dot', text: `${node.instance}: ${val}` });

        // Для кнопок обнуляем значение через 1 секунду
        if (node.instance === 'button') {
          setTimeout(async () => {
            try {
              const nullState = {};
              nullState[node.instance] = null;
              await requestJson(
                'POST', url,
                { 'X-Internal-Token': backend.token },
                { state: nullState },
                2000
              );
              node.status({ fill: 'green', shape: 'dot', text: '' });
            } catch (err) {
              node.debug(`Не удалось обнулить событие кнопки: ${err.message}`);
            }
          }, 1000);
        }

        msg.payload    = val;
        msg.statusCode = response.statusCode;
        msg.backendResponse = response.body;
        sender(msg);
        done();

      } catch (err) {
        if (err.message === 'TIMEOUT' && node.alwaysSuccess) {
          node.status({ fill: 'yellow', shape: 'ring', text: 'авто-ответ Алисе' });
          msg.payload       = val;
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

  RED.nodes.registerType('event-golc', EventGolcNode);
};
