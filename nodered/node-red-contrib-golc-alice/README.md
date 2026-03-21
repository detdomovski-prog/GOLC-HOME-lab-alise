# node-red-contrib-golc-alice

DIY free Node-RED nodes for your personal Yandex Alice integration.

## Install

Inside your Node-RED user directory (usually `~/.node-red`):

```bash
npm install /opt/GOLC-HOME-lab-alise/nodered/node-red-contrib-golc-alice
```

Then restart Node-RED.

## Node: `alice-device`

Modes:

- `register` — register/update virtual device in backend registry.
- `state` — update state for an existing device.

Required backend env:

- `INTERNAL_TOKEN` (must match node config `Internal Token`)

Backend endpoints used:

- `POST /internal/registry/devices`
- `POST /internal/devices/:id/state`

## Message overrides

- `msg.mode` — override mode (`register` or `state`)
- `msg.device` — full device object for register mode
- `msg.deviceId` — device id for state mode
- `msg.state` — state object for state mode
