// 出售时成本检查只在内存中运行，不读取或修改用户账本。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { cheapestPlan, validPlan, readCache, writeCache } = require('../craft-scrip-simulator.js');

const penPlan = {
  qualityCap: 6000,
  ingredients: [{ uid: 44050, amount: 1, level: 660 }, { uid: 44023, amount: 2, level: 680 }, { uid: 44033, amount: 1, level: 680 }],
  macros: [
    { initialQuality: 2936, seconds: 6, collectability: 1140, scripts: ['/ac "加工" <wait.3>\n/ac "制作" <wait.3>'] },
    { initialQuality: 5846, seconds: 3, collectability: 1140, scripts: ['/ac "精密制作" <wait.3>'] }
  ]
};
assert.equal(validPlan(penPlan, 1140), true);
assert.equal(validPlan(penPlan, 1141), false);
const penPrices = new Map([[44050, { hq: 1100, nq: 100 }], [44023, { hq: 101, nq: 100 }], [44033, { hq: 1100, nq: 100 }]]);
const savedPlans = new Map();
const storage = { getItem: key => savedPlans.get(key), setItem: (key, value) => savedPlans.set(key, value) };
const penKey = JSON.stringify({ recipeId: 35823, target: 1140 });
writeCache(storage, penKey, { plan: penPlan });
const planCacheKey = [...savedPlans.keys()][0];
// Exercise the previous format as well as the new outcome envelope.
savedPlans.set(planCacheKey, JSON.stringify([[penKey, penPlan]]));
const failedKey = JSON.stringify({ recipeId: 35824, target: 1140 });
writeCache(storage, failedKey, { error: '后台模拟超时' });
const restoredPlan = readCache(storage).get(penKey).plan;
assert.deepEqual(restoredPlan, penPlan);
assert.deepEqual(readCache(storage).get(failedKey), { error: '后台模拟超时' });
const affordable = cheapestPlan(restoredPlan, penPrices, 0);
assert.equal(affordable.initialQuality, 3022, '两份 HQ 木材提供 3022 初期品质');
assert.deepEqual([...affordable.hqCounts], [[44050, 0], [44023, 2], [44033, 0]]);
assert.equal(cheapestPlan(restoredPlan, penPrices, 3_600_000).macro.seconds, 3, '人工更贵时复用更短的已保存宏');
penPrices.get(44023).hq = 0;
assert.equal(cheapestPlan(restoredPlan, penPrices, 0).hqCounts.get(44023), 0, '缺价 HQ 木材由其他可报价垫料替换');
penPrices.get(44033).hq = 0;
assert.equal(cheapestPlan(restoredPlan, penPrices, 0), null, '报价齐全的组合达不到要求时不计价');

const source = fs.readFileSync(path.join(__dirname, '..', 'fantasy.js'), 'utf8');
const slice = (from, to) => {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `${from} / ${to} 未找到`);
  return source.slice(start, end);
};
const percentileContext = vm.createContext({ marketComparisonCost: price => Number(price || 0) * 1.05 });
const marketMethod = source.match(/^  const EQUIPMENT_QUALITY_MARKET_METHOD = [^\n]+/m)[0];
const marketPricing = marketMethod + '\n' + slice('  const EQUIPMENT_QUALITY_MARKET_MIN_LISTINGS', '  const craftedUnitComparisonCost');
vm.runInContext(marketPricing, percentileContext);
const percentile = vm.runInContext('equipmentQualityMarketPercentile', percentileContext);
const qualityPrice = vm.runInContext('equipmentQualityMarketPrice', percentileContext);
const quote = vm.runInContext('marketReferenceQuote', percentileContext);
const qualityQuotes = vm.runInContext('marketReferenceQuotesForListings', percentileContext);
const npcSnapshot = vm.runInContext('marketNpcSnapshot', percentileContext);
const suspiciousListings = [100, 200, 300, 400, 1000000].map((pricePerUnit, index) => ({ pricePerUnit, quantity: index === 4 ? 999 : 1 }));
assert.equal(percentile(suspiciousListings).price, 200, 'P25 不受高价大挂单拉高');
assert.equal(quote(suspiciousListings).price, 200, '加权均价被异常高价抬高超过 50% 时改用 P25');
assert.equal(quote(suspiciousListings).method, 'p25');
assert.equal(quote([100, 100, 100, 100, 350].map(pricePerUnit => ({ pricePerUnit, quantity: 1 }))).method, 'weighted', '恰好高出 50% 仍采用均价');
assert.equal(quote([100, 200, 300, 400, 500].map((pricePerUnit, index) => ({ pricePerUnit, quantity: index === 0 ? 999 : 1 }))).price, 100, '均价低于 P25 时保留低价库存优势');
assert.equal(quote(suspiciousListings.slice(0, 4)).lowSample, true, '不足五条仍沿用加权均价并标记样本少');
assert.equal(quote(suspiciousListings.slice(0, 4)).price, 250);
assert.equal(quote([]).price, 0, '无有效挂单不提供报价');
assert.equal(percentile([...suspiciousListings, { pricePerUnit: -1, quantity: 1 }]).count, 5, '无效挂单不进入样本');
const mixed = qualityQuotes([{ hq: true, pricePerUnit: 100, quantity: 100 }, { hq: false, pricePerUnit: 200, quantity: 100 }]);
assert.equal(mixed.any.count, 2, '潜艇通用口径合并 HQ 与 NQ 挂单');
assert.equal(mixed.any.price, 150);
assert.equal(mixed.hq.price, 100);
assert.equal(mixed.nq.price, 200);
const pooled = qualityQuotes([100, 110, 120, 130, 140, 150].map((pricePerUnit, index) => ({ pricePerUnit, quantity: 1, hq: index < 3 })));
assert.equal(pooled.any.count, 6, '两种品质合计达到 P25 样本门槛');
assert.ok(pooled.any.p25Price > 0);
assert.equal(pooled.hq.p25Price, 0);
assert.equal(pooled.nq.p25Price, 0);
const npcListings = [{ hq: true, pricePerUnit: 100, quantity: 120 }, { hq: false, pricePerUnit: 100, quantity: 80 }];
assert.equal(npcSnapshot(npcListings, 200).eligibleQuantity, 200, 'NPC 低价库存门槛合计 HQ 与 NQ 数量');
assert.equal(npcSnapshot(npcListings, 100).eligibleQuantity, 0, '含税报价不低于 NPC 时不算合格库存');
const candidateContext = vm.createContext({
  marketComparisonCost: price => Number(price || 0) * 1.05,
  money: value => `${Math.round(value)} G`, npcCandidate: () => null,
  MARKET_NPC_STOCK_THRESHOLD: 200
});
vm.runInContext(marketPricing +
  slice('  const marketNpcSnapshotKey', '  const sourceOptionPriceLabel'), candidateContext);
