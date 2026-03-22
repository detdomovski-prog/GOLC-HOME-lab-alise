/**
 * golc-auth-simple — простая аутентификация Яндекс.ID для Алисы
 *
 * Входящий msg:
 *   msg.payload.login — логин Яндекс (опционально)
 *   msg.payload.password — пароль (опционально)
 *
 * Выходящий msg:
 *   msg.token — авторизационный токен (если успешно)
 *   msg.user_id — ID пользователя Яндекса
 *   msg.account_email — email аккаунта
 *   msg.statusCode — HTTP статус
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
          'Content-Type': 'application/json',
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

module.exports = function (RED) {
  function GolcAuthSimpleNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.backendUrl = (config.backendUrl || 'http://localhost:3000').replace(/\/$/, '');
    node.authEndpoint = config.authEndpoint || '/alice/auth';
    node.alwaysSuccess = config.alwaysSuccess === true || config.alwaysSuccess === 'true';

    node.on('input', async (msg, send, done) => {
      const sender = send || node.send.bind(node);

      try {
        // Берём логин и пароль из msg.payload или конфига
        const login = (msg.payload?.login || msg.login || '').trim();
        const password = (msg.payload?.password || msg.password || '').trim();

        if (!login || !password) {
          node.status({ fill: 'yellow', shape: 'ring', text: 'требуется логин и пароль' });
          return done(new Error('msg.payload должен содержать {login, password}'));
        }

        node.status({ fill: 'blue', shape: 'dot', text: 'аутентификация...' });

        // Отправляем запрос на бэкенд для аутентификации
        const url = `${node.backendUrl}${node.authEndpoint}`;
        const response = await requestJson(
          'POST', url,
          {},
          { login, password },
          3000
        );

        if (response.statusCode === 200 && response.body) {
          const { access_token, user_id, account_email } = response.body;

          if (!access_token) {
            node.status({ fill: 'yellow', shape: 'ring', text: 'токен не получен' });
            return done(new Error('Бэкенд не вернул токен'));
          }

          node.status({
            fill: 'green',
            shape: 'dot',
            text: `✓ ${account_email || login}`
          });

          msg.token = access_token;
          msg.user_id = user_id;
          msg.account_email = account_email;
          msg.statusCode = 200;
          msg.authResult = response.body;

          sender(msg);
          done();

        } else if (response.statusCode === 401) {
          node.status({ fill: 'red', shape: 'ring', text: 'неверные учётные данные' });
          done(new Error('Неверный логин или пароль'));
        } else {
          node.status({ fill: 'red', shape: 'ring', text: `ошибка ${response.statusCode}` });
          done(new Error(`Бэкенд вернул ${response.statusCode}: ${JSON.stringify(response.body)}`));
        }

      } catch (err) {
        if (err.message === 'TIMEOUT' && node.alwaysSuccess) {
          node.status({ fill: 'yellow', shape: 'ring', text: 'таймаут (авто-ответ)' });
          msg.statusCode = 200;
          msg.aliceResponse = { status: 'ok' };
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

  RED.nodes.registerType('golc-auth-simple', GolcAuthSimpleNode);
};
