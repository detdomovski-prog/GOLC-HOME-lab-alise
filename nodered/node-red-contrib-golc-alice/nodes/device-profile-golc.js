/**
 * device-profile-golc — конфигурационная нода профиля устройства Алисы
 * Хранит: учётные данные, имя, описание, комната, тип устройства
 */
module.exports = function (RED) {
  function DeviceProfileGolcNode(config) {
    RED.nodes.createNode(this, config);

    this.deviceName        = config.deviceName        || '';
    this.deviceDescription = config.deviceDescription || '';
    this.deviceRoom        = config.deviceRoom        || 'Комната';
    this.deviceType        = config.deviceType        || 'devices.types.light';

    // credentials.userLabel — метка авторизованного пользователя (хранится зашифрованно)
    // credentials.backendUrl / internalToken — параметры подключения к бэкенду
  }

  RED.nodes.registerType('device-profile-golc', DeviceProfileGolcNode, {
    credentials: {
      userLabel:     { type: 'text'     },
      backendUrl:    { type: 'text'     },
      internalToken: { type: 'password' }
    }
  });
};
