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
  // body should contain payload.devices or actions depending on client
  // We'll try to support both shapes: { devices: [...] } or { actions: [...] }
  const results = [];

  // If payload structure like { devices: [{ id, capabilities: [...] }] }
  const devicesArray = (body.payload && body.payload.devices) || body.devices || [];

  for (const dev of devicesArray) {
    const id = dev.id;
    const d = devices[id];
    if (!d) {
      results.push({ id, capabilities: [], action_result: { status: 'ERROR', error_code: 'DEVICE_NOT_FOUND' } });
      continue;
    }
    const capsRes = [];
    if (dev.capabilities && Array.isArray(dev.capabilities)) {
      for (const cap of dev.capabilities) {
        if (cap.type === 'devices.capabilities.on_off') {
          // If requested state provided
          const value = cap.state && cap.state.value;
          if (typeof value === 'boolean') {
            d.state.on = value;
            capsRes.push({ type: cap.type, state: { instance: 'on', value: d.state.on }, action_result: { status: 'DONE' } });
          } else {
            // if no clear value, return current
            capsRes.push({ type: cap.type, state: { instance: 'on', value: d.state.on }, action_result: { status: 'ERROR' } });
          }
        } else {
          capsRes.push({ type: cap.type, action_result: { status: 'ERROR' } });
        }
      }
    }
    results.push({ id: d.id, capabilities: capsRes, action_result: { status: 'DONE' } });
  }

  return results;
};
