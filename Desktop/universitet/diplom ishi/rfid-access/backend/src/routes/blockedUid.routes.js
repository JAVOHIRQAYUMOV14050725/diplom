// src/routes/blockedUid.routes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/blockedUid.controller');

router.get('/', ctrl.list);          // GET blocked
router.post('/block', ctrl.block);   // POST block
router.post('/unblock', ctrl.unblock);

module.exports = router;
