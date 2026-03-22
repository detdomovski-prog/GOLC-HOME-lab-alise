/**
 * golc-auth-simple.js
 * 
 * Упрощённая авторизация в Node-RED
 * Не занимается OAuth — просто берёт access_token из backend'а
 * и сохраняет его локально
 */

module.exports = function (RED) {
  function GolcAuthSimpleNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Конфиг
    node.backendUrl = config.backendUrl || 'http://localhost:3000';
    node.username = config.username || '';
    
    // Credentials
    node.password = (node.credentials && node.credentials.password) || '';
    node.accessToken = (node.credentials && node.credentials.accessToken) || '';
    node.userId = (node.credentials && node.credentials.userId) || '';

    /**
     * Попытка авторизации через backend
     */
    async function authenticate() {
      if (!node.username || !node.password) {
        node.status({ fill: 'red', shape: 'ring', text: 'missing credentials' });
        return null;
      }

      try {
        const response = await fetch(`${node.backendUrl}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: node.username,
            password: node.password
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (!data.ok || !data.access_token) {
          throw new Error('Invalid response from backend');
        }

        // Сохраняем локально
        node.credentials.accessToken = data.access_token;
        node.credentials.userId = data.user_id;
        node.accessToken = data.access_token;
        node.userId = data.user_id;

        node.status({
          fill: 'green',
          shape: 'dot',
          text: `✓ ${data.user_id}`
        });

        RED.nodes.addCredentials(node.id, node.credentials);
        return data;
      } catch (error) {
        node.status({
          fill: 'red',
          shape: 'ring',
          text: `auth error: ${error.message}`
      }
    }

    // На входящее сообщение → отправляем access_token
    node.on('input', async (msg, send, done) => {
      const sender = send || node.send.bind(node);

      try {
        // Если нет токена → пытаемся авторизоваться
        if (!node.accessToken) {
          const authResult = await authenticate();
          if (!authResult) {
            done(new Error('Не удалось авторизоваться'));
            return;
          }
        }

        // Отправляем сообщение с токеном
        msg.access_token = node.accessToken;
        msg.user_id = node.userId;
        msg.payload = {
          access_token: node.accessToken,
          user_id: node.userId,
          status: 'authorized'
        };

        sender(msg);
        done();
      } catch (error) {
        done(error);
      }
    });

    // Инициализация
    node.status({
      fill: node.accessToken ? 'green' : 'yellow',
      shape: 'ring',
      text: node.accessToken ? `✓ ${node.userId}` : 'waiting'
    });
  }

  RED.nodes.registerType('golc-auth-simple', GolcAuthSimpleNode, {
    credentials: {
      password: { type: 'password' },
      accessToken: { type: 'password' },
      userId: { type: 'text' }
    }
  });
};
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
