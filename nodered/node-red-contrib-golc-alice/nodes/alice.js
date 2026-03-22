"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const axios_1 = __importDefault(require("axios"));
module.exports = (RED) => {
    function AliceService(config) {
        RED.nodes.createNode(this, config);
        this.debug("Starting Alice service... ID: " + this.id);
        const login = (this.credentials.id || '').trim();
        const password = this.credentials.password || '';
        const apiBaseUrl = (config.apiBaseUrl || 'http://127.0.0.1:3001').replace(/\/$/, '');
        let accessToken = '';

        const normalizeToken = (rawToken) => {
            if (!rawToken) {
                return '';
            }
            if (typeof rawToken !== 'string') {
                return '';
            }
            try {
                const tokenJson = JSON.parse(rawToken);
                if (tokenJson && tokenJson.access_token) {
                    return tokenJson.access_token;
                }
            }
            catch (_err) {
            }
            return rawToken;
        };

        this.isOnline = false;
        this.getApiBaseUrl = () => apiBaseUrl;
        this.getToken = () => accessToken;

        const setOnline = () => {
            if (!this.isOnline) {
                this.isOnline = true;
                this.emit('online');
            }
        };

        const setOffline = () => {
            if (this.isOnline) {
                this.isOnline = false;
                this.emit('offline');
            }
        };

        this.send2gate = (path, data, _retain) => {
            if (!accessToken) {
                return;
            }
            let payloadData = data;
            if (typeof data === 'string') {
                try {
                    payloadData = JSON.parse(data);
                }
                catch (_err) {
                    payloadData = { raw: data };
                }
            }
            axios_1.default.request({
                timeout: 5000,
                method: 'POST',
                url: `${apiBaseUrl}/gtw/device/events`,
                headers: {
                    'content-type': 'application/json',
                    'Authorization': "Bearer " + accessToken
                },
                data: {
                    path,
                    payload: payloadData
                }
            }).catch(error => {
                this.debug("Error when send event to gateway: " + error.message);
            });
        };

        const authByBackend = () => {
            if (!login || !password) {
                this.error("Authentication is required: set login and password");
                setOffline();
                return;
            }
            axios_1.default.request({
                timeout: 7000,
                method: 'POST',
                url: `${apiBaseUrl}/api/login`,
                headers: {
                    'content-type': 'application/json'
                },
                data: {
                    username: login,
                    password
                }
            }).then(result => {
                const data = result.data || {};
                if (!data.ok || !data.access_token) {
                    throw new Error('Backend auth failed');
                }
                accessToken = data.access_token;
                this.credentials.token = accessToken;
                RED.nodes.addCredentials(this.id, this.credentials);
                setOnline();
                this.debug("Backend auth successful");
            }).catch(error => {
                this.error("Backend auth error: " + error.message);
                setOffline();
            });
        };

        accessToken = normalizeToken(this.credentials.token);
        if (accessToken) {
            setOnline();
        }
        else {
            authByBackend();
        }

        const serviceRouteId = login || this.id;
        RED.httpAdmin.get("/noderedhome/" + serviceRouteId + "/clearalldevice", (_req, res) => {
            if (!accessToken) {
                res.status(401).send('No token');
                return;
            }
            axios_1.default.request({
                timeout: 7000,
                method: 'POST',
                url: `${apiBaseUrl}/gtw/device/clearallconfigs`,
                headers: {
                    'content-type': 'application/json',
                    'Authorization': "Bearer " + accessToken
                },
                data: {}
            })
                .then(() => {
                this.trace("All devices configs deleted on gateway successfully");
                res.sendStatus(200);
            })
                .catch(error => {
                this.debug("Error when delete all device configs: " + error.message);
                res.sendStatus(500);
            });
        });

        RED.httpAdmin.get("/noderedhome/" + serviceRouteId + "/getfullconfig", (_req, res) => {
            if (!accessToken) {
                res.status(401).send('No token');
                return;
            }
            axios_1.default.request({
                timeout: 7000,
                method: 'GET',
                url: `${apiBaseUrl}/v1.0/user/info`,
                headers: {
                    'content-type': 'application/json',
                    'Authorization': "Bearer " + accessToken
                }
            })
                .then(result => {
                this.trace("Full SmartHome config successfully retrieved");
                res.json(result.data);
            })
                .catch(error => {
                this.debug("Error when retrieve full config: " + error.message);
                res.sendStatus(500);
            });
        });

        this.on('close', (_removed, done) => {
            setOffline();
            setTimeout(() => {
                done();
            }, 100);
        });
    }
    RED.nodes.registerType("alice-service", AliceService, {
        credentials: {
            email: { type: "text" },
            password: { type: "password" },
            token: { type: "password" },
            id: { type: "text" }
        }
    });
};
//# sourceMappingURL=alice.js.map