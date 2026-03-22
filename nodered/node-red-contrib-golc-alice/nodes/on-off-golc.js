/**
 * on-off-golc — нода управления устройством Алисы (вкл/выкл)
 *
 * Режимы Split button (splitButton: true/false):
 *  - false → переключатель: входящий msg определяет on/off (msg.payload = true/false/"on"/"off", msg.command = "on"/"off")
 *  - true  → кнопка: любой входящий сигнал = нажатие (действие "button press" по документации Яндекс)
 *
 * Response (alwaysSuccess: true):
 *  Если бэкенд не ответил в течение 2 секунд — нода сама возвращает
 *  подтверждение успеха в умение Алисы (msg.aliceResponse = { status: 'ok' })
 *
 * Входящий msg:
 *   msg.payload = true / false / "on" / "off" / 1 / 0
 *   msg.command = "on" / "off"   (приоритет над payload при splitButton=false)
 *   msg.deviceId — переопределяет ID устройства из конфига
 */

const http  = require('http');
const https = require('https');

// ── Вспомогательные функции ─────────────────────────────────────────────────

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number')  return value !== 0;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    return s === 'on' || s === 'true' || s === '1';
  }
  return null; // невозможно определить
}

function requestJson(method, targetUrl, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    let finished = false;

    const parsed  = new URL(targetUrl);
    const lib     = parsed.protocol === 'https:' ? https : http;
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
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          if (finished) return;
          clearTimeout(timer);
          finished = true;
          try {
            resolve({ statusCode: res.statusCode, body: raw ? JSON.parse(raw) : {} });
          } catch (e) {
            reject(e);
          }
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

// ── Регистрация ноды ─────────────────────────────────────────────────────────

module.exports = function (RED) {
  function OnOffGolcNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Ссылка на config-node профиля устройства
    const profile = RED.nodes.getNode(config.deviceProfile);

    node.splitButton  = config.splitButton  === true || config.splitButton  === 'true';
    node.alwaysSuccess = config.alwaysSuccess === true || config.alwaysSuccess === 'true';

    // Идентификатор устройства формируется из имени + комнаты конфига
    function resolveDeviceId(msg) {
      if (msg.deviceId) return String(msg.deviceId).trim();
      if (!profile) return '';
      // ID = sanitized(room + '_' + name), строчные буквы, без пробелов
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

    // Отправить состояние on/off на бэкенд
    async function sendState(deviceId, state, backend) {
      const url = `${backend.url}/internal/devices/${encodeURIComponent(deviceId)}/state`;
      return requestJson(
        'POST',
        url,
        { 'X-Internal-Token': backend.token },
        { state },
        2000  // 2 секунды таймаут
      );
    }

    // Отправить событие нажатия кнопки (split = button mode)
    async function sendButtonPress(deviceId, backend) {
      const url = `${backend.url}/internal/devices/${encodeURIComponent(deviceId)}/state`;
      return requestJson(
        'POST',
        url,
        { 'X-Internal-Token': backend.token },
        { state: { button_pressed: true } },
        2000
      );
    }

    node.on('input', async (msg, send, done) => {
      const sender  = send  || node.send.bind(node);
      const backend = resolveBackend();
      const deviceId = resolveDeviceId(msg);

      if (!deviceId) {
        node.status({ fill: 'red', shape: 'ring', text: 'нет ID устройства' });
        return done(new Error('Не задан ID устройства. Проверьте профиль device-profile-golc.'));
      }

      node.status({ fill: 'blue', shape: 'dot', text: 'отправка...' });

      try {
        let response;

        if (node.splitButton) {
          // ── Режим КНОПКА: нажатие (button press) ──────────────────────────
          response = await sendButtonPress(deviceId, backend);
          node.status({ fill: 'green', shape: 'dot', text: 'нажато' });
        } else {
          // ── Режим ПЕРЕКЛЮЧАТЕЛЬ: on / off ──────────────────────────────────
          // Приоритет: msg.command → msg.payload
          const raw  = msg.command !== undefined ? msg.command : msg.payload;
          const onOff = toBoolean(raw);

          if (onOff === null) {
            node.status({ fill: 'yellow', shape: 'ring', text: 'неверный payload' });
            return done(new Error(
              `Невозможно определить on/off из msg.payload="${raw}". ` +
              'Используйте true/false, "on"/"off", 1/0 или msg.command.'
            ));
          }

          response = await sendState(deviceId, { on: onOff }, backend);
          node.status({ fill: 'green', shape: 'dot', text: onOff ? 'вкл' : 'выкл' });
        }

        msg.payload    = response.body;
        msg.statusCode = response.statusCode;
        sender(msg);
        done();

      } catch (err) {
        if (err.message === 'TIMEOUT' && node.alwaysSuccess) {
          // Response-режим: устройство не ответило за 2 сек → авто-подтверждение
          node.status({ fill: 'yellow', shape: 'ring', text: 'авто-ответ Алисе' });
          msg.payload       = { status: 'ok', source: 'auto-response' };
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

    node.on('close', () => {
      node.status({});
    });
  }

  RED.nodes.registerType('on-off-golc', OnOffGolcNode);
};
