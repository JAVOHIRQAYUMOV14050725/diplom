const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/rfid.controller');

// stream: GET /api/rfid/stream
router.get('/stream', ctrl.stream);

// scan: POST /api/rfid
router.post('/', ctrl.scan);

// logs: GET /api/rfid/logs?limit=100
router.get('/logs', ctrl.logs);

// login for admin UI (uses env ADMIN_USER / ADMIN_PASS and returns JWT)
router.post('/login', ctrl.login);

module.exports = router;