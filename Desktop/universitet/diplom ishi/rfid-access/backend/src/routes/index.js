const express = require('express');
const router = express.Router();

router.use('/rfid', require('./rfid.routes'));
router.use('/users', require('./users.routes'));
router.use('/blocked-uids', require('./blockedUid.routes'));


module.exports = router;
