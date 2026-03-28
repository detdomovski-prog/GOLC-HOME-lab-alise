/**
 * Node-RED API endpoints для управления устройствами
 * 
 * Это REST API на Express, который может быть развёрнут как:
 * 1. Отдельное приложение (рекомендуется)
 * 2. Часть Node-RED (через функции)
 */

const express = require('express');
const app = express();
app.use(express.json());

// Конфигурация
const CONFIG = {
  NODERED_TOKEN: process.env.NODERED_TOKEN || 'your-nodered-token',
  BACKEND_URL: process.env.BACKEND_URL || 'http://localhost:3000'
};

// ========================================
// STORAGE (в реальности → Node-RED context)
// ========================================

// Устройства: { id: string, user_id: string, name: string, type: string, ... }
const devices = new Map();
// Состояния устройств
const deviceStates = new Map();

// Добавляем примеры устройств
devices.set('lamp_1', {
  id: 'lamp_1',
  user_id: 'user123',
  name: 'Лампа в гостиной',
  description: 'Умная лампа Xiaomi',
  room: 'Гостиная',
  type: 'devices.types.light',
  capabilities: [
    {
      type: 'on_off',
      retrievable: true,
      parameters: { split: false }
    },
    {
      type: 'color_setting',
      retrievable: true,
      parameters: { color_model: 'rgb' }
    }
  ],
  properties: []
});

deviceStates.set('lamp_1', [
  { type: 'on_off', state: { value: false } },
  { type: 'color_setting', state: { value: 'FF0000' } }
]);

// ========================================
// MIDDLEWARE
// ========================================

function authMiddleware(req, res, next) {
  const token = req.headers['x-token'];

  if (token !== CONFIG.NODERED_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  next();
}

// ========================================
// ENDPOINTS
// ========================================

/**
 * GET /api/devices?user_id=user123
 * 
 * Вернуть список устройств пользователя
 */
app.get('/api/devices', authMiddleware, (req, res) => {
  const { user_id } = req.query;

  const userDevices = Array.from(devices.values()).filter(d => d.user_id === user_id);

  res.json(userDevices);
});

/**
 * POST /api/devices/state
 * 
 * Вернуть состояние устройств
 */
app.post('/api/devices/state', authMiddleware, (req, res) => {
  const { device_ids } = req.body;

  const states = device_ids.map(id => {
    const device = devices.get(id);
    const deviceState = deviceStates.get(id) || [];

    return {
      id,
      capabilities: deviceState
    };
  });

  res.json(states);
});

/**
 * POST /api/devices/action
 * 
 * Выполнить действие на устройстве (включить/выключить/изменить цвет и т.д.)
 */
app.post('/api/devices/action', authMiddleware, (req, res) => {
  const { devices: actions } = req.body;

  const result = actions.map(action => {
    const device = devices.get(action.id);

    if (!device) {
      return {
        id: action.id,
        error_code: 'DEVICE_NOT_FOUND'
      };
    }

    // Применяем команду
    if (action.capabilities) {
      const deviceState = deviceStates.get(action.id) || [];

      action.capabilities.forEach(cap => {
        const existingCap = deviceState.find(c => c.type === cap.type);

        if (existingCap && cap.state) {
          existingCap.state = cap.state;
        } else if (cap.state) {
          deviceState.push(cap);
        }
      });

      deviceStates.set(action.id, deviceState);

      console.log(`✅ Action on ${action.id}:`, JSON.stringify(action.capabilities, null, 2));
    }

    return {
      id: action.id,
      capabilities: action.capabilities || []
    };
  });

  res.json({ devices: result });
});

/**
 * POST /api/devices/add
 * 
 * Добавить новое устройство
 */
app.post('/api/devices/add', authMiddleware, (req, res) => {
  const {
    id,
    user_id,
    name,
    type = 'devices.types.other',
    capabilities = [],
    properties = []
  } = req.body;

  if (!id || !user_id || !name) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const device = {
    id,
    user_id,
    name,
    type,
    capabilities,
    properties,
    room: '',
    description: ''
  };

  devices.set(id, device);
  deviceStates.set(id, []);

  // 🔔 Уведомляем backend об добавлении устройства
  fetch(`${CONFIG.BACKEND_URL}/api/devices/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: CONFIG.NODERED_TOKEN, device })
  }).catch(err => console.error('Backend notification error:', err));

  res.json({ ok: true, device });
});

/**
 * DELETE /api/devices/:id
 * 
 * Удалить устройство
 */
app.delete('/api/devices/:id', authMiddleware, (req, res) => {
  const { id } = req.params;

  if (devices.has(id)) {
    devices.delete(id);
    deviceStates.delete(id);
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'device_not_found' });
  }
});

/**
 * GET /api/devices/:id
 * 
 * Получить информацию об устройстве
 */
app.get('/api/devices/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const device = devices.get(id);

  if (!device) {
    return res.status(404).json({ error: 'device_not_found' });
  }

  res.json(device);
});

// ========================================
// ЗАПУСК
// ========================================

const PORT = process.env.PORT || 1881;
app.listen(PORT, () => {
  console.log(`🎛️  Node-RED API running on port ${PORT}`);
  console.log(`   GET  /api/devices?user_id=...`);
  console.log(`   POST /api/devices/state`);
  console.log(`   POST /api/devices/action`);
  console.log(`   POST /api/devices/add`);
  console.log(`   DELETE /api/devices/:id`);
});

module.exports = app;
