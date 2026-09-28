const assert = require('node:assert/strict');
const test = require('node:test');

const { buildBlastRadius } = require('../src/services/assetGraph.service');

test('buildBlastRadius returns bounded downstream contributions by shortest hop', () => {
  const result = buildBlastRadius([
    { asset_id: 'ROOT', hostname: 'core-ledger', risk_score: 80, dependencies: [] },
    { asset_id: 'API', hostname: 'payments-api', risk_score: 60, dependencies: ['ROOT'] },
    { asset_id: 'PORTAL', hostname: 'customer-portal', risk_score: 40, dependencies: ['API'] },
    { asset_id: 'TOO-FAR', hostname: 'third-hop', risk_score: 99, dependencies: ['PORTAL'] },
    { asset_id: 'OUT-OF-RANGE', hostname: 'unreachable-at-four-hops', risk_score: 99, dependencies: ['TOO-FAR'] }
  ], 'ROOT');

  assert.equal(result.formula_version, 'blast-radius-v1');
  assert.equal(result.impacted_assets.length, 3);
  assert.deepEqual(result.impacted_assets.map((asset) => asset.distance), [1, 2, 3]);
  assert.deepEqual(result.impacted_assets.map((asset) => asset.asset_id), ['API', 'PORTAL', 'TOO-FAR']);
  assert.equal(result.impacted_assets[0].contribution, 4.8);
  assert.equal(result.impacted_assets[1].contribution, 1.6);
  assert.equal(result.impacted_assets[2].contribution, 1.98);
  assert.equal(result.base_risk_score, 80);
  assert.equal(result.blast_radius_score, 88.38);
  assert.ok(result.blast_radius_score >= result.base_risk_score);
  assert.ok(result.blast_radius_score <= 99);
});

test('buildBlastRadius handles assets with no downstream dependents', () => {
  const result = buildBlastRadius([
    { asset_id: 'LEAF', risk_score: 34, dependencies: ['ROOT'] },
    { asset_id: 'ROOT', risk_score: 70, dependencies: [] }
  ], 'LEAF');

  assert.equal(result.impacted_asset_count, 0);
  assert.equal(result.propagation_uplift, 0);
  assert.equal(result.blast_radius_score, 34);
});