const marketCandidate = vm.runInContext('marketPurchaseCandidate', candidateContext);
const npcMaterial = { marketStatus: 'listing-weighted', marketQualityMethod: 'hybrid-p25-weighted-v1', marketReferenceQuotes: { any: { price: 100 } }, marketNpcSnapshots: { '200': { dataCenters: { A: npcSnapshot(npcListings, 200) } } } };
assert.equal(marketCandidate(npcMaterial, { price: 200 }).price, 105, 'HQ 与 NQ 合计达到 200 个后市场可参与 NPC 比价');
npcMaterial.marketNpcSnapshots['200'].dataCenters.A.eligibleQuantity = 199;
assert.equal(marketCandidate(npcMaterial, { price: 200 }).price, 0, '库存不足时市场价仅供参考');
npcMaterial.marketStatus = 'stale';
assert.equal(marketCandidate(npcMaterial, { price: 200 }).price, 0, '保留的库存核验也须满足门槛');
npcMaterial.marketNpcSnapshots['200'].dataCenters.A.eligibleQuantity = 200;
assert.equal(marketCandidate(npcMaterial, { price: 200 }).price, 105, '刷新失败时保留满足库存门槛的报价');
assert.equal(marketCandidate(npcMaterial, null).price, 105, '无 NPC 时旧报价继续用于含税成本');
const p25Material = { marketStatus: 'listing-weighted', marketQualityMethod: 'hybrid-p25-weighted-v1', marketReferenceQuotes: { hq: { price: 200 } } };
assert.equal(qualityPrice(p25Material, 'hq'), 200);
p25Material.marketStatus = 'stale';
assert.equal(qualityPrice(p25Material, 'hq'), 200, '失败时沿用对应品质报价');
p25Material.marketStatus = 'listing-weighted';
p25Material.marketQualityMethod = 'p25-v1';
assert.equal(qualityPrice(p25Material, 'hq'), 0, '旧缓存不能冒充新版混合报价');
const recipes = new Map([
  [1000, { y: 1, a: [49214, 2, 44001, 1, 49220, 1, 9, 1] }],
  [1001, { y: 1, a: [49214, 2, 44001, 1, 49220, 1, 9, 1] }],
  [1002, { y: 1, a: [49220, 2] }],
  [49214, { y: 1, a: [9, 2] }],
  [44001, { y: 1, a: [9, 1] }],
  [49220, { y: 3, a: [9, 3] }]
]);
const settings = { enabled: false, hourlyRate: 3600, equipmentScheme: 1, equipmentIntermediate: true, equipmentFinal: true };
const materials = [9, 49214, 44001, 49220, 44091, 44169].map(uid => ({ uid, id: `item-${uid}` }));
const hqPurchase = new Map([[44091, 1800], [44169, 900]]);
const legacyPurchase = new Map();
const context = vm.createContext({
  data: { m: materials }, timeCostSettings: settings,
  purchaseRows: material => hqPurchase.has(material.uid) ? [{ quality: 'hq', quantity: 1, total: hqPurchase.get(material.uid) }]
    : legacyPurchase.has(material.uid) ? [{ quantity: 1, total: legacyPurchase.get(material.uid) }] : [],
  marketComparisonCost: value => Number(value || 0) * 1.05,
  equipmentQualityMarketPrice: qualityPrice,
  recipeDisplayNodeFor: uid => recipes.get(Number(uid)),
  levequestRecipes: { recipes: {} },
  directSourceChoice: material => ({ price: Number(material.uid) === 9 ? 10 : 0, source: '采购价' }),
  materialName: uid => String(uid),
  calculateEquipmentProductionPlan: () => ({ total: 70, missing: [] }),
  combatBlueprints: [['防护', ['骑士'], [2000, 2001, 2002, 2003, 2004], [], { 骑士: [1000, 1001] }]]
});
vm.runInContext(slice('  const saleTimeFoodIds', '  const unitCost = tableRow =>'), context);
const catalog = vm.runInContext('Object.entries(equipmentMacros).map(([key, value]) => ({ key, seconds: value.seconds, scripts: value.scripts }))', context);
for (const macro of catalog) {
  assert.ok(macro.scripts.length > 0, `${macro.key} 应有可查看的宏`);
  const waits = macro.scripts.flatMap(script => [...script.matchAll(/wait[.](\d+)/g)].map(match => Number(match[1])));
  assert.equal(waits.reduce((sum, seconds) => sum + seconds, 0), macro.seconds, `${macro.key} 的宏等待时间与计价秒数一致`);
}
const plan = (id = 1000) => vm.runInContext(`equipmentSaleCostSnapshot({ id:'770-test', components:[{ item:{ itemId:${id} }, qty:1 }] })`, context);
assert.equal(plan().total, 70, '关闭时间成本仍在出售时计算材料成本');
settings.enabled = true;
const cheap = plan();
assert.ok(cheap.laborCost > 0 && cheap.foodCost > 0, '开启时间成本后分开记录人工与食药');
assert.ok(cheap.materialCost > 0 && cheap.total > cheap.materialCost);
assert.equal(plan(1001).total, cheap.total, '骑士盾牌与主手采用相同 HQ 垫料规则');
settings.equipmentScheme = 2;
const luxury = plan();
assert.ok(luxury.total < cheap.total, '方案二减少 770 HQ 垫料步骤');
settings.equipmentIntermediate = false;
assert.ok(plan().laborCost < luxury.laborCost, '取消半成品时间后减少人工');
settings.equipmentFinal = false;
assert.equal(plan().laborCost, 0);
assert.equal(plan().foodCost, 0);
settings.equipmentFinal = true;
settings.equipmentIntermediate = true;
hqPurchase.set(49214, 1);
assert.ok(plan().sources.some(row => row.itemId === 49214 && row.source === 'HQ 已记录采购均价'), '同品质半成品采购记录优先');
settings.equipmentEnabled = false;
assert.ok(plan().total < 70, '关闭装备分类开关仍采用已记录的 HQ 半成品价格');
settings.equipmentEnabled = true;
settings.enabled = false;
hqPurchase.set(49214, 5000);
const recordedExpensive = plan();
assert.equal(recordedExpensive.materialCost, 5050, '已有 HQ 采购记录即使高于自制仍优先');
const recordedRows = vm.runInContext("equipmentSaleCostSnapshot({ id:'770-test', components:[{item:{itemId:1000},qty:1}] }, {}, { includeTrace:true }).selectedRows", context);
assert.ok(recordedRows.basic.some(row => row.uid === 49214 && row.sourceKind === 'recorded' && row.quality === 'hq'), '基础栏标明实际采购路线与 HQ 品质');
for (const rows of Object.values(recordedRows)) {
  assert.ok(rows.every((row, index) => index === 0 || rows[index - 1].uid <= row.uid), '三栏材料沿用物品 ID 升序');
}
assert.ok(recordedExpensive.routes.some(row => row.itemId === 49214 && row.sourceKind === 'recorded' && row.quality === 'hq'), '出售快照锁定半成品来源');
assert.ok(!recordedRows.basic.some(row => row.uid === 9 && row.quantity >= 7), '外购半成品不展开它的下级原料');
hqPurchase.delete(49214);
Object.assign(materials.find(row => row.uid === 49214), { marketStatus: 'listing-weighted', marketQualityMethod: 'hybrid-p25-weighted-v1', marketReferenceQuotes: { hq: { price: 5 }, nq: { price: 100 } } });
let compared = vm.runInContext("equipmentSaleCostSnapshot({ id:'770-test', components:[{item:{itemId:1000},qty:1}] }, {}, { includeTrace:true })", context);
assert.equal(compared.trace['49214:hq:false'].sourceKind, 'market', '无对应品质采购记录时比较税后市场价与自制价');
legacyPurchase.set(49214, 1);
compared = vm.runInContext("equipmentSaleCostSnapshot({ id:'770-test', components:[{item:{itemId:1000},qty:1}] }, {}, { includeTrace:true })", context);
assert.equal(compared.trace['49214:hq:false'].sourceKind, 'market', '旧未标品质采购不冒充 HQ');
legacyPurchase.delete(49214);
materials.find(row => row.uid === 49214).marketReferenceQuotes.hq.price = 20 / 1.05;
compared = vm.runInContext("equipmentSaleCostSnapshot({ id:'770-test', components:[{item:{itemId:1000},qty:1}] }, {}, { includeTrace:true })", context);
assert.equal(compared.trace['49214:hq:false'].sourceKind, 'craft', '同价时采用自制');
delete materials.find(row => row.uid === 49214).marketReferenceQuotes;
const fractional = vm.runInContext("equipmentSaleCostSnapshot({ id:'770-test', components:[{item:{itemId:1002},qty:1}] }, {}, { includeTrace:true })", context);
assert.equal(fractional.materialCost, 20, '一炉产三件使用两件，按三分之二分摊原料');
assert.equal(fractional.selectedRows.direct.find(row => row.uid === 49220).quantity, 2);
assert.equal(fractional.selectedRows.basic.find(row => row.uid === 9).quantity, 2);
settings.enabled = true;

