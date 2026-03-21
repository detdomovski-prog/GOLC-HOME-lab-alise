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
  }
};

exports.getDevicesList = function() {
  return Object.values(devices).map(d => ({
    id: d.id,
    name: d.name,
    type: d.type,
    status_info: d.status_info,
    capabilities: d.capabilities,
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
    if (!d) return { id, capabilities: [] };
    // Build capabilities states
    const caps = d.capabilities.map(c => {
      if (c.type === 'devices.capabilities.on_off') {
        return { type: c.type, state: { instance: 'on', value: !!d.state.on } };
      }
      return { type: c.type };
    });
    return { id: d.id, capabilities: caps };
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
