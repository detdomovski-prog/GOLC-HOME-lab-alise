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

exports.getDevicesList = function() {
  return Object.values(devices).map(d => ({
    id: d.id,
    name: d.name,
    type: d.type,
    status_info: d.status_info,
    capabilities: d.capabilities,
    properties: d.properties || [],
    device_info: d.device_info
  }));
};

exports.queryDevices = function(ids) {
  if (!ids || ids.length === 0) {
    // return all
    ids = Object.keys(devices);
  }
  return ids.map(id => {
    const d = devices[id];
    if (!d) {
      return {
        id,
        error_code: 'DEVICE_NOT_FOUND',
        error_message: 'Device not found'
      };
    }
    // Build capabilities states
    const caps = d.capabilities.map(c => {
      if (c.type === 'devices.capabilities.on_off') {
        return { type: c.type, state: { instance: 'on', value: !!d.state.on } };
      }
      return { type: c.type };
    });

    const props = (d.properties || []).map(p => {
      if (p.type === 'devices.properties.float' && p.parameters && p.parameters.instance === 'temperature') {
        return {
          type: p.type,
          state: {
            instance: 'temperature',
            value: Number(d.state.temperature)
          }
        };
      }
      if (p.type === 'devices.properties.float' && p.parameters && p.parameters.instance === 'humidity') {
        return {
          type: p.type,
          state: {
            instance: 'humidity',
            value: Number(d.state.humidity)
          }
        };
      }
      if (p.type === 'devices.properties.event' && p.parameters && p.parameters.instance === 'open') {
        return {
          type: p.type,
          state: {
            instance: 'open',
            value: d.state.opened ? 'opened' : 'closed'
          }
        };
      }
      return { type: p.type };
    });

    return { id: d.id, capabilities: caps, properties: props };
  });
};

exports.applyActions = function(body) {
  // body may contain payload.devices or devices depending on client
  const results = [];
  const devicesArray = (body.payload && body.payload.devices) || body.devices || [];

  for (const dev of devicesArray) {
    const id = dev.id;
    const d = devices[id];
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
