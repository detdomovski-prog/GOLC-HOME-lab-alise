# 🚀 Инструкция по развёртыванию GOLC HOME OAuth

## Архитектура (быстро)

```
┌──────────────────┐
│ Яндекс Алиса     │
└────────┬─────────┘
         │ OAuth
         ▼
┌──────────────────────────────────┐
│ Твой OAuth Backend (Node.js)     │ ← backend/oauth/
│ • /oauth/authorize               │
│ • /oauth/token                   │
│ • /v1.0/user/devices             │
│ • /api/login (для Node-RED)      │
└────────┬──────────────────────────┘
         │ HTTP
         ▼
┌──────────────────────────────────┐
│ Node-RED API (Node.js)           │ ← backend/nodered-api/
│ • /api/devices                   │
│ • /api/devices/action            │
└────────┬──────────────────────────┘
         │ MQTT / HTTP
         ▼
┌──────────────────────────────────┐
│ Node-RED (CT112)                 │
│ • golc-auth-simple (авторизация) │
│ • Управление устройствами        │
└──────────────────────────────────┘
```

## 📋 Step-by-Step

### 1️⃣ Подготовка (локально)

```bash
# Клонируешь репо и переходишь в директорию
cd GOLC-HOME-lab-alise

# Устанавливаешь зависимости OAuth backend
cd backend/oauth
npm install

# Устанавливаешь зависимости Node-RED API
cd ../nodered-api
npm install

# Возвращаешься в корень
cd ../..
```

### 2️⃣ Регистрация приложения в Яндекс Диалоги

Это ОДИН РАЗ, потом используешь credentials:

1. Переходишь на https://yandex.ru/dev/dialogs/
2. Заходишь в Консоль разработчика
3. Создаёшь новое приложение (Smart Home)
4. В настройках приложения устанавливаешь:

**OAuth endpoints:**
```
Authorization: https://твой.домен.kz/oauth/authorize
Token: https://твой.домен.kz/oauth/token
User info: https://твой.домен.kz/oauth/userinfo
```

**Smart Home endpoints:**
```
Devices: https://твой.домен.kz/v1.0/user/devices
Devices query: https://твой.домен.kz/v1.0/user/devices/query
Devices action: https://твой.домен.kz/v1.0/user/devices/action
```

5. Копируешь **client_id** и **client_secret**

### 3️⃣ Развёртывание OAuth Backend

#### Вариант A: Локально (для тестирования)

```bash
cd backend/oauth

# Создаёшь .env файл
cp .env.example .env

# Редактируешь .env
nano .env
# Указываешь:
# YANDEX_CLIENT_ID=...
# YANDEX_CLIENT_SECRET=...
# Остальное можно оставить как есть

# Запускаешь
npm start
# Или для разработки с hot reload:
npm install -D nodemon
npm run dev
```

Backend будет запущен на **http://localhost:3000**

#### Вариант B: На сервере (Production)

```bash
# Копируешь папку backend/oauth на сервер
scp -r backend/oauth user@server:/opt/golc-oauth

# На сервере
ssh user@server
cd /opt/golc-oauth
npm install --production

# Создаёшь .env с правильными значениями
cat > .env << EOF
YANDEX_CLIENT_ID=your-client-id
YANDEX_CLIENT_SECRET=your-client-secret
BACKEND_URL=https://твой.домен.kz
NODERED_URL=http://localhost:1881
NODERED_TOKEN=your-secret-token
JWT_SECRET=your-jwt-secret
PORT=3000
EOF

# Запускаешь через PM2
npm install -g pm2
pm2 start server.js --name "golc-oauth"
pm2 save
pm2 startup
```

### 4️⃣ Развёртывание Node-RED API

#### Вариант A: Локально (для тестирования)

```bash
cd backend/nodered-api

cp .env.example .env
# Можешь отредактировать, но по умолчанию работает

npm start
# Запуститься на http://localhost:1881
```

#### Вариант B: На сервере или CT112

```bash
# Копируешь папку
scp -r backend/nodered-api user@server:/opt/golc-nodered-api

ssh user@server
cd /opt/golc-nodered-api
npm install --production

cat > .env << EOF
NODERED_TOKEN=your-secret-token
BACKEND_URL=http://localhost:3000
PORT=1881
EOF

pm2 start server.js --name "golc-nodered-api"
pm2 save
```

