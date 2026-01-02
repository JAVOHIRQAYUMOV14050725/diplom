const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/rfid.controller');

// stream
router.get('/stream', ctrl.stream);

// scan
router.post('/', ctrl.scan);

// logs
router.get('/logs', ctrl.logs);

// inside
router.get('/inside', ctrl.inside);

// stats
router.get('/stats/today', ctrl.todayStats);
router.get('/stats/by-date', ctrl.statsByDate);

// 🔒 BLOCKED
router.get('/blocked', ctrl.list);
router.delete('/blocked/:uid', ctrl.unblock);

// login
router.post('/login', ctrl.login);

module.exports = router;
