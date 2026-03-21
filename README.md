# Alice Smart Home (Node-RED)

Минимальный проект для интеграции с Яндекс Smart Home через Node-RED.

## Структура

- `nodered/` — сюда складывать `flows.json` и настройки Node-RED
- `docs/` — документация и примеры запросов/ответов
- `scripts/` — тестовые скрипты
- `url.txt` — базовый URL (Cloudflare Tunnel endpoint)

## Быстрый старт

1. Открой Node-RED и импортируй `flows.json`.
2. Нажми **Deploy**.
3. Проверь доступность эндпоинтов скриптом ниже.

## Тесты (PowerShell)

# GOLC-HOME-lab-alise — Yandex Smart Home Provider (Express mock)

Минимальный Express backend, реализующий обязательные endpoint'ы Yandex Smart Home для тестирования и интеграции.

Требования выполнены строго по документации: https://yandex.ru/dev/dialogs/smart-home/doc/ru/

## Структура проекта

- `routes/` — маршруты Express
- `controllers/` — обработчики запросов
- `services/` — бизнес-логика и in-memory устройства
- `config/` — конфигурации (env)
- `app.js` — точка входа
- `docs/requests/` — примеры JSON запросов

## Быстрый старт

1. Скопируйте `.env.example` → `.env` и при необходимости отредактируйте `PORT` и `AUTH_TOKEN`.
2. Установите зависимости:

```bash
npm install
```

3. Запустите сервер:

```bash
npm start
```

Сервер по умолчанию слушает порт из `.env` или `3000`.

## Тестирование (curl)

Получение тестового токена (stub):

```bash
curl -s -X POST http://localhost:3000/token | jq
```

Список устройств:

```bash
curl -H "Authorization: Bearer test-token" -H "X-Request-Id: abc123" http://localhost:3000/v1.0/user/devices | jq
```

Запрос состояния устройства:

```bash
curl -H "Authorization: Bearer test-token" -H "X-Request-Id: rq1" -H "Content-Type: application/json" -d @docs/requests/test-query.json http://localhost:3000/v1.0/user/devices/query | jq
```

Действие над устройством (включить/выключить):

```bash
curl -H "Authorization: Bearer test-token" -H "X-Request-Id: rq2" -H "Content-Type: application/json" -d @docs/requests/test-action.json http://localhost:3000/v1.0/user/devices/action | jq
```

Отвязка пользователя:

```bash
curl -X POST -H "Authorization: Bearer test-token" -H "X-Request-Id: rq3" http://localhost:3000/v1.0/user/unlink | jq
```

## Примечания

- Используйте `.env` для настройки `AUTH_TOKEN` (по умолчанию `test-token`).
- В продакшене настраивайте HTTPS и безопасное хранение секретов.
- Для интеграции через Cloudflare Tunnel используйте `url.txt` для текущего публичного URL (не хардкодьте адреса).

## Free Node-RED Bridge (аналог для личного использования)

Добавлены внутренние endpoint'ы для Node-RED, чтобы обновлять состояния устройств и читать их, без платных нод:

- `GET /internal/devices/state?ids=lamp1,temp1`
- `POST /internal/devices/lamp1/state`
- `POST /internal/devices/bulk-state`

Во всех запросах нужен заголовок `X-Internal-Token: <INTERNAL_TOKEN>`.

Примеры:

```bash
curl -H "X-Internal-Token: local-internal-token" \
	"http://localhost:3000/internal/devices/state?ids=temp1,door1"
```

```bash
curl -X POST "http://localhost:3000/internal/devices/temp1/state" \
	-H "X-Internal-Token: local-internal-token" \
	-H "Content-Type: application/json" \
	-d '{"state":{"temperature":24.2,"humidity":51}}'
```

```bash
curl -X POST "http://localhost:3000/internal/devices/bulk-state" \
	-H "X-Internal-Token: local-internal-token" \
	-H "Content-Type: application/json" \
	-d '{"devices":[{"id":"lamp1","state":{"on":true}},{"id":"door1","state":{"opened":true}}]}'
```

Как связать с Node-RED:

1. В Node-RED используйте `inject/function -> http request`.
2. Для датчиков отправляйте `POST /internal/devices/:id/state` при изменении значений.
3. Для чтения текущего состояния вызывайте `GET /internal/devices/state`.
4. Яндекс продолжает работать через стандартные `GET/POST /v1.0/user/*` endpoint'ы.

## Node-RED npm-узел (как `node-red-contrib-*`)

Для установки в Node-RED добавлен пакет:

- `nodered/node-red-contrib-golc-alice`

Установка в окружении Node-RED (папка `~/.node-red`):

```bash
cd ~/.node-red
npm install /opt/GOLC-HOME-lab-alise/nodered/node-red-contrib-golc-alice
```

После перезапуска Node-RED появится узел `alice-device`.

Быстрый сценарий:

1. Узел `alice-device` в режиме `register` — регистрирует виртуальное устройство.
2. Второй `alice-device` в режиме `state` — обновляет состояние (`msg.state`).
3. В Яндексе запускаете «Обновить устройства» и видите новые объекты.
