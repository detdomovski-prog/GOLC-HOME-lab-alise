const deviceService = require('../services/deviceService');

// GET /v1.0/user/devices
exports.getDevices = (req, res) => {
  const requestId = req.requestId;
  const devices = deviceService.getDevicesList();
  res.status(200).json({ request_id: requestId, payload: { user_id: 'test-user', devices } });
};

// POST /v1.0/user/devices/query
exports.queryDevices = (req, res) => {
  const requestId = req.requestId;
  const body = req.body || {};
  // expected: { devices: [{ id: 'lamp1' }...] }
  const ids = (body.devices || []).map(d => d.id);
  const states = deviceService.queryDevices(ids);
  res.status(200).json({ request_id: requestId, payload: { devices: states } });
};

// POST /v1.0/user/devices/action
exports.actionDevices = (req, res) => {
  const requestId = req.requestId;
  const body = req.body || {};
  // expected body contains actions in typical Yandex payload structure
  // We'll apply actions and return action_result for each capability and device
  const results = deviceService.applyActions(body);
  res.status(200).json({ request_id: requestId, payload: { devices: results } });
};

// POST /v1.0/user/unlink
exports.unlinkUser = (req, res) => {
  const requestId = req.requestId;
  // perform any cleanup if needed
  res.status(200).json({ request_id: requestId });
};
