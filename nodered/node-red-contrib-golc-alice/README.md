# node-red-contrib-golc-alice

DIY free Node-RED nodes for your personal Yandex Alice integration.

## Install

Inside your Node-RED user directory (usually `~/.node-red`):

```bash
npm install /opt/GOLC-HOME-lab-alise/nodered/node-red-contrib-golc-alice
```

Then restart Node-RED.

## Node: `golchomelab-auth`

First node for OAuth authorization flow with Alice-compatible backend.

Actions:

- `get_token` — requests token from backend endpoint (default `POST /endpoint/token`)
- `build_auth_url` — generates authorization URL (default `GET /endpoint/auth`)

Outputs in `get_token` mode:

- `msg.oauth` — full token response
- `msg.access_token` — token string
- `msg.headers.Authorization` — `Bearer <token>` (if enabled)

Outputs in `build_auth_url` mode:

- `msg.authUrl` — ready-to-open authorization URL

## Node: `golchomelab-virtual-device`

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

For `golchomelab-auth` node you can override with:

- `msg.action`, `msg.tokenEndpoint`, `msg.authEndpoint`
- `msg.clientId`, `msg.clientSecret`, `msg.redirectUri`, `msg.scope`
- `msg.code`, `msg.state`, `msg.grantType`
