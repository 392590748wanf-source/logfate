// 用模拟挂单验证大区响应被缩成摘要后，推荐价和缺失项结果保持一致。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'fantasy.js'), 'utf8').replace(/\r\n/g, '\n');
const marketPricingSource = source.match(/^  const EQUIPMENT_QUALITY_MARKET_METHOD = [^\n]+/m)[0] + '\n'
  + source.slice(source.indexOf('  const MARKET_COMPARISON_TAX_RATE'), source.indexOf('  const craftedUnitComparisonCost'));
const start = source.indexOf('        const candidateIds = candidateMaterials.map(material => material.uid).join(\',\');');
const end = source.indexOf('\n      };\n      let pending = materials;', start);
assert.ok(start > 0 && end > start, '必须检查实际的大区挂单处理代码');

const candidateMaterials = [1, 2].map(uid => ({ uid, marketNpcSnapshots: { '100': { status: 'pending-data-center' } } }));
const oldRegionalPrice = { status: 'listing-weighted', price: 17, updatedAt: '2026-10-06' };
candidateMaterials[0].marketDataCenters = { 莫古力: oldRegionalPrice };
candidateMaterials[0].marketNpcSnapshots['100'].dataCenters = { 莫古力: { status: 'checked', eligibleQuantity: 240, comparisonPrice: 19, updatedAt: '2026-10-06' } };
const failed = [];
const context = vm.createContext({
  candidateMaterials, failed, refreshedAt: '2026-10-07',
  requestMarket: async url => {
    const scope = decodeURIComponent(new URL(url).pathname.split('/')[3]);
    if (scope === '莫古力') throw new Error('offline');
    return {
      items: {
        '1': { listings: [{ pricePerUnit: 20, quantity: 5 }, { pricePerUnit: 30, quantity: 5 }] },
        ...(scope === '陆行鸟' ? {} : { '2': { listings: [{ pricePerUnit: 40, quantity: 3 }] } })
      },
      unresolvedItems: scope === '陆行鸟' ? [2] : []
    };
  }
});
vm.runInContext(marketPricingSource, context);

