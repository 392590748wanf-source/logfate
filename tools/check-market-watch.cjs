const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const watch = require('../market-watch.js');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'fantasy.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
assert.match(css, /\.watch-layout\s*\{[^}]*grid-template-columns:\s*280px/, '左侧搜索栏约 280px');
assert.match(css, /@media \(max-width: 1280px\)[^\n]*\.watch-row/, '窄窗口列表应换列');
assert.match(source, /setInterval\(\(\) => refreshWatchMarket\(false\), 30 \* 60 \* 1000\)/, '每 30 分钟检查行情');
assert.match(source, /api\/v2\/history\/\$\{marketPath\}\//, '成交历史使用当前市场范围');
assert.match(source, /api\/v2\/\$\{marketPath\}\//, '挂单使用当前市场范围');
assert.match(source, /generation !== watchRefreshGeneration/, '切换范围时废弃旧请求结果');
assert.match(source, /openPurchaseManager\(material\)/, '监控列表复用采购账本入口');
assert.match(source, /craftable \? `<button type="button" class="watch-item-link" data-watch-craft/, '只有有配方的物品名称可打开制作详情');
assert.match(source, /: `<span class="watch-item-name">/, '无配方的原材料名称为普通文字');
assert.match(source, /class="watch-price watch-craft-price">\$\{craftable \?/, '制作价仅在有配方时显示');
const watchCraftStart = source.indexOf('  const watchSubmarinePart =');
const watchCraftEnd = source.indexOf('  async function loadWatchWorldCatalog()', watchCraftStart);
const watchCraftSource = source.slice(watchCraftStart, watchCraftEnd);
assert.equal([...watchCraftSource.matchAll(/await refreshWatchCraftMarketPrices\(/g)].length, 2, '列表和详情共用原料报价与缓存');
const routeContext = vm.createContext({
  submarineData: { parts: [{ id: 21874, n: '测试潜艇部件' }] },
  openSubmarineDetail: part => part
});
vm.runInContext(watchCraftSource.slice(0, watchCraftSource.indexOf('  function queueWatchCraftQuotes')) +
  watchCraftSource.slice(watchCraftSource.indexOf('  function openWatchCraftDetail')) +
  '\nthis.marketUrl = watchCraftMarketUrl;', routeContext);
assert.equal(new URL(routeContext.marketUrl(['1', '2'])).pathname, '/api/v2/China/1,2', '制作原料固定查中国区汇总');
assert.equal(routeContext.openWatchCraftDetail('21874').id, 21874, '潜艇部件复用台账详情');
const recipeContext = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'levequest-recipes.js'), 'utf8'), recipeContext);
const giant = watch.normalizeCraftRecipes(recipeContext.window.FF14_LEVEQUEST_RECIPES.recipes['36115']);
assert.equal(giant[0].yield, 3, '巨匠药酒一批产出三个');
assert.equal(giant[0].ingredients.length, 12, '巨匠药酒包含六种原料');
const giantPrices = Object.fromEntries(giant[0].ingredients.filter((_, index) => index % 2 === 0).map(id => [id, { price: 100, source: '采购均价' }]));
const giantQuote = watch.quoteCraftRecipe(giant[0], giantPrices);
assert.equal(giantQuote.batchTotal, 2400);
assert.equal(giantQuote.unitTotal, 800, '每件制作价按产出量均摊');
const priceFunctionStart = source.indexOf('  function watchCraftEffectivePrices(');
const priceFunctionEnd = source.indexOf('  const watchCraftPrices =', priceFunctionStart);
assert.ok(priceFunctionStart > 0 && priceFunctionEnd > priceFunctionStart);
const priceContext = { data: { m: [{ uid: 36263, id: 'sample' }] }, purchaseAverage: () => 100, watchCraftMarketQuotes: new Map([['36263', { price: 200, status: 'ok' }]]) };
vm.runInNewContext(source.slice(priceFunctionStart, priceFunctionEnd) + '\nthis.prices = watchCraftEffectivePrices;', priceContext);
assert.equal(priceContext.prices(['36263'])['36263'].price, 100, '列表与详情共用采购均价优先规则');
priceContext.purchaseAverage = () => 0;
assert.equal(priceContext.prices(['36263'])['36263'].price, 200);
delete giantPrices['13'];
assert.equal(watch.quoteCraftRecipe(giant[0], giantPrices).batchTotal, null, '原料缺价不显示完整总价');
const twoRecipes = watch.normalizeCraftRecipes([{ id: 1, yield: 1, ingredients: [{ id: 1, amount: 2 }] }, { id: 2, yield: 3, ingredients: [{ id: 1, amount: 3 }] }]);
assert.equal(watch.cheapestCraftRecipeIndex(twoRecipes, { 1: { price: 100 } }), 1, '默认选择每件价格最低的完整配方');
assert.equal(watch.cheapestCraftRecipeIndex(twoRecipes, {}), 0, '全部缺价时显示首个配方');

async function checkIngredientQuoteRetention() {
  const stored = new Map();
  const cacheKey = 'test-watch-ingredients';
  const localStorage = { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) };
  const ingredient = { price: 105, status: 'ok', quotedAt: 1, checkedAt: 1 };
  const quotes = new Map([['1', ingredient], ['2', { ...ingredient, price: 210 }]]);
  const context = vm.createContext({ localStorage, data: { m: [] }, window: { MarketWatch: watch },
    watchCraftMarketQuotes: quotes, watchCraftMarketQuoteKey: cacheKey,
    validMarketListings: listings => listings || [], marketComparisonCost: price => price * 1.05,
    fetch: async () => ({ ok: true, json: async () => ({ items: {
      1: { listings: [] }, 2: { listings: [{ pricePerUnit: 300, quantity: 999 }] }
    } }) }) });
  const helpers = source.slice(source.indexOf('  const retainedQuoteNote ='), source.indexOf('  const marketQuoteExplanation ='));
  vm.runInContext(helpers + watchCraftSource.slice(0, watchCraftSource.indexOf('  function queueWatchCraftQuotes'))
    + source.slice(priceFunctionStart, priceFunctionEnd), context);
  const signal = new AbortController().signal;
  assert.equal(await context.refreshWatchCraftMarketPrices(['1', '2', '3'], signal, () => true), true, '遗漏的物品单独标记失败');
  assert.equal(quotes.get('1').quotedAt, 1);
  assert.equal(quotes.get('1').price, 105, '空挂单保留价格监控原料的旧报价');
  assert.equal(quotes.get('2').price, 315, '有效报价更新同一物品');
  assert.equal(quotes.has('3'), false, '没有快照的缺价物品保持缺价');
  context.fetch = async () => { throw Error('offline'); };
  assert.equal(await context.refreshWatchCraftMarketPrices(['1', '2'], signal, () => true), true);
  const restored = vm.runInContext('readAuxiliaryMarketQuotes', context)(cacheKey);
  assert.equal(restored.get('2').price, 315);
  assert.equal(restored.get('2').status, 'error');
  assert.match(context.watchCraftEffectivePrices(['2'])['2'].source, /沿用上次报价/);
}
checkIngredientQuoteRetention().catch(error => { console.error(error); process.exitCode = 1; });

