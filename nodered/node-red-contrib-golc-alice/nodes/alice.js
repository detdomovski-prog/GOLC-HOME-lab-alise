"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const axios_1 = __importDefault(require("axios"));
const mqtt_1 = __importDefault(require("mqtt"));
module.exports = (RED) => {
    function AliceService(config) {
        RED.nodes.createNode(this, config);
        this.debug("Starting Alice service... ID: " + this.id);
        const email = (this.credentials.email || '').trim();
        const login = (this.credentials.id || '').trim();
        const password = this.credentials.password || '';
        const tokenRaw = this.credentials.token || '';
        const apiBaseUrl = (config.apiBaseUrl || 'https://alice.golchomelab.kz').replace(/\/$/, '');
        let accessToken = '';
        let mqttClient = null;

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

        const resolveToken = () => {
            if (!tokenRaw || typeof tokenRaw !== 'string') {
                return '';
            }
            try {
                const parsed = JSON.parse(tokenRaw);
                if (parsed && parsed.access_token) {
                    return parsed.access_token;
                }
            }
            catch (_err) {
            }
            return tokenRaw;
        };

        this.send2gate = (path, data, retain) => {
            if (!mqttClient || !this.isOnline) {
                return;
            }
            const payload = typeof data === 'string' ? data : JSON.stringify(data || {});
            mqttClient.publish(path, payload, { qos: 0, retain: !!retain }, (error) => {
                if (error) {
                    this.debug("Error when send MQTT event: " + error.message);
                }
            });
        };
        accessToken = resolveToken();

        if (!login || !password) {
            this.error("Authentication is required: set login and password in node credentials");
            setOffline();
            return;
        }

        if (!accessToken) {
            this.error("OAuth token is required: set token in node credentials");
            setOffline();
            return;
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
                url: 'https://api.iot.yandex.net/v1.0/user/info',
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

        mqttClient = mqtt_1.default.connect('mqtts://mqtt.cloud.yandex.net', {
            port: 8883,
            clientId: login,
            rejectUnauthorized: false,
            username: login,
            password,
            reconnectPeriod: 10000
        });

        mqttClient.on('message', (topic, payload) => {
            try {
                const arrTopic = topic.split('/');
                const data = JSON.parse(payload.toString());
                this.trace("Incoming:" + topic + " timestamp:" + new Date().getTime());
                if (payload.length && typeof data === 'object') {
                    if (arrTopic[3] === 'message') {
                        this.warn(data.text);
                    }
                    else {
                        this.emit(arrTopic[3], data);
                    }
                }
            }
            catch (error) {
                this.debug("Error parse MQTT payload: " + error.message);
            }
        });

        mqttClient.on('connect', () => {
            this.debug('Yandex IOT client connected');
            setOnline();
            mqttClient.subscribe('$me/device/commands/+', () => {
                this.debug('Yandex IOT client subscribed to commands');
            });
        });

        mqttClient.on('offline', () => {
            this.debug('Yandex IOT client offline');
            setOffline();
        });

        mqttClient.on('disconnect', () => {
            this.debug('Yandex IOT client disconnect');
            setOffline();
        });

        mqttClient.on('reconnect', () => {
            this.debug('Yandex IOT client reconnecting ...');
        });

        mqttClient.on('error', (error) => {
            this.error('Yandex IOT client error: ' + error.message);
            setOffline();
        });

        this.on('offline', () => {
            this.isOnline = false;
        });

        this.on('online', () => {
            this.isOnline = true;
        });

        this.on('close', (_removed, done) => {
            setOffline();
            setTimeout(() => {
                if (mqttClient) {
                    mqttClient.end(false, {}, done);
                    return;
                }
                done();
            }, 500);
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