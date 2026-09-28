const { getBlastRadius } = require('../services/assetGraph.service');

const getAssetBlastRadius = async (req, res, next) => {
  try {
    const profile = await getBlastRadius(req.params.asset_id);
    if (!profile) return res.status(404).json({ success: false, message: 'Asset not found' });
    res.status(200).json({ success: true, data: profile });
  } catch (error) {
    next(error);
  }
};

module.exports = { getAssetBlastRadius };