const gatheringSettings = { enabled: true, equipmentEnabled: true, hourlyRate: 3600, equipmentSchemes: { '750': 1 }, equipmentIntermediate: true, equipmentFinal: true };
const gatheringHqPrices = new Map([[45974, 12], [45975, 30], [46251, 14], [44091, 1800], [44169, 900], [36060, 500]]);
const gatheringMaterials = [2001, 2002, 2003, 45974, 45975, 46251, 44091, 44169, 36060, 9].map(uid => ({ uid, id: `gathering-${uid}` }));
const gatheringContext = vm.createContext({
  data: { m: gatheringMaterials }, timeCostSettings: gatheringSettings,
  purchaseRows: material => gatheringHqPrices.has(material.uid) ? [{ quality: material.uid === 36060 ? 'nq' : 'hq', quantity: 1, total: gatheringHqPrices.get(material.uid) }] : [],
  marketComparisonCost: value => Number(value || 0) * 1.05,
  equipmentQualityMarketPrice: qualityPrice,
  recipeDisplayNodeFor: uid => [2001, 2002, 2003].includes(Number(uid)) ? { y: 1, a: [45974, 2, 45975, 2, 46251, 2, 9, 1] } : null,
  levequestRecipes: { recipes: {} },
  directSourceChoice: material => ({ price: Number(material.uid) === 9 ? 10 : 5, source: 'NQ 采购价' }),
  materialName: uid => String(uid),
  calculateEquipmentProductionPlan: () => ({ total: 60, missing: [] }),
  combatBlueprints: [], gatheringBlueprints: [['测试', [], [2000, 2001, 2002, 2004, 2005], [[2003, 1]], {}]]
});
vm.runInContext(slice('  const saleTimeFoodIds', '  const unitCost = tableRow =>'), gatheringContext);
const gatheringPlan = (uid = 2002) => vm.runInContext(`equipmentSaleCostSnapshot({ id:'750-test', components:[{ item:{ itemId:${uid} }, qty:1 }] })`, gatheringContext);
const firstGathering = gatheringPlan();
assert.equal(firstGathering.seconds, 70, '750 方案一成装宏为 70 秒，外购半成品不计自制时间');
assert.equal(firstGathering.hqPadding.length, 4, '750 普通部位方案一选四个 HQ 半成品');
assert.equal(firstGathering.hqPadding.filter(row => row.itemId === 45975).length, 0, '自动避开更贵的 HQ 垫料');
assert.ok(firstGathering.foodCost > 0, '750 成装计入牛排与药液');
assert.equal(gatheringPlan(2001).hqPadding.length, 6, '750 衣服与裤子按方案一垫六个 HQ 半成品');
assert.equal(gatheringPlan(2003).hqPadding.length, 3, '750 首饰按方案一垫三个 HQ 半成品');
gatheringSettings.equipmentSchemes['750'] = 2;
const secondGathering = gatheringPlan();
assert.equal(secondGathering.seconds, 80, '750 方案二成装宏为 80 秒');
assert.equal(secondGathering.hqPadding.length, 3, '750 普通部位方案二选三个 HQ 半成品');
assert.equal(gatheringPlan(2001).hqPadding.length, 4, '750 衣服与裤子按方案二垫四个 HQ 半成品');
assert.equal(gatheringPlan(2003).hqPadding.length, 2, '750 首饰按方案二垫两个 HQ 半成品');
assert.equal(firstGathering.settingsSnapshot.equipmentSchemes['750'], 1, '已售成本快照不随方案切换变化');
for (const uid of [45974, 45975, 46251]) gatheringHqPrices.delete(uid);
gatheringContext.recipeDisplayNodeFor = uid => [2001, 2002, 2003].includes(Number(uid))
  ? { y: 1, a: [45974, 2, 45975, 2, 46251, 2, 9, 1] }
  : [45974, 45975, 46251].includes(Number(uid)) ? { y: 1, a: [9, 1] } : null;
gatheringSettings.equipmentSchemes['750'] = 1;
assert.ok(Math.abs(gatheringPlan().seconds - (70 + 4 * 52 + 2 * 3600 / 999)) < 0.001, '750 方案一 HQ 宏与 NQ 简易制作分别计时');
gatheringSettings.equipmentSchemes['750'] = 2;
assert.ok(Math.abs(gatheringPlan().seconds - (80 + 3 * 49 + 3 * 3600 / 999)) < 0.001, '750 方案二 HQ 宏与 NQ 简易制作分别计时');
gatheringContext.recipeDisplayNodeFor = uid => [2001, 2002, 2003].includes(Number(uid))
  ? { y: 1, a: [46251, 6, 9, 1] }
  : Number(uid) === 46251 ? { y: 1, a: [9, 1] } : null;
assert.ok(Math.abs(gatheringPlan().seconds - (80 + 3 * 54 + 3 * 3600 / 999)) < 0.001, '750 方案二自制 750 HQ 半成品按 54 秒计时');
assert.ok(gatheringPlan().foodCost > secondGathering.foodCost, '750 HQ 半成品自制另计 NQ 高山茶');

