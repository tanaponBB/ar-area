// GET /api/session — checks the admin key
const { handle } = require('../lib/pins');
module.exports = (req, res) => handle(req, res, 'session');
