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

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-endpoints.ps1
```

## Полезные ссылки

- Документация Яндекс Smart Home: https://yandex.ru/dev/dialogs/smart-home/doc/ru/