const baseContext = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'base-materials.js'), 'utf8'), baseContext);
const base = baseContext.window.FF14_BASE_MATERIALS;
const realSettings = { ...settings, enabled: true, equipmentScheme: 1, equipmentIntermediate: true, equipmentFinal: true };
const realContext = vm.createContext({
  data: { m: Object.keys(base.n).map(uid => ({ uid: Number(uid), id: `base-${uid}` })).concat([{ uid: 44091, id: 'steak' }, { uid: 44169, id: 'medicine' }]) },
  timeCostSettings: realSettings, purchaseRows: material => hqPurchase.has(Number(material.uid)) && Number(material.uid) !== 49214
    ? [{ quality: 'hq', quantity: 1, total: hqPurchase.get(Number(material.uid)) }] : [],
  marketComparisonCost: value => Number(value || 0) * 1.05,
  equipmentQualityMarketPrice: qualityPrice,
  recipeDisplayNodeFor: uid => base.g[String(uid)]?.[0],
  levequestRecipes: { recipes: {} },
  directSourceChoice: material => ({ price: base.g[String(material.uid)]?.length ? 0 : 100, source: '当前材料价' }),
  materialName: uid => base.n[String(uid)] || String(uid),
  calculateEquipmentProductionPlan: () => ({ total: 100, missing: [] }),
  combatBlueprints: [['防护', ['骑士'], [49271, 49272, 49273, 49274, 49275], [], { 骑士: [49249, 49270] }]]
});
vm.runInContext(slice('  const saleTimeFoodIds', '  const unitCost = tableRow =>'), realContext);
realSettings.hourlyRate = 400000;
realSettings.equipmentSchemes = { '770': 2 };
const detailed = vm.runInContext("equipmentSaleCostSnapshot({ id:'770-职业 38', components:[{item:{itemId:49249},qty:1}] }, {}, { includeTrace:true })", realContext);
assert.ok(detailed.finished.length === 1 && detailed.trace['49249:hq:true'], '开启装备时间成本后可追溯成品及半成品节点');
assert.ok(Math.abs(detailed.total - detailed.materialCost - detailed.laborCost - detailed.foodCost) < 0.001, '详情成本与出售快照逐项相加一致');
const rowSum = rows => rows.reduce((sum, row) => sum + row.cost, 0);
assert.ok(Math.abs(rowSum(detailed.selectedRows.finished) - detailed.total) < 0.001, '成品栏与出售总成本一致');
assert.ok(Math.abs(rowSum(detailed.selectedRows.basic) - detailed.materialCost) < 0.001, '终端材料栏与出售材料成本一致');
assert.ok(rowSum(detailed.selectedRows.direct) >= detailed.materialCost, '直接素材栏含半成品制作费用');
assert.ok(detailed.finishedLaborCost > 0 && detailed.finishedLaborCost <= detailed.laborCost, '成品人工可与半成品人工分列');
const componentSum = (rows, key) => rows.reduce((sum, row) => sum + row[key], 0);
for (const row of [...detailed.selectedRows.finished, ...detailed.selectedRows.direct]) {
  assert.ok(Math.abs(row.cost - row.materialCost - row.laborCost - row.foodCost) < 0.001, '清单每行按材料、人工、食药保存可核对的拆分');
}
assert.ok(Math.abs(componentSum(detailed.selectedRows.finished, 'materialCost') - detailed.materialCost) < 0.001, '成品栏材料成本与出售快照一致');
assert.ok(Math.abs(componentSum(detailed.selectedRows.finished, 'laborCost') - detailed.laborCost) < 0.001, '成品栏人工成本与出售快照一致');
assert.ok(Math.abs(componentSum(detailed.selectedRows.finished, 'foodCost') - detailed.foodCost) < 0.001, '成品栏食药成本与出售快照一致');
assert.ok(Math.abs(componentSum(detailed.selectedRows.direct, 'laborCost') - (detailed.laborCost - detailed.finishedLaborCost)) < 0.001, '直接素材栏不重复计入成品制作人工');
assert.ok(Math.abs(componentSum(detailed.selectedRows.direct, 'foodCost') - (detailed.foodCost - detailed.finished[0].result.ownFood)) < 0.001, '直接素材栏不重复计入成品制作食药');
assert.ok(detailed.trace['49249:hq:true'].inputs.some(input => input.quality === 'hq'), '配方明细保留 HQ 用量和采用来源');
const footerContext = vm.createContext({
  money: value => `${Math.round(value || 0)} G`, submarineRawRecipe: () => null,
  itemLabelMarkup: (uid, name) => name, recipeCandidatesFor: () => []
});
vm.runInContext(slice('  const roundedEquipmentFooterCosts', '  const equipmentSourceShortLabel'), footerContext);
const footerTable = vm.runInContext('costTable', footerContext);
const roundedFooter = vm.runInContext('roundedEquipmentFooterCosts({ materialCost: 40.25, laborCost: 50.25, foodCost: 11 }, 101.5)', footerContext);
assert.equal(roundedFooter.materialCost + roundedFooter.laborCost + roundedFooter.foodCost, roundedFooter.total, '表尾整数金额之和等于总成本');
const footerRow = { uid: 9, name: '测试材料', quantity: 1, cost: 101.5, materialCost: 40.25, laborCost: 50.25, foodCost: 11, unitCost: 101.5 };
const completeFooter = footerTable([footerRow], '原合计', 101.5, { equipmentRoute: true, equipmentFooter: { status: { complete: true, canEstimate: true } } });
assert.match(completeFooter, /材料成本<\/th><th>41 G/);
assert.match(completeFooter, /时间成本<\/th><th>50 G/);
assert.match(completeFooter, /食药成本<\/th><th>11 G/);
assert.match(completeFooter, /总成本<\/th><th>102 G/);
const pendingFoodFooter = footerTable([footerRow], '原合计', 101.5, { equipmentRoute: true, equipmentFooter: { status: { complete: false, canEstimate: true } } });
assert.match(pendingFoodFooter, /材料成本（暂估）/);
assert.match(pendingFoodFooter, /时间成本（暂估）/);
assert.match(pendingFoodFooter, /食药成本<\/th><th>待补价/);
assert.match(pendingFoodFooter, /总成本<\/th><th>待补价/);
const missingMaterialFooter = footerTable([footerRow], '原合计', 101.5, { equipmentRoute: true, equipmentFooter: { status: { complete: false, canEstimate: false } } });
assert.equal((missingMaterialFooter.match(/待补价/g) || []).length, 4, '材料缺价时各拆分值不假装完整');
const legacyFooter = footerTable([footerRow], '原合计', 101.5, { equipmentRoute: true });
assert.match(legacyFooter, /原合计<\/th><th>102 G/);
assert.doesNotMatch(legacyFooter, /时间成本|食药成本/, '关闭装备时间成本时保持单行合计');
recipes.set(1999, { y: 1, a: [9, 1] });
const unknownMacro = vm.runInContext("equipmentSaleCostSnapshot({ id:'770-test', components:[] }, {}, { targetItem:{uid:1999,quality:'hq'}, includeTrace:true, allowMissing:true })", context);
assert.match(unknownMacro.missing.join('、'), /HQ 宏时长未核验/, '未知 HQ 宏不得按简易制作时间估算');
for (const uid of [49249, 49270, 49272, 49274]) {
  const actual = vm.runInContext(`equipmentSaleCostSnapshot({ id:'770-职业 38', components:[{item:{itemId:${uid}},qty:1}] })`, realContext);
  assert.ok(actual.materialCost > 0 && actual.laborCost > 0 && actual.foodCost > 0, `真实 770 配方 ${uid} 可计算出售快照`);
}
const actualGatheringSettings = { enabled: true, equipmentEnabled: true, hourlyRate: 3600, equipmentSchemes: { '750': 1 }, equipmentIntermediate: true, equipmentFinal: true };
const actualGatheringMaterials = Object.keys(base.n).map(uid => ({ uid: Number(uid), id: `base-${uid}` }))
  .concat([{ uid: 44091, id: 'steak' }, { uid: 44169, id: 'medicine' }, { uid: 36060, id: 'tea' }]);
