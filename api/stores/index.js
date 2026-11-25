// POST /api/stores — create (admin key required)
const { handle } = require('../../lib/pins');
module.exports = (req, res) => handle(req, res, 'stores');
