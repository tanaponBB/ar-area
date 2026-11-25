// PUT / DELETE /api/stores/:id — update or delete (admin key required)
const { handle } = require('../../lib/pins');
module.exports = (req, res) => handle(req, res, 'stores', String(req.query.id || ''));