const actualGatheringContext = vm.createContext({
  data: { m: actualGatheringMaterials }, timeCostSettings: actualGatheringSettings,
  purchaseRows: material => [44091, 44169, 36060].includes(Number(material.uid))
    ? [{ quality: Number(material.uid) === 36060 ? 'nq' : 'hq', quantity: 1, total: 900 }] : [],
  marketComparisonCost: value => Number(value || 0) * 1.05,
  equipmentQualityMarketPrice: qualityPrice,
  recipeDisplayNodeFor: uid => base.g[String(uid)]?.[0], levequestRecipes: { recipes: {} },
  directSourceChoice: material => ({ price: base.g[String(material.uid)]?.length ? 0 : 100, source: '当前材料价' }),
  materialName: uid => base.n[String(uid)] || String(uid),
  calculateEquipmentProductionPlan: () => ({ total: 100, missing: [] }),
  combatBlueprints: [], gatheringBlueprints: [['大地使者', [], [47189, 47190, 47191, 47192, 47193], [], {}]]
});
vm.runInContext(slice('  const saleTimeFoodIds', '  const unitCost = tableRow =>'), actualGatheringContext);
const actualGathering = vm.runInContext("equipmentSaleCostSnapshot({ id:'750-职业 17', components:[{item:{itemId:47189},qty:1}] })", actualGatheringContext);
assert.ok(actualGathering.materialCost > 0 && actualGathering.laborCost >= 70 && actualGathering.foodCost > 0, '真实 750 配方可按售后宏计算');
assert.ok(actualGathering.hqPadding.length >= 4, '真实 750 头部按方案一垫至少四个 HQ 半成品');

const qualityPurchases = [
  { materialId: 'leaf', quality: 'hq', quantity: 2, unitPrice: 8, total: 16 },
  { materialId: 'leaf', quantity: 3, unitPrice: 9, total: 27 },
  { materialId: 'leaf', quality: 'nq', quantity: 4, unitPrice: 10, total: 40 },
  { materialId: 'semi', quality: 'hq', quantity: 1, unitPrice: 15, total: 15 },
  { materialId: 'unresolved-gear', quality: 'hq', quantity: 1, unitPrice: 20, total: 20 }
];
const qualityContext = vm.createContext({
  data: { m: [{ uid: 9, id: 'leaf' }, { uid: 200, id: 'semi' }, { uid: 999, id: 'unresolved-gear' }] }, purchases: qualityPurchases,
  tableRows: () => [{ components: [{ item: { itemId: 1000 } }, { item: { itemId: 999 } }] }],
  recipeDisplayNodeFor: uid => Number(uid) === 1000 ? { a: [200, 1, 9, 2] } : Number(uid) === 200 ? { a: [9, 1] } : null
});
vm.runInContext(slice('  const equipmentBaseLeafIds', '  const recipeNodeFor'), qualityContext);
assert.equal(vm.runInContext('normalizeEquipmentBasePurchaseQuality()', qualityContext), true, '旧装备基础材料采购品质首次修正');
assert.deepEqual(qualityPurchases.map(row => row.quality), ['nq', 'nq', 'nq', 'hq', 'hq'], '只修正无配方基础材料，半成品与无配方成品 HQ 保持原样');
assert.equal(qualityPurchases.reduce((sum, row) => sum + row.total, 0), 118, '品质修正不改采购金额');
assert.equal(vm.runInContext('normalizeEquipmentBasePurchaseQuality()', qualityContext), false, '品质修正可重复运行');

// 半成品详情应叠在装备详情上；返回及采购录入后仍能回到原清单。
const parentDetail = { open: true, scrollTop: 86, close() { this.open = false; }, showModal() { this.open = true; } };
const materialDetail = { open: false, close() { this.open = false; }, showModal() { this.open = true; } };
const parentContent = { innerHTML: '原装备制作清单' };
const materialContent = { controls: new Map(), lists: new Map(), querySelector(selector) {
  if (!this.controls.has(selector)) this.controls.set(selector, { onclick: null, addEventListener(type, handler) { this.onclick = handler; } });
  return this.controls.get(selector);
}, querySelectorAll(selector) {
  if (!this.lists.has(selector)) {
    const attr = selector.slice(1, -1), key = attr.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    this.lists.set(selector, [...this.html.matchAll(new RegExp(`${attr}="(\\d+)"`, 'g'))]
      .map(match => ({ dataset: { [key]: match[1] }, onclick: null })));
  }
  return this.lists.get(selector);
} };
Object.defineProperty(materialContent, 'innerHTML', { set(value) { this.html = value; this.controls.clear(); this.lists.clear(); }, get() { return this.html; } });
const elements = { '#equipment-material-dialog': materialDetail, '#equipment-material-content': materialContent,
  '#equipment-material-meta': { textContent: '' }, '#equipment-material-title': { textContent: '' },
  '#bundle-detail-dialog': parentDetail, '#bundle-detail-content': parentContent };
