/**
 * color-golc — нода управления цветом устройства Алисы
 *
 * Тип: devices.capabilities.color_setting
 * Управляет RGB/HSV цветом, белой температурой и цветовыми сценами
 *
 * Входящий msg (select по типу msg.payload):
 *   - RGB объект: { r: 0-255, g: 0-255, b: 0-255 }
 *   - HSV объект: { h: 0-360, s: 0-100, v: 0-100 }
 *   - Temperature: число 2000-9000 K
 *   - Scene: строка из списка (alarm, alice, candle, dinner, fantasy, garland, jungle, movie, neon, night, ocean, party, reading, rest, romance, siren, sunrise, sunset)
 *
 * Выходы (3 порта):
 *   Порт 0: RGB/HSV цвет при изменении
 *   Порт 1: Белая температура (K) при изменении
 *   Порт 2: Сцена (строка) при изменении
 *
 * Исходящий msg:
 *   msg.payload    = отправленное значение
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
  function ColorGolcNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    const profile = RED.nodes.getNode(config.deviceProfile);

    node.colorSupport    = config.colorSupport === true || config.colorSupport === 'true';
    node.scheme          = node.colorSupport ? (config.scheme || 'rgb') : null;
    node.tempSupport     = config.tempSupport === true || config.tempSupport === 'true';
    node.tempMin         = Math.max(2000, parseInt(config.tempMin) || 2000);
    node.tempMax         = Math.min(9000, parseInt(config.tempMax) || 9000);
    node.scenes          = config.scenes || [];
    node.alwaysSuccess   = config.alwaysSuccess === true || config.alwaysSuccess === 'true';

    // Кэш последних значений для защиты от дублирования
    let lastRgbValue  = null;
    let lastTempValue = null;
    let lastSceneValue = null;

    const VALID_SCENES = [
      'alarm', 'alice', 'candle', 'dinner', 'fantasy', 'garland',
      'jungle', 'movie', 'neon', 'night', 'ocean', 'party',
      'reading', 'rest', 'romance', 'siren', 'sunrise', 'sunset'
    ];

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

    // Преобразование RGB объекта в 24-bit число
    function rgbToNumber(rgb) {
      const r = Math.max(0, Math.min(255, parseInt(rgb.r) || 0));
      const g = Math.max(0, Math.min(255, parseInt(rgb.g) || 0));
      const b = Math.max(0, Math.min(255, parseInt(rgb.b) || 0));
      return (r << 16) | (g << 8) | b;
    }

    // Преобразование 24-bit числа в RGB объект
    function numberToRgb(num) {
      return {
        r: (num >> 16) & 0xFF,
        g: (num >> 8) & 0xFF,
        b: num & 0xFF
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

      const payload = msg.payload;
      const outmsgs = [null, null, null]; // [color, temperature, scene]
      let stateToSend = null;
      let displayText = '';

      try {
        // Определяем тип входящего значения и валидируем
        if (typeof payload === 'object' && payload !== null) {
          // Проверяем RGB объект
          if ('r' in payload && 'g' in payload && 'b' in payload) {
            if (!node.colorSupport) {
              node.status({ fill: 'yellow', shape: 'ring', text: 'RGB отключён' });
              return done(new Error('Поддержка RGB отключена в конфигурации'));
            }
            const rgbNum = rgbToNumber(payload);
            if (rgbNum === lastRgbValue) {
              node.debug('RGB значение не изменилось');
              return done();
            }
            stateToSend = { rgb: rgbNum };
            outmsgs[0] = { payload };
            lastRgbValue = rgbNum;
            displayText = `RGB(${payload.r},${payload.g},${payload.b})`;
          }
          // Проверяем HSV объект
          else if ('h' in payload && 's' in payload && 'v' in payload) {
            if (!node.colorSupport) {
              node.status({ fill: 'yellow', shape: 'ring', text: 'HSV отключён' });
              return done(new Error('Поддержка HSV отключена в конфигурации'));
            }
            if (JSON.stringify(payload) === JSON.stringify(lastRgbValue)) {
              node.debug('HSV значение не изменилось');
              return done();
            }
            stateToSend = { hsv: payload };
            outmsgs[0] = { payload };
            lastRgbValue = payload;
            displayText = `HSV(${payload.h}°,${payload.s}%,${payload.v}%)`;
          } else {
            node.status({ fill: 'yellow', shape: 'ring', text: 'неверный объект' });
            return done(new Error('RGB объект требует {r,g,b} или HSV требует {h,s,v}'));
          }
        }
        // Число = белая температура
        else if (typeof payload === 'number') {
          if (!node.tempSupport) {
            node.status({ fill: 'yellow', shape: 'ring', text: 'температура отключена' });
            return done(new Error('Поддержка температуры отключена в конфигурации'));
          }
          const temp = Math.round(payload);
          if (temp < node.tempMin || temp > node.tempMax) {
            node.status({ fill: 'yellow', shape: 'ring', text: `${temp}K вне диапазона` });
            return done(new Error(`Температура ${temp}K вне диапазона [${node.tempMin}, ${node.tempMax}]`));
          }
          if (temp === lastTempValue) {
            node.debug('Температура не изменилась');
            return done();
          }
          stateToSend = { temperature_k: temp };
          outmsgs[1] = { payload: temp };
          lastTempValue = temp;
          displayText = `Темп: ${temp}K`;
        }
        // Строка = сцена
        else if (typeof payload === 'string') {
          if (node.scenes.length === 0) {
            node.status({ fill: 'yellow', shape: 'ring', text: 'сцены отключены' });
            return done(new Error('Сцены отключены в конфигурации'));
          }
          const scene = String(payload).trim();
          if (!node.scenes.includes(scene)) {
            node.status({ fill: 'yellow', shape: 'ring', text: 'сцена не в списке' });
            return done(new Error(`Сцена "${scene}" не в списке разрешённых`));
          }
          if (scene === lastSceneValue) {
            node.debug('Сцена не изменилась');
            return done();
          }
          stateToSend = { scene: scene };
          outmsgs[2] = { payload: scene };
          lastSceneValue = scene;
          displayText = `Сцена: ${scene}`;
        } else {
          node.status({ fill: 'yellow', shape: 'ring', text: 'неверный тип' });
          return done(new Error(`Неподдерживаемый тип payload: ${typeof payload}`));
        }

        node.status({ fill: 'blue', shape: 'dot', text: `отправка... ${displayText}` });

        // Отправляем на бэкенд
        const url = `${backend.url}/internal/devices/${encodeURIComponent(deviceId)}/state`;
        const response = await requestJson(
          'POST', url,
          { 'X-Internal-Token': backend.token },
          { state: stateToSend },
          2000
        );

        node.status({ fill: 'green', shape: 'dot', text: displayText });

        // Отправляем на выходы (с инфо о статусе)
        outmsgs.forEach((m, idx) => {
          if (m) {
            m.statusCode = response.statusCode;
            m.backendResponse = response.body;
          }
        });
        sender(outmsgs);
        done();

      } catch (err) {
        if (err.message === 'TIMEOUT' && node.alwaysSuccess) {
          node.status({ fill: 'yellow', shape: 'ring', text: `авто-ответ ${displayText}` });
          outmsgs.forEach((m, idx) => {
            if (m) {
              m.statusCode = 200;
              m.aliceResponse = { status: 'ok' };
            }
          });
          sender(outmsgs);
          done();
        } else {
          node.status({ fill: 'red', shape: 'ring', text: 'ошибка' });
          done(err);
        }
      }
    });

    node.on('close', () => { node.status({}); });
  }

  RED.nodes.registerType('color-golc', ColorGolcNode);
};
