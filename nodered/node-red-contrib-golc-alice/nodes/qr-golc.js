// qr-golc.js — Node-RED нода: рисует QR-код через встроенный HTTP endpoint
// Не требует внешних зависимостей: QR генерируется на клиенте через qrcode.js (CDN)

module.exports = function (RED) {
  'use strict';

  function QrGolcNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.title   = config.title   || 'QR авторизация';
    node.width   = parseInt(config.width)  || 300;
    node.height  = parseInt(config.height) || 300;
    node.bgColor = config.bgColor || '#ffffff';
    node.fgColor = config.fgColor || '#000000';
    node.autoOpen = config.autoOpen !== false;

    // Текущий URL для QR (из последнего сообщения)
    let currentUrl = '';
    let currentStep = '';

    // --- HTTP endpoint: отдаёт HTML страницу с QR ---
    RED.httpAdmin.get('/golc-qr/:id', RED.auth.needsPermission(''), function (req, res) {
      const n = RED.nodes.getNode(req.params.id);
      if (!n) {
        res.status(404).send('Node not found');
        return;
      }
      const url   = n._qrUrl   || '';
      const step  = n._qrStep  || '';
      const title = n.title;
      const w     = n.width;
      const h     = n.height;
      const bg    = n.bgColor;
      const fg    = n.fgColor;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(`<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    body{margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
         min-height:100vh;background:${bg};font-family:sans-serif;color:#333}
    h2{margin:0 0 12px;font-size:18px;text-align:center}
    #qrbox{padding:16px;background:#fff;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.15)}
    canvas{display:block}
    #step{margin-top:12px;font-size:13px;color:#666;text-align:center;max-width:320px}
    #url-text{margin-top:8px;font-size:12px;color:#999;word-break:break-all;text-align:center;max-width:320px}
    #status{margin-top:10px;font-size:14px;font-weight:bold;color:#1a7f37}
    button{margin-top:16px;padding:8px 24px;font-size:14px;border:none;border-radius:6px;
           background:#fc3f1d;color:#fff;cursor:pointer}
    button:hover{background:#e03516}
    #empty{color:#999;font-size:15px}
  </style>
</head>
<body>
  <h2>${title}</h2>
  <div id="qrbox">
    <div id="empty" style="display:${url ? 'none' : 'block'};width:${w}px;text-align:center;padding:40px 0">
      Ожидание URL…
    </div>
    <canvas id="qrcanvas" style="display:${url ? 'block' : 'none'}"></canvas>
  </div>
  <div id="step">${step}</div>
  <div id="url-text">${url ? '<a href="'+url+'" target="_blank">'+url+'</a>' : ''}</div>
  <div id="status"></div>
  <button onclick="location.reload()">Обновить</button>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
  <script>
    const QR_URL = ${JSON.stringify(url)};
    const W = ${w}, H = ${h};
    const FG = ${JSON.stringify(fg)};
    const BG = ${JSON.stringify(bg)};

    if (QR_URL) {
      const canvas = document.getElementById('qrcanvas');
      canvas.width  = W;
      canvas.height = H;

      // qrcodejs рисует в div — перехватываем через временный контейнер
      const tmp = document.createElement('div');
      tmp.style.display = 'none';
      document.body.appendChild(tmp);

      new QRCode(tmp, {
        text: QR_URL,
        width: W,
        height: H,
        colorDark: FG,
        colorLight: BG,
        correctLevel: QRCode.CorrectLevel.M
      });

      // Ждём пока qrcodejs создаст canvas/img
      setTimeout(function () {
        const src = tmp.querySelector('canvas') || tmp.querySelector('img');
        if (src) {
          const ctx = canvas.getContext('2d');
          if (src.tagName === 'CANVAS') {
            ctx.drawImage(src, 0, 0, W, H);
          } else {
            src.onload = function() { ctx.drawImage(src, 0, 0, W, H); };
          }
        }
        document.body.removeChild(tmp);
      }, 200);
    }

    // Авто-обновление каждые 5 сек пока URL не появится
    if (!QR_URL) {
      setTimeout(function(){ location.reload(); }, 5000);
    }
  </script>
</body>
</html>`);
    });

    // --- Обработка входящих сообщений ---
    node.on('input', function (msg) {
      // Принимаем: msg.qrText / msg.verification_url / msg.payload (строка)
      const url =
        msg.qrText ||
        msg.verification_url ||
        (typeof msg.payload === 'string' ? msg.payload : '');

      const step = msg.step || msg.user_code
        ? `Шаг: ${msg.step || ''}${msg.user_code ? '  |  Код: ' + msg.user_code : ''}`
        : '';

      node._qrUrl  = url;
      node._qrStep = step;

      if (url) {
        node.status({ fill: 'green', shape: 'dot', text: 'URL получен' });
      } else {
        node.status({ fill: 'grey', shape: 'ring', text: 'нет URL' });
      }

      // Передаём дальше без изменений
      node.send(msg);
    });

    node.on('close', function () {
      node._qrUrl  = '';
      node._qrStep = '';
      node.status({});
    });
  }

  RED.nodes.registerType('qr-golc', QrGolcNode);
};
