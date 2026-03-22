# 🏠 GOLC HOME - Яндекс Алиса + Smart Home

Интеграция Яндекс Алисы с Node-RED через правильную архитектуру OAuth 2.0.

**Версия:** v0.1.31  
**Статус:** ✅ Готово к развёртыванию

## 🎯 Архитектура

```
Яндекс Алиса
    ↓
OAuth Backend (backend/oauth/)
    ↓ (HTTP REST)
Node-RED API (backend/nodered-api/)
    ↓ (MQTT/HTTP)
Node-RED (CT112)
    ↓
Устройства (Xiaomi, Tuya, и т.д.)
```

## 📦 Компоненты

| Компонент | Описание | Тип |
|-----------|---------|-----|
| **backend/oauth/** | OAuth 2.0 endpoints + Smart Home API | Node.js/Express |
| **backend/nodered-api/** | REST API для управления устройствами | Node.js/Express |
| **nodered/node-red-contrib-golc-alice** | Node-RED пакет с нодами | npm |
| **docs/ARCHITECTURE_OAUTH.md** | Подробная архитектура | Документация |
| **DEPLOYMENT_GUIDE.md** | Инструкция развёртывания | Руководство |
| **QUICKSTART.md** | Быстрый старт за 5 минут | Справка |

## 🚀 Быстрый старт

```bash
# 1. OAuth Backend
cd backend/oauth
cp .env.example .env
npm install && npm start
# → http://localhost:3000

# 2. Node-RED API (новый терминал)
cd backend/nodered-api
cp .env.example .env
npm install && npm start
# → http://localhost:1881

# 3. Обновить Node-RED (CT112)
pct enter 112
npm install node-red-contrib-golc-alice@latest
pm2 restart all
```

## 📖 Документация

- **[QUICKSTART.md](./QUICKSTART.md)** — 5 минут на старт
- **[DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)** — Production развёртывание
- **[docs/ARCHITECTURE_OAUTH.md](./docs/ARCHITECTURE_OAUTH.md)** — Полная архитектура

## 🔑 Ключевые особенности

✅ **Правильная архитектура** — OAuth на backend, Node-RED как исполнитель  
✅ **Безопасность** — JWT токены, локальное хранение credentials  
✅ **Стандарты Яндекса** — Полная поддержка Account Linking и Smart Home API  
✅ **Масштабируемость** — Отдельные backend и Node-RED API  
✅ **Простота** — Готовые endpoints и примеры  

## 📝 Endpoints

### OAuth (для Яндекса)

```
GET  /oauth/authorize           — Авторизация пользователя
POST /oauth/token               — Обмен code на access_token
GET  /oauth/userinfo            — Информация о пользователе
```

### Smart Home API (для Яндекса)

```
POST /v1.0/user/devices         — Список устройств пользователя
POST /v1.0/user/devices/query   — Состояние устройств
POST /v1.0/user/devices/action  — Управление устройствами
```

### Внутренний API (Node-RED)

```
POST /api/login                 — Авторизация пользователя
GET  /api/devices?user_id=...   — Список устройств
POST /api/devices/state         — Состояние устройств
POST /api/devices/action        — Выполнить команду
POST /api/devices/add           — Добавить новое устройство
DELETE /api/devices/:id         — Удалить устройство
```

## 🔗 Регистрация в Яндекс Диалоги

1. Переходишь на https://yandex.ru/dev/dialogs/
2. Регистрируешь приложение (Smart Home)
3. Устанавливаешь OAuth endpoints:
   - Authorization: `https://твой.домен.kz/oauth/authorize`
   - Token: `https://твой.домен.kz/oauth/token`
   - User info: `https://твой.домен.kz/oauth/userinfo`
4. Устанавливаешь Smart Home endpoints:
   - `https://твой.домен.kz/v1.0/user/devices`
   - `https://твой.домен.kz/v1.0/user/devices/query`
   - `https://твой.домен.kz/v1.0/user/devices/action`
5. Копируешь `client_id` и `client_secret`
6. Добавляешь их в `backend/oauth/.env`

## 🧪 Тестирование

```bash
# Логин (получить access_token)
curl -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# Список устройств
curl -X GET http://localhost:1881/api/devices?user_id=user123 \
  -H "X-Token: your-secret-token"

# Управление устройством
curl -X POST http://localhost:1881/api/devices/action \
  -H "X-Token: your-secret-token" \
  -H "Content-Type: application/json" \
  -d '{
    "devices": [{
      "id": "lamp_1",
      "capabilities": [{"type":"on_off","state":{"value":true}}]
    }]
  }'
```

## 📊 История версий

| Версия | Дата | Изменения |
|--------|------|----------|
| v0.1.31 | 2026-03-22 | ✨ Полная архитектура OAuth + документация |
| v0.1.30 | 2026-03-22 | 🐛 Исправлена маршрутизация admin endpoints |
| v0.1.29 | 2026-03-22 | 🔒 Добавлена приватность (только userId) |
| v0.1.28 | 2026-03-22 | 🔑 Реализовано Yandex Device OAuth |
| v0.1.27 | 2026-03-22 | 🎨 Упрощённый UI (кнопка → код → submit) |

## 🛠 Зависимости

### OAuth Backend
- Node.js >= 14
- Express 4.18+
- jsonwebtoken 9.0+
- uuid 9.0+

### Node-RED API
- Node.js >= 14
- Express 4.18+

### Node-RED
- Node-RED >= 3.0.0
- node-red-contrib-golc-alice >= 0.1.31

## 📝 Лицензия

MIT

## 👥 Автор

GOLC-HOME Lab  
https://github.com/detdomovski-prog/GOLC-HOME-lab-alise

---

**Нужна помощь?** Смотри [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) или [docs/ARCHITECTURE_OAUTH.md](./docs/ARCHITECTURE_OAUTH.md)
