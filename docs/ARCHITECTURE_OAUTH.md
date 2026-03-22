# GOLC HOME - Правильная архитектура OAuth + Smart Home

## 🎯 Архитектура системы

```
┌─────────────────────────────────────────────────────────────┐
│                    Яндекс Алиса (Облако)                    │
│                  (Пользователь говорит команды)              │
└────────────────────────────┬────────────────────────────────┘
                             │
                  OAuth 2.0 Account Linking
                             │
                  GET/POST /oauth/authorize
                  POST /oauth/token
                  GET /oauth/userinfo
                             │
        ┌────────────────────▼────────────────────┐
        │  BACKEND (Node.js + OAuth + Smart Home) │
        │        (твой.домен.kz)                  │
        │                                          │
        │  📌 OAuth endpoints                      │
        │  📌 /v1.0/user/devices                   │
        │  📌 /v1.0/user/devices/query             │
        │  📌 /v1.0/user/devices/action            │
        │  📌 /api/login (для Node-RED)            │
        └────────┬────────────────────┬────────────┘
                 │                    │
      HTTP REST  │         HTTP REST  │
      (управ.)   │         (devices)  │
                 │                    │
    ┌────────────▼─┐        ┌─────────▼─────────┐
    │  Node-RED    │        │  Node-RED API     │
    │   (CT112)    │        │  (выполнение)     │
    │              │        │                   │
    │ • golc-auth- │        │ /api/devices      │
    │   simple     │        │ /api/devices/add  │
    │ • управление │        │ /api/devices/action
    │   устройств. │        │ /api/devices/query│
    └──────┬───────┘        └─────────┬─────────┘
           │                          │
           │      (MQTT / HTTP)       │
           └──────────────┬───────────┘
                          │
                ┌─────────▼──────────┐
                │    Устройства      │
                │ • Лампы (Xiaomi)   │
                │ • Розетки          │
                │ • Датчики          │
                │ • Кондиционеры     │
                └────────────────────┘
```

## 🔐 OAuth Flow (Яндекс ↔ Backend)

### 1️⃣ Пользователь в Алисе: "Добавить устройство"

```
Алиса → Яндекс Диалоги
Яндекс Диалоги → Редирект на /oauth/authorize?client_id=...&redirect_uri=...
```

### 2️⃣ Пользователь вводит логин/пароль

```
GET https://твой.домен.kz/oauth/authorize
  ?client_id=your-client-id
  &redirect_uri=https://oauth.yandex.ru/codes
  &response_type=code
  &state=...
  &scope=...

Response: Редирект на страницу логина
```

### 3️⃣ Пользователь логинится и разрешает доступ

```
POST https://твой.домен.kz/login/process
  {username: "admin", password: "admin123"}

Response: Редирект на https://oauth.yandex.ru/codes?code=ABC123&state=...
```

### 4️⃣ Яндекс получает code и обменивает на token

```
POST https://твой.домен.kz/oauth/token
  {
    grant_type: "authorization_code",
    code: "ABC123",
    client_id: "...",
    client_secret: "...",
    redirect_uri: "https://oauth.yandex.ru/codes"
  }

Response:
  {
    "access_token": "eyJhbGc...",
    "token_type": "bearer",
    "expires_in": 86400
  }
```

### 5️⃣ Яндекс использует access_token для запросов

```
POST https://твой.домен.kz/v1.0/user/devices
  Authorization: Bearer eyJhbGc...

Response: Список устройств пользователя
```

## 🏗️ Структура backend'а

### Папка: `backend/oauth/`
- **server.js** — OAuth endpoints + Smart Home API
- **package.json** — зависимости

### Папка: `backend/nodered-api/`
- **server.js** — REST API для управления устройствами
- **package.json** — зависимости

## 📋 Endpoints

### OAuth (Яндекс приходит сюда)

| Method | Endpoint | Описание |
|--------|----------|---------|
| GET | `/oauth/authorize` | Инициализация авторизации |
| POST | `/oauth/token` | Получение access_token |
| GET | `/oauth/userinfo` | Информация о пользователе |

### Smart Home API (Яндекс приходит сюда)

| Method | Endpoint | Описание |
|--------|----------|---------|
| POST | `/v1.0/user/devices` | Список устройств |
| POST | `/v1.0/user/devices/query` | Состояние устройств |
| POST | `/v1.0/user/devices/action` | Управление устройствами |