let parentRefreshes = 0, purchaseOpens = 0, latestPurchaseOptions = null;
const basePurchaseRows = [{ id: 'base-1', materialId: 'item-9', quality: 'nq', date: '2026-10-20', quantity: 2, unitPrice: 100, total: 210, tax: 0.05 }];
const detailContext = vm.createContext({
  document: { querySelector: selector => elements[selector] }, data: { m: [{ uid: 200, id: 'semi-200' }, { uid: 9, id: 'item-9', n: '基础材料' }] }, state: {},
  purchases: basePurchaseRows, confirm: () => true, save: () => {}, refreshNpcRecommendations: () => {},
  equipmentTimeEnabled: () => false, materialName: uid => String(uid),
  purchaseRows: material => material.uid === 9 ? basePurchaseRows : [], purchaseAverage: () => 105,
  purchaseDateLabel: row => row.date, purchaseSourceLabel: () => '市场采购', marketComparisonCost: () => 0,
  money: value => String(value), escapeTradeHtml: value => String(value), itemLabelMarkup: () => '',
  recipeDisplayNodeFor: uid => Number(uid) === 200 ? { y: 1, a: [] } : null,
  craftSimulatorLink: () => '',
  equipmentSchemeFor: () => 1, equipmentMacroFor: () => ({ seconds: 3600 / 999, scripts: [], simple: true }),
  equipmentQualityMarketPrice: () => 0, marketQuoteRetained: () => false, marketQuoteExplanation: () => '待刷新',
  timeCostSettings: { hourlyRate: 0 },
  equipmentSaleCostSnapshot: () => ({ trace: { '200:hq:false': { material: 10, labor: 0, food: 0, source: '自制', sourceKind: 'craft', output: 1, inputs: [], missing: [] } } }),
  openBundleDetail: () => { parentRefreshes++; parentContent.innerHTML = '更新后的装备制作清单'; },
  openPurchase: (material, row, options) => { purchaseOpens++; latestPurchaseOptions = { material, row, options }; }
});
vm.runInContext(slice('  const equipmentSourceShortLabel', '  function openBundleDetail(bundle)'), detailContext);
const summaryState = vm.runInContext('equipmentCostSummaryState', detailContext);
assert.equal(summaryState({ missing: [] }).complete, true, '完整报价显示总成本');
assert.equal(summaryState({ missing: ['HQ 魔匠药液'] }).canEstimate, true, '仅食药缺价时仍显示已有材料和人工的暂估');
assert.equal(summaryState({ missing: ['HQ 魔匠药液'] }).foodMissing[0], 'HQ 魔匠药液', '缺价提示明确指出食药名称');
assert.equal(summaryState({ missing: ['黑铁矿'] }).canEstimate, false, '材料缺价时不把不完整成本伪装为暂估');
const detailBundle = { label: '测试', components: [{ item: { itemId: 999 } }] };
detailContext.openEquipmentCostNode(detailBundle, 200, 'hq');
assert.equal(parentContent.innerHTML, '原装备制作清单', '打开半成品明细不覆盖装备制作清单');
assert.equal(materialDetail.open, true);
assert.doesNotMatch(materialContent.innerHTML, /时间成本|HQ 犎牛牛排/, '关闭时间成本时不展示人工与食药行');
materialContent.querySelector('[data-equipment-cost-back]').onclick();
assert.equal(materialDetail.open, false, '返回只关闭半成品明细');
assert.equal(parentDetail.open, true);
detailContext.openEquipmentCostNode(detailBundle, 200, 'hq');
materialContent.querySelector('[data-equipment-cost-purchase]').onclick();
assert.equal(purchaseOpens, 1);
assert.equal(parentDetail.open, true, '打开采购时保留装备详情');
detailContext.state.purchaseDetailReturn();
assert.equal(parentRefreshes, 1, '采购后刷新装备清单');
assert.equal(parentDetail.scrollTop, 86, '采购后保留装备详情滚动位置');
assert.equal(materialDetail.open, true, '采购后回到半成品明细');
detailContext.openEquipmentCostNode(detailBundle, 9, 'hq', [{ uid: 200, quality: 'hq' }]);
assert.match(materialContent.innerHTML, /NQ 市场价/, '基础材料只展示 NQ 市场价');
assert.doesNotMatch(materialContent.innerHTML, /宏|自制总价|查看HQ/, '基础材料不展示制作信息和品质切换');
assert.match(materialContent.innerHTML, /2026-10-20/, '基础材料详情直接展示采购历史');
materialContent.querySelector('[data-equipment-base-add]').onclick();
assert.equal(latestPurchaseOptions.options.fixedQuality, 'nq', '基础材料新增采购固定为 NQ');
detailContext.state.purchaseDetailReturn();
assert.equal(parentDetail.scrollTop, 86, '基础材料采购后仍保持装备清单滚动位置');
const editButton = materialContent.querySelectorAll('[data-equipment-base-edit]')[0];
editButton.onclick();
assert.equal(latestPurchaseOptions.row.id, 'base-1', '基础材料可直接编辑历史记录');
detailContext.state.purchaseDetailReturn();
const deleteButton = materialContent.querySelectorAll('[data-equipment-base-delete]')[0];
deleteButton.onclick();
assert.equal(basePurchaseRows.length, 0, '基础材料可直接删除历史记录');
assert.equal(parentDetail.open, true, '基础材料采购操作不会关闭底层装备详情');

detailContext.equipmentTimeEnabled = () => true;
detailContext.timeCostSettings.hourlyRate = 3600;
detailContext.equipmentMacroFor = () => ({ seconds: 10, scripts: ['/ac "制作" <wait.10>'] });
detailContext.equipmentSaleCostSnapshot = () => ({ trace: { '200:hq:false': {
  material: 15, labor: 5, food: 1, ownSeconds: 5, ownLabor: 5, ownFood: 1,
  source: '自制', sourceKind: 'craft', output: 2, missing: [],
  inputs: [{ uid: 9, quality: 'nq', amount: 3, unitCost: 10, source: '市场' }],
  foodCharges: [{ kind: 'steak', quantity: 10 / 1800, unitPrice: 360, source: '市场' }]
} } });
detailContext.openEquipmentCostNode(detailBundle, 200, 'hq');
assert.match(materialContent.innerHTML, /本批制作明细 · 产出 2 个/, '多产出按一批展示');
assert.match(materialContent.innerHTML, />30<\/td>/, '材料合价按本批用量乘单价');
assert.match(materialContent.innerHTML, /时间成本/, '人工行显示为时间成本');
assert.match(materialContent.innerHTML, /10 秒<\/button>/, '人工用量只显示本批实际制作秒数');
assert.match(materialContent.innerHTML, /1／秒/, '人工单价取整显示');
assert.match(materialContent.innerHTML, /本批合价（产出 2 个）/, '表尾标明批次产出量');
assert.match(materialContent.innerHTML, />42<\/th>/, '表尾直接显示含食药与人工的本批合价');
assert.match(materialContent.innerHTML, />21<\/th>/, '每件自制总价按产出量分摊');
assert.doesNotMatch(materialContent.innerHTML, /42 ÷ 2/, '表尾不显示计算公式');
const macroPanel = materialContent.querySelector('[data-equipment-macro-details]');
macroPanel.hidden = true;
materialContent.querySelector('[data-equipment-macro-toggle]').onclick({ currentTarget: { setAttribute() {} } });
assert.equal(macroPanel.hidden, false, '点击人工秒数展开宏内容');

const submarineSettings = { enabled: false, hourlyRate: 3600, submarineIntermediate: true, submarineWorkshop: false, submarineWorkshopSeconds: 0 };
const timedMaterialContext = vm.createContext({
  submarineTimedQuoteCache: new Map(), timeCostSettings: { submarineIntermediate: true, hourlyRate: 400000 },
  data: { m: [{ uid: '9', n: '原料' }, { uid: '200', n: '半成品' }] },
  submarineData: { g: { '200': [{ y: 2, a: [9, 2] }] } }, recipeCandidatesFor: () => [],
  staticSubmarineKind: () => '采集', recordedPurchaseCostChoice: () => null,
  waiveMarketStockGateWhenNotCompetitive: options => options,
  submarineNonCraftSourceOptions: material => String(material.uid) === '9' ? [{ price: 10, source: '市场' }] : [],
  lowestSubmarineOption: options => options.find(option => option.price > 0) || { price: 0, source: '待补价' }
});
vm.runInContext(slice('  const submarineTimedCraftQuote', '  // 制作本体时'), timedMaterialContext);
const timedMaterial = vm.runInContext('submarineTimedCraftQuote(200)', timedMaterialContext);
assert.equal(timedMaterial.material, 10, '潜艇半成品原料按配方产出量分摊');
assert.ok(Math.abs(timedMaterial.labor - 400000 / 999 / 2) < 0.001, '潜艇简易制作人工按每小时 999 次和产出量分摊');

const referenceElements = new Map();
const referenceNodes = {
  '200': [{ y: 2, a: [10, 1, 9, 2] }],
  '201': [{ y: 1, a: [200, 2] }]
};
const marketChoice = { key: 'direct-market', label: '市场采购', price: 10 };
let purchaseChoice = null, submarineDetailTime = true;
Object.assign(timedMaterialContext, {
  submarineData: { g: referenceNodes },
  submarineTimedQuoteCache: new Map(),
  data: { m: [{ uid: 9 }, { uid: 10 }, { uid: 200 }, { uid: 201 }] },
  recordedPurchaseCostChoice: material => Number(material.uid) === 9 ? purchaseChoice : null,
  submarineNonCraftSourceOptions: material => Number(material.uid) < 200 ? [marketChoice] : [],
  submarineSourceChoice: material => Number(material.uid) < 200 ? marketChoice : { key: 'craft', label: '自制配方', price: 250 },
  submarineCraftInputChoice: () => marketChoice,
  submarineTimeEnabled: () => submarineDetailTime,
  craftSimulatorLink: () => '',
  materialName: uid => '材料 ' + uid,
  recommendationTag: choice => choice.label,
  itemLabelMarkup: (_, name) => name,
  money: value => value.toFixed(2) + ' G',
  document: { querySelector: id => {
    if (!referenceElements.has(id)) referenceElements.set(id, { showModal() {} });
    return referenceElements.get(id);
  } }
});
vm.runInContext(slice('  const retainedQuoteNote', '  const marketQuoteExplanation') +
  slice('  const submarineRawRecipe', '  function openLeveMaterialSourceDetail'), timedMaterialContext);
