const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/rfid.controller');

// stream: GET /api/rfid/stream
router.get('/stream', ctrl.stream);

// scan: POST /api/rfid
router.post('/', ctrl.scan);

// logs: GET /api/rfid/logs?limit=100
router.get('/logs', ctrl.logs);

// inside count: GET /api/rfid/inside
router.get('/inside', ctrl.inside);
// today entry chart
router.get('/stats/today', ctrl.todayStats);
// entry stats by date
router.get('/stats/by-date', ctrl.statsByDate);
router.get('/', ctrl.list);          // GET /api/blocked
router.delete('/:uid', ctrl.unblock); // DELETE /api/blocked/:uid

// login for admin UI (uses env ADMIN_USER / ADMIN_PASS and returns JWT)
router.post('/login', ctrl.login);

module.exports = router;