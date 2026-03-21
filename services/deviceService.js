// In-memory device store for testing
const devices = {
  lamp1: {
    id: 'lamp1',
    name: 'Лампа',
    type: 'devices.types.light',
    status_info: { reportable: true },
    capabilities: [
      { type: 'devices.capabilities.on_off', retrievable: true }
    ],
    device_info: {
      manufacturer: 'DIY',
      model: 'lamp1',
      hw_version: '1.0',
      sw_version: '1.0'
    },
    // internal state
    state: {
      on: true
    }
  },
  socket1: {
    id: 'socket1',
    name: 'Розетка',
    type: 'devices.types.socket',
    status_info: { reportable: true },
    capabilities: [
      { type: 'devices.capabilities.on_off', retrievable: true }
    ],
    device_info: {
      manufacturer: 'DIY',
      model: 'socket1',
      hw_version: '1.0',
      sw_version: '1.0'
    },
    state: {
      on: false
    }
  },
  temp1: {
    id: 'temp1',
    name: 'Датчик температуры',
    type: 'devices.types.sensor.climate',
    status_info: { reportable: true },
    capabilities: [],
    properties: [
      {
        type: 'devices.properties.float',
        retrievable: true,
        reportable: true,
        parameters: {
          instance: 'temperature',
          unit: 'unit.temperature.celsius'
        }
      },
      {
        type: 'devices.properties.float',
        retrievable: true,
        reportable: true,
        parameters: {
          instance: 'humidity',
          unit: 'unit.percent'
        }
      }
    ],
    device_info: {
      manufacturer: 'DIY',
      model: 'temp1',
      hw_version: '1.0',
      sw_version: '1.0'
    },
    state: {
      temperature: 22.5,
      humidity: 48
    }
  },
  door1: {
    id: 'door1',
    name: 'Датчик открытия двери',
    type: 'devices.types.sensor.open',
    status_info: { reportable: true },
    capabilities: [],
    properties: [
      {
        type: 'devices.properties.event',
        retrievable: true,
        reportable: true,
        parameters: {
          instance: 'open',
          events: [
            { value: 'opened' },
            { value: 'closed' }
          ]
        }
      }
    ],
    device_info: {
      manufacturer: 'DIY',
      model: 'door1',
      hw_version: '1.0',
      sw_version: '1.0'
    },
    state: {
      opened: false
    }
  }
};

const virtualDevices = {};

function getDeviceById(id) {
  return devices[id] || virtualDevices[id] || null;
}

function getAllDeviceIds() {
  return [...Object.keys(devices), ...Object.keys(virtualDevices)];
}

function mapDeviceForList(d) {
  return {
    id: d.id,
    name: d.name,
    type: d.type,
    status_info: d.status_info || { reportable: true },
    capabilities: d.capabilities || [],
    properties: d.properties || [],
    device_info: d.device_info || {
      manufacturer: 'DIY',
      model: d.id,
      hw_version: '1.0',
      sw_version: '1.0'
    }
  };
}

function buildPropertyState(device, propertyDef) {
  const params = propertyDef.parameters || {};
  const instance = params.instance;
  const state = device.state || {};

  if (propertyDef.type === 'devices.properties.float') {
    const value = Number(state[instance]);
    return {
      type: propertyDef.type,
      state: {
        instance,
        value: Number.isFinite(value) ? value : 0
      }
    };
  }

  if (propertyDef.type === 'devices.properties.event') {
    let value = state[instance];
    if (instance === 'open' && typeof value === 'undefined') {
      value = state.opened ? 'opened' : 'closed';
    }
    return {
      type: propertyDef.type,
      state: {
        instance,
        value: typeof value === 'undefined' ? null : value
      }
    };
  }

  return { type: propertyDef.type };
}

exports.getDevicesList = function() {
  return getAllDeviceIds().map(id => mapDeviceForList(getDeviceById(id)));
};

exports.queryDevices = function(ids) {
  if (!ids || ids.length === 0) {
    ids = getAllDeviceIds();
  }
  return ids.map(id => {
    const d = getDeviceById(id);
    if (!d) {
      return {
        id,
        error_code: 'DEVICE_NOT_FOUND',
        error_message: 'Device not found'
      };
    }
    // Build capabilities states
    const caps = (d.capabilities || []).map(c => {
      if (c.type === 'devices.capabilities.on_off') {
        return { type: c.type, state: { instance: 'on', value: !!d.state.on } };
      }
      return { type: c.type };
    });

    const props = (d.properties || []).map(p => buildPropertyState(d, p));

    return { id: d.id, capabilities: caps, properties: props };
  });
};

