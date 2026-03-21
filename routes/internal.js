const express = require('express');
const controller = require('../controllers/internalController');

const router = express.Router();

router.use('/internal', controller.ensureInternalAuth);

router.get('/internal/devices/state', controller.getStates);
router.post('/internal/devices/:id/state', controller.updateSingleState);
router.post('/internal/devices/bulk-state', controller.updateBulkStates);
router.get('/internal/registry/devices', controller.listRegisteredDevices);
router.post('/internal/registry/devices', controller.registerDevices);
router.delete('/internal/registry/devices/:id', controller.deleteRegisteredDevice);

module.exports = router;
