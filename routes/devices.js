const express = require('express');
const controller = require('../controllers/devicesController');
const router = express.Router();

// GET /v1.0/user/devices
router.get('/user/devices', controller.getDevices);

// POST /v1.0/user/devices/query
router.post('/user/devices/query', controller.queryDevices);

// POST /v1.0/user/devices/action
router.post('/user/devices/action', controller.actionDevices);

// POST /v1.0/user/unlink
router.post('/user/unlink', controller.unlinkUser);

module.exports = router;