exports.applyActions = function(body) {
  // body may contain payload.devices or devices depending on client
  const results = [];
  const devicesArray = (body.payload && body.payload.devices) || body.devices || [];

  for (const dev of devicesArray) {
    const id = dev.id;
    const d = getDeviceById(id);
    if (!d) {
      results.push({ id, action_result: { status: 'ERROR', error_code: 'DEVICE_NOT_FOUND' } });
      continue;
    }
    const capsRes = [];
    const requestedCapabilities = dev.capabilities || dev.actions || [];
    if (Array.isArray(requestedCapabilities)) {
      for (const cap of requestedCapabilities) {
        const instance = (cap.state && cap.state.instance) || 'on';
        if (cap.type === 'devices.capabilities.on_off') {
          const supportsOnOff = (d.capabilities || []).some(c => c.type === 'devices.capabilities.on_off');
          if (!supportsOnOff) {
            capsRes.push({
              type: cap.type,
              state: {
                instance,
                action_result: { status: 'ERROR', error_code: 'NOT_SUPPORTED_IN_CURRENT_MODE' }
              }
            });
            continue;
          }

          let value = cap.state && cap.state.value;
          if (value === 'true') value = true;
          if (value === 'false') value = false;

          if (typeof value === 'boolean') {
            d.state.on = value;
            capsRes.push({
              type: cap.type,
              state: {
                instance,
                action_result: { status: 'DONE' }
              }
            });
          } else {
            capsRes.push({
              type: cap.type,
              state: {
                instance,
                action_result: { status: 'ERROR', error_code: 'INVALID_VALUE' }
              }
            });
          }
        } else {
          capsRes.push({
            type: cap.type,
            state: {
              instance,
              action_result: { status: 'ERROR', error_code: 'NOT_SUPPORTED_IN_CURRENT_MODE' }
            }
          });
        }
      }
    }
    results.push({ id: d.id, capabilities: capsRes });
  }

  return results;
};

exports.updateDeviceState = function(id, patch) {
  const d = getDeviceById(id);
  if (!d) return null;

  const nextState = patch || {};

  if (Object.prototype.hasOwnProperty.call(nextState, 'on')) {
    d.state.on = !!nextState.on;
  }
  if (Object.prototype.hasOwnProperty.call(nextState, 'temperature')) {
    d.state.temperature = Number(nextState.temperature);
  }
  if (Object.prototype.hasOwnProperty.call(nextState, 'humidity')) {
    d.state.humidity = Number(nextState.humidity);
  }
  if (Object.prototype.hasOwnProperty.call(nextState, 'opened')) {
    d.state.opened = !!nextState.opened;
  }

  if (Object.prototype.hasOwnProperty.call(nextState, 'open')) {
    d.state.open = nextState.open;
  }

  for (const key of Object.keys(nextState)) {
    if (!Object.prototype.hasOwnProperty.call(d.state, key)) {
      d.state[key] = nextState[key];
    }
  }

  return { id: d.id, state: { ...d.state } };
};

exports.getStateSnapshot = function(ids) {
  const targetIds = Array.isArray(ids) && ids.length ? ids : getAllDeviceIds();

  return targetIds.map(id => {
    const d = getDeviceById(id);
    if (!d) {
      return { id, error_code: 'DEVICE_NOT_FOUND', error_message: 'Device not found' };
    }
    return { id: d.id, state: { ...d.state } };
  });
};

exports.registerVirtualDevices = function(items) {
  const devicesList = Array.isArray(items) ? items : [];

  return devicesList.map(item => {
    const id = item && item.id ? String(item.id) : '';
    if (!id) {
      return { id: null, error_code: 'INVALID_DEVICE', error_message: 'id is required' };
    }

    virtualDevices[id] = {
      id,
      name: item.name || id,
      type: item.type || 'devices.types.other',
      status_info: item.status_info || { reportable: true },
      capabilities: Array.isArray(item.capabilities) ? item.capabilities : [],
      properties: Array.isArray(item.properties) ? item.properties : [],
      device_info: item.device_info || {
        manufacturer: 'Node-RED',
        model: id,
        hw_version: '1.0',
        sw_version: '1.0'
      },
      state: item.state && typeof item.state === 'object' ? { ...item.state } : {}
    };

    return { id, status: 'registered' };
  });
};

exports.listVirtualDevices = function() {
  return Object.values(virtualDevices).map(d => mapDeviceForList(d));
};

exports.deleteVirtualDevice = function(id) {
  if (!virtualDevices[id]) return false;
  delete virtualDevices[id];
  return true;
};