// Windows 中文输入法即使未送出 compositionend，也必须继续更新搜索结果。
const inputHandler = source.match(/searchInput\.oninput = event => \{[^\n]+\};/)?.[0];
assert.ok(inputHandler, '找不到监控搜索输入事件');
let resultRenders = 0;
const inputContext = { searchInput: {}, state: { watchComposing: true }, renderWatchSearchResults: () => { resultRenders++; } };
vm.runInNewContext(inputHandler, inputContext);
inputContext.searchInput.oninput({ target: { value: '巨匠药酒' }, isComposing: true });
assert.equal(inputContext.state.otherSearch, '巨匠药酒');
assert.equal(resultRenders, 1, '组字期间也要刷新结果，不可卡在初始提示');

// 导入的旧材料若缺少名称，也不能让整个搜索事件抛错。
const searchStart = source.indexOf('  const otherSearchResults = query => {');
const searchEnd = source.indexOf('  const watchEscape', searchStart);
assert.ok(searchStart > 0 && searchEnd > searchStart);
const searchContext = { data: { m: [{ uid: 1 }, { uid: 36115, n: '巨匠药酒' }] }, itemIndex: () => [] };
vm.runInNewContext(source.slice(searchStart, searchEnd) + '\nthis.search = otherSearchResults;', searchContext);
assert.equal(searchContext.search('巨匠药酒')[0].uid, 36115);

const refreshStart = source.indexOf('  function renderWatchMarketState() {');
const refreshEnd = source.indexOf('  function renderWatchSearchResults() {', refreshStart);
assert.ok(refreshStart > 0 && refreshEnd > refreshStart);
let wholeRenders = 0;
const refreshContext = { state: { page: 'watch' }, document: { activeElement: { id: 'watch-search-input' } }, renderWatch: () => { wholeRenders++; } };
vm.runInNewContext(source.slice(refreshStart, refreshEnd) + '\nthis.refresh = renderWatchMarketState;', refreshContext);
refreshContext.refresh();
assert.equal(wholeRenders, 0, '异步刷新时不得替换正在输入的搜索框');
assert.equal(refreshContext.state.watchDeferredRender, true);
refreshContext.document.activeElement = null;
refreshContext.refresh();
assert.equal(wholeRenders, 1);

