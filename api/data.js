// GET /api/data — public: stores + QR spots for the AR page
const { handle } = require('../lib/pins');
module.exports = (req, res) => handle(req, res, 'data');
