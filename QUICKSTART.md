# ⚡ GOLC HOME OAuth - Быстрый старт (5 минут)

## 📦 Что где находится

```
backend/oauth/          → OAuth endpoints для Яндекса + Smart Home API
backend/nodered-api/    → REST API для управления устройствами Node-RED
nodered/.../golc-auth-simple.{js,html} → Нода для авторизации в Node-RED
docs/ARCHITECTURE_OAUTH.md → Подробная документация
DEPLOYMENT_GUIDE.md     → Инструкция развёртывания
```

## 🎯 Главное отличие от v0.1.30

**Было:**
- golc-auth делал OAuth сам (неправильно)
- Node-RED напрямую обращался к Яндексу (не работает)

**Теперь:**
- Backend делает OAuth (правильно)
- Node-RED просто авторизуется через `/api/login`
- Яндекс обращается только к Backend

## 🚀 Запуск (локально)

```bash
# 1️⃣ OAuth Backend
cd backend/oauth
cp .env.example .env
npm install
npm start
# → http://localhost:3000

# 2️⃣ Node-RED API (в другом терминале)
cd backend/nodered-api
cp .env.example .env
npm install
npm start
# → http://localhost:1881

# 3️⃣ Node-RED (CT112) - обновить
pct enter 112
npm install node-red-contrib-golc-alice@latest
pm2 restart all
```

## 🔑 Конфигурация

**backend/oauth/.env:**
```env
YANDEX_CLIENT_ID=your-client-id
YANDEX_CLIENT_SECRET=your-client-secret
BACKEND_URL=https://твой.домен.kz
NODERED_URL=http://localhost:1881
NODERED_TOKEN=secret-token
JWT_SECRET=jwt-secret
```

**backend/nodered-api/.env:**
```env
NODERED_TOKEN=secret-token
BACKEND_URL=http://localhost:3000
```

## 📡 Endpoints

| Endpoint | Кто | Описание |
|----------|-----|---------|
| `POST /oauth/authorize` | Яндекс | Авторизация |
| `POST /oauth/token` | Яндекс | Получить токен |
| `POST /v1.0/user/devices` | Яндекс | Список устройств |
| `POST /api/login` | Node-RED | Логин пользователя |
| `GET /api/devices?user_id=...` | Backend | Список устройств |
| `POST /api/devices/action` | Backend | Управление |

## ✅ Проверка

```bash
# Логин
curl -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# Ответ: access_token + user_id
```

## 🎯 Следующие шаги

1. **Регистрация в Яндекс Диалоги** → получить client_id/secret
2. **Развёртывание на сервер** → настроить HTTPS
3. **Подключение устройств** → добавить в Node-RED
4. **Тестирование в Алисе** → "Добавить устройство"

## 📚 Подробнее

- **Архитектура:** `docs/ARCHITECTURE_OAUTH.md`
- **Развёртывание:** `DEPLOYMENT_GUIDE.md`
- **Исходный код:** `backend/*/server.js`

## 🆘 Проблемы

**404 на /oauth/authorize**
→ Проверь HTTPS сертификат, протокол, BACKEND_URL в .env

**Node-RED не видит backend**
→ Укажи `http://localhost:3000` в golc-auth-simple node

**Яндекс говорит "invalid_client"**
→ Проверь что client_id совпадает с тем что в Яндекс Диалоги

---

**Версия:** v0.1.31  
**Дата:** 2026-03-22  
**Статус:** ✅ Готово к развёртыванию
