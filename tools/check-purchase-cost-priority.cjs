const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../fantasy.js'), 'utf8');
const section = (start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing source section: ${start}`);
  return source.slice(from, to);
};

const material = { id: 'fire-shard', uid: '2', n: '火之碎晶', mp: 47 / 1.05 };
const steel = { id: 'white-steel', uid: '3', n: '白钢锭' };
const purchases = [{ materialId: material.id, quantity: 10, total: 580 }];
const context = {
  data: { m: [material, steel] }, purchases,
  npcCandidate: () => null,
  marketPurchaseCandidate: () => ({ price: 47, source: '市场参考价' }),
  staticSubmarineKind: () => '常规采集品',
  materialName: uid => uid === '2' ? material.n : steel.n,
  submarineNonCraftSourceOptions: () => [{ key: 'direct-market', kind: '常规采集品', label: '市场采购', price: 47 }],
  lowestSubmarineOption: options => options.filter(option => option.price > 0).sort((a, b) => a.price - b.price)[0],
  waiveMarketStockGateWhenNotCompetitive: options => options,
  recipeCandidatesFor: uid => String(uid) === '3' ? [{ a: [2, 2], y: 1 }] : [],
  submarineCraftCostCache: new Map(),
  craftedUnitComparisonCost: price => price + 400,
  submarineSourceChoice: () => ({ key: 'direct-market', label: '市场采购', price: 47 }),
  leveMaterial: uid => String(uid) === '2' ? material : steel,
  leveNonCraftSourceChoice: () => ({ key: 'direct-market', price: 47 }),
  leveCraftInputChoice: () => ({ key: 'direct-market', price: 47 }),
  leveRecipeNode: uid => String(uid) === '3' ? { a: [2, 2], y: 1 } : null
};
vm.createContext(context);
const code = [
  section('  const purchaseRows =', '  // 采购均价会合并'),
  section('  const directSourceChoice =', '  const syncPurchaseCosts ='),
  section('  const submarineCraftInputChoice =', '  // 装备与潜水艇'),
  section('  const submarineCostSourceChoice =', '  const submarinePartIds ='),
  section('  const leveDirectUnitCost =', '  // 交付成品本身'),
  section('  const leveRecipeUnitCost =', '  const leveCraftInputChoice ='),
  section('  const leveCostSourceChoice =', '  // 仅缓存无递归轨迹'),
  '({ directSourceChoice, submarineCraftInputChoice, selfCraftUnitCost, submarineCostSourceChoice, leveDirectUnitCost, leveRecipeUnitCost, leveCostSourceChoice })'
].join('\n');
const engine = vm.runInContext(code, context);

assert.equal(engine.directSourceChoice(material).price, 58);
assert.equal(engine.submarineCraftInputChoice(2).source, '采购平均价');
assert.equal(engine.submarineCraftInputChoice(2).price, 58);
assert.equal(engine.selfCraftUnitCost(3), 116);
assert.equal(engine.submarineCostSourceChoice(material).price, 58);
assert.equal(context.submarineSourceChoice(material).price, 47, 'Future buying recommendation stays market-priced');
assert.equal(engine.leveDirectUnitCost('2'), 58);
assert.equal(engine.leveCostSourceChoice('2').price, 58);
assert.equal(engine.leveRecipeUnitCost('3', new Set(), false, false), 116);

purchases.splice(0);
context.submarineCraftCostCache.clear();
assert.equal(engine.directSourceChoice(material).price, 47);
assert.equal(engine.submarineCraftInputChoice(2).price, 47);
assert.equal(engine.selfCraftUnitCost(3), 94);
assert.equal(engine.submarineCostSourceChoice(material).price, 47);
assert.equal(engine.leveDirectUnitCost('2'), 47);
assert.equal(engine.leveCostSourceChoice('2').price, 47);
assert.equal(engine.leveRecipeUnitCost('3', new Set(), false, false), 94);

purchases.push({ materialId: material.id, kind: 'exchange', quantity: 2, total: 120 });
assert.equal(engine.submarineCraftInputChoice(2).price, 60, 'Recorded exchange acquisition is also an actual purchase cost');

assert.ok(source.includes("const sourceChoiceFor = itemId => leveCostSourceChoice(itemId)"));
assert.ok(source.includes("const sourceChoiceFor = uid => submarineCostSourceChoice(materialFor(uid))"));
assert.ok(source.includes("return scope === 'submarine' ? submarineCostSourceChoice(material).price : materialUnitPrice(material)"));
assert.ok(source.includes("sourceChoiceFor(uid).key === 'recorded-purchase' || isNpcTerminal(uid)"));
console.log('Recorded purchase cost priority and market fallback checks passed.');
