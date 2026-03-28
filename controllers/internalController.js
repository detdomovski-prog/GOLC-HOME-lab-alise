const deviceService = require('../services/deviceService');

function getInternalToken(req) {
  return req.headers['x-internal-token'] || req.headers['X-Internal-Token'];
}

function isInternalAuthorized(req) {
  const expected = process.env.INTERNAL_TOKEN || 'local-internal-token';
  return getInternalToken(req) === expected;
}

exports.ensureInternalAuth = (req, res, next) => {
  if (!isInternalAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid internal token' });
  }
  return next();
};

exports.getStates = (req, res) => {
  const requestId = req.requestId;
  const ids = req.query.ids ? String(req.query.ids).split(',').map(x => x.trim()).filter(Boolean) : [];
  const snapshot = deviceService.getStateSnapshot(ids);
  res.status(200).json({ request_id: requestId, payload: { devices: snapshot } });
};

exports.updateSingleState = (req, res) => {
  const requestId = req.requestId;
  const id = req.params.id;
  const statePatch = (req.body && req.body.state) || req.body || {};
  const updated = deviceService.updateDeviceState(id, statePatch);

  if (!updated) {
    return res.status(404).json({ request_id: requestId, error: 'DEVICE_NOT_FOUND', message: 'Device not found' });
  }

  return res.status(200).json({ request_id: requestId, payload: updated });
};

exports.updateBulkStates = (req, res) => {
  const requestId = req.requestId;
  const devices = (req.body && req.body.devices) || [];

  if (!Array.isArray(devices)) {
    return res.status(400).json({ request_id: requestId, error: 'INVALID_BODY', message: 'devices must be an array' });
  }

  const result = devices.map(item => {
    const id = item && item.id;
    const statePatch = (item && item.state) || {};
    const updated = deviceService.updateDeviceState(id, statePatch);
    if (!updated) {
      return { id, error_code: 'DEVICE_NOT_FOUND', error_message: 'Device not found' };
    }
    return updated;
  });

  return res.status(200).json({ request_id: requestId, payload: { devices: result } });
};

exports.registerDevices = (req, res) => {
  const requestId = req.requestId;
  const devices = (req.body && req.body.devices) || [];

  if (!Array.isArray(devices)) {
    return res.status(400).json({ request_id: requestId, error: 'INVALID_BODY', message: 'devices must be an array' });
  }

  const result = deviceService.registerVirtualDevices(devices);
  return res.status(200).json({ request_id: requestId, payload: { devices: result } });
};

exports.listRegisteredDevices = (req, res) => {
  const requestId = req.requestId;
  const devices = deviceService.listVirtualDevices();
  return res.status(200).json({ request_id: requestId, payload: { devices } });
};

exports.deleteRegisteredDevice = (req, res) => {
  const requestId = req.requestId;
  const id = req.params.id;
  const removed = deviceService.deleteVirtualDevice(id);

  if (!removed) {
    return res.status(404).json({ request_id: requestId, error: 'DEVICE_NOT_FOUND', message: 'Device not found' });
  }

  return res.status(200).json({ request_id: requestId, payload: { id, status: 'deleted' } });
};
