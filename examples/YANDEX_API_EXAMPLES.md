# 📱 Примеры запросов Яндекс Алисы

Это примеры реальных HTTP запросов которые Яндекс будет отправлять к твоему OAuth Backend.

## 1️⃣ Authorization Request

Когда пользователь нажимает "Добавить устройство" в Алисе:

```http
GET /oauth/authorize?
  client_id=your-client-id&
  redirect_uri=https://oauth.yandex.ru/codes&
  response_type=code&
  state=random-state-value&
  scope=smart_home

Host: твой.домен.kz
```

**Твой ответ:**
Редирект на форму логина:
```
Location: /login?code=ABC123&redirect_uri=https://oauth.yandex.ru/codes&state=random-state-value
```

## 2️⃣ Token Request

После того как пользователь залогинился и разрешил доступ:

```http
POST /oauth/token HTTP/1.1
Host: твой.домен.kz
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
code=ABC123&
client_id=your-client-id&
client_secret=your-client-secret&
redirect_uri=https://oauth.yandex.ru/codes
```

**Твой ответ:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "expires_in": 86400,
  "refresh_token": null
}
```

## 3️⃣ Devices List Request

Яндекс запрашивает список устройств пользователя:

```http
POST /v1.0/user/devices HTTP/1.1
Host: твой.домен.kz
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
```

**Твой ответ:**
```json
{
  "request_id": "123e4567-e89b-12d3-a456-426614174000",
  "payload": {
    "devices": [
      {
        "id": "lamp_1",
        "name": "Лампа в гостиной",
        "description": "Умная лампа Xiaomi",
        "room": "Гостиная",
        "type": "devices.types.light",
        "capabilities": [
          {
            "type": "on_off",
            "retrievable": true,
            "parameters": {
              "split": false
            }
          },
          {
            "type": "brightness",
            "retrievable": true,
            "parameters": {
              "range": {
                "min": 0,
                "max": 100
              }
            }
          },
          {
            "type": "color_setting",
            "retrievable": true,
            "parameters": {
              "color_model": "rgb"
            }
          }
        ],
        "properties": []
      },
      {
        "id": "socket_1",
        "name": "Розетка",
        "description": "Умная розетка",
        "room": "Спальня",
        "type": "devices.types.socket",
        "capabilities": [
          {
            "type": "on_off",
            "retrievable": true,
            "parameters": {
              "split": false
            }
          }
        ],
        "properties": []
      }
    ]
  }
}
```

## 4️⃣ State Query Request

Яндекс запрашивает состояние устройств:

```http
POST /v1.0/user/devices/query HTTP/1.1
Host: твой.домен.kz
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json

{
  "devices": [
    {
      "id": "lamp_1"
    }
  ]
}
```

**Твой ответ:**
```json
{
  "request_id": "123e4567-e89b-12d3-a456-426614174000",
  "payload": {
    "devices": [
      {
        "id": "lamp_1",
        "capabilities": [
          {
            "type": "on_off",
            "state": {
              "value": true
            }
          },
          {
            "type": "brightness",
            "state": {
              "value": 75
            }
          },
          {
            "type": "color_setting",
            "state": {
              "value": "FF0000"
            }
          }
        ]
      }
    ]
  }
}
```

## 5️⃣ Action Request

Пользователь говорит: "Алиса, включи лампу"

```http
POST /v1.0/user/devices/action HTTP/1.1
Host: твой.домен.kz
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json

{
  "devices": [
    {
      "id": "lamp_1",
      "capabilities": [
        {
          "type": "on_off",
          "state": {
            "value": true
          }
        }
      ]
    }
  ]
}
```

**Твой ответ:**
```json
{
  "request_id": "123e4567-e89b-12d3-a456-426614174000",
  "payload": {
    "devices": [
      {
        "id": "lamp_1",
        "capabilities": [
          {
            "type": "on_off",
            "state": {
              "value": true
            }
          }
        ]
      }
    ]
  }
}
```

## 6️⃣ Error Response

Если что-то пошло не так:

```json
{
  "request_id": "123e4567-e89b-12d3-a456-426614174000",
  "payload": {
    "error_code": "DEVICE_NOT_FOUND"
  }
}
```

## 📋 Device Types

| Type | Описание | Примеры |
|------|---------|---------|
| `devices.types.light` | Лампа / Свет | Xiaomi Mi Smart LED Bulb |
| `devices.types.socket` | Розетка | Sonoff Basic |
| `devices.types.switch` | Выключатель | Aqara Wall Switch |
| `devices.types.thermostat` | Термостат | Ecovacs Deebot |
| `devices.types.sensor` | Датчик | Aqara Temperature & Humidity |
| `devices.types.camera` | Камера | Xiaomi Mi Home Security Camera |
| `devices.types.cooker` | Варочная панель | Midea Smart Cooker |
| `devices.types.washer` | Стиральная машина | LG SmartThinQ |
| `devices.types.dishwasher` | Посудомойка | Bosch Home |
| `devices.types.other` | Другое | Generic Device |

## 🎯 Capability Types

| Type | Параметр | Примеры значений |
|------|----------|-----------------|
| `on_off` | `value` | `true`, `false` |
| `brightness` | `value` | `0` - `100` |
| `color_setting` | `value` | `"FF0000"` (RGB hex) |
| `temperature_k` | `value` | `2700` - `6500` (Kelvin) |
| `mode` | `value` | `"turbo"`, `"normal"`, `"eco"` |
| `range` | `value` | `0` - `100` (зависит от device) |
| `volume` | `value` | `0` - `100` |
| `channel` | `value` | `1` - `1000` |

## 🔐 Authorization Header Format

```
Authorization: Bearer <access_token>
```

Где `<access_token>` - это JWT токен который ты вернул в `/oauth/token` endpoint.

## 🧪 Curl примеры

### 1. Получить access_token

```bash
curl -X POST http://localhost:3000/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&code=ABC123&client_id=your-client-id&client_secret=your-secret"
```

### 2. Получить список устройств

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -X POST http://localhost:3000/v1.0/user/devices \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

### 3. Включить лампу

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -X POST http://localhost:3000/v1.0/user/devices/action \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "devices": [{
      "id": "lamp_1",
      "capabilities": [{
        "type": "on_off",
        "state": {"value": true}
      }]
    }]
  }'
```

---

Для подробной документации смотри [docs/ARCHITECTURE_OAUTH.md](../docs/ARCHITECTURE_OAUTH.md)