const submarineReferenceMarkup = uid => {
  vm.runInContext(`openSubmarineRecipeReference(${uid})`, timedMaterialContext);
  return referenceElements.get('#recipe-reference-content').innerHTML;
};
const submarineDetail = submarineReferenceMarkup(200);
assert.equal((submarineDetail.match(/<table /g) || []).length, 1, '直接素材和递归基础素材仅排列不同，合并到带制作成本的表');
assert.match(submarineDetail, /单件材料费<\/th><th>15\.00 G/);
assert.match(submarineDetail, /单件制作时间成本<\/th><th>200\.20 G/);
assert.match(submarineDetail, /单件制作总成本<\/th><th>215\.20 G/);
assert.match(submarineReferenceMarkup(201), /递归基础素材参考/, '下级配方确实展开为其他物料时保留基础素材参考');
purchaseChoice = { key: 'recorded-purchase', label: '采购均价', price: 30 };
assert.match(submarineReferenceMarkup(200), /单件制作总成本<\/th><th>235\.20 G/, '采购优先表使用已有采购价并加人工');
submarineDetailTime = false;
assert.doesNotMatch(submarineReferenceMarkup(200), /单件制作时间成本/);
const submarinePlan = { total: 100, missing: [], roots: [{ key: 'root' }], nodes: new Map([
  ['root', { batches: 1 }], ['semi', { batches: 3, node: { y: 2 } }]
]), basic: [{ uid: 9, quantity: 10 }] };
let semiBuyPrice = 0;
const submarineContext = vm.createContext({
  timeCostSettings: submarineSettings, submarineCurrentPlan: () => submarinePlan,
  submarineTimeEnabled: () => Boolean(submarineSettings.enabled && submarineSettings.submarineEnabled !== false),
  timeSettingsSnapshot: () => JSON.parse(JSON.stringify(submarineSettings)),
  data: { m: [{ uid: 9 }, { uid: 200 }] },
  submarineData: { g: { 100: [{ y: 1, a: [200, 6] }], 200: [{ y: 2, a: [9, 2] }] } },
  recipeCandidatesFor: () => [], materialName: uid => String(uid),
  submarineNonCraftSourceOptions: material => Number(material.uid) === 9 ? [{ price: 10, source: '采购价' }]
    : Number(material.uid) === 200 && semiBuyPrice > 0 ? [{ price: semiBuyPrice, source: '半成品采购价' }] : [],
  submarineCostSourceChoice: material => Number(material.uid) === 9 ? { price: 10, source: '采购价', key: 'purchase' } : { price: 0, key: 'craft' }
});
vm.runInContext(slice('  const submarineSaleCostSnapshot', '  const submarineSuiteCurrentPlan'), submarineContext);
const sub = count => vm.runInContext(`submarineSaleCostSnapshot(Array(${count}).fill({ id:100 }))`, submarineContext);
assert.equal(sub(2).total, 200, '潜艇关闭时间成本时仍锁定当前材料价');
submarineSettings.enabled = true;
const withIntermediate = sub(1);
assert.ok(Math.abs(withIntermediate.intermediateSeconds - 3 * 3600 / 999) < 0.001, '简易制作以 999 次／小时按实际制作次数计时');
semiBuyPrice = 11;
assert.equal(sub(1).intermediateSeconds, 0, '半成品外购总成本更低时不再计自制时间');
semiBuyPrice = 0;
submarineSettings.submarineWorkshop = true;
assert.throws(() => sub(1), /交纳秒数/);
submarineSettings.submarineWorkshopSeconds = 25;
assert.equal(sub(2).workshopSeconds, 50, '整套按最终部件数累计工房交纳时间');
submarineSettings.enabled = false;
assert.equal(sub(2).laborCost, 0, '关闭总开关不计潜艇人工');
submarineSettings.enabled = true;
submarineSettings.submarineEnabled = false;
assert.equal(sub(2).laborCost, 0, '关闭潜艇分类开关不计人工');
submarineSettings.submarineEnabled = true;
const submarineDataContext = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'submarine-data.js'), 'utf8'), submarineDataContext);
const actualSubmarine = submarineDataContext.window.FF14_SUBMARINE_DATA;
const realSubSettings = { ...submarineSettings, enabled: true, submarineWorkshop: false };
const realSubContext = vm.createContext({
  timeCostSettings: realSubSettings, submarineData: actualSubmarine,
  submarineTimeEnabled: () => Boolean(realSubSettings.enabled && realSubSettings.submarineEnabled !== false),
  timeSettingsSnapshot: () => JSON.parse(JSON.stringify(realSubSettings)),
  submarineCurrentPlan: () => ({ total: 100, missing: [], basic: [], roots: [], nodes: new Map() }),
  data: { m: Object.keys({ ...base.n, ...actualSubmarine.n }).map(uid => ({ uid: Number(uid) })) },
  recipeCandidatesFor: uid => base.g[String(uid)] || [], materialName: uid => actualSubmarine.n[String(uid)] || base.n[String(uid)] || String(uid),
  submarineNonCraftSourceOptions: material => (actualSubmarine.g[String(material.uid)] || base.g[String(material.uid)]) ? [] : [{ price: 100, source: '材料参考价' }],
  submarineCostSourceChoice: material => (actualSubmarine.g[String(material.uid)] || base.g[String(material.uid)]) ? { price: 0, key: 'craft' } : { price: 100, key: 'market', source: '材料参考价' }
});
vm.runInContext(slice('  const submarineSaleCostSnapshot', '  const submarineSuiteCurrentPlan'), realSubContext);
realSubContext.part = actualSubmarine.parts[0];
const realSubSale = vm.runInContext('submarineSaleCostSnapshot([part])', realSubContext);
assert.ok(realSubSale.materialCost > 0 && realSubSale.intermediateSeconds > 0, '真实潜艇部件配方可计算简易制作时间');

const inbound = { p: { gear: { q: 0, v: 0, made: 0, sold: 0 } }, l: [] };
const inboundContext = vm.createContext({ data: inbound, stock: id => inbound.p[id], today: () => '2026-10-23' });
vm.runInContext(slice('  function craftPlan(bundle)', '  function undoCraft(bundle)'), inboundContext);
vm.runInContext("craft({ id:'770-test', label:'测试装备', components:[{item:{id:'gear'},qty:1}] })", inboundContext);
assert.equal(inbound.p.gear.q, 1, '装备无价仍可入库');
assert.equal(inbound.p.gear.v, 0, '新装备入库不预先锁定账面成本');
assert.equal(inbound.l[0].costBasis, 'quantity-only');

