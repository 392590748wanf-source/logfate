// 用模拟挂单验证大区响应被缩成摘要后，推荐价和缺失项结果保持一致。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'fantasy.js'), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('          const candidateIds = candidateMaterials.map(material => material.uid).join(\',\');');
const end = source.indexOf('        } catch (error) {\n          batch.forEach(material => {', start);
assert.ok(start > 0 && end > start, '必须检查实际的大区挂单处理代码');

const candidateMaterials = [1, 2].map(uid => ({ uid, marketNpcSnapshots: { '100': { status: 'pending-data-center' } } }));
const failed = [];
const context = vm.createContext({
  candidateMaterials, failed, refreshedAt: '2026-10-07',
  CHINA_MARKET_DATA_CENTERS: ['A', 'B', 'C', 'D'],
  requestMarket: async url => {
    if (url.includes('/B/')) throw new Error('offline');
    return {
      items: {
        '1': { listings: [{ pricePerUnit: 20, quantity: 5 }, { pricePerUnit: 30, quantity: 5 }] },
        '2': { listings: [{ pricePerUnit: 40, quantity: 3 }] }
      },
      unresolvedItems: url.includes('/A/') ? ['missing'] : []
    };
  },
  weightedListingPrice: listings => listings?.length ? {
    price: listings.reduce((sum, row) => sum + row.pricePerUnit, 0) / listings.length,
    quantity: listings.reduce((sum, row) => sum + row.quantity, 0)
  } : null,
  validMarketListings: listings => listings || [],
  npcMarketSnapshot: (listings, npcPrice) => ({ status: 'checked', eligibleQuantity: (listings || []).filter(row => row.pricePerUnit < npcPrice).reduce((sum, row) => sum + row.quantity, 0) })
});

(async () => {
  await vm.runInContext(`(async () => { ${source.slice(start, end)} })()`, context);
  assert.equal(candidateMaterials[0].marketDataCenters.A.price, 25);
  assert.equal(candidateMaterials[1].marketDataCenters.C.price, 40);
  assert.equal(candidateMaterials[0].marketDataCenters.B.status, 'error');
  assert.equal(candidateMaterials[0].marketNpcSnapshots['100'].dataCenters.A.eligibleQuantity, 10);
  assert.equal(candidateMaterials[1].marketNpcSnapshots['100'].dataCenters.D.eligibleQuantity, 3);
  assert.equal(candidateMaterials[0].marketNpcSnapshots['100'].dataCenters.B.status, 'error');
  assert.deepEqual(failed, ['missing'], '同一批未解析材料只记录一次');
  console.log('Market refresh compact-response checks passed (simulated listings only).');
})().catch(error => { console.error(error); process.exitCode = 1; });
