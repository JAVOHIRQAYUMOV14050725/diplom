const express = require('express');
const router = express.Router();
const users = require('../controllers/users.controller');

// Note: mounted at /api/users in app -> use root paths here
router.get('/', users.list);
router.post('/', users.create);
router.delete('/:id', users.remove);

module.exports = router;