### 5️⃣ Обновление Node-RED в CT112

```bash
# На CT112 машине
pct enter 112

# Обновляешь npm пакет
npm install node-red-contrib-golc-alice@latest

# Рестартануешь Node-RED
pm2 restart all
pm2 save
```

### 6️⃣ Nginx + SSL (для фронтенда)

```nginx
# /etc/nginx/sites-available/golc.kz
server {
    listen 443 ssl http2;
    server_name твой.домен.kz;

    ssl_certificate /etc/letsencrypt/live/твой.домен.kz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/твой.домен.kz/privkey.pem;

    # OAuth Backend
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}

# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name твой.домен.kz;
    return 301 https://$server_name$request_uri;
}
```

```bash
# Включаешь сайт
sudo ln -s /etc/nginx/sites-available/golc.kz /etc/nginx/sites-enabled/

# Проверяешь синтаксис
sudo nginx -t

# Рестартануешь
sudo systemctl restart nginx
```

## 🧪 Тестирование

### 1️⃣ Проверить OAuth Backend

```bash
# Логин
curl -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# Должен вернуть:
{
  "ok": true,
  "user_id": "user123",
  "access_token": "eyJhbGc...",
  "username": "admin"
}
```

### 2️⃣ Проверить Node-RED API

```bash
# Список устройств (используй access_token из предыдущего запроса)
curl -X GET http://localhost:1881/api/devices?user_id=user123 \
  -H "X-Token: your-secret-token"

# Должен вернуть массив устройств
[]
```

### 3️⃣ Проверить Яндекс интеграцию (после регистрации)

1. Открываешь Яндекс Алису
2. Добавляешь устройство
3. Выбираешь своё приложение
4. Логинишься (admin / admin123)
5. Разрешаешь доступ
6. Должна появиться лампа в Алисе

## 🔑 Переменные окружения

| Переменная | Где | Значение |
|-----------|------|---------|
| `YANDEX_CLIENT_ID` | oauth | ID приложения Яндекса |
| `YANDEX_CLIENT_SECRET` | oauth | Secret приложения Яндекса |
| `BACKEND_URL` | oauth | https://твой.домен.kz |
| `NODERED_URL` | oauth | http://localhost:1881 |
| `NODERED_TOKEN` | both | Секретный токен для API |
| `JWT_SECRET` | oauth | Секретный ключ для JWT |
| `PORT` | both | Порт (3000 для oauth, 1881 для api) |

## 🐛 Troubleshooting

### OAuth Backend не запускается

```bash
# Проверь логи
tail -f /var/log/pm2/golc-oauth-error.log

# Проверь конфиг
cat .env

# Убедись что порт свободен
netstat -tlnp | grep 3000
```

### Node-RED не видит OAuth Backend

```bash
# Проверь в Node-RED логи
pm2 log node-red

# Попробуй с localhost вместо доменного имени
# backend-url должен быть: http://localhost:3000
```

### Яндекс возвращает ошибку на /oauth/authorize

```bash
# Проверь что:
# 1. client_id совпадает с тем что регистрировал в Яндекс
# 2. redirect_uri совпадает
# 3. HTTPS сертификат валидный
# 4. Backend доступен с интернета (не за NAT)

curl https://твой.домен.kz/oauth/authorize?client_id=test
```

## 📚 Дополнительно

- OAuth流 документация: docs/ARCHITECTURE_OAUTH.md
- Примеры: backend/oauth/server.js
- Информация о стандартах: https://yandex.ru/dev/dialogs/alice/doc/smart-home/

## ✅ Checklist

- [ ] Зарегистрировано приложение в Яндекс Диалоги
- [ ] Получены client_id и client_secret
- [ ] OAuth Backend работает на localhost:3000
- [ ] Node-RED API работает на localhost:1881
- [ ] curl тест логина прошёл успешно
- [ ] Nginx + SSL настроены
- [ ] Node-RED обновлён на CT112
- [ ] Яндекс может достучаться до HTTPS endpoints
- [ ] Устройства появляются в Алисе
- [ ] Управление работает (вкл/выкл, команды)