assert.match(source, /costBasis: 'quantity-only'/, '装备入库只记数量');
assert.match(source, /const costSnapshot = equipmentSaleCostSnapshot\(bundle, overrides\)/, '装备出售时重新估价');
assert.match(source, /const costSnapshot = submarineSaleCostSnapshot\(parts\)/, '潜艇整套出售时估价');
assert.match(source, /const now = leveRecipeCost\(\{ itemId: line\.itemId \}\)/, '理符保存前重新估价');
assert.match(source, /已更新成本预览。请核对后再次点击保存/, '理符改价后要求再次确认');

(async () => {
  const regionalStorage = new Map();
  const regionalMaterial = { uid: 200 };
  const regionalDialog = { open: true, addEventListener() {}, removeEventListener() {}, querySelector: () => null };
  let regionalAttempt = 1;
  Object.assign(timedMaterialContext, {
    localStorage: { getItem: key => regionalStorage.get(key), setItem: (key, value) => regionalStorage.set(key, value) },
    CHINA_MARKET_DATA_CENTERS: ['陆行鸟', '莫古力'], AbortController, setTimeout, clearTimeout,
    canRefreshMarketMaterial: () => true, validMarketListings: listings => listings,
    window: { MarketWatch: require('../market-watch.js') },
    fetch: async url => {
      const scope = decodeURIComponent(new URL(url).pathname.split('/')[3]);
      if (scope === '陆行鸟' && regionalAttempt === 2) throw Error('offline');
      return { ok: true, json: async () => ({ itemID: 200, listings: [{ pricePerUnit: scope === '陆行鸟' ? 10 : regionalAttempt === 1 ? 20 : 30, quantity: 3 }] }) };
    }
  });
  const regionalRefresh = vm.runInContext('refreshSubmarineRegionalPrices', timedMaterialContext);
  await regionalRefresh(regionalMaterial, regionalDialog);
  const restoreRegionalQuote = () => vm.runInContext('readAuxiliaryMarketQuotes(submarineRegionalQuoteKey)', timedMaterialContext).get('200');
  const initialRegional = restoreRegionalQuote();
  regionalAttempt = 2;
  regionalMaterial.marketCheckedAt = Date.now() + 1;
  await regionalRefresh(regionalMaterial, regionalDialog);
  const updatedRegional = restoreRegionalQuote();
  assert.equal(updatedRegional.陆行鸟.minimum, 10, '分区明细刷新失败沿用同区最低价');
  assert.equal(updatedRegional.陆行鸟.quotedAt, initialRegional.陆行鸟.quotedAt);
  assert.equal(updatedRegional.陆行鸟.status, 'error');
  assert.equal(updatedRegional.莫古力.minimum, 30, '另一大区成功时独立更新');

  const request = recipeId => ({ recipeId, itemId: recipeId, target: 1140 });
  const pendingRequest = request(35825);
  const mockState = { viewing: true };
  const requests = [JSON.parse(penKey), JSON.parse(failedKey), pendingRequest];
  const attempts = [];
  const timers = [];
  const scheduler = vm.createContext({
    localStorage: storage, timeCostSettings: { enabled: true, craftScripEnabled: true },
    window: { CraftScripSimulator: { readCache, writeCache, validPlan, solve: async input => {
      attempts.push(input.recipeId);
      throw Error('当前配装未找到达标宏');
    } } },
    document: { querySelector: () => null },
    viewingCraftScripGuide: () => mockState.viewing, refreshCraftScripSimulationGuide: () => {},
    setTimeout: callback => { timers.push(callback); return timers.length; }
  });
  vm.runInContext(`const craftScripSimulations = window.CraftScripSimulator.readCache(localStorage);
    let activeCraftScripSimulations = 0, craftScripSimulationTimer = null, craftScripQueueStarted = false;
    const craftScripSimulationKey = request => JSON.stringify(request);
    const craftScripCandidateTickets = ['purple'];`, scheduler);
  scheduler.craftScripCandidateCosts = () => requests.map(input => ({ request: input, itemId: input.recipeId,
    simulation: vm.runInContext('craftScripSimulations', scheduler).get(JSON.stringify(input)), batchMaterial: 100, yieldCount: 1, payout: 144 }));
  vm.runInContext(slice('  function startCraftScripSimulation', '  const lowestCraftScripCollectible'), scheduler);
  scheduler.scheduleCraftScripSimulation();
  mockState.viewing = false;
  timers.shift()();
  await new Promise(setImmediate);
  assert.deepEqual(attempts, [35825], '切到其他页面后仅继续首轮未完成的配方，跳过已保存的成功和失败');
  assert.deepEqual(readCache(storage).get(JSON.stringify(pendingRequest)), { error: '当前配装未找到达标宏' });
  timers.shift()();
  assert.equal(timers.length, 0, '本轮全部有结果后停止排队');

  const medicine = { uid: 44169 };
  let foodRequests = 0, detailRefreshes = 0;
  const foodContext = vm.createContext({
    state: { page: 'equipment', foodRefreshing: false }, data: { m: [medicine] },
    saleTimeFoodIds: { steak: 44091, medicine: 44169, tea: 36060 },
    window: { materialRefreshRunning: true }, AbortController, setTimeout, clearTimeout,
    marketComparisonCost: price => Number(price || 0) * 1.05,
    fetch: async url => { foodRequests++; assert.match(url, /\/China\/44169\?/); return { ok: true, json: async () => ({ itemID: 44169,
      listings: [{ hq: true, pricePerUnit: 665, quantity: 10 }, { hq: false, pricePerUnit: 100, quantity: 10 }] }) }; },
    invalidatePlans: () => {}, invalidateNpcMaterials: () => {}, syncPurchaseCosts: () => {}, save: () => {},
    refreshOpenEquipmentDetailFromMarket: () => { detailRefreshes++; },
    document: { querySelector: () => ({ open: false }) }, renderTimeFoodPrices: () => {}
  });
  vm.runInContext(marketPricing, foodContext);
  vm.runInContext(slice('  const recentlyRefreshedFood', '  async function refreshMarket('), foodContext);
  vm.runInContext(slice('  async function refreshEquipmentFoodMarket', '  function marketRefreshWarning('), foodContext);
  await foodContext.refreshEquipmentFoodMarket(['HQ 魔匠药液']);
  assert.equal(foodRequests, 1, `全量刷新运行中，定向食药刷新仍能请求：${foodContext.state.foodRefreshError}`);
  assert.equal(medicine.marketReferenceQuotes.hq.price, 665, 'HQ 药液挂单写入同品质报价');
  assert.equal(medicine.marketReferenceQuotes.nq.price, 100, '定向刷新保留 NQ 报价');
  assert.equal(medicine.marketStatus, 'listing-weighted');
  assert.equal(foodContext.state.foodRefreshing, false);
  assert.ok(detailRefreshes >= 2, '刷新开始与结束都更新装备详情');
  foodContext.fetch = async () => { throw new Error('network offline'); };
  await foodContext.refreshEquipmentFoodMarket(['HQ 魔匠药液']);
  assert.match(foodContext.state.foodRefreshError, /network offline/, '刷新失败应显示原因');
  assert.equal(medicine.marketReferenceQuotes.hq.price, 665, '网络失败不清空已有报价');
  assert.equal(vm.runInContext('marketReferencePrice', foodContext)(medicine, 'hq'), 665, '网络失败后旧食药报价仍可计价');
  console.log('Sale-time material, labor, food and preview checks passed (in-memory only).');
})().catch(error => { console.error(error); process.exitCode = 1; });