(async () => {
  const splitStart = source.indexOf('      const requestChinaBatch = async (batch, retry = false) => {');
  const splitEnd = source.indexOf('      const refreshMarketBatch =', splitStart);
  assert.ok(splitStart > 0 && splitEnd > splitStart, '中国区报价请求应支持拆批重试');
  const splitContext = vm.createContext({ requestChinaMarket: async url => {
    const ids = url.match(/\/China\/([^?]+)/)[1].split(',');
    if (ids.length > 1) throw Object.assign(new Error('批量请求超时'), { name: 'AbortError' });
    if (ids[0] === '3') return { items: {}, unresolvedItems: [3] };
    return { itemID: Number(ids[0]), listings: [{ pricePerUnit: 100, quantity: 1 }] };
  } });
  vm.runInContext(`${source.slice(splitStart, splitEnd)}; this.requestChinaBatch = requestChinaBatch;`, splitContext);
  const splitResult = await splitContext.requestChinaBatch([1, 2, 3, 4].map(uid => ({ uid })));
  assert.deepEqual(Object.keys(splitResult.items), ['1', '2', '4'], '大批次失败后保留逐项成功的报价');
  assert.equal(splitResult.failures['3'], '市场接口未识别该物品 ID', '仅真正未解析的物品计入失败');
  let offlineRequests = 0;
  splitContext.requestChinaMarket = async () => { offlineRequests++; throw new Error('网络不可用'); };
  const offlineResult = await splitContext.requestChinaBatch([1, 2, 3].map(uid => ({ uid })));
  assert.equal(offlineRequests, 1, '断网时不应递归重试整批物品');
  assert.equal(Object.keys(offlineResult.failures).length, 3);
  let groupedRequests = 0;
  splitContext.requestChinaMarket = async url => {
    groupedRequests++;
    const ids = url.match(/\/China\/([^?]+)/)[1].split(',');
    assert.ok(ids.length <= 10, '单个中国区请求不超过 10 件');
    return { items: Object.fromEntries(ids.map(uid => [uid, { listings: [] }])) };
  };
  const groupedResult = await splitContext.requestChinaBatch(Array.from({ length: 30 }, (_, index) => ({ uid: index + 1 })));
  assert.equal(groupedRequests, 4, '30 件在一轮中拆成并发小批，减少补充大区查询轮次');
  assert.equal(Object.keys(groupedResult.failures).length, 0);

  await vm.runInContext(`(async () => { ${source.slice(start, end)} })()`, context);
  assert.equal(candidateMaterials[0].marketDataCenters.陆行鸟.price, 25);
  assert.equal(candidateMaterials[1].marketDataCenters.猫小胖.price, 40);
  assert.equal(candidateMaterials[0].marketDataCenters.莫古力.status, 'error');
  assert.equal(candidateMaterials[0].marketDataCenters.莫古力.price, 17);
  assert.equal(candidateMaterials[0].marketDataCenters.莫古力.updatedAt, '2026-10-06');
  assert.equal(candidateMaterials[0].marketNpcSnapshots['100'].dataCenters.陆行鸟.eligibleQuantity, 10);
  assert.equal(candidateMaterials[1].marketNpcSnapshots['100'].dataCenters.豆豆柴.eligibleQuantity, 3);
  assert.equal(candidateMaterials[0].marketNpcSnapshots['100'].dataCenters.莫古力.status, 'error');
  assert.equal(candidateMaterials[0].marketNpcSnapshots['100'].dataCenters.莫古力.eligibleQuantity, 240, '核验失败时沿用该大区最近一次合格库存');
  assert.equal(candidateMaterials[1].marketNpcSnapshots['100'].dataCenters.陆行鸟.status, 'error', '大区遗漏的物品保留核验失败状态');
  assert.deepEqual(failed, [], '大区补充库存查询失败不应误报中国区主报价失败');
  candidateMaterials[0].marketNpcSnapshots['100'].status = 'pending-data-center';
  context.requestMarket = async () => ({ items: { '1': { listings: [] } } });
  await vm.runInContext(`(async () => { ${source.slice(start, end)} })()`, context);
  assert.equal(candidateMaterials[0].marketNpcSnapshots['100'].dataCenters.莫古力.eligibleQuantity, 0, '有效的无库存响应覆盖旧核验');
  assert.equal(candidateMaterials[0].marketDataCenters.莫古力.price, 17, '无挂单不覆盖最近一次有效报价');
  const warningStart = source.indexOf('  function marketRefreshWarning(');
  const warningEnd = source.indexOf('  function visibleGuideMarketMaterials() {', warningStart);
  assert.ok(warningStart > 0 && warningEnd > warningStart, '应有刷新失败悬浮提示');
  const marketMaterials = [{ uid: 1, n: '测试<材料>' }, { uid: 999 }];
  const warningContext = vm.createContext({
    data: { m: marketMaterials }, canRefreshMarketMaterial: material => Boolean(material.uid),
    escapeTradeHtml: value => String(value).replace(/</g, '&lt;').replace(/>/g, '&gt;')
  });
  vm.runInContext(source.slice(warningStart, warningEnd), warningContext);
  assert.equal(warningContext.marketRefreshWarning(), '', '没有失败物品时不显示警示图标');
  const failureStart = source.indexOf('  const recordMarketRefreshFailure =');
  const failureEnd = source.indexOf('  let activeMarketRefresh', failureStart);
  vm.runInContext(source.slice(failureStart, failureEnd) + '\nthis.fail = recordMarketRefreshFailure;', warningContext);
  warningContext.fail(marketMaterials[0], '请求超时');
  Object.assign(marketMaterials[1], { marketStatus: 'listing-weighted', marketDataCenters: { A: { status: 'error' } } });
  const warning = warningContext.marketRefreshWarning();
  assert.match(warning, /测试&lt;材料&gt;（ID 1）：请求超时/, '失败原因和安全转义的材料名称来自各自的记录');
  assert.match(warning, /已有报价，大区库存核验未完成 1 件/, '大区核验失败单独提示');
  assert.match(warning, /未知物品（ID 999）/, '未收录的物品仍应显示 ID');
  marketMaterials[1].marketStatus = 'no-listings';
  const laterWarning = warningContext.marketRefreshWarning();
  assert.match(laterWarning, /暂无有效挂单 1 件/, '请求成功但无价格也要显示提示');
  assert.match(laterWarning, /报价请求失败 1 件/, '其他材料刷新后应保留未重试物品的失败记录');

  const recipeContext = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'levequest-recipes.js'), 'utf8'), recipeContext);
  const recipes = recipeContext.window.FF14_LEVEQUEST_RECIPES.recipes;
  Object.assign(recipeContext, {
    leveRecipeNode: uid => recipes[uid]?.[0],
    leveMaterial: uid => ({ uid }),
    voucherCarrierIds: new Set(['10335'])
  });
  const recipeStart = source.indexOf('  const leveRecipeMarketMaterials =');
  const recipeEnd = source.indexOf('  const leveBaseMaterials =', recipeStart);
  const leveMaterials = vm.runInContext(source.slice(recipeStart, recipeEnd) +
    '\nleveRecipeMarketMaterials([{itemId:1838}, {itemId:10610}, {itemId:25796}]);', recipeContext);
  const leveIds = new Set(leveMaterials.map(material => material.uid));
  for (const uid of ['3', '9', '5277', '12518', '27765', '10335']) {
    assert.ok(leveIds.has(uid), `理符刷新应包括原料、半成品、水晶及兑换凭证 ${uid}`);
  }
  const nested = recipes[27690][0].a[0];
  assert.ok(leveIds.has(String(nested)), '理符刷新应深入半成品的下级配方');
  assert.ok(!leveIds.has('1838') && !leveIds.has('10610'), '有配方的交付成品无需请求自身的市场价');
  assert.equal(leveIds.size, leveMaterials.length, '共用原料只请求一次');

  const queueStart = source.indexOf('  let activeMarketRefresh');
  const queueEnd = source.indexOf('  async function runMarketRefresh(', queueStart);
  let release;
  const firstBatch = new Promise(resolve => { release = resolve; });
  const calls = [];
  const queueContext = vm.createContext({ runMarketRefresh: async materials => {
    calls.push(materials);
    if (calls.length === 1) await firstBatch;
  } });
  vm.runInContext(source.slice(queueStart, queueEnd), queueContext);
  const globalRefresh = queueContext.refreshMarket();
  const leveRefresh = queueContext.refreshMarket(true, leveMaterials);
  await Promise.resolve();
  assert.deepEqual(calls, [null], '共享刷新先完成在途批次');
  release();
  await Promise.all([globalRefresh, leveRefresh]);
  assert.deepEqual(calls, [null, leveMaterials], '在途全局刷新结束后仍会发送理符定向请求');

  const priced = { uid: '1', marketDataCenters: { 陆行鸟: { status: 'error', reason: 'npcMarketSnapshot is not defined' } } };
  const recovered = { uid: '2' };
  const stillEmpty = { uid: '3' };
  const oldSnapshot = { uid: '4', mp: 80, u: '2026-10-06', marketStatus: 'listing-weighted',
    marketQualityMethod: 'hybrid-p25-weighted-v1', marketReferenceQuotes: { any: { price: 80 }, hq: { price: 120 } } };
  const excluded = { uid: '5', marketExcluded: true };
  const refreshRequests = [];
  const dataCenterRequests = [];
  const stages = [];
  let saveCount = 0;
  const refreshButton = { classList: { toggle() {} }, set textContent(value) { stages.push(value); } };
  const refreshContext = vm.createContext({
    state: { page: 'home' }, window: {}, data: { m: [priced, recovered, stillEmpty, oldSnapshot, excluded] },
    saleTimeFoodIds: { medicine: 1 }, isNonMarketSubmarineNode: () => false, AbortController,
    document: { querySelector: selector => selector === '#refresh-market' ? refreshButton : null },
    setTimeout: (callback, delay) => delay < 1000 ? setTimeout(callback, 0) : setTimeout(callback, delay),
    clearTimeout, console, localStorage: { setItem(key) { if (key === 'ff14-material-state') saveCount++; } },
    npcCandidate: material => material === priced ? { price: 200 } : null, leveSourceRecord: () => null,
    recipeCandidatesFor: () => [], leveRecipeNode: () => null,
    money: value => String(value),
    invalidatePlans() {}, invalidateNpcMaterials() {}, ensureSubmarineMaterials() {}, syncPurchaseCosts() {},
    fetch: async url => {
      const [, scope, itemPath] = url.match(/\/api\/v2\/([^/]+)\/([^?]+)/);
      if (scope !== 'China') {
        assert.equal(refreshRequests.length, 2, '优先跑完中国区首轮和补刷，再核验大区库存');
        dataCenterRequests.push(itemPath);
        return { ok: true, json: async () => ({ itemID: 1, listings: [
          { pricePerUnit: 100, quantity: 210 }, { pricePerUnit: 195, quantity: 300 }
        ] }) };
      }
      const ids = itemPath.split(',');
      refreshRequests.push(ids);
      assert.equal(saveCount, 0, '食药首批完成后也不会提前写存储');
      const isRetry = refreshRequests.length > 1;
      const items = {};
      for (const id of ids) {
        if (id === '4') continue;
        const listings = id === '1' || (id === '2' && isRetry) ? [{ pricePerUnit: 100, quantity: 12 }] : [];
        items[id] = { itemID: Number(id), listings };
      }
      return { ok: true, json: async () => ({ items }) };
    }
  });
  vm.runInContext(marketPricingSource, refreshContext);
  vm.runInContext(source.slice(source.indexOf('  const marketNpcSnapshotKey'), source.indexOf('  const marketPurchaseCandidate')), refreshContext);
  vm.runInContext(source.slice(source.indexOf('  const recentlyRefreshedFood'), source.indexOf('  async function refreshEquipmentFoodMarket')), refreshContext);
  await refreshContext.refreshMarket();
  assert.deepEqual(refreshRequests, [['1', '2', '3', '4'], ['2', '3', '4']], '全流程只补刷没有当前报价的物品一次');
  assert.equal(priced.mp, 100, '接口成功应真正写入首轮价格');
  assert.deepEqual(dataCenterRequests, ['1', '1', '1', '1'], '仅对市场价格可能优于 NPC 的材料做大区库存核验');
  assert.equal(priced.marketDataCenters.陆行鸟.status, 'listing-weighted', '成功核验覆盖之前的程序错误');
  const npcSnapshot = priced.marketNpcSnapshots['200'].dataCenters.陆行鸟;
  assert.equal(npcSnapshot.eligibleQuantity, 210, '税后不低于 NPC 的库存不计入门槛');
  assert.equal(npcSnapshot.comparisonPrice, 105, '大区市场比较价包含税费');
  assert.equal(recovered.mp, 100, '补刷取得的价格应写回材料');
  assert.equal(stillEmpty.marketStatus, 'no-listings', '两轮没有挂单时保留暂无挂单状态');
  assert.equal(oldSnapshot.mp, 80, '请求失败不丢失旧价');
  assert.equal(oldSnapshot.u, '2026-10-06');
  const quote = vm.runInContext('marketReferencePrice', refreshContext);
  assert.equal(quote(JSON.parse(JSON.stringify(oldSnapshot))), 80, '重新读取报价缓存后仍可计价');
  assert.equal(quote(oldSnapshot, 'hq'), 120);
  assert.equal(oldSnapshot.marketRefreshError, '市场接口未返回该物品');
  assert.equal(refreshContext.state.marketRefreshing, false, '补刷结束后刷新状态解除');
  assert.equal(saveCount, 1, '普通材料两轮结束后统一保存');
  assert.ok(stages.includes('自动补刷 0/3…') && stages.includes('自动补刷 3/3…'), '刷新按钮显示实际补刷范围和进度');
  assert.equal(stages.at(-1), '统一刷新市场价');
  const apply = vm.runInContext('applyChinaMarketListings', refreshContext);
  const explain = vm.runInContext('marketQuoteExplanation', refreshContext);
  const nq = { pricePerUnit: 90, quantity: 10, hq: false };
  apply(oldSnapshot, { listings: [nq] }, '2026-10-07');
  assert.equal(quote(oldSnapshot, 'any'), 90);
  assert.equal(quote(oldSnapshot, 'nq'), 90);
  assert.equal(quote(oldSnapshot, 'hq'), 120, '仅 NQ 新报价不得清空 HQ');
  assert.match(explain(oldSnapshot, 'hq'), /沿用上次报价.*2026\/10\/6/);
  assert.doesNotMatch(explain(oldSnapshot, 'nq'), /沿用上次报价/);
  const previousListings = oldSnapshot.marketListings;
  apply(oldSnapshot, { listings: [] }, '2026-10-08');
  assert.equal(oldSnapshot.u, '2026-10-07');
  assert.equal(oldSnapshot.marketListings, previousListings);
  assert.equal(quote(oldSnapshot, 'nq'), 90);
  assert.match(explain(oldSnapshot, 'nq'), /沿用上次报价/);
  apply(oldSnapshot, { listings: [nq, { ...nq, hq: true, pricePerUnit: 150 }] }, '2026-10-09');
  assert.equal(quote(oldSnapshot, 'hq'), 150);
  assert.doesNotMatch(explain(oldSnapshot, 'hq'), /沿用上次报价/);
  assert.ok(!source.includes('notices.push(`刷新失败：'), '失败列表不应再作为常驻页面文字');
  console.log('Market refresh compact-response checks passed (simulated listings only).');
})().catch(error => { console.error(error); process.exitCode = 1; });