const normalized = watch.normalizeSettings({
  customCategories: [{ id: 'custom-food', name: '食材' }, { id: 'custom-food', name: '重复' }],
  items: {
    100: { categoryId: 'custom-food', priority: 'high', quality: 'hq', below: 80, above: 120, order: 3, alertState: 'below' },
    101: { categoryId: 'missing', priority: 'bad', quality: 'bad', below: -1, above: '20' }
  }, alerts: [{ uid: '100', kind: 'below', price: 70, at: 123, read: false }]
}, ['102']);
assert.equal(normalized.customCategories.length, 1);
assert.equal(normalized.items['100'].categoryId, 'custom-food');
assert.equal(normalized.items['101'].categoryId, 'other');
assert.equal(normalized.items['101'].priority, 'medium');
assert.equal(normalized.items['101'].quality, 'all');
assert.equal(normalized.items['101'].below, null);
assert.equal(normalized.items['102'].categoryId, 'other');
assert.equal(normalized.alerts.length, 1);
assert.deepEqual(normalized.marketScope, { dataCenter: 'China', worldId: null });
assert.equal(normalized.items['100'].alertStates[watch.chinaScopeKey], 'below', '旧版提醒状态迁入中国区');
assert.equal(normalized.alerts[0].scopeLabel, '中国区汇总', '旧版提醒历史标明来源');
const catalog = watch.normalizeWorldCatalog([
  { name: '陆行鸟', region: '中国', worlds: [1042, 1081] },
  { name: '莫古力', region: '中国', worlds: [1172] },
  { name: '猫小胖', region: '中国', worlds: [1043] },
  { name: '豆豆柴', region: '中国', worlds: [1192] }
], [
  { id: 1042, name: '拉诺西亚' }, { id: 1081, name: '红玉海' }, { id: 1172, name: '白银乡' },
  { id: 1043, name: '延夏' }, { id: 1192, name: '水晶塔' }
]);
assert.deepEqual(catalog.map(row => row.name), watch.chinaDataCenters);
assert.equal(catalog[0].worlds.length, 2);
assert.equal(watch.scopeKey({ dataCenter: 'China', worldId: 1042 }), watch.chinaScopeKey);
assert.equal(watch.scopePath({ dataCenter: '陆行鸟', worldId: null }), '陆行鸟');
assert.equal(watch.scopePath({ dataCenter: '陆行鸟', worldId: 1042 }), '1042');
assert.equal(watch.scopeLabel({ dataCenter: '陆行鸟', worldId: 1042 }, catalog), '陆行鸟 · 拉诺西亚');
assert.equal(watch.listingWorldName({ worldName: '拉诺西亚', worldID: 1042 }, catalog), '拉诺西亚');
assert.equal(watch.listingWorldName({ worldID: 1042 }, catalog), '拉诺西亚', '挂单仅有服务器 ID 时查目录');
assert.equal(watch.listingWorldName({}, catalog, { dataCenter: '陆行鸟', worldId: 1042 }), '拉诺西亚', '旧缓存没有服务器 ID 时使用已选单服');
assert.equal(watch.listingWorldName({ worldID: 1042 }, []), '服务器 ID 1042', '目录不可用时仍显示服务器 ID');
const scoped = watch.normalizeSettings({ marketScope: { dataCenter: '陆行鸟', worldId: 1042 }, items: { 100: { below: 80, alertStates: { 'world:1042': 'below', 'dc:陆行鸟': 'inside' } } } });
assert.equal(scoped.marketScope.worldId, 1042);
assert.equal(watch.alertTransition(scoped.items['100'], 70, 'world:1042').alert, null, '同一服务器持续越界不重复提醒');
assert.equal(watch.alertTransition(scoped.items['100'], 70, 'dc:陆行鸟').alert, 'below', '大区汇总保有独立提醒状态');

const listings = [
  { pricePerUnit: 100, quantity: 2, hq: true, worldName: '陆行鸟' },
  { pricePerUnit: 110, quantity: 3, hq: false },
  { pricePerUnit: 120, quantity: 4, hq: true },
  { pricePerUnit: -5, quantity: 20, hq: true }
];
assert.equal(watch.summarizeListings(listings, 'hq').minimum, 100);
assert.equal(watch.summarizeListings([{ pricePerUnit: 100, quantity: 2, worldID: 1042 }]).listings[0].worldID, 1042, '行情快照保留挂单服务器 ID');
assert.equal(watch.summarizeListings(listings, 'nq').minimum, 110);
assert.equal(watch.summarizeListings(listings, 'hq', 4).average, 110);
assert.equal(watch.summarizeListings([], 'all').minimum, null);

