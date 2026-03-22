module.exports = function (RED) {
  function GolcAuthSimpleNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.backendUrl = (config.backendUrl || 'http://127.0.0.1:3001').trim();
    node.username = (config.username || '').trim();

    node.password = (node.credentials && node.credentials.password) || '';
    node.accessToken = (node.credentials && node.credentials.accessToken) || '';
    node.userId = (node.credentials && node.credentials.userId) || '';

    async function authenticate() {
      if (!node.username || !node.password) {
        node.status({ fill: 'red', shape: 'ring', text: 'нужны логин/пароль' });
        return null;
      }

      const baseUrl = (node.backendUrl || 'http://127.0.0.1:3001').replace(/\/$/, '');

      try {
        const response = await fetch(`${baseUrl}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: node.username,
            password: node.password
          })
        });

        let data = {};
        try {
          data = await response.json();
        } catch (_err) {
          data = {};
        }

        if (!response.ok) {
          throw new Error((data && data.error) || `HTTP ${response.status}`);
        }

        if (!data.ok || !data.access_token) {
          throw new Error('Неверный ответ от backend');
        }

        node.credentials.accessToken = data.access_token;
        node.credentials.userId = data.user_id || '';
        node.accessToken = data.access_token;
        node.userId = data.user_id || '';
        RED.nodes.addCredentials(node.id, node.credentials);

        node.status({
          fill: 'green',
          shape: 'dot',
          text: node.userId ? `✓ ${node.userId}` : '✓ authorized'
        });

        return data;
      } catch (error) {
        node.status({ fill: 'red', shape: 'ring', text: `auth error: ${error.message}` });
        return null;
      }
    }

    node.on('input', async (msg, send, done) => {
      const sender = send || node.send.bind(node);

      try {
        if (!node.accessToken) {
          const authResult = await authenticate();
          if (!authResult) {
            done(new Error('Не удалось авторизоваться'));
            return;
          }
        }

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

    node.status({
      fill: node.accessToken ? 'green' : 'yellow',
      shape: 'ring',
      text: node.accessToken ? (node.userId ? `✓ ${node.userId}` : '✓ token') : 'ожидание логина'
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
