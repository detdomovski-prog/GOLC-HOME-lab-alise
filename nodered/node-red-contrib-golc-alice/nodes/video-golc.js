/**
 * video-golc — нода потокового видео с камеры устройства Алисы
 *
 * Тип: devices.capabilities.video_stream
 * Предоставляет HLS видео поток с камеры для интеграции с Алисой
 *
 * Параметры:
 *   - Профиль устройства (device-profile-golc)
 *   - URL видео потока (HLS, m3u8)
 *   - Протокол (HLS по умолчанию)
 *
 * Входящие сообщения: не требуются (ноды без входов)
 * Исходящие сообщения: не генерирует (ноды без выходов)
 *
 * Зарегистрирует потоковое видео на бэкенде при инициализации
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
  function VideoGolcNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    const profile = RED.nodes.getNode(config.deviceProfile);

    node.protocol  = config.protocol || 'hls';
    node.streamUrl = config.streamUrl || '';

    function resolveDeviceId() {
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

    function registerVideoStream() {
      const backend  = resolveBackend();
      const deviceId = resolveDeviceId();

      if (!deviceId) {
        node.status({ fill: 'red', shape: 'ring', text: 'нет ID устройства' });
        node.error('Не задан ID устройства. Проверьте профиль device-profile-golc.');
        return;
      }

      if (!node.streamUrl) {
        node.status({ fill: 'yellow', shape: 'ring', text: 'нет URL потока' });
        return;
      }

      node.status({ fill: 'blue', shape: 'dot', text: 'регистрация видео...' });

      const videoState = {
        get_stream: {
          stream_url: node.streamUrl,
          protocol: node.protocol
        }
      };

      const url = `${backend.url}/internal/devices/${encodeURIComponent(deviceId)}/state`;
      requestJson(
        'POST', url,
        { 'X-Internal-Token': backend.token },
        { state: videoState },
        2000
      )
        .then((response) => {
          const urlPreview = node.streamUrl.length > 30 
            ? node.streamUrl.substring(0, 27) + '...' 
            : node.streamUrl;
          node.status({ fill: 'green', shape: 'dot', text: urlPreview });
          node.debug(`Видео поток зарегистрирован: ${response.statusCode}`);
        })
        .catch((err) => {
          if (err.message === 'TIMEOUT') {
            const urlPreview = node.streamUrl.length > 30 
              ? node.streamUrl.substring(0, 27) + '...' 
              : node.streamUrl;
            node.status({ fill: 'yellow', shape: 'ring', text: `таймаут: ${urlPreview}` });
            node.debug('Таймаут при регистрации видео потока (может быть в норме)');
          } else {
            node.status({ fill: 'red', shape: 'ring', text: 'ошибка' });
            node.error(`Ошибка регистрации видео: ${err.message}`);
          }
        });
    }

    // Попытка регистрации при загрузке ноды
    setTimeout(registerVideoStream, 1000);

    // Переоткрытие при изменении профиля в процессе работы (редко)
    profile.on('profileUpdated', () => {
      setTimeout(registerVideoStream, 500);
    });

    node.on('close', () => { 
      node.status({}); 
    });
  }

  RED.nodes.registerType('video-golc', VideoGolcNode);
};
