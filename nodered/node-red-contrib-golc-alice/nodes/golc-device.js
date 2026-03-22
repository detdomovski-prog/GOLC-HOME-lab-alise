const http = require('http');
const https = require('https');

function asBoolean(value, fallback) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return fallback;
}

function requestJson(method, targetUrl, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const lib = parsed.protocol === 'https:' ? https : http;

    const payload = body ? JSON.stringify(body) : null;

    const req = lib.request(
      {
        method,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        headers: {
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(headers || {}),
        },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            const json = raw ? JSON.parse(raw) : {};
            resolve({ statusCode: res.statusCode, body: json });
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = function (RED) {
  function AliceDeviceNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.backendUrl = (config.backendUrl || 'http://localhost:3000').replace(/\/$/, '');
    node.internalToken = config.internalToken || 'local-internal-token';
    node.mode = config.mode || 'register';

    node.deviceId = config.deviceId || '';
    node.deviceName = config.deviceName || '';
    node.devicePreset = config.devicePreset || 'light';
    node.deviceType = config.deviceType || 'devices.types.light';

    node.withOnOff = asBoolean(config.withOnOff, true);
    node.withTemperature = asBoolean(config.withTemperature, false);
    node.withHumidity = asBoolean(config.withHumidity, false);
    node.withOpenSensor = asBoolean(config.withOpenSensor, false);

    async function handleRegister(msg) {
      const deviceId = (msg.deviceId || node.deviceId || '').trim();
      if (!deviceId) {
        throw new Error('deviceId is required for register mode');
      }

      const baseDevice = {
        id: deviceId,
        name: (msg.deviceName || node.deviceName || deviceId).trim(),
        type: node.deviceType,
        status_info: { reportable: true },
        capabilities: [],
        properties: [],
        state: {},
      };

      if (node.withOnOff) {
        baseDevice.capabilities.push({ type: 'devices.capabilities.on_off', retrievable: true });
        baseDevice.state.on = false;
      }

      if (node.withTemperature) {
        baseDevice.properties.push({
          type: 'devices.properties.float',
          retrievable: true,
          reportable: true,
          parameters: { instance: 'temperature', unit: 'unit.temperature.celsius' },
        });
        baseDevice.state.temperature = 22;
      }

      if (node.withHumidity) {
        baseDevice.properties.push({
          type: 'devices.properties.float',
          retrievable: true,
          reportable: true,
          parameters: { instance: 'humidity', unit: 'unit.percent' },
        });
        baseDevice.state.humidity = 50;
      }

      if (node.withOpenSensor) {
        baseDevice.properties.push({
          type: 'devices.properties.event',
          retrievable: true,
          reportable: true,
          parameters: { instance: 'open', events: [{ value: 'opened' }, { value: 'closed' }] },
        });
        baseDevice.state.open = 'closed';
      }

      const deviceFromMsg = msg.device && typeof msg.device === 'object' ? msg.device : {};
      const merged = {
        ...baseDevice,
        ...deviceFromMsg,
        id: deviceFromMsg.id || baseDevice.id,
        name: deviceFromMsg.name || baseDevice.name,
        state: {
          ...baseDevice.state,
          ...(deviceFromMsg.state || {}),
        },
      };

      const url = `${node.backendUrl}/internal/registry/devices`;
      const response = await requestJson(
        'POST',
        url,
        { 'X-Internal-Token': node.internalToken },
        { devices: [merged] }
      );

      msg.payload = response.body;
      msg.statusCode = response.statusCode;
      return msg;
    }

    async function handleStateUpdate(msg) {
      const id = (msg.deviceId || node.deviceId || '').trim();
      if (!id) {
        throw new Error('deviceId is required for state mode');
      }

      const state = (msg.state && typeof msg.state === 'object') ? msg.state : (msg.payload && typeof msg.payload === 'object' ? msg.payload : null);
      if (!state) {
        throw new Error('msg.state or msg.payload object is required for state mode');
      }

      const url = `${node.backendUrl}/internal/devices/${encodeURIComponent(id)}/state`;
      const response = await requestJson(
        'POST',
        url,
        { 'X-Internal-Token': node.internalToken },
        { state }
      );

      msg.payload = response.body;
      msg.statusCode = response.statusCode;
      return msg;
    }

    node.on('input', async (msg, send, done) => {
      const sender = send || node.send.bind(node);
      try {
        const mode = (msg.mode || node.mode || 'register').toLowerCase();
        node.status({ fill: 'blue', shape: 'dot', text: `alice ${mode}...` });

        const outMsg = mode === 'state'
          ? await handleStateUpdate(msg)
          : await handleRegister(msg);

        node.status({ fill: 'green', shape: 'dot', text: `ok ${mode}` });
        sender(outMsg);
        done();
      } catch (error) {
        node.status({ fill: 'red', shape: 'ring', text: 'error' });
        done(error);
      }
    });
  }

  RED.nodes.registerType('golchomelab-virtual-device', AliceDeviceNode);
};