### Внутренний API (Node-RED ↔ Backend)

| Method | Endpoint | Описание |
|--------|----------|---------|
| POST | `/api/login` | Логин пользователя (для Node-RED) |
| POST | `/api/devices/add` | Добавить устройство |

### Node-RED API (Backend ↔ Node-RED)

| Method | Endpoint | Описание |
|--------|----------|---------|
| GET | `/api/devices?user_id=...` | Список устройств пользователя |
| POST | `/api/devices/state` | Состояние устройств |
| POST | `/api/devices/action` | Выполнить команду |
| POST | `/api/devices/add` | Добавить новое устройство |
| DELETE | `/api/devices/:id` | Удалить устройство |

## 🚀 Развёртывание

### 1️⃣ Backend (OAuth)

```bash
cd backend/oauth
npm install
export YANDEX_CLIENT_ID="your-client-id"
export YANDEX_CLIENT_SECRET="your-client-secret"
export BACKEND_URL="https://твой.домен.kz"
export NODERED_URL="http://localhost:1881"
export NODERED_TOKEN="your-nodered-token"
npm start
```

### 2️⃣ Node-RED API

```bash
cd backend/nodered-api
npm install
export NODERED_TOKEN="your-nodered-token"
export BACKEND_URL="http://localhost:3000"
npm start
# Запуститься на порту 1881
```

### 3️⃣ Node-RED (CT112)

```bash
pct enter 112
cd /opt/GOLC-HOME-lab-alise

# Обновить npm пакет
npm install node-red-contrib-golc-alice@latest

# Рестартануть Node-RED
pm2 restart all
pm2 save
```

### 4️⃣ Nginx (проксирование)

```nginx
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

    # Node-RED API (если нужно)
    location /nodered-api/ {
        proxy_pass http://localhost:1881/;
        proxy_set_header Host $host;
    }
}
```

## 🧪 Тестирование

### 1️⃣ Логин через Node-RED API

```bash
curl -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# Response:
{
  "ok": true,
  "user_id": "user123",
  "access_token": "eyJhbGc...",
  "username": "admin",
  "email": "admin@golc.kz"
}
```

### 2️⃣ Получить список устройств

```bash
curl -X POST http://localhost:3000/v1.0/user/devices \
  -H "Authorization: Bearer eyJhbGc..." \
  -H "Content-Type: application/json"
```

### 3️⃣ Управление устройством

```bash
curl -X POST http://localhost:3000/v1.0/user/devices/action \
  -H "Authorization: Bearer eyJhbGc..." \
  -H "Content-Type: application/json" \
  -d '{
    "devices": [
      {
        "id": "lamp_1",
        "capabilities": [
          {
            "type": "on_off",
            "state": {"value": true}
          }
        ]
      }
    ]
  }'
```

## 🔑 Переменные окружения

| Переменная | Описание | Пример |
|-----------|---------|--------|
| `YANDEX_CLIENT_ID` | ID приложения Яндекса | `your-client-id` |
| `YANDEX_CLIENT_SECRET` | Secret приложения Яндекса | `your-secret` |
| `BACKEND_URL` | URL твоего backend'а | `https://golc.kz` |
| `NODERED_URL` | URL Node-RED API | `http://localhost:1881` |
| `NODERED_TOKEN` | Secret для Node-RED API | `super-secret-token` |
| `JWT_SECRET` | Secret для JWT токенов | `super-secret-jwt` |
| `PORT` | Порт backend'а | `3000` |

## ✅ Checklist для регистрации в Яндекс Диалоги

- [ ] Зарегистрировано приложение на https://yandex.ru/dev/dialogs/
- [ ] Получены `client_id` и `client_secret`
- [ ] Установлены OAuth endpoints:
  - `https://твой.домен.kz/oauth/authorize`
  - `https://твой.домен.kz/oauth/token`
  - `https://твой.домен.kz/oauth/userinfo`
- [ ] Установлены Smart Home endpoints:
  - `https://твой.домен.kz/v1.0/user/devices`
  - `https://твой.домен.kz/v1.0/user/devices/query`
  - `https://твой.домен.kz/v1.0/user/devices/action`
- [ ] Сертификат SSL действительный
- [ ] Backend и Node-RED API запущены
- [ ] Тестирование через curl прошло успешно
