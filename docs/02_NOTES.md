Технические заметки (рабочая страница)

1) Аутентификация и прокси
- В примере у вас tunnel на Cloudflare, который требует Basic auth (WWW-Authenticate: Basic realm=...).
- Опции: убрать Basic auth для публичного endpoint'а или использовать Allow-Rule в Cloudflare Access.

2) Node-RED
- В `flows.json` уже есть шаблоны function-нод, возвращающие `request_id` и `action_result`.
- Важно: `http in` должен быть связан с ровно одним `http response` и возвращать единый JSON объект.

3) Тестирование
- Скрипт `scripts/test-endpoints.ps1` используется для автоматической проверки. Убедитесь, что `url.txt` содержит корректный base URL (например, `https://.../endpoint`).

4) Логи Yandex
- Если Yandex пишет `Capability ... action status is ERROR, code: UNKNOWN_ERROR` — проверьте тело ответа на `action` (в т.ч. request_id, наличие action_result на уровне capability и device, правильный Content-Type).

5) Безопасность
- Никогда не выкладывайте permanent credentials в репозиторий. Для тестов используйте временные креды или локальные .env файлы.

6) Contacts
- Запишите сюда, кто имеет доступ к cloudflared / Cloudflare Dashboard, и где искать конфиги.

--
Добавляйте сюда обнаруженные проблемы и принятые решения по мере работы.
