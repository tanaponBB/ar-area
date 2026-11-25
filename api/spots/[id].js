// PUT / DELETE /api/spots/:id — update or delete (admin key required)
const { handle } = require('../../lib/pins');
module.exports = (req, res) => handle(req, res, 'spots', String(req.query.id || ''));