const base = { below: 80, above: 120, alertState: 'inside' };
assert.deepEqual(watch.alertTransition(base, 80), { state: 'inside', alert: null }, '边界不提醒');
assert.deepEqual(watch.alertTransition(base, 120), { state: 'inside', alert: null }, '边界不提醒');
assert.deepEqual(watch.alertTransition(base, 79), { state: 'below', alert: 'below' });
assert.deepEqual(watch.alertTransition({ ...base, alertState: 'below' }, 70), { state: 'below', alert: null }, '持续越界不重复');
assert.deepEqual(watch.alertTransition({ ...base, alertState: 'below' }, 90), { state: 'inside', alert: null }, '回到范围内重置');
assert.equal(watch.alertTransition({ ...base, alertState: 'below' }, null).alert, null, '无挂单不提醒');

const now = Date.UTC(2026, 9, 22, 12);
const sale = (daysAgo, price, quantity = 1, hq = false) => ({ timestamp: Math.floor((now - daysAgo * 86400000) / 1000), pricePerUnit: price, quantity, hq });
const sales = [sale(13, 100), sale(12, 100), sale(5, 100), sale(4, 100), sale(1, 120), sale(0, 120)];
const summary = watch.summarizeSales(sales, 'all', now);
assert.equal(summary.direction, 'up');
assert.equal(summary.recentUnits, 4);
assert.equal(summary.salesDirection, 'up');
assert.equal(summary.points.length, 7);
assert.equal(watch.summarizeSales(sales, 'hq', now).direction, 'insufficient');
assert.equal(watch.summarizeSales(sales, 'all', now, true).direction, 'insufficient');
const midnight = Date.UTC(2026, 9, 22, 16, 30); // 中国时间 10 月 23 日 00:30
const entryAt = (iso, price, quantity, hq = false) => ({ timestamp: Math.floor(Date.parse(iso) / 1000), pricePerUnit: price, quantity, hq });
const periodEntries = [
  entryAt('2026-10-22T15:59:00Z', 100, 2),
  entryAt('2026-10-22T16:00:00Z', 200, 1),
  entryAt('2026-10-22T16:20:00Z', 300, 3),
  entryAt('2026-10-16T16:00:00Z', 400, 4),
  entryAt('2026-09-23T16:00:00Z', 500, 5),
  entryAt('2026-10-22T16:10:00Z', 999, 6, true)
];
const history = watch.aggregateSalesHistory(periodEntries, 'nq', midnight);
const todaySales = watch.salesForPeriod(history, 'today', midnight);
assert.equal(todaySales.points.length, 1, '当天只绘制已到达的小时');
assert.equal(todaySales.units, 4);
assert.equal(todaySales.averageSalePrice, 275);
assert.equal(watch.salesForPeriod(history, 'yesterday', midnight).units, 2);
assert.equal(watch.salesForPeriod(history, 'week', midnight).units, 10);
assert.equal(watch.salesForPeriod(history, 'month', midnight).units, 15);
assert.equal(watch.salesForPeriod(watch.aggregateSalesHistory(periodEntries, 'hq', midnight), 'today', midnight).units, 6);
assert.equal(watch.salesForPeriod(watch.aggregateSalesHistory([], 'all', midnight), 'today', midnight).units, 0);
assert.equal(watch.salesForPeriod(watch.aggregateSalesHistory([], 'all', midnight), 'today', midnight).averageSalePrice, null);
const capped = watch.aggregateSalesHistory([entryAt('2026-10-15T16:00:00Z', 100, 1)], 'all', midnight, true);
assert.equal(watch.salesForPeriod(capped, 'week', midnight).complete, true);
assert.equal(watch.salesForPeriod(capped, 'month', midnight).complete, false);
assert.equal(watch.salesForPeriod(capped, 'month', midnight).units, null, '截断时不能显示误导性的完整数量');
assert.match(source, /id="watch-sale-period"/, '列表标题应有统一成交时段选择');
assert.match(source, /data-watch-sales/, '成交价和数量应共用大图入口');
assert.match(watch.sparkline([100, null, 120]), /,/);
assert.equal(watch.sparkline([null, 100, null]), '');
assert.equal(watch.escapeHtml('<script>'), '&lt;script&gt;');
console.log('Market watch settings, listing, trend, threshold and escaping checks passed.');
