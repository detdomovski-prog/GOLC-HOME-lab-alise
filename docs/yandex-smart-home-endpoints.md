# Требования и эндпоинты Яндекс Smart Home (REST)

Источник: https://yandex.ru/dev/dialogs/smart-home/doc/ru/

## Базовая схема

Endpoint URL провайдера (пример): `https://example.com/v1.0`

Платформа умного дома Яндекса обращается к провайдеру по REST.

## Обязательные REST-эндпоинты провайдера

### 1) Проверка доступности Endpoint URL
- Метод: `HEAD`
- URL: `https://example.com/v1.0`
- Назначение: периодическая проверка доступности
- Ответ: `HTTP 200 OK`
- Док: https://yandex.ru/dev/dialogs/smart-home/doc/ru/reference/check

### 2) Unlink (разъединение аккаунтов)
- Метод: `POST`
- URL: `https://example.com/v1.0/user/unlink`
- Заголовки: `Authorization`, `X-Request-Id`
- Ответ (пример):
  ```json
  { "request_id": "<string>" }
  ```
- Док: https://yandex.ru/dev/dialogs/smart-home/doc/ru/reference/unlink

### 3) Получение списка устройств пользователя
- Метод: `GET`
- URL: `https://example.com/v1.0/user/devices`
- Заголовки: `Authorization`, `X-Request-Id`
- Ответ (основные поля):
  ```json
  {
    "request_id": "<string>",
    "payload": {
      "user_id": "<string>",
      "devices": [
        {
          "id": "<string>",
          "name": "<string>",
          "type": "<string>",
          "status_info": { "reportable": true },
          "capabilities": [ /* список умений */ ],
          "properties": [ /* список свойств */ ]
        }
      ]
    }
  }
  ```
- Док: https://yandex.ru/dev/dialogs/smart-home/doc/ru/reference/get-devices

### 4) Получение состояния устройств
- Метод: `POST`
- URL: `https://example.com/v1.0/user/devices/query`
- Заголовки: `Authorization`, `X-Request-Id`, `Content-Type: application/json`
- Тело запроса (пример):
  ```json
  {
    "devices": [
      { "id": "<string>", "custom_data": { } }
    ]
  }
  ```
- Ответ (основные поля):
  ```json
  {
    "request_id": "<string>",
    "payload": {
      "devices": [
        {
          "id": "<string>",
          "capabilities": [ /* статусы умений */ ],
          "properties": [ /* статусы свойств */ ]
        }
      ]
    }
  }
  ```
- Док: https://yandex.ru/dev/dialogs/smart-home/doc/ru/reference/post-devices-query

### 5) Управление устройствами (action)
- Метод: `POST`
- URL: `https://example.com/v1.0/user/devices/action`
- Заголовки: `Authorization`, `X-Request-Id`, `Content-Type: application/json`
- Тело запроса (пример):
  ```json
  {
    "payload": {
      "devices": [
        {
          "id": "<string>",
          "custom_data": { },
          "capabilities": [ /* команды */ ]
        }
      ]
    }
  }
  ```
- Ответ (основные поля):
  ```json
  {
    "request_id": "<string>",
    "payload": {
      "devices": [
        {
          "id": "<string>",
          "capabilities": [ /* результаты выполнения */ ],
          "action_result": {
            "status": "DONE",
            "error_code": "",
            "error_message": ""
          }
        }
      ]
    }
  }
  ```
- Док: https://yandex.ru/dev/dialogs/smart-home/doc/ru/reference/post-action

## Общие требования по заголовкам
- `Authorization: Bearer <token>`
- `X-Request-Id: <uuid>` — нужно логировать на стороне провайдера
- `Content-Type: application/json` — для POST

## Полезные разделы документации
- Типы устройств: https://yandex.ru/dev/dialogs/smart-home/doc/ru/concepts/device-types
- Умения (capabilities): https://yandex.ru/dev/dialogs/smart-home/doc/ru/concepts/capability-types
- Свойства (properties): https://yandex.ru/dev/dialogs/smart-home/doc/ru/concepts/properties-types
- Коды ответов: https://yandex.ru/dev/dialogs/smart-home/doc/ru/concepts/response-codes

## Примечание
Все структуры запросов/ответов должны строго соответствовать официальной документации.
