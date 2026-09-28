const FORMULA_VERSION = 'blast-radius-v1';
const DEFAULT_DECAY_FACTOR = 0.5;
const DEFAULT_MAX_HOPS = 3;
const CONTRIBUTION_RATE = 0.08;
const MAX_UPLIFT_POINTS = 18;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const rounded = (value, decimals = 2) => Number(Number(value).toFixed(decimals));

/**
 * The derived score is bounded and leaves the existing base risk untouched:
 * blast_radius_score = min(99, base_risk_score + min(sum(dependent_base_score
 * x contribution_rate x decay_factor ^ (distance - 1)), max_uplift)).
 * max_uplift is capped at 18 points and 20% of the base score so this remains
 * an explainable propagation estimate rather than a second risk engine.
 */
const buildBlastRadius = (assets = [], assetId, options = {}) => {
  const decayFactor = clamp(Number(options.decayFactor ?? DEFAULT_DECAY_FACTOR), 0, 1);
  const maxHops = clamp(Math.floor(Number(options.maxHops ?? DEFAULT_MAX_HOPS)), 1, 3);
  const normalizedAssets = assets.map((asset) => ({
    asset_id: String(asset.asset_id),
    hostname: asset.hostname || asset.asset_id,
    dependencies: Array.isArray(asset.dependencies) ? [...new Set(asset.dependencies.map(String))] : [],
    base_risk_score: clamp(Number(asset.risk_score) || 0, 0, 99)
  }));
  const byId = new Map(normalizedAssets.map((asset) => [asset.asset_id, asset]));
  const root = byId.get(String(assetId));
  if (!root) return null;

  const dependentsByDependency = new Map();
  normalizedAssets.forEach((asset) => {
    asset.dependencies.forEach((dependencyId) => {
      if (!byId.has(dependencyId)) return;
      const dependents = dependentsByDependency.get(dependencyId) || [];
      dependents.push(asset.asset_id);
      dependentsByDependency.set(dependencyId, dependents);
    });
  });

  const distances = new Map();
  const queue = (dependentsByDependency.get(root.asset_id) || []).map((id) => ({ id, distance: 1 }));
  while (queue.length) {
    const { id, distance } = queue.shift();
    if (id === root.asset_id || distance > maxHops) continue;
    const previousDistance = distances.get(id);
    if (previousDistance !== undefined && previousDistance <= distance) continue;
    distances.set(id, distance);
    (dependentsByDependency.get(id) || []).forEach((dependentId) => {
      queue.push({ id: dependentId, distance: distance + 1 });
    });
  }

  const impactedAssets = [...distances.entries()].map(([id, distance]) => {
    const asset = byId.get(id);
    const contribution = asset.base_risk_score * CONTRIBUTION_RATE * (decayFactor ** (distance - 1));
    return {
      asset_id: asset.asset_id,
      hostname: asset.hostname,
      distance,
      base_risk_score: rounded(asset.base_risk_score),
      contribution: rounded(contribution)
    };
  }).sort((left, right) => left.distance - right.distance || right.contribution - left.contribution || left.asset_id.localeCompare(right.asset_id));

  const rawUplift = impactedAssets.reduce((sum, asset) => sum + asset.contribution, 0);
  const maxUplift = Math.min(MAX_UPLIFT_POINTS, root.base_risk_score * 0.2);
  const appliedUplift = Math.min(rawUplift, maxUplift);

  return {
    asset_id: root.asset_id,
    hostname: root.hostname,
    base_risk_score: rounded(root.base_risk_score),
    blast_radius_score: rounded(clamp(root.base_risk_score + appliedUplift, 0, 99)),
    propagation_uplift: rounded(appliedUplift),
    impacted_assets: impactedAssets,
    impacted_asset_count: impactedAssets.length,
    decay_factor: decayFactor,
    max_hops: maxHops,
    formula_version: FORMULA_VERSION,
    formula: 'min(99, base + min(sum(dependent_base x 0.08 x 0.5^(distance-1)), min(18, base x 0.20)))',
    explanation: 'Derived estimated propagation based on stored dependency links; the certified base risk score is unchanged.',
    computed_at: new Date().toISOString()
  };
};

const getBlastRadius = async (assetId, options = {}) => {
  const Asset = require('../models/Asset');
  const assets = await Asset.find().select('asset_id hostname dependencies risk_score').lean();
  return buildBlastRadius(assets, assetId, options);
};

module.exports = {
  FORMULA_VERSION,
  buildBlastRadius,
  getBlastRadius
};
