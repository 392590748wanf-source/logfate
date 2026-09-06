window.addEventListener('load', async () => {
  const startupDesktopBridge = window.ff14Desktop;
  let externalDataBundle = null;
  try {
    externalDataBundle = (await startupDesktopBridge?.loadDataBundle())?.bundle || null;
  } catch (error) {
    console.warn('无法加载本机资料缓存，已使用内置资料。', error);
  }
  const externalDatasets = externalDataBundle?.datasets || {};
  const datasetGlobals = {
    baseMaterials: 'FF14_BASE_MATERIALS',
    submarineData: 'FF14_SUBMARINE_DATA',
    hqHelperFallback: 'FF14_HQHELPER_FALLBACK',
    retainerData: 'FF14_RETAINER_DATA',
    materialSources: 'FF14_MATERIAL_SOURCES',
    exchangeSources: 'FF14_EXCHANGE_SOURCES',
    craftScrips: 'FF14_CRAFT_SCRIPS',
    levequests: 'FF14_LEVEQUESTS',
    levequestCatalog: 'FF14_LEVEQUEST_CATALOG',
    fisherLeves: 'FF14_FISHER_LEVES',
    levequestRecipes: 'FF14_LEVEQUEST_RECIPES',
    levequestMaterialSources: 'FF14_LEVEQUEST_MATERIAL_SOURCES'
  };
  Object.entries(datasetGlobals).forEach(([key, globalName]) => {
    if (externalDatasets[key] && typeof externalDatasets[key] === 'object') window[globalName] = externalDatasets[key];
  });
  const state = { page: 'home', type: null, expanded: false, submarineExpanded: false, submarineView: 'summary', submarinePartsOpen: false, guideView: 'basic', guideExpanded: false, selectedMaterial: null, basicCategory: 'equipment', craftScripTicket: 'orange', craftScripManualEditingId: null, otherSearch: '', basicMaterialSearch: '', tradeView: 'inventory', tradeSearch: '', tradeEditingId: null, tradeSourceLoading: new Set(), tradeSourceFailures: new Map(), tradeSourceAudited: new Set(), leveView: 'ledger', leveSaleView: 'orders', leveJob: '刻木匠', leveStart: 20, leveTarget: 100, leveDouble: false, levePlanEditing: false, leveCatalogSearch: '', leveCatalogCollapsed: {}, leveSaleDraft: null, leveGuidePlan: '', leveGuideJob: '', leveGuideStart: '', leveGuideTarget: '', equipmentGroups: {}, equipmentSections: {}, guideCategories: {}, marketRefreshing: false, marketMessage: '', equipmentCombatTier: '770', equipmentGatheringTier: '750', equipmentSummaryTiers: { combat: '770', gathering: '750' }, submarineGroups: {}, itemIndexLoading: false, itemIconIndexLoading: false, garlandIconLoading: new Set() };
  const data = JSON.parse(localStorage.getItem('ff14-770') || '{"m":[],"r":[],"p":{},"l":[]}');
  const mergeMaterials = (defaults, saved) => {
    const savedById = new Map((saved || []).map(item => [String(item.id), item]));
    const defaultIds = new Set((defaults || []).map(item => String(item.id)));
    return [
      ...(defaults || []).map(item => {
        const savedItem = savedById.get(String(item.id));
        return savedItem ? { ...item, ...savedItem, id: item.id, n: item.n, uid: item.uid } : item;
      }),
      ...(saved || []).filter(item => !defaultIds.has(String(item.id)))
    ];
  };
  // 旧版本曾以内部 id 合并材料，而理符递归材料会因资料更新生成不同的内部 id。
  // 游戏物品 uid 才是唯一键：启动时统一合并，避免同一物品在材料指导价出现两行。
  const deduplicateMaterialsByUid = materials => {
    const groups = new Map();
    (materials || []).forEach(material => {
      const uid = String(material?.uid || '').trim();
      const key = uid || `__id:${String(material?.id || '')}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(material);
    });
    const aliases = new Map(), unique = [];
    const snapshotTime = material => {
      const value = Date.parse(String(material?.u || ''));
      return Number.isFinite(value) ? value : 0;
    };
    groups.forEach(group => {
      const primary = { ...group[0] };
      const newest = group.reduce((latest, material) => snapshotTime(material) >= snapshotTime(latest) ? material : latest, group[0]);
      group.slice(1).forEach(material => {
        aliases.set(String(material.id), String(primary.id));
        Object.entries(material).forEach(([key, value]) => {
          if (key === 'id' || key === 'uid') return;
          if ((primary[key] === undefined || primary[key] === null || primary[key] === '') && value !== undefined && value !== null && value !== '') primary[key] = value;
        });
      });
      // 市场快照是一组字段，必须整体从最新记录继承，不能混用两次刷新的数据。
      ['mp', 'u', 'marketStatus', 'marketSampleQuantity', 'marketSampleTarget', 'marketListings', 'marketDataCenters', 'marketNpcSnapshots'].forEach(key => {
        if (newest[key] !== undefined) primary[key] = newest[key];
      });
      unique.push(primary);
    });
    return { materials: unique, aliases };
  };
  const externalPreset = externalDatasets.nbbPreset;
  if (externalPreset?.r && externalPreset?.m) {
    const remoteRecipeIds = new Set(externalPreset.r.map(row => String(row.id)));
    data.r = [...externalPreset.r, ...(data.r || []).filter(row => !remoteRecipeIds.has(String(row.id)))];
    data.m = mergeMaterials(externalPreset.m, data.m || []);
  }
  const savedMaterials = JSON.parse(localStorage.getItem('ff14-material-state') || 'null');
  if (savedMaterials) data.m = externalPreset?.m ? mergeMaterials(data.m, savedMaterials) : savedMaterials;
  const purchases = JSON.parse(localStorage.getItem('ff14-material-purchases') || '[]');
  const materialDeduplication = deduplicateMaterialsByUid(data.m);
  data.m = materialDeduplication.materials;
  // 采购账本仍以旧内部 id 关联；迁移到保留条目后，历史采购均价不会丢失。
  purchases.forEach(row => {
    const replacement = materialDeduplication.aliases.get(String(row?.materialId));
    if (replacement) row.materialId = replacement;
  });
  if (materialDeduplication.aliases.size) {
    // 立即落盘迁移结果；用户下次启动也不会重新载入旧的重复记录。
    localStorage.setItem('ff14-770', JSON.stringify(data));
    localStorage.setItem('ff14-material-state', JSON.stringify(data.m));
    localStorage.setItem('ff14-material-purchases', JSON.stringify(purchases));
  }
  const prices = JSON.parse(localStorage.getItem('ff14-fantasy-prices') || '{}');
  const submarineTicketSettings = JSON.parse(localStorage.getItem('ff14-submarine-ticket-settings') || '{"defaultUnitCost":80}');
  if (!(Number(submarineTicketSettings.defaultUnitCost) > 0)) submarineTicketSettings.defaultUnitCost = 80;
  const otherMaterialIds = JSON.parse(localStorage.getItem('ff14-other-material-ids') || '[]');
  const tradeInventoryStorageKey = 'ff14-trade-inventory';
  let tradeInventory = JSON.parse(localStorage.getItem(tradeInventoryStorageKey) || '[]');
  if (!Array.isArray(tradeInventory)) tradeInventory = [];
  const tradeSourceCacheStorageKey = 'ff14-trade-source-cache';
  let tradeSourceCache = JSON.parse(localStorage.getItem(tradeSourceCacheStorageKey) || '{}');
  if (!tradeSourceCache || Array.isArray(tradeSourceCache) || typeof tradeSourceCache !== 'object') tradeSourceCache = {};
  const garlandVentureCoreCacheStorageKey = 'ff14-garland-venture-core-cache';
  const garlandVentureCoreCacheVersion = 1;
  const garlandVentureCoreCacheTtl = 24 * 60 * 60 * 1000;
  let garlandVentureCoreCache = JSON.parse(localStorage.getItem(garlandVentureCoreCacheStorageKey) || 'null');
  if (!garlandVentureCoreCache || typeof garlandVentureCoreCache !== 'object' || Array.isArray(garlandVentureCoreCache)) garlandVentureCoreCache = null;
  let garlandVentureCoreRequest = null;
  const craftScripManualStorageKey = 'ff14-craft-scrip-manual-exchanges';
  let craftScripManualExchanges = JSON.parse(localStorage.getItem(craftScripManualStorageKey) || '[]');
  if (!Array.isArray(craftScripManualExchanges)) craftScripManualExchanges = [];
  const leveSalesStorageKey = 'ff14-leve-sales-ledger';
  let leveSales = JSON.parse(localStorage.getItem(leveSalesStorageKey) || '[]');
  if (!Array.isArray(leveSales)) leveSales = [];
  leveSales = leveSales.map(sale => sale?.planName === '方案一（系统推荐）' ? { ...sale, planName: '方案一（默认）' } : sale);
  const levePricePresetStorageKey = 'ff14-leve-sale-price-presets';
  let levePricePresets = JSON.parse(localStorage.getItem(levePricePresetStorageKey) || '{}');
  if (!levePricePresets || Array.isArray(levePricePresets) || typeof levePricePresets !== 'object') levePricePresets = {};
  const submarineStocks = JSON.parse(localStorage.getItem('ff14-submarine-stocks') || '{}');
  const submarineSales = JSON.parse(localStorage.getItem('ff14-submarine-sales') || '[]');
  const submarineSuiteSales = JSON.parse(localStorage.getItem('ff14-submarine-suite-sales') || '[]');
  const submarineOperations = JSON.parse(localStorage.getItem('ff14-submarine-operations') || '[]');
  const npcMaterialConfig = JSON.parse(localStorage.getItem('ff14-submarine-npc-materials') || '{"added":{},"disabled":[]}');
  const submarineSuites = JSON.parse(localStorage.getItem('ff14-submarine-suites') || 'null') || [
    { id: '1111', code: '1111', priceKey: 'submarine-suite-1111' },
    { id: '1121', code: '1121', priceKey: 'submarine-suite-1121' },
    { id: '3004', code: '3004', priceKey: 'submarine-suite-3004' },
    { id: '3024', code: '3024', priceKey: 'submarine-suite-3024' },
    { id: '3124', code: '3124', priceKey: 'submarine-suite-3124' },
    { id: '3124m', code: '3124', modified: true, label: '3124改', priceKey: 'submarine-suite-3124m' },
    { id: '4254m', code: '4254', modified: true, label: '4254改', priceKey: 'submarine-suite-4254m' },
    { id: '4224m', code: '4224', modified: true, label: '4224改', priceKey: 'submarine-suite-4224m' }
  ];
  const planCache = new Map();
  // 配方不会在运行时写入，建立首条配方索引以避免台账渲染时重复线性扫描。
  const recipeByItemIdIndex = new Map();
  data.r.forEach(row => {
    const itemId = Number(row.itemId);
    if (Number.isFinite(itemId) && !recipeByItemIdIndex.has(itemId)) recipeByItemIdIndex.set(itemId, row);
  });
  // 潜水艇推荐分类和后续制作成本必须使用同一份实时来源比价结果。
  const submarineSourceCache = new Map();
  const submarineCraftCostCache = new Map();
  // 理符分类会在每个折叠栏统计一次；缓存顶层来源选择，避免重复递归计算同一物品。
  const leveGuideChoiceCache = new Map();
  const leveGuideKindCache = new Map();
  const invalidatePlans = () => {
    planCache.clear();
    submarineSourceCache.clear();
    submarineCraftCostCache.clear();
    leveGuideChoiceCache.clear();
    leveGuideKindCache.clear();
  };
  const guideIndexCache = { equipment: new Map(), submarine: null, leve: new Map(), catalog: null, membership: new Map() };
  const invalidateGuideIndexes = () => { guideIndexCache.equipment.clear(); guideIndexCache.submarine = null; guideIndexCache.leve.clear(); guideIndexCache.catalog = null; guideIndexCache.membership.clear(); };
  const itemIndex = () => window.FF14_ITEM_INDEX || [];
  const loadItemIndex = () => {
    if (window.FF14_ITEM_INDEX || state.itemIndexLoading) return;
    state.itemIndexLoading = true;
    const script = document.createElement('script');
    script.src = 'item-index.js';
    script.onload = () => {
      state.itemIndexLoading = false;
      if (state.page === 'guide' && state.basicCategory === 'other') renderGuide();
      else if (state.page === 'trade') {
        renderTrade();
        const search = document.querySelector('#trade-listing-dialog[open] #trade-listing-search');
        search?.dispatchEvent(new Event('input'));
      }
      else if (state.page === 'leve') renderLeve();
    };
    script.onerror = () => {
      state.itemIndexLoading = false;
      state.marketMessage = '道具索引加载失败，请稍后重试。';
      if (state.page === 'trade') renderTrade();
      else if (state.page === 'leve') renderLeve();
      else renderGuide();
    };
    document.head.append(script);
  };
  // 完整 Garland 图标索引只在“其他材料”搜索时按需载入；常用配方物品直接使用内置资料索引。
  const loadItemIconIndex = () => {
    if (window.FF14_ITEM_ICON_INDEX || state.itemIconIndexLoading) return;
    state.itemIconIndexLoading = true;
    const script = document.createElement('script');
    script.src = 'item-icon-index.js';
    script.onload = () => { state.itemIconIndexLoading = false; if (state.page === 'guide' && (state.basicCategory === 'other' || state.basicCategory === 'leve')) renderGuide(); else if (state.page === 'trade') renderTrade(); else if (state.page === 'leve') renderLeve(); };
    script.onerror = () => { state.itemIconIndexLoading = false; /* 图标仅作展示，索引加载失败不影响搜索或账本。 */ };
    document.head.append(script);
  };
  const moneyFormatter = new Intl.NumberFormat('zh-CN');
  const chinaDateFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
  const money = n => moneyFormatter.format(Math.round(n || 0)) + ' G';
  // 市场参考价按交易税估算；制作时间补差仅供仍明确启用它的业务规则使用。
  // 历史采购记录的 total 已是用户实际入账合价，因此不会在这里重复计税。
  const MARKET_COMPARISON_TAX_RATE = 0.05;
  const SELF_CRAFT_TIME_SURCHARGE = 400;
  const MARKET_NPC_STOCK_THRESHOLD = 200;
  const CHINA_MARKET_DATA_CENTERS = ['陆行鸟', '莫古力', '猫小胖', '豆豆柴'];
  const marketComparisonCost = price => {
    const value = Number(price || 0);
    return value > 0 ? value * (1 + MARKET_COMPARISON_TAX_RATE) : 0;
  };
  const craftedUnitComparisonCost = inputUnitCost => {
    const value = Number(inputUnitCost || 0);
    return value > 0 ? value + SELF_CRAFT_TIME_SURCHARGE : null;
  };
  const marketPriceLabel = material => {
    if (material?.marketExcluded) {
      return material.marketExcludedReason === 'collectable' ? '不可交易，不查询市场价' : '不查询市场价';
    }
    if (Number(material?.mp) > 0) {
      if (material.marketStatus === 'listing-weighted') {
        return money(marketComparisonCost(material.mp));
      }
      if (material.marketStatus === 'no-listings') return money(marketComparisonCost(material.mp)) + '（暂无在售，最近快照）';
      if (material.marketStatus === 'stale') return money(marketComparisonCost(material.mp)) + '（最近快照）';
      return money(marketComparisonCost(material.mp));
    }
    if (material?.marketStatus === 'no-listings') return '暂无在售挂单';
    if (material?.marketStatus === 'not-found') return '无市场数据';
    return '未获取';
  };
  const marketNpcSnapshotKey = price => String(Number(price || 0));
  // NPC 与市场比较时，不能因少量低价挂单误导采购建议；每个大区独立达到库存门槛后才允许市场参与比价。
  const marketPurchaseCandidate = (material, npc = npcCandidate(material)) => {
    const rawMarketPrice = Number(material?.mp || 0);
    const npcPrice = Number(npc?.price || 0);
    if (!(rawMarketPrice > 0)) {
      return { key: 'direct-market', price: 0, unavailable: true, source: 'Universalis 市场挂单', formula: '等待四大区 HQ／NQ 市场挂单' };
    }
    if (!(npcPrice > 0)) {
      return { key: 'direct-market', price: marketComparisonCost(rawMarketPrice), source: 'Universalis 中国区 HQ／NQ 挂单', formula: '中国区 HQ／NQ 挂单最低价起前 999 个的加权价 × 1.05（含税比较）' };
    }
    const snapshot = material?.marketNpcSnapshots?.[marketNpcSnapshotKey(npcPrice)];
    if (snapshot?.status === 'not-required') {
      return {
        key: 'direct-market', price: marketComparisonCost(rawMarketPrice), source: 'Universalis 中国区 HQ／NQ 挂单',
        formula: snapshot.reason || `中国区税后市场均价 ${money(rawMarketPrice)} × 1.05 已不低于其他有效来源，无需库存判定`
      };
    }
    const candidates = Object.entries(snapshot?.dataCenters || {})
      .filter(([, entry]) => Number(entry?.eligibleQuantity || 0) >= MARKET_NPC_STOCK_THRESHOLD && Number(entry?.comparisonPrice || 0) < npcPrice)
      .map(([dataCenter, entry]) => ({ dataCenter, ...entry }))
      .sort((left, right) => Number(left.comparisonPrice) - Number(right.comparisonPrice));
    if (candidates.length) {
      const selected = candidates[0];
      return {
        key: 'direct-market', price: Number(selected.comparisonPrice), source: `Universalis ${selected.dataCenter}大区 HQ／NQ 挂单`, dataCenter: selected.dataCenter,
        eligibleQuantity: Number(selected.eligibleQuantity), rawPrice: Number(selected.rawPrice),
        formula: `${selected.dataCenter}大区税后市场价 ${money(selected.rawPrice)} × 1.05；低于 NPC ${money(npcPrice)} 的合格库存 ${selected.eligibleQuantity} 个（任一单个大区达到 ${MARKET_NPC_STOCK_THRESHOLD} 个即可）`
      };
    }
    const failed = Object.values(snapshot?.dataCenters || {}).some(entry => entry?.status === 'error');
    return {
      key: 'direct-market', price: 0, referencePrice: marketComparisonCost(rawMarketPrice), unavailable: true, source: 'Universalis 市场挂单',
      formula: failed ? `部分大区刷新失败，无法确认任一单个大区是否有 ${MARKET_NPC_STOCK_THRESHOLD} 个低价库存` : `市场合格库存不足（任一单个大区需 ${MARKET_NPC_STOCK_THRESHOLD} 个税后低于 NPC ${money(npcPrice)} 的 HQ／NQ 挂单）`
    };
  };
  const sourceOptionPriceLabel = option => {
    const price = Number(option?.price || 0) || Number(option?.referencePrice || 0);
    return price > 0 ? money(price) + (option?.unavailable && Number(option?.referencePrice || 0) > 0 ? '（仅参考）' : '') : '—';
  };
  const sourceChoiceRows = choice => (choice?.options || []).map(option => `<tr class="${option.key === choice.key && option.key === 'npc' ? 'npc-row' : ''}"><td>${option.key === choice.key ? recommendationTag(option, '当前推荐') : ''}${option.label}</td><td>${sourceOptionPriceLabel(option)}</td><td class="label">${option.source}</td><td class="label"><small class="meta">${option.formula || '未获取有效价格'}</small></td></tr>`).join('');
  const sourceChoiceComparisonTable = choice => {
    const rows = sourceChoiceRows(choice);
    return `<section class="sales-history"><h3>取得方式单价对比</h3><div class="table-wrap history-table"><table class="ledger"><thead><tr><th>渠道</th><th>单价</th><th>数据来源</th><th>计算依据</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">暂无可用渠道</td></tr>'}</tbody></table></div></section>`;
  };
  // 库存门槛只用于阻止“少量低价挂单”成为推荐来源；市场价已不低于 NPC 或自制价时，它不会被选中，无需再校验库存。
  const waiveMarketStockGateWhenNotCompetitive = options => {
    const market = options.find(option => option.key === 'direct-market');
    if (!market?.unavailable || !(Number(market.referencePrice) > 0)) return options;
    const blocker = options.find(option => ['npc', 'craft'].includes(option.key) && Number(option.price) > 0 && Number(option.price) <= Number(market.referencePrice));
    if (!blocker) return options;
    market.price = Number(market.referencePrice);
    market.unavailable = false;
    market.formula = `税后市场参考价 ${money(market.referencePrice)} 不低于${blocker.label} ${money(blocker.price)}，不会被推荐，无需任一单个大区 ${MARKET_NPC_STOCK_THRESHOLD} 个库存门槛`;
    return options;
  };
  const marketNpcPriceLabel = (material, npc) => {
    const candidate = marketPurchaseCandidate(material, npc);
    const chinaReference = marketPriceLabel(material);
    if (!(Number(npc?.price) > 0)) return chinaReference;
    // 表格只保留一个可直接比较的金额：有合格大区则用实际可购价，否则用中国区税后参考价。
    return candidate.dataCenter && Number(candidate.price) > 0 ? money(candidate.price) : chinaReference;
  };
  const chinaDate = value => {
    const parts = chinaDateFormatter.formatToParts(value instanceof Date ? value : new Date(value));
    const find = type => parts.find(part => part.type === type)?.value;
    return `${find('year')}-${find('month')}-${find('day')}`;
  };
  const today = () => chinaDate(new Date());
  const shiftDate = (date, days) => { const [year, month, day] = String(date).split('-').map(Number); return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10); };
  const stock = id => data.p[id] || { q: 0, v: 0, made: 0, sold: 0 };
  const save = () => {
    localStorage.setItem('ff14-770', JSON.stringify(data));
    localStorage.setItem('ff14-fantasy-prices', JSON.stringify(prices));
    localStorage.setItem('ff14-submarine-ticket-settings', JSON.stringify(submarineTicketSettings));
    localStorage.setItem('ff14-material-state', JSON.stringify(data.m));
    localStorage.setItem('ff14-material-purchases', JSON.stringify(purchases));
    localStorage.setItem('ff14-other-material-ids', JSON.stringify(otherMaterialIds));
    localStorage.setItem(tradeInventoryStorageKey, JSON.stringify(tradeInventory));
    localStorage.setItem(tradeSourceCacheStorageKey, JSON.stringify(tradeSourceCache));
    if (garlandVentureCoreCache) localStorage.setItem(garlandVentureCoreCacheStorageKey, JSON.stringify(garlandVentureCoreCache));
    else localStorage.removeItem(garlandVentureCoreCacheStorageKey);
    localStorage.setItem(craftScripManualStorageKey, JSON.stringify(craftScripManualExchanges));
    localStorage.setItem(leveSalesStorageKey, JSON.stringify(leveSales));
    localStorage.setItem(levePricePresetStorageKey, JSON.stringify(levePricePresets));
    localStorage.setItem('ff14-submarine-stocks', JSON.stringify(submarineStocks));
    localStorage.setItem('ff14-submarine-sales', JSON.stringify(submarineSales));
    localStorage.setItem('ff14-submarine-suite-sales', JSON.stringify(submarineSuiteSales));
    localStorage.setItem('ff14-submarine-operations', JSON.stringify(submarineOperations));
    localStorage.setItem('ff14-submarine-npc-materials', JSON.stringify(npcMaterialConfig));
    localStorage.setItem('ff14-submarine-suites', JSON.stringify(submarineSuites));
  };
  const backupStorageKeys = [
    'ff14-770', 'ff14-material-state', 'ff14-material-purchases', 'ff14-fantasy-prices',
    'ff14-submarine-ticket-settings', 'ff14-other-material-ids', 'ff14-submarine-stocks',
    'ff14-submarine-sales', 'ff14-submarine-suite-sales', 'ff14-submarine-operations',
    'ff14-submarine-npc-materials', 'ff14-submarine-suites', 'ff14-leve-plans', leveSalesStorageKey, levePricePresetStorageKey, craftScripManualStorageKey, tradeInventoryStorageKey, tradeSourceCacheStorageKey, garlandVentureCoreCacheStorageKey, 'ff14-market-refreshed-at'
  ];
  const backupFormat = 'ff14-fantasy-backup';
  const createBackup = () => ({
    format: backupFormat,
    version: 1,
    exportedAt: new Date().toISOString(),
    storage: Object.fromEntries(backupStorageKeys.map(key => [key, localStorage.getItem(key)]).filter(([, value]) => typeof value === 'string'))
  });
  const validateBackup = backup => {
    if (!backup || backup.format !== backupFormat || backup.version !== 1 || !backup.storage || Array.isArray(backup.storage)) {
      throw new Error('备份文件格式不正确，或版本不受支持。');
    }
    const storage = {};
    Object.entries(backup.storage).forEach(([key, value]) => {
      if (!backupStorageKeys.includes(key) || typeof value !== 'string') throw new Error('备份文件包含无效数据。');
      storage[key] = value;
    });
    if (!Object.keys(storage).length) throw new Error('备份文件中没有可恢复的账本数据。');
    return storage;
  };
  const restoreBackup = backup => {
    const storage = validateBackup(backup);
    if (!confirm('导入会覆盖本机当前账本数据。建议先导出备份，确认继续吗？')) return false;
    backupStorageKeys.forEach(key => localStorage.removeItem(key));
    Object.entries(storage).forEach(([key, value]) => localStorage.setItem(key, value));
    location.reload();
    return true;
  };
  const sales = () => data.l.filter(row => row.type === '出售');
  const jobNames = {
    '职业 38':'骑士', '职业 41':'武僧', '职业 44':'战士', '职业 47':'龙骑士',
    '职业 50':'诗人', '职业 53':'白魔法师', '职业 55':'黑魔法师', '职业 69':'学者',
    '职业 29':'召唤师', '职业 93':'忍者', '职业 98':'暗黑骑士', '职业 96':'机工士',
    '职业 99':'占星术士', '职业 111':'武士', '职业 112':'赤魔法师', '职业 149':'绝枪战士',
    '职业 150':'舞者', '职业 180':'钐镰客', '职业 181':'贤者', '职业 196':'蝰蛇剑士',
    '职业 197':'绘灵法师', '职业 9':'刻木匠', '职业 10':'锻铁匠', '职业 11':'铸甲匠',
    '职业 12':'雕金匠', '职业 13':'制革匠', '职业 14':'裁衣匠', '职业 15':'炼金术士',
    '职业 16':'烹饪师', '职业 17':'采矿工', '职业 18':'园艺工', '职业 19':'捕鱼人'
  };
  const jobIconPaths = {
    '职业 38':'pld.png', '职业 44':'war.png', '职业 98':'drk.png', '职业 149':'gnb.png',
    '职业 53':'whm.png', '职业 69':'sch.png', '职业 99':'ast.png', '职业 181':'sge.png',
    '职业 47':'drg.png', '职业 180':'rpr.png', '职业 41':'mnk.png', '职业 111':'sam.png',
    '职业 93':'nin.png', '职业 196':'vpr.png', '职业 50':'brd.png', '职业 96':'mch.png', '职业 150':'dnc.png',
    '职业 55':'blm.png', '职业 29':'smn.png', '职业 112':'rdm.png', '职业 197':'pct.png',
    '职业 9':'crp.png', '职业 10':'bsm.png', '职业 11':'arm.png', '职业 12':'gsm.png', '职业 13':'ltw.png', '职业 14':'wvr.png', '职业 15':'alc.png', '职业 16':'cul.png', '职业 17':'min.png', '职业 18':'btn.png', '职业 19':'fsh.png'
  };
  const groupIconPaths = { '防护职业':'role-icons/tank.png', '治疗职业':'role-icons/healer.png', '制敌 DPS':'role-icons/dps.png', '强袭 DPS':'role-icons/dps.png', '游击 DPS':'role-icons/dps.png', '远敏 DPS':'role-icons/ranged.png', '法系 DPS':'role-icons/magic.png', '大地使者':'role-icons/dol.png', '能工巧匠':'role-icons/doh.png' };
  // 职业名称与图标命名按 HqHelper 的职业映射核对；图标文件随本站静态发布，
  // 不在用户浏览时依赖外部图床。加载失败后才显示文字回退。
  const jobIconUrl = path => (path.startsWith('role-icons/') ? 'assets/' : 'assets/equipment-icons/') + path.split('/').map(encodeURIComponent).join('/');
  const iconMarkup = (path, label, kind = 'job') => `<span class="job-badge ${kind === 'role' ? 'role-badge' : ''}" title="${label}"><img src="${jobIconUrl(path)}" alt="${label}" loading="eager" decoding="async" onerror="this.parentElement.classList.add('icon-failed');this.remove()"><span aria-hidden="true">${label.slice(0, 1)}</span></span>`;
  const preloadJobIcons = () => [...new Set([...Object.values(jobIconPaths), ...Object.values(groupIconPaths)])].forEach(path => {
    const image = new Image();
    image.src = jobIconUrl(path);
  });
  const crystalSpecs = [
    ['火', 2, 8, 14], ['冰', 3, 9, 15], ['风', 4, 10, 16],
    ['土', 5, 11, 17], ['雷', 6, 12, 18], ['水', 7, 13, 19]
  ];
  const crystalElementIcons = { 火: 'fire', 冰: 'ice', 风: 'wind', 土: 'earth', 雷: 'lightning', 水: 'water' };
  const baseMaterials = window.FF14_BASE_MATERIALS || { n: {}, b: {}, d: {}, k: {}, meta: {} };
  const submarineData = window.FF14_SUBMARINE_DATA || { parts: [], g: {}, n: {}, leaves: [] };
  // HqHelper 仅作为版本固定的回退快照：主配方存在时绝不覆盖。
  const hqHelperFallback = window.FF14_HQHELPER_FALLBACK || { meta: {}, items: {}, recipes: {}, trades: {}, audit: {} };
  const hqHelperItems = hqHelperFallback.items || {};
  const hqHelperRecipes = hqHelperFallback.recipes || {};
  const garlandIconCacheKey = 'ff14-garland-icon-cache';
  const garlandIconCache = JSON.parse(localStorage.getItem(garlandIconCacheKey) || '{}');
  const garlandIconIndex = hqHelperFallback.icons || {};
  const itemIconId = uid => {
    const key = String(uid);
    const craftScripIcon = Number(window.FF14_CRAFT_SCRIPS?.items?.[key]?.i || window.FF14_CRAFT_SCRIP_DATA?.items?.[key]?.i || 0);
    const leveIcon = Number((window.FF14_LEVEQUEST_CATALOG?.routes || window.FF14_LEVEQUESTS?.routes || []).find(route => String(route.itemId) === key)?.itemIcon || 0);
    const leveRecipeIcon = Number(window.FF14_LEVEQUEST_RECIPES?.items?.[key]?.icon || 0);
    const direct = Number(garlandIconIndex[key] || garlandIconCache[key] || craftScripIcon || leveIcon || leveRecipeIcon || 0);
    const indexed = Number(window.FF14_ITEM_ICON_INDEX?.[key] || 0);
    return direct > 0 ? direct : indexed > 0 ? indexed : 0;
  };
  const fetchGarlandIcon = uid => {
    const key = String(uid);
    if (!/^\d+$/.test(key) || itemIconId(key) || state.garlandIconLoading.has(key)) return;
    state.garlandIconLoading.add(key);
    fetch(`https://www.garlandtools.org/db/doc/item/en/3/${encodeURIComponent(key)}.json`)
      .then(response => response.ok ? response.json() : null)
      .then(payload => {
        const icon = Number(payload?.item?.icon || 0);
        if (icon > 0) {
          garlandIconCache[key] = icon;
          localStorage.setItem(garlandIconCacheKey, JSON.stringify(garlandIconCache));
          if (state.page === 'guide' && state.basicCategory === 'other') renderGuide();
        }
      })
      .catch(() => {})
      .finally(() => state.garlandIconLoading.delete(key));
  };
  // 理符交付物统一直接使用已核验的 Garland 图标。此前先尝试本地 NBB 图、
  // 再回退网络图，会在编辑额度导致整表重绘时反复闪烁。
  const itemIconMarkup = (uid, options = {}) => {
    if (options.hq) {
      const iconId = itemIconId(uid);
      return iconId ? `<img class="item-icon levequest-item-icon" src="https://www.garlandtools.org/files/icons/item/${iconId}.png" alt="" aria-hidden="true" loading="lazy" decoding="async" onerror="this.remove()">` : '';
    }
    const iconId = itemIconId(uid);
    if (!iconId) return '';
    return `<img class="item-icon" src="https://www.garlandtools.org/files/icons/item/${iconId}.png" alt="" aria-hidden="true" loading="lazy" decoding="async" onerror="this.remove()">`;
  };
  const itemLabelMarkup = (uid, name, options = {}) => `<span class="item-label">${itemIconMarkup(uid, options)}<span>${name}</span>${options.hq ? '<span class="hq-icon" role="img" title="高品质交付" aria-label="高品质交付">&#xE03C;</span>' : ''}</span>`;
  // 改级潜水艇的“骨架”只是在工房配方中承接旧部件的内部节点，
  // 不是真实的市场板物品，不能向 Universalis 查询价格。
  const submarineSkeletonNodeIds = new Set([
    '26508', '26509', '26510', '26511', '26512', '26513', '26514', '26515',
    '26516', '26517', '26518', '26519', '26520', '26521', '26522', '26523',
    '26524', '26525', '26526', '26527'
  ]);
  const isNonMarketSubmarineNode = materialOrUid => submarineSkeletonNodeIds.has(String(typeof materialOrUid === 'object' ? materialOrUid?.uid : materialOrUid));
  const retainerData = window.FF14_RETAINER_DATA || {};
  const materialSources = window.FF14_MATERIAL_SOURCES || {};
  const exchangeSources = window.FF14_EXCHANGE_SOURCES || { carriers: {}, routes: [] };
  const craftScrips = window.FF14_CRAFT_SCRIPS || { tickets: {}, exchanges: [], collectables: [], items: {}, recipes: {} };
  const levequests = window.FF14_LEVEQUESTS || { jobs: [], routes: [] };
  const leveCatalog = window.FF14_LEVEQUEST_CATALOG || { jobs: levequests.jobs || [], routes: levequests.routes || [], audit: {} };
  const fisherLeves = window.FF14_FISHER_LEVES || { jobs: [], routes: [], audit: {} };
  const allLeveRoutes = [...(leveCatalog.routes || []), ...(fisherLeves.routes || [])];
  const allLeveJobs = [...new Set([...(leveCatalog.jobs || levequests.jobs || []), ...(fisherLeves.jobs || [])])];
  const levePlanStorageKey = 'ff14-leve-plans';
  const leveCatalogKey = route => String(route?.leveId || '');
  // 版本 3：方案一清理 20 级以下的旧版本机路线。
  const systemLevePlanVersion = 4;
  const systemLevePlanEntries = () => {
    const variant = state.leveDouble ? 'double' : 'normal';
    return allLeveRoutes.filter(route => Number(route.systemPlan?.[variant] || 0) > 0)
      .map(route => ({ leveId: Number(route.leveId), allowances: Number(route.systemPlan[variant]), quantity: Number(route.systemQuantity?.[variant] || 0) || null }));
  };
  const normalizeLevePlan = plan => {
    const id = String(plan?.id || '');
    return {
      id, name: id === 'system-default' ? '方案一（默认）' : (String(plan?.name || '未命名方案').trim() || '未命名方案'), system: Boolean(plan?.system), planVersion: Number(plan?.planVersion || 0),
      entries: [...new Map((plan?.entries || []).map(entry => [String(entry?.leveId || ''), { leveId: Number(entry?.leveId || 0), allowances: Math.max(1, Number(entry?.allowances || 1)), quantity: Number(entry?.quantity || 0) || null }]))
        .values()].filter(entry => entry.leveId !== 0)
    };
  };
  const defaultLevePlans = () => [{ id: 'system-default', name: '方案一（默认）', system: true, planVersion: systemLevePlanVersion, entries: systemLevePlanEntries() }];
  const storedLevePlans = JSON.parse(localStorage.getItem(levePlanStorageKey) || 'null');
  let levePlans = Array.isArray(storedLevePlans?.plans) && storedLevePlans.plans.length
    ? storedLevePlans.plans.map(normalizeLevePlan)
    : defaultLevePlans();
  levePlans = levePlans.map(plan => plan.system && plan.planVersion !== systemLevePlanVersion
    ? { ...plan, planVersion: systemLevePlanVersion, entries: systemLevePlanEntries() } : plan);
  let activeLevePlanId = levePlans.some(plan => plan.id === storedLevePlans?.activeId) ? storedLevePlans.activeId : levePlans[0].id;
  const activeLevePlan = () => levePlans.find(plan => plan.id === activeLevePlanId) || levePlans[0];
  const selectedLeveGuidePlan = () => levePlans.find(plan => plan.id === state.leveGuidePlan) || activeLevePlan();
  const saveLevePlans = () => {
    localStorage.setItem(levePlanStorageKey, JSON.stringify({ schema: 1, activeId: activeLevePlanId, plans: levePlans.map(normalizeLevePlan) }));
    invalidateGuideIndexes();
  };
  const levequestRecipes = window.FF14_LEVEQUEST_RECIPES || { items: {}, recipes: {}, audit: {} };
  const levequestMaterialSources = window.FF14_LEVEQUEST_MATERIAL_SOURCES || { items: {}, audit: {} };
  const normalizeCraftScripExchange = (route, manual = false) => {
    const itemId = String(route?.itemId ?? route?.uid ?? '').trim();
    const ticket = String(route?.ticket || '');
    const ticketCost = Number(route?.ticketCost), outputQuantity = Number(route?.outputQuantity ?? 1);
    if (!/^\d+$/.test(itemId) || !['orange', 'purple'].includes(ticket) || !(ticketCost > 0) || !(outputQuantity > 0)) return null;
    return { ...route, itemId, ticket, ticketCost, outputQuantity, manual: Boolean(manual || route.manual), active: route.active !== false };
  };
  const craftScripExchanges = () => {
    const byRoute = new Map();
    (craftScrips.exchanges || []).map(route => normalizeCraftScripExchange(route)).filter(Boolean)
      .forEach(route => byRoute.set(`${route.itemId}:${route.ticket}`, route));
    craftScripManualExchanges.map(route => normalizeCraftScripExchange(route, true)).filter(Boolean)
      .forEach(route => byRoute.set(`${route.itemId}:${route.ticket}`, route));
    return [...byRoute.values()].filter(route => route.active);
  };
  const craftScripTicket = key => craftScrips.tickets?.[key] || { label: key };
  const craftScripTicketLabel = key => craftScripTicket(key).label || key;
  let npcMaterialIndex = null;
  let npcComparisonReady = false;
  const npcComparisonCache = new Map();
  const invalidateNpcMaterials = () => { npcMaterialIndex = null; npcComparisonCache.clear(); invalidateGuideIndexes(); invalidatePlans(); };
  const npcMaterialByUid = () => {
    if (npcMaterialIndex) return npcMaterialIndex;
    const disabled = new Set((npcMaterialConfig.disabled || []).map(String));
    const builtIn = Object.entries(materialSources)
      .filter(([uid, source]) => source.npc && submarineData.n?.[String(uid)] && !disabled.has(String(uid)))
      .map(([uid, source]) => [String(uid), { uid: String(uid), name: source.name, ...source.npc, builtIn: true }]);
    npcMaterialIndex = Object.fromEntries([...builtIn, ...Object.entries(npcMaterialConfig.added || {}).map(([uid, spec]) => [String(uid), { uid: String(uid), ...spec }])]);
    return npcMaterialIndex;
  };
  const npcCandidate = materialOrUid => npcMaterialByUid()[String(typeof materialOrUid === 'object' ? materialOrUid?.uid : materialOrUid)];
  const npcMaterial = materialOrUid => {
    const uid = String(typeof materialOrUid === 'object' ? materialOrUid?.uid : materialOrUid), candidate = npcCandidate(uid);
    if (!candidate || !npcComparisonReady) return candidate;
    return npcComparison(uid).recommendation === 'NPC' ? candidate : undefined;
  };
  const baseMaterialMeta = baseMaterials.meta || {};
  const isCrystal = material => /之(碎晶|水晶|晶簇)$/.test(material.n);
  const ensureCrystals = () => crystalSpecs.forEach(([element, shard, crystal, cluster]) => {
    [[shard, '碎晶'], [crystal, '水晶'], [cluster, '晶簇']].forEach(([uid, suffix]) => {
      if (!data.m.some(material => String(material.uid) === String(uid))) {
        data.m.push({ id: 'crystal-' + uid, n: element + '之' + suffix, uid: String(uid), c: 0, mp: 0, u: '' });
      }
    });
  });
  ensureCrystals();
  const ensureBaseMaterials = () => Object.entries(baseMaterials.n).forEach(([uid, name]) => {
    if (!data.m.some(material => String(material.uid) === String(uid))) {
      data.m.push({ id: 'base-' + uid, n: name, uid: String(uid), c: 0, mp: 0, u: '' });
    }
  });
  ensureBaseMaterials();
  const hqHelperInputIds = new Set(Object.values(hqHelperRecipes).flatMap(recipes => recipes.flatMap(recipe => recipe.a || []).filter((_, index) => index % 2 === 0).map(String)));
  const ensureHqHelperFallbackMaterials = () => hqHelperInputIds.forEach(uid => {
    const item = hqHelperItems[uid];
    if (item && !data.m.some(material => String(material.uid) === uid)) {
      data.m.push({ id: 'hqhelper-' + uid, n: item.n, uid, c: 0, mp: 0, u: '', hqHelperFallback: true });
    }
  });
  ensureHqHelperFallbackMaterials();
  const applyHqHelperMaterialMetadata = () => data.m.forEach(material => {
    const source = hqHelperItems[String(material.uid)];
    if (!source) return;
    material.hqHelperTradable = source.t;
    if (hqHelperFallback.trades?.[String(material.uid)]) material.hqHelperTrade = true;
  });
  applyHqHelperMaterialMetadata();
  const ensureSubmarineMaterials = () => Object.entries(submarineData.n || {}).forEach(([uid, name]) => {
    const fixed = npcMaterial(uid), material = data.m.find(item => String(item.uid) === String(uid));
    if (!material) data.m.push({ id: 'submarine-' + uid, n: name, uid: String(uid), c: fixed?.price || 0, mp: 0, u: '', fixedNpcPrice: fixed?.price, npcSource: fixed?.source, marketExcluded: isNonMarketSubmarineNode(uid) });
    else if (fixed) { material.fixedNpcPrice = fixed.price; material.npcSource = fixed.source; material.c = fixed.price; }
    else { delete material.fixedNpcPrice; delete material.npcSource; }
    if (isNonMarketSubmarineNode(uid)) {
      material && (material.marketExcluded = true);
      if (material) { material.mp = 0; material.u = ''; delete material.marketStatus; }
    }
  });
  ensureSubmarineMaterials();
  const ensureExchangeMaterials = () => Object.entries(exchangeSources.carriers || {}).forEach(([uid, spec]) => {
    if (!data.m.some(material => String(material.uid) === String(uid))) data.m.push({ id: 'exchange-' + uid, n: spec.name, uid: String(uid), c: 0, mp: 0, u: '', exchangeCarrier: true });
  });
  ensureExchangeMaterials();
  const craftScripItems = craftScrips.items || {};
  const craftScripCollectibleIds = new Set((craftScrips.collectables || []).map(spec => String(spec.itemId)));
  const ensureCraftScripMaterials = () => {
    const ids = new Set([
      ...Object.keys(craftScripItems),
      ...(craftScrips.collectables || []).map(spec => String(spec.itemId)),
      ...craftScripExchanges().map(route => String(route.itemId))
    ]);
    ids.forEach(uid => {
      const item = craftScripItems[uid] || hqHelperItems[uid];
      const route = craftScripExchanges().find(entry => String(entry.itemId) === uid);
      let material = data.m.find(row => String(row.uid) === uid);
      if (!material) {
        material = { id: 'craft-scrip-' + uid, n: item?.n || materialSources[uid]?.name || route?.name || `物品 ${uid}`, uid, c: 0, mp: 0, u: '', craftScripMaterial: true, iconId: item?.i || 0 };
        data.m.push(material);
      }
      if (craftScripCollectibleIds.has(uid)) {
        // 清理早期客户端留下的市场快照，避免不可交易收藏品被误当成可采购材料。
        material.marketExcluded = true;
        material.marketExcludedReason = 'collectable';
        material.mp = 0;
        material.u = '';
        delete material.marketStatus;
        delete material.marketSampleQuantity;
        delete material.marketSampleTarget;
      }
    });
  };
  ensureCraftScripMaterials();
  // 物品主数据由装备/潜水艇配方索引提供；来源索引不能单独注入推荐材料。
  const purchaseRows = material => purchases.filter(row => row.materialId === material.id);
  const purchaseAverage = material => {
    const rows = purchaseRows(material), quantity = rows.reduce((sum, row) => sum + row.quantity, 0);
    return quantity ? rows.reduce((sum, row) => sum + row.total, 0) / quantity : 0;
  };
  // 采购均价会合并历史兑换入账；来源比价中的“市场采购”只比较直接市场购买，避免
  // 已经按薰衣草 / 天穹票入账的成本被误标为市场采购。
  const directPurchaseAverage = material => {
    const rows = purchaseRows(material).filter(row => row.kind !== 'exchange');
    const quantity = rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    return quantity ? rows.reduce((sum, row) => sum + Number(row.total || 0), 0) / quantity : 0;
  };
  // NPC 材料允许保留自有采购记录。仅比较有效的正数价格，始终采用较低成本。
  const npcCostChoice = (materialOrUid, spec = npcCandidate(materialOrUid)) => {
    const material = typeof materialOrUid === 'object'
      ? materialOrUid
      : data.m.find(item => String(item.uid) === String(materialOrUid));
    const npcPrice = Number(spec?.price || 0), purchasePrice = Number(material ? purchaseAverage(material) : 0);
    if (purchasePrice > 0 && (!npcPrice || purchasePrice < npcPrice)) return { price: purchasePrice, source: '采购平均价' };
    if (npcPrice > 0) return { price: npcPrice, source: 'NPC 采购价' };
    if (purchasePrice > 0) return { price: purchasePrice, source: '采购平均价' };
    return { price: 0, source: '—' };
  };
  const voucherCarrierIds = new Set(Object.keys(exchangeSources.carriers || {}).map(String));
  // 凭证仅用于记录某一笔兑换采购的约定成本，不维护囤货数量或持有成本。
  const exchangeRoutesFor = uid => (exchangeSources.routes || []).map((route, routeIndex) => ({ ...route, routeIndex, quantity: Number(route.outputs?.[String(uid)] || 0) }))
    .filter(route => route.quantity > 0);
  const directSourceChoice = material => {
    if (!material) return { price: 0, source: '—' };
    const purchase = purchaseAverage(material), npc = npcCandidate(material);
    const market = marketPurchaseCandidate(material, npc);
    const choices = [];
    if (purchase > 0) choices.push({ price: purchase, source: '采购平均价', type: 'purchase' });
    if (Number(npc?.price) > 0) choices.push({ price: Number(npc.price), source: npc.source || 'NPC 采购价', type: 'npc' });
    if (market.price > 0) choices.push({ price: market.price, source: market.source + '（含 5% 税费）', type: 'market' });
    return choices.sort((left, right) => left.price - right.price)[0] || { price: 0, source: '—' };
  };
  const syncPurchaseCosts = () => {
    data.m.forEach(material => {
      material.c = directSourceChoice(material).price || 0;
      delete material.q;
    });
    invalidatePlans();
    invalidateGuideIndexes();
  };
  syncPurchaseCosts();
  const recipeByItemId = itemId => recipeByItemIdIndex.get(Number(itemId));
  const componentList = entries => entries.map(([itemId, qty = 1]) => {
    const found = recipeByItemId(itemId);
    return { item: found || { id: 'item-' + itemId, itemId: Number(itemId), n: materialName(itemId) }, qty: Number(qty) || 1, itemId: Number(itemId) };
  });
  const row = (id, group, label, entries, priceKey, indent = false, pricePart = 'total', job = null) => ({
    id, group, label, components: componentList(entries), priceKey, indent, pricePart, job
  });
  const combatBlueprints = [
    ['防护职业', ['职业 38','职业 44','职业 98','职业 149'], [49271,49272,49273,49274,49275], [[49306,1],[49311,1],[49316,1],[49321,2]], { '职业 38':[49249,49270], '职业 44':[49251], '职业 98':[49259], '职业 149':[49264] }],
    ['治疗职业', ['职业 53','职业 69','职业 99','职业 181'], [49296,49297,49298,49299,49300], [[49309,1],[49314,1],[49319,1],[49324,2]], { '职业 53':[49254], '职业 69':[49256], '职业 99':[49261], '职业 181':[49267] }],
    ['制敌 DPS', ['职业 47','职业 180'], [49276,49277,49278,49279,49280], [[49307,1],[49312,1],[49317,1],[49322,2]], { '职业 47':[49252], '职业 180':[49266] }],
    ['强袭 DPS', ['职业 41','职业 111'], [49281,49282,49283,49284,49285], [[49307,1],[49312,1],[49317,1],[49322,2]], { '职业 41':[49250], '职业 111':[49262] }],
    ['游击 DPS', ['职业 93','职业 196'], [49291,49292,49293,49294,49295], [[49308,1],[49313,1],[49318,1],[49323,2]], { '职业 93':[49258], '职业 196':[49268] }],
    ['远敏 DPS', ['职业 50','职业 96','职业 150'], [49286,49287,49288,49289,49290], [[49308,1],[49313,1],[49318,1],[49323,2]], { '职业 50':[49253], '职业 96':[49260], '职业 150':[49265] }],
    ['法系 DPS', ['职业 55','职业 29','职业 112','职业 197'], [49301,49302,49303,49304,49305], [[49310,1],[49315,1],[49320,1],[49325,2]], { '职业 55':[49255], '职业 29':[49257], '职业 112':[49263], '职业 197':[49269] }]
  ];
  const gatheringBlueprints = [
    ['大地使者', ['职业 17','职业 18','职业 19'], [47189,47190,47191,47192,47193], [[47198,1],[47199,1],[47200,1],[47201,2]], { '职业 17':[47171,47182], '职业 18':[47172,47183], '职业 19':[47173] }],
    ['能工巧匠', ['职业 9','职业 10','职业 11','职业 12','职业 13','职业 14','职业 15','职业 16'], [47184,47185,47186,47187,47188], [[47194,1],[47195,1],[47196,1],[47197,2]], { '职业 9':[47163,47174], '职业 10':[47164,47175], '职业 11':[47165,47176], '职业 12':[47166,47177], '职业 13':[47167,47178], '职业 14':[47168,47179], '职业 15':[47169,47180], '职业 16':[47170,47181] }]
  ];
  const pairs = ids => ids.map(itemId => [itemId, 1]);
  const tableRows = type => {
    const all = [];
    if (type === '770') {
      combatBlueprints.forEach(([group, jobs, armor, accessory, weapons]) => {
        all.push({ header: group });
        jobs.forEach(job => {
          const weapon = pairs(weapons[job]);
          const jobRow = row('770-'+job, group, jobNames[job], [...pairs(armor), ...accessory, ...weapon], group+'-整套', true, 'total', job);
          jobRow.tool = row('770-'+job+'-weapon', group, jobNames[job]+'武器', weapon, group+'-'+job+'-武器', true, 'weapon', job);
          all.push(jobRow);
        });
        all.push(row('770-'+group+'-gear', group, '防具首饰', [...pairs(armor), ...accessory], group+'-防具首饰', false, 'gear'));
        all.push(row('770-'+group+'-armor', group, '防具', pairs(armor), group+'-防具', true, 'armor'));
        all.push(row('770-'+group+'-accessory', group, '首饰', accessory, group+'-首饰', true, 'accessory'));
      });
    } else {
      gatheringBlueprints.forEach(([group, jobs, armor, accessory, tools]) => {
        all.push({ header: group });
        jobs.forEach(job => {
          const tool = pairs(tools[job]);
          const jobRow = row('750-'+job, group, jobNames[job], [...pairs(armor), ...accessory, ...tool], group+'-全套', true, 'total', job);
          jobRow.tool = row('750-'+job+'-tool', group, jobNames[job]+'主副手', tool, group+'-'+job+'-主副手', true, 'weapon', job);
          all.push(jobRow);
        });
        all.push(row('750-'+group+'-gear', group, '防具首饰', [...pairs(armor), ...accessory], group+'-防具首饰', false, 'gear'));
        all.push(row('750-'+group+'-armor', group, group+'防具', pairs(armor), group+'-防具', true, 'armor'));
        all.push(row('750-'+group+'-accessory', group, group+'首饰', accessory, group+'-首饰', true, 'accessory'));
      });
    }
    return all.filter(item => item.header || item.components.some(component => component.item));
  };
  const equipmentGradeCatalog = [
    { id: '770', category: 'combat', label: '770 HQ' },
    { id: '750', category: 'gathering', label: '750 HQ' }
  ];
  const equipmentCategoryFor = type => equipmentGradeCatalog.find(item => item.id === String(type))?.category || 'combat';
  const availableEquipmentGrades = category => equipmentGradeCatalog.filter(item => item.category === category && tableRows(item.id).some(row => !row.header));
  const graphRecipes = { ...(baseMaterials.g || {}), ...(submarineData.g || {}), ...(craftScrips.recipes || {}) };
  const recipeCandidatesFor = uid => graphRecipes[String(uid)]?.length
    ? graphRecipes[String(uid)]
    : (hqHelperRecipes[String(uid)] || []);
  const recipeSourceFor = uid => graphRecipes[String(uid)]?.length ? (craftScrips.recipes?.[String(uid)]?.length ? 'garland' : 'primary') : (hqHelperRecipes[String(uid)]?.length ? 'hqhelper' : 'missing');
  const hqHelperAudit = hqHelperFallback.audit || {};
  window.FF14_HQHELPER_AUDIT = {
    ...hqHelperAudit,
    meta: hqHelperFallback.meta || {},
    activeFallbackRecipeGroups: Object.keys(hqHelperRecipes).filter(uid => !graphRecipes[uid]).map(Number)
  };
  if (hqHelperFallback.meta?.commit) console.info(`HqHelper 7.55 回退数据已加载：${hqHelperFallback.meta.commit.slice(0, 12)}；主配方冲突 ${Number(hqHelperAudit.conflicts?.length || 0)} 组。`);
  const DEFAULT_TICKET_UNIT_COST = 80;
  const ticketUnitCost = () => Number(submarineTicketSettings.defaultUnitCost) > 0
    ? Number(submarineTicketSettings.defaultUnitCost)
    : DEFAULT_TICKET_UNIT_COST;
  const sourceKindForRoute = route => route.kind === '天穹票兑换' ? '天穹票兑换' : '薰衣草/风茄兑换';
  const sourceLabelForRoute = route => {
    if (route.carrierId === '15857') return '薰衣草兑换';
    if (route.carrierId === '15858') return '风茄兑换';
    return /白钢/.test(route.label || '') ? '白钢兑换' : /黄铜/.test(route.label || '') ? '黄铜兑换' : '天穹票兑换';
  };
  const recommendationClass = choice => {
    if (!choice) return 'recommend-pending';
    if (choice.key === 'npc') return 'recommend-npc';
    if (choice.key === 'craft') return 'recommend-craft';
    if (choice.key === 'pending') return 'recommend-pending';
    if (choice.label === '薰衣草兑换') return 'recommend-lavender';
    if (choice.label === '风茄兑换') return 'recommend-pepper';
    if (choice.label === '白钢兑换') return 'recommend-white-steel';
    if (choice.label === '黄铜兑换') return 'recommend-yellow-brass';
    return 'recommend-market';
  };
  const recommendationTag = (choice, text = null) => `<span class="recommend-tag ${recommendationClass(choice)}">${text || `推荐：${choice?.label || '待补价'}`}</span>`;
  const isExchangeChoice = choice => Boolean(choice?.key && choice.key.startsWith('exchange-'));
  const staticSubmarineKind = material => {
    const uid = String(material?.uid || '');
    if (voucherCarrierIds.has(uid)) return '薰衣草/风茄兑换';
    // 此函数在启动期就会被 NPC 成本初始化调用，不能依赖后面才声明的分类辅助函数。
    const source = materialSources[uid] || {}, kinds = [source.verified?.submarine, ...(source.nativeSubmarineKinds || source.submarineKinds || [])].filter(Boolean);
    const priority = ['NPC 购买材料', '常规采集品', '军票兑换', '薰衣草/风茄兑换', '天穹票兑换', '限时采集品', '怪物掉落', '潜水艇携带材料'];
    const baseKind = source.verified?.equipment || source.equipmentKinds?.[0] || baseMaterials.k?.[uid] || '常规采集品';
    const fallback = baseKind === '神典石材料' ? '军票兑换' : baseKind === '灵砂' ? '限时采集品' : baseKind;
    return priority.find(kind => kinds.includes(kind)) || fallback;
  };
  // 非自制取得方式：市场、NPC 与兑换均为成本终点，不继续展开配方。
  const submarineNonCraftSourceOptions = (material, npcSpec = npcCandidate(material), includeNpc = true) => {
    if (!material) return [];
    const uid = String(material.uid), options = [], directPurchase = directPurchaseAverage(material), market = marketPurchaseCandidate(material, npcSpec), nativeKind = staticSubmarineKind(material);
    if (directPurchase > 0) options.push({ key: 'direct-purchase', kind: nativeKind, label: '市场采购', source: '采购平均价', price: directPurchase, formula: '全部历史直接采购合价 ÷ 数量' });
    options.push({ key: 'direct-market', kind: nativeKind, label: '市场采购', source: market.source, price: Number(market.price || 0), unavailable: Boolean(market.unavailable), formula: market.formula });
    const npc = npcSpec;
    if (includeNpc && Number(npc?.price || 0) > 0) options.push({ key: 'npc', kind: 'NPC 购买材料', label: 'NPC 购买', source: npc.source || 'NPC 商店', price: Number(npc.price), formula: 'NPC 售卖价' });
    exchangeRoutesFor(uid).forEach(route => {
      if (route.carrierId) {
        const carrier = data.m.find(item => String(item.uid) === String(route.carrierId));
        const carrierPurchase = carrier ? purchaseAverage(carrier) : 0, carrierMarket = marketPurchaseCandidate(carrier, npcCandidate(carrier)).price, carrierPrice = carrierPurchase || carrierMarket;
        options.push({ key: 'exchange-' + route.routeIndex, kind: sourceKindForRoute(route), label: sourceLabelForRoute(route), source: carrier?.n || route.label, price: carrierPrice > 0 ? carrierPrice / route.quantity : 0, unavailable: !(carrierPrice > 0), formula: carrierPrice > 0 ? `${carrierPurchase > 0 ? '凭证采购均价' : '凭证市场均价 × 1.05（含税比较）'} ${money(carrierPrice)} ÷ ${route.quantity}` : '等待凭证市场价 / 采购价' });
      } else {
        const unitCost = ticketUnitCost(), ticketCost = Number(route.ticketCost || 40) * unitCost;
        options.push({ key: 'exchange-' + route.routeIndex, kind: sourceKindForRoute(route), label: sourceLabelForRoute(route), source: route.label, price: ticketCost / route.quantity, formula: `${Number(route.ticketCost || 40)} 张 × ${money(unitCost)} ÷ ${route.quantity}` });
      }
    });
    return waiveMarketStockGateWhenNotCompetitive(options);
  };
  const lowestSubmarineOption = (options, fallbackKind) => {
    const valid = options.filter(option => Number(option.price) > 0);
    valid.sort((left, right) => Number(left.price) - Number(right.price) || (left.kind === fallbackKind ? -1 : 1));
    return valid[0] || { key: 'pending', kind: fallbackKind, label: '待补价', source: '未获取有效价格', price: 0, unavailable: true };
  };
  // 制作本体时，下级材料可选择市场、NPC、兑换或继续自制中成本最低的有效来源。
  // trail 仅用于递归防环；顶层结果单独缓存，避免来源比价与配方递归相互污染。
  const submarineCraftInputChoice = (uid, trail = new Set()) => {
    uid = String(uid);
    const material = data.m.find(item => String(item.uid) === uid) || { uid, n: materialName(uid) };
    const options = submarineNonCraftSourceOptions(material);
    if (!trail.has(uid) && recipeCandidatesFor(uid).length) {
      const craft = selfCraftUnitCost(uid, trail);
      options.push({ key: 'craft', kind: staticSubmarineKind(material), label: '自制配方', source: '递归制作配方', price: Number(craft || 0), unavailable: !(Number(craft) > 0), formula: craft ? '递归制作配方的当前单价' : '等待下级材料价格' });
    }
    return lowestSubmarineOption(waiveMarketStockGateWhenNotCompetitive(options), staticSubmarineKind(material));
  };
  const submarineCraftInputBreakdown = (uid, trail = new Set()) => {
    uid = String(uid);
    const node = recipeCandidatesFor(uid)[0];
    if (!node || trail.has(uid)) return [];
    const next = new Set(trail); next.add(uid), output = Math.max(1, Number(node.y) || 1);
    const rows = [];
    for (let index = 0; index < node.a.length; index += 2) {
      const child = Number(node.a[index]), batchQuantity = Number(node.a[index + 1] || 0), quantity = batchQuantity / output;
      if (!child || !batchQuantity) continue;
      const choice = submarineCraftInputChoice(child, next);
      const unit = Number(choice.price || 0);
      rows.push({ uid: child, quantity, batchQuantity, choice, unit, total: unit * quantity, batchTotal: unit * batchQuantity });
    }
    return rows;
  };
  const selfCraftUnitCost = (uid, trail = new Set(), includeTimeSurcharge = false) => {
    uid = String(uid);
    if (trail.has(uid)) return null;
    if (!trail.size && submarineCraftCostCache.has(uid)) return submarineCraftCostCache.get(uid);
    const node = recipeCandidatesFor(uid)[0];
    if (!node) return null;
    const rows = submarineCraftInputBreakdown(uid, trail);
    const inputs = rows.length && rows.every(row => row.unit > 0) ? rows.reduce((sum, row) => sum + row.total, 0) : null;
    const value = inputs == null ? null : (includeTimeSurcharge ? craftedUnitComparisonCost(inputs) : inputs);
    if (!trail.size) submarineCraftCostCache.set(uid, value);
    return value;
  };
  // 装备与潜水艇均使用同一来源比较口径；装备节点同样可在直购与自制间选取较低有效成本。
  const equipmentCraftUnitCost = (uid, trail = new Set(), includeTimeSurcharge = true) => {
    uid = String(uid);
    if (trail.has(uid)) return null;
    const node = recipeCandidatesFor(uid)[0];
    const material = data.m.find(item => String(item.uid) === uid) || { uid, n: materialName(uid) };
    const direct = directSourceChoice(material);
    if (!node) return Number(direct.price) > 0 ? Number(direct.price) : null;
    const next = new Set(trail); next.add(uid);
    let total = 0;
    for (let index = 0; index < node.a.length; index += 2) {
      const child = Number(node.a[index]), quantity = Number(node.a[index + 1]);
      if (!child || !quantity) continue;
      const price = equipmentCraftUnitCost(child, next, true);
      if (price == null) return null;
      total += price * quantity;
    }
    const inputUnitCost = total / Math.max(1, Number(node.y) || 1);
    const craft = includeTimeSurcharge ? craftedUnitComparisonCost(inputUnitCost) : inputUnitCost;
    return Number(direct.price) > 0 ? Math.min(Number(direct.price), craft) : craft;
  };
  // 所有可用取得方式都在此处展开。0、缺价和无法递归的路线仅保留说明，不参与最低价选择。
  const submarineSourceOptions = material => {
    if (!material) return [];
    const uid = String(material.uid), options = submarineNonCraftSourceOptions(material);
    if (recipeCandidatesFor(uid).length) {
      const craft = selfCraftUnitCost(uid);
      options.push({ key: 'craft', kind: staticSubmarineKind(material), label: '自制配方', source: '递归制作配方', price: Number(craft || 0), unavailable: !(Number(craft) > 0), formula: craft ? '递归制作配方的当前单价' : '等待下级材料价格' });
    }
    return waiveMarketStockGateWhenNotCompetitive(options);
  };
  const submarineSourceChoice = material => {
    const uid = String(material?.uid || '');
    if (submarineSourceCache.has(uid)) return submarineSourceCache.get(uid);
    const options = submarineSourceOptions(material), fallbackKind = staticSubmarineKind(material), valid = options.filter(option => Number(option.price) > 0);
    valid.sort((left, right) => Number(left.price) - Number(right.price) || (left.kind === fallbackKind ? -1 : 1));
    const choice = valid[0] || { key: 'pending', kind: fallbackKind, label: '待补价', source: '未获取有效价格', price: 0, unavailable: true };
    const result = { ...choice, fallbackKind, options };
    submarineSourceCache.set(uid, result);
    return result;
  };
  const submarinePartIds = () => new Set((submarineData.parts || []).map(part => String(part.id)));
  // 推荐材料只列出原材料及仍有外部取得方式的半成品；纯自制半成品会在制作配方中展开，
  // 不占用材料指导价列表。部件本身不属于推荐材料的半成品。
  const isSubmarineIntermediate = material => {
    const uid = String(material?.uid || '');
    return Boolean(uid && !submarinePartIds().has(uid) && recipeCandidatesFor(uid).length);
  };
  const hasSubmarineExchangeRoute = material => exchangeRoutesFor(material?.uid).length > 0;
  const showSubmarineGuideMaterial = material => {
    if (!isSubmarineIntermediate(material)) return true;
    const choice = submarineSourceChoice(material);
    return choice.key !== 'craft' || hasSubmarineExchangeRoute(material);
  };
  const submarineGuideKind = material => {
    const uid = String(material?.uid || ''), choice = submarineSourceChoice(material);
    // 两种兑换凭证始终置顶显示，方便记录其市场价或采购均价。
    if (voucherCarrierIds.has(uid)) return '薰衣草/风茄兑换';
    if (choice.key === 'npc') return 'NPC 购买材料';
    if (isExchangeChoice(choice)) return choice.kind;
    // 只有可制作半成品推荐市场采购时才独立集中；原材料回到其客观来源分类。
    if (isSubmarineIntermediate(material) && choice.label === '市场采购') return '市场采购半成品';
    return staticSubmarineKind(material);
  };
  const showSubmarineRecommendationTag = material => {
    const choice = submarineSourceChoice(material);
    // 常规采集品只展示客观分类与价格；不把“采集”伪装成一个需要执行的推荐操作。
    if (!isSubmarineIntermediate(material) && staticSubmarineKind(material) === '常规采集品') return false;
    // 无制作配方的原材料推荐市场采购时，价格列已足够表达取得方式，无需重复标签。
    return Boolean(isSubmarineIntermediate(material) || choice.label !== '市场采购');
  };
  const recommendedNpcMaterial = material => submarineSourceChoice(material).kind === 'NPC 购买材料';
  const hasComparableSubmarineSources = material => submarineSourceChoice(material).options.filter(option => Number(option.price) > 0).length >= 2;
  const selfCraftLeafIds = (uid, leaves = new Set(), trail = new Set()) => {
    uid = String(uid); if (trail.has(uid)) return leaves;
    const node = recipeCandidatesFor(uid)[0];
    if (!node) { leaves.add(uid); return leaves; }
    const next = new Set(trail); next.add(uid);
    for (let index = 0; index < node.a.length; index += 2) { const child = Number(node.a[index]); if (child > 0) selfCraftLeafIds(child, leaves, next); }
    return leaves;
  };
  const npcComparison = uid => {
    uid = String(uid);
    if (npcComparisonCache.has(uid)) return npcComparisonCache.get(uid);
    const candidate = npcCandidate(uid);
    if (!candidate) return null;
    const manual = Boolean(candidate.manual), hasCraftRoute = Boolean(recipeCandidatesFor(uid).length);
    // NPC 直购基础材料没有自制配方。递归成本计算仍可将其作为固定价叶子，
    // 但材料列表和详情不能把该固定价误称为“自制价格”。
    const self = hasCraftRoute ? selfCraftUnitCost(uid) : null;
    // 不可自制的基础材料无需等待市场价：NPC 直购就是其固定成本。
    const recommendation = manual || candidate.force || !hasCraftRoute || self == null || candidate.price <= self ? 'NPC' : '自制';
    const value = { ...candidate, uid, self, hasCraftRoute, recommendation, difference: self == null ? null : candidate.price - self };
    npcComparisonCache.set(uid, value);
    return value;
  };
  npcComparisonReady = true;
  invalidateNpcMaterials();
  ensureSubmarineMaterials();
  syncPurchaseCosts();
  const refreshNpcRecommendations = () => { invalidateNpcMaterials(); ensureSubmarineMaterials(); syncPurchaseCosts(); };
  // 配方展示必须只由资料决定，不能因为当前市场价较低就截断下级材料。
  // 成本树仍可调用 recipeNodeFor，根据最低有效来源将节点作为外购终点。
  const recipeDisplayNodeFor = (uid, parentJob = null) => {
    const candidates = recipeCandidatesFor(uid);
    return candidates.find(row => parentJob != null && Number(row.j) === Number(parentJob)) || candidates[0] || null;
  };
  const recipeNodeFor = (uid, parentJob = null, scope = 'equipment', isFinishedProduct = false) => {
    const node = recipeDisplayNodeFor(uid, parentJob);
    const material = data.m.find(item => String(item.uid) === String(uid));
    const direct = scope === 'submarine' ? submarineSourceChoice(material || { uid: String(uid) }) : directSourceChoice(material || { uid: String(uid) });
    const recipeCost = node ? (scope === 'submarine'
      ? selfCraftUnitCost(uid, new Set(), false)
      : equipmentCraftUnitCost(uid, new Set(), !isFinishedProduct)) : null;
    // 直购、采购或兑换成本不高于递归制作时，将该材料作为基础叶子处理。
    // 潜水艇的“自制（制作配方）”推荐不等于外购：必须继续展开合建与下级配方。
    // 只有市场、NPC、兑换等非制作渠道才可以将该物品视为成本叶子。
    const isSelfCraftChoice = scope === 'submarine' && direct.key === 'craft';
    if (!isSelfCraftChoice && direct.price > 0 && (!node || recipeCost == null || direct.price <= recipeCost)) return null;
    return node;
  };
  const materialName = uid => data.m.find(item => String(item.uid) === String(uid))?.n || levequestRecipes.items?.[String(uid)]?.n || hqHelperItems[String(uid)]?.n || craftScripItems[String(uid)]?.n || baseMaterials.n?.[String(uid)] || submarineData.n?.[String(uid)] || `未知材料 ${uid}`;
  const leveRouteMatches = (route, filters = {}) => {
    const job = String(filters.job || '');
    const start = Number(filters.start || 0), target = Number(filters.target || 0);
    return (!job || route.job === job) && (!start || Number(route.level) >= start) && (!target || Number(route.level) < target);
  };
  const leveGuideRoutes = () => {
    const selected = selectedLeveGuidePlan();
    const entries = new Set((selected?.entries || []).map(entry => String(entry.leveId)));
    return allLeveRoutes.filter(route => entries.has(leveCatalogKey(route)) && leveRouteMatches(route, {
      job: state.leveGuideJob, start: state.leveGuideStart, target: state.leveGuideTarget
    }));
  };
  // 理符根物品必须有已核验 ID；此处仅将资料包已有的物品元数据投影到内存，
  // 不用中文名称反向猜测，也不把它们写入用户采购或库存台账。
  const leveKnownMaterial = row => {
    const uid = String(row?.itemId || '');
    if (!/^\d+$/.test(uid)) return null;
    const known = data.m.find(material => String(material.uid) === uid);
    if (known) return known;
    const source = levequestRecipes.items?.[uid] || hqHelperItems[uid] || craftScripItems[uid] || {};
    const material = { id: `leve-${uid}`, uid, n: source.n || row.item || materialName(uid), c: 0, mp: 0, u: '', leveMaterial: true };
    data.m.push(material);
    return material;
  };
  const leveMaterial = uid => {
    uid = String(uid || '');
    if (!/^\d+$/.test(uid)) return null;
    const current = data.m.find(material => String(material.uid) === uid);
    if (current) return current;
    const source = levequestRecipes.items?.[uid] || hqHelperItems[uid] || craftScripItems[uid] || {};
    const material = { id: `leve-ingredient-${uid}`, uid, n: source.n || materialName(uid), c: 0, mp: 0, u: '', leveMaterial: true };
    data.m.push(material);
    return material;
  };
  const leveRecipeNode = uid => levequestRecipes.recipes?.[String(uid)]?.[0] || null;
  const leveJobLabels = { 8: '刻木匠', 9: '锻铁匠', 10: '铸甲匠', 11: '雕金匠', 12: '制革匠', 13: '裁衣匠', 14: '炼金术士', 15: '烹饪师' };
  const leveSourceRecord = uid => levequestMaterialSources.items?.[String(uid)] || {};
  const leveNonCraftSourceOptions = uid => {
    const material = leveMaterial(uid);
    if (!material) return [];
    const record = leveSourceRecord(uid);
    const npc = Number(record.npc?.price || 0) > 0 ? record.npc : npcCandidate(material);
    // 理符 Garland 商店资料独立于潜水艇来源表，不能反向改变潜水艇成本。
    const options = submarineNonCraftSourceOptions(material, npc, false);
    if (Number(npc?.price || 0) > 0) options.push({ key: 'npc', kind: 'NPC 购买材料', label: 'NPC 购买', source: npc.source || 'Garland NPC 商店', price: Number(npc.price), formula: 'Garland NPC 售卖价' });
    return waiveMarketStockGateWhenNotCompetitive(options);
  };
  const leveNonCraftSourceChoice = uid => {
    const material = leveMaterial(uid);
    if (!material) return { key: 'pending', kind: '理符材料', label: '待补价', source: '未找到材料资料', price: 0, unavailable: true };
    const choices = leveNonCraftSourceOptions(uid).filter(choice => Number(choice.price) > 0);
    return { ...lowestSubmarineOption(choices, '理符材料'), options: choices };
  };
  const leveDirectUnitCost = uid => Number(leveNonCraftSourceChoice(uid).price) || null;
  // 交付成品本身不计时间补差；理符下级半成品仍按全局自制规则比较。
  const leveRecipeUnitCost = (uid, trail = new Set(), allowDirect = true, includeTimeSurcharge = true) => {
    uid = String(uid || '');
    if (trail.has(uid)) return null;
    const recipe = leveRecipeNode(uid);
    const direct = leveDirectUnitCost(uid);
    if (!recipe) return direct;
    const next = new Set(trail); next.add(uid);
    let craft = 0;
    for (let index = 0; index < recipe.a.length; index += 2) {
      const child = String(recipe.a[index] || ''), quantity = Number(recipe.a[index + 1] || 0);
      const childCost = leveRecipeUnitCost(child, next, true);
      if (!(quantity > 0) || !(Number(childCost) > 0)) { craft = null; break; }
      craft += childCost * quantity / Math.max(1, Number(recipe.y) || 1);
    }
    const craftWithTime = Number(craft) > 0
      ? (includeTimeSurcharge ? craftedUnitComparisonCost(craft) : craft)
      : null;
    if (!(Number(craftWithTime) > 0)) return allowDirect ? direct : null;
    return allowDirect && Number(direct) > 0 ? Math.min(direct, craftWithTime) : craftWithTime;
  };
  const leveCraftInputChoice = (uid, trail = new Set()) => {
    uid = String(uid || '');
    const material = leveMaterial(uid);
    const choices = material ? leveNonCraftSourceOptions(uid) : submarineNonCraftSourceOptions({ uid, n: materialName(uid) });
    if (!trail.has(uid) && leveRecipeNode(uid)) {
      const craft = leveRecipeUnitCost(uid, trail, false);
      choices.push({ key: 'craft', kind: '理符材料', label: '自制配方', source: '递归制作配方', price: Number(craft || 0), unavailable: !(Number(craft) > 0), formula: craft ? '递归制作配方的当前单价' : '等待下级材料价格' });
    }
    waiveMarketStockGateWhenNotCompetitive(choices);
    return { ...lowestSubmarineOption(choices, '理符材料'), options: choices };
  };
  // 仅缓存无递归轨迹的顶层选择。带 trail 的调用必须保留独立上下文以正确防环。
  const leveGuideChoice = uid => {
    uid = String(uid || '');
    if (leveGuideChoiceCache.has(uid)) return leveGuideChoiceCache.get(uid);
    const choice = leveCraftInputChoice(uid);
    leveGuideChoiceCache.set(uid, choice);
    return choice;
  };
  const leveCraftInputBreakdown = (uid, trail = new Set()) => {
    const recipe = leveRecipeNode(uid);
    if (!recipe) return [];
    uid = String(uid || '');
    if (trail.has(uid)) return [];
    const next = new Set(trail); next.add(uid);
    const output = Math.max(1, Number(recipe.y) || 1);
    return Array.from({ length: recipe.a.length / 2 }, (_, index) => {
      const child = String(recipe.a[index * 2]), batchQuantity = Number(recipe.a[index * 2 + 1] || 0);
      const choice = leveCraftInputChoice(child, next), unit = Number(choice.price || 0), material = leveMaterial(child);
      return { uid: Number(child), name: material?.n || materialName(child), quantity: batchQuantity / output, batchQuantity, choice, unit, total: unit * batchQuantity / output, batchTotal: unit * batchQuantity };
    }).filter(row => row.uid && row.batchQuantity > 0);
  };
  const leveRecipeInputBreakdown = uid => leveCraftInputBreakdown(uid);
  const leveRecipeCost = row => {
    const uid = String(row?.itemId || '');
    const recipe = /^\d+$/.test(uid) ? leveRecipeNode(uid) : null;
    if (!recipe) {
      const unit = leveDirectUnitCost(uid);
      return Number(unit) > 0 ? { unit, reason: '' } : { unit: null, reason: row?.itemId ? '等待材料价格' : '待核验物品 ID' };
    }
    const rows = leveRecipeInputBreakdown(uid);
    if (!rows.length || rows.some(entry => !(Number(entry.unit) > 0))) return { unit: null, reason: '等待下级材料价格' };
    return { unit: leveRecipeUnitCost(uid, new Set(), false, false), reason: '' };
  };
  const leveGuideKindPriority = ['NPC 购买材料', '军票兑换', '薰衣草/风茄兑换', '天穹票兑换', '市场采购半成品', '常规采集品', '限时采集品', '灵砂', '怪物掉落'];
  const leveSourceKinds = material => (leveSourceRecord(material?.uid).kinds || []).filter(Boolean);
  // 资料只注明“市场采购半成品”的配方物品，本身不是采集叶子。
  // 若当前选择自制，就让递归展开出的真实下级材料承担材料指导价展示。
  const isLeveSelfCraftIntermediate = material => {
    const uid = String(material?.uid || ''), kinds = leveSourceKinds(material);
    return Boolean(uid && leveRecipeNode(uid) && kinds.length && kinds.every(kind => kind === '市场采购半成品') && leveGuideChoice(uid).key === 'craft');
  };
  const leveGuideKind = material => {
    const uid = String(material?.uid || '');
    if (leveGuideKindCache.has(uid)) return leveGuideKindCache.get(uid);
    const record = leveSourceRecord(uid), choice = leveGuideChoice(uid);
    let kind;
    if (choice.key === 'npc') kind = 'NPC 购买材料';
    else if (isExchangeChoice(choice)) kind = choice.kind;
    else if (leveRecipeNode(uid) && ['direct-purchase', 'direct-market'].includes(choice.key)) kind = '市场采购半成品';
    else {
      const eligibleKinds = (record.kinds || []).filter(item => item !== '市场采购半成品');
      if (leveGuideKindPriority.some(item => eligibleKinds.includes(item))) kind = leveGuideKindPriority.find(item => eligibleKinds.includes(item));
      // 有配方却没有可显示的真实来源，不能误称为采集品；交给资料审计补齐来源。
      else kind = leveRecipeNode(uid) || record.status === '待核验' ? '待核验' : '常规采集品';
    }
    leveGuideKindCache.set(uid, kind);
    return kind;
  };
  const isLeveGuideExcluded = material => {
    const uid = String(material?.uid || ''), record = leveSourceRecord(uid);
    return isCrystal(material) || record.kinds?.includes('潜水艇携带材料') || sourceKinds(material, 'submarine').includes('潜水艇携带材料');
  };
  const leveGuideClassificationAudit = materials => {
    const list = materials || [];
    const hiddenSelfCraftIntermediates = list.filter(isLeveSelfCraftIntermediate).map(material => ({ uid: String(material.uid), name: material.n }));
    const marketPurchaseIntermediates = list.filter(material => leveRecipeNode(material.uid) && leveSourceKinds(material).includes('市场采购半成品') && !isLeveSelfCraftIntermediate(material)).map(material => ({ uid: String(material.uid), name: material.n }));
    const pendingSourceRecipes = list.filter(material => leveRecipeNode(material.uid) && leveGuideKind(material) === '待核验').map(material => ({ uid: String(material.uid), name: material.n }));
    return { hiddenSelfCraftIntermediates, marketPurchaseIntermediates, pendingSourceRecipes };
  };
  const leveBaseMaterials = () => {
    const filterKey = [selectedLeveGuidePlan()?.id || '', state.leveGuideJob, state.leveGuideStart, state.leveGuideTarget].join('|');
    const cached = guideIndexCache.leve.get(filterKey);
    if (cached) {
      const candidates = data.m.filter(material => cached.has(String(material.uid)) && !isLeveGuideExcluded(material));
      window.FF14_LEVE_GUIDE_CLASSIFICATION_AUDIT = leveGuideClassificationAudit(candidates);
      return candidates.filter(material => !isLeveSelfCraftIntermediate(material)).sort((left, right) => Number(left.uid) - Number(right.uid));
    }
    const required = new Set(), visiting = new Set();
    const visit = uid => {
      uid = String(uid);
      if (!/^\d+$/.test(uid) || visiting.has(uid)) return;
      visiting.add(uid);
      const node = leveRecipeNode(uid);
      if (node) for (let index = 0; index < node.a.length; index += 2) {
        const child = String(node.a[index] || '');
        if (!/^\d+$/.test(child)) continue;
        if (!isLeveGuideExcluded(leveMaterial(child) || { uid: child, n: levequestRecipes.items?.[child]?.n || materialName(child) })) required.add(child);
        const source = levequestRecipes.items?.[child] || hqHelperItems[child] || craftScripItems[child] || {};
        if (!data.m.some(material => String(material.uid) === child)) data.m.push({ id: `leve-ingredient-${child}`, uid: child, n: source.n || materialName(child), c: 0, mp: 0, u: '', leveMaterial: true });
        visit(child);
      }
      visiting.delete(uid);
    };
    leveGuideRoutes().forEach(route => {
      if (route.job === '捕鱼人') {
        const material = leveKnownMaterial(route);
        if (material && !isLeveGuideExcluded(material)) required.add(String(material.uid));
      }
      visit(route.itemId);
    });
    guideIndexCache.leve.set(filterKey, required);
    const candidates = data.m.filter(material => required.has(String(material.uid)) && !isLeveGuideExcluded(material));
    window.FF14_LEVE_GUIDE_CLASSIFICATION_AUDIT = leveGuideClassificationAudit(candidates);
    return candidates.filter(material => !isLeveSelfCraftIntermediate(material)).sort((left, right) => Number(left.uid) - Number(right.uid));
  };
  const nodeKey = (uid, node) => node ? `${uid}@${node.id || node.j}` : `leaf@${uid}`;
  // 装备始终按照完整配方自制到底：市场、采购和 NPC 价格只用于最终原料，
  // 不能将任何可制作半成品作为成本终点。
  function calculateEquipmentProductionPlan(bundle) {
    const nodes = new Map(), leaves = new Map(), roots = [];
    const addLeaf = (uid, quantity) => leaves.set(String(uid), (leaves.get(String(uid)) || 0) + Number(quantity || 0));
    const addNeed = (uid, quantity, parentJob = null) => {
      const node = recipeDisplayNodeFor(uid, parentJob);
      if (!node) { addLeaf(uid, quantity); return `leaf@${uid}`; }
      const key = nodeKey(uid, node);
      const entry = nodes.get(key) || { key, uid: Number(uid), node, needed: 0, batches: 0, processed: 0, inputs: [] };
      entry.needed += Number(quantity || 0);
      nodes.set(key, entry);
      return key;
    };
    bundle.components.filter(component => component.item).forEach(component => {
      const uid = component.item.itemId;
      const key = addNeed(uid, component.qty, baseMaterials.j?.[String(uid)] ?? null);
      roots.push({ key, uid: Number(uid), quantity: Number(component.qty), name: component.item.n });
    });
    const rootKeys = new Set(roots.map(root => root.key));
    let changed = true;
    while (changed) {
      changed = false;
      for (const entry of [...nodes.values()]) {
        const batches = Math.ceil(entry.needed / Math.max(1, Number(entry.node.y) || 1));
        const delta = batches - entry.processed;
        if (delta <= 0) continue;
        entry.processed = batches; entry.batches = batches; changed = true;
        for (let index = 0; index < entry.node.a.length; index += 2) {
          const uid = Number(entry.node.a[index]), quantity = Number(entry.node.a[index + 1] || 0) * delta;
          if (!uid || !quantity) continue;
          const key = addNeed(uid, quantity, entry.node.j);
          const input = entry.inputs.find(value => value.key === key);
          if (input) input.quantity += quantity;
          else entry.inputs.push({ key, uid, quantity });
        }
      }
    }
    const leafCost = uid => materialUnitPrice(data.m.find(item => String(item.uid) === String(uid)) || { uid: String(uid) });
    const allocation = (key, quantity, target, trail = new Set()) => {
      if (!quantity || trail.has(key)) return;
      const entry = nodes.get(key);
      if (!entry) {
        const uid = Number(String(key).replace('leaf@', ''));
        target.cost += leafCost(uid) * quantity;
        return;
      }
      const share = quantity / Math.max(1, Number(entry.needed || 0));
      const next = new Set(trail); next.add(key);
      entry.inputs.forEach(input => allocation(input.key, input.quantity * share, target, next));
    };
    const allocationCost = (key, quantity) => {
      const target = { cost: 0 };
      allocation(key, quantity, target);
      return target.cost;
    };
    const makeRows = (requests, nameFor) => {
      const rows = new Map();
      requests.forEach(request => {
        const key = String(request.uid), row = rows.get(key) || { uid: Number(request.uid), name: nameFor(request), quantity: 0, cost: 0 };
        row.quantity += Number(request.quantity || 0);
        row.cost += allocationCost(request.key, request.quantity);
        rows.set(key, row);
      });
      return [...rows.values()].sort((left, right) => left.uid - right.uid);
    };
    const finished = makeRows(roots, request => request.name);
    const directRequests = [];
    roots.forEach(root => {
      const entry = nodes.get(root.key);
      if (!entry) return;
      const share = root.quantity / Math.max(1, Number(entry.needed || 0));
      entry.inputs.forEach(input => directRequests.push({ ...input, quantity: input.quantity * share, name: materialName(input.uid) }));
    });
    const direct = makeRows(directRequests, request => request.name);
    const basic = [...leaves.entries()].map(([uid, quantity]) => ({ uid: Number(uid), name: materialName(uid), quantity, cost: leafCost(uid) * quantity })).sort((left, right) => left.uid - right.uid);
    const basicTotal = basic.reduce((sum, row) => sum + row.cost, 0);
    const craftedOutputs = [...nodes.entries()].filter(([key]) => !rootKeys.has(key)).reduce((sum, [, entry]) => sum + Number(entry.batches || 0) * Math.max(1, Number(entry.node.y) || 1), 0);
    // 装备制作成本只计算完整递归后的基础原料，不计制作时间补差。
    const timeCost = 0;
    const total = finished.reduce((sum, row) => sum + row.cost, 0);
    const missing = basic.filter(row => row.quantity > 0 && !(leafCost(row.uid) > 0)).map(row => row.name);
    return {
      roots, nodes, finished, direct, basic,
      basicTotal, total, timeCost, craftedOutputs,
      allocationCost, missing
    };
  }
  // 统一生产计划：同一半成品先合并需求，再按产出向上取整；每个视图都从该计划取数。
  function calculateProductionPlan(bundle) {
    const nodes = new Map(), leaves = new Map(), roots = [];
    const scope = bundle.partId ? 'submarine' : 'equipment';
    if (scope === 'equipment') return calculateEquipmentProductionPlan(bundle);
    const addLeaf = (uid, quantity) => leaves.set(String(uid), (leaves.get(String(uid)) || 0) + quantity);
    const addNeed = (uid, quantity, parentJob = null, isFinishedProduct = false) => {
      const node = recipeNodeFor(uid, parentJob, scope, isFinishedProduct);
      if (!node) { addLeaf(uid, quantity); return `leaf@${uid}`; }
      const key = nodeKey(uid, node);
      const entry = nodes.get(key) || { key, uid: Number(uid), node, needed: 0, batches: 0, processed: 0, inputs: [] };
      entry.needed += quantity;
      nodes.set(key, entry);
      return key;
    };
    bundle.components.filter(component => component.item).forEach(component => {
      const itemId = component.item.itemId;
      const key = addNeed(itemId, component.qty, baseMaterials.j?.[String(itemId)] ?? null, true);
      roots.push({ key, uid: Number(itemId), quantity: component.qty, name: component.item.n });
    });
    const rootKeys = new Set(roots.map(root => root.key));
    // 新增需求只补充因新批次产生的子素材，直到所有批次数稳定。
    let changed = true;
    while (changed) {
      changed = false;
      for (const entry of [...nodes.values()]) {
        const batches = Math.ceil(entry.needed / Math.max(1, Number(entry.node.y) || 1));
        const delta = batches - entry.processed;
        if (delta <= 0) continue;
        entry.processed = batches; entry.batches = batches; changed = true;
        for (let index = 0; index < entry.node.a.length; index += 2) {
          const uid = Number(entry.node.a[index]), quantity = Number(entry.node.a[index + 1] || 0) * delta;
          if (!uid || !quantity) continue;
          const childKey = addNeed(uid, quantity, entry.node.j);
          const input = entry.inputs.find(value => value.key === childKey);
          if (input) input.quantity += quantity;
          else entry.inputs.push({ key: childKey, uid, quantity });
        }
      }
    }
    const leafCost = uid => {
      const material = data.m.find(item => String(item.uid) === String(uid));
      return scope === 'submarine' ? submarineSourceChoice(material).price : materialUnitPrice(material);
    };
    const addAllocation = (target, key, quantity, trail = new Set()) => {
      if (trail.has(key) || !quantity) return;
      const entry = nodes.get(key);
      if (!entry) {
        const uid = Number(String(key).replace('leaf@', ''));
        target.cost += leafCost(uid) * quantity;
        return;
      }
      const share = quantity / Math.max(entry.needed, 1);
      const next = new Set(trail); next.add(key);
      entry.inputs.forEach(input => addAllocation(target, input.key, input.quantity * share, next));
    };
    const makeRows = (requests, nameFor) => {
      const map = new Map();
      requests.forEach((request, index) => {
        const allocation = { cost: 0 };
        addAllocation(allocation, request.key, request.quantity);
        const key = String(request.uid);
        const row = map.get(key) || { uid: Number(request.uid), name: nameFor(request), quantity: 0, cost: 0 };
        row.quantity += request.quantity; row.cost += allocation.cost; map.set(key, row);
      });
      return [...map.values()].sort((left, right) => left.uid - right.uid);
    };
    const finished = makeRows(roots, request => request.name);
    const directRequests = [];
    roots.forEach(root => {
      const entry = nodes.get(root.key);
      if (!entry) return;
      const share = root.quantity / Math.max(entry.needed, 1);
      entry.inputs.forEach(input => directRequests.push({ ...input, quantity: input.quantity * share, name: materialName(input.uid) }));
    });
    const direct = makeRows(directRequests, request => request.name);
    const basic = [...leaves.entries()].map(([uid, quantity]) => ({ uid: Number(uid), name: materialName(uid), quantity, cost: leafCost(uid) * quantity })).sort((left, right) => left.uid - right.uid);
    const craftedOutputs = [...nodes.entries()].filter(([key]) => !rootKeys.has(key)).reduce((sum, [, entry]) => sum + Number(entry.batches || 0) * Math.max(1, Number(entry.node.y) || 1), 0);
    const timeCost = 0;
    // 潜水艇与装备均按递归后的基础材料成本计算，不再计制作时间补差。
    const basicTotal = basic.reduce((sum, row) => sum + row.cost, 0);
    const total = finished.reduce((sum, row) => sum + row.cost, 0);
    const allocationCost = (key, quantity) => { const target = { cost: 0 }; addAllocation(target, key, quantity); return target.cost; };
    return { roots, nodes, finished, direct, basic, basicTotal, total, timeCost, craftedOutputs, allocationCost, missing: basic.filter(row => !leafCost(row.uid)).map(row => row.name) };
  }
  const productionPlan = bundle => {
    const key = bundle.id || JSON.stringify(bundle.components?.map(component => [component.itemId || component.item?.itemId, component.qty]));
    if (!planCache.has(key)) planCache.set(key, calculateProductionPlan(bundle));
    return planCache.get(key);
  };
  // 台账成本价始终是当前整套“基础制作素材”生产计划成本，不提供人工成本覆盖。
  const unitCost = tableRow => productionPlan(tableRow).total;
  const baseIngredients = item => {
    const recipeMaterials = baseMaterials.b?.[String(item.itemId)];
    // 打包数据以紧凑的 [物品ID, 数量, ...] 形式保存，旧配方则仍使用名称/数量对。
    const pairs = recipeMaterials
      ? (Array.isArray(recipeMaterials[0])
        ? recipeMaterials
        : recipeMaterials.filter((_, index) => index % 2 === 0).map((uid, index) => [uid, recipeMaterials[index * 2 + 1]]))
      : (item.a || []).map(([name, qty]) => {
        const material = data.m.find(row => row.n === name);
        return [Number(material?.uid || 0), qty];
      });
    return pairs.map(([uid, qty]) => {
    const material = data.m.find(row => String(row.uid) === String(uid));
    return { material, qty };
    });
  };
  const directIngredients = item => {
    const directMaterials = baseMaterials.d?.[String(item.itemId)];
    const pairs = directMaterials
      ? directMaterials.filter((_, index) => index % 2 === 0).map((uid, index) => [uid, directMaterials[index * 2 + 1]])
      : (item.a || []).map(([name, qty]) => [data.m.find(row => row.n === name)?.uid, qty]);
    return pairs.map(([uid, qty]) => ({ material: data.m.find(row => String(row.uid) === String(uid)), uid, qty }));
  };
  // 装备可制作性只取决于是否存在完整配方，不能被当前更低的市场价影响。
  const hasCompleteBaseRecipe = item => Boolean(recipeDisplayNodeFor(item.itemId)) && !baseMaterialMeta.cycles?.includes(String(item.itemId));
  const estimateRecipe = item => baseIngredients(item).reduce((sum, { material, qty }) => {
    return sum + qty * (material?.c || material?.mp || 0);
  }, 0);
  const inventory = tableRow => tableRow.components.length ? Math.min(...tableRow.components.filter(component => component.item).map(component => Math.floor(stock(component.item.id).q / component.qty))) : 0;
  const totalMade = tableRow => tableRow.components.length ? Math.min(...tableRow.components.filter(component => component.item).map(component => Math.floor((stock(component.item.id).made || 0) / component.qty))) : 0;
  const totalSold = tableRow => tableRow.components.length ? Math.min(...tableRow.components.filter(component => component.item).map(component => Math.floor((stock(component.item.id).sold || 0) / component.qty))) : 0;
  const priceFor = tableRow => tableRow.pricePart === 'gear'
    ? (prices[tableRow.priceKey] ?? ((prices[tableRow.group+'-防具'] || 0) + (prices[tableRow.group+'-首饰'] || 0)))
    : (prices[tableRow.priceKey] || 0);
  const ledgerRows = type => tableRows(type).flatMap(item => item.header ? [] : [item, ...(item.tool ? [item.tool] : [])]);
  const isCraftLog = entry => entry.autoKind === 'craft' || entry.autoKind === 'legacy-craft';
  const automaticLogs = (kind, bundle) => {
    const row = typeof bundle === 'object' ? bundle : ['770', '750'].flatMap(ledgerRows).find(item => item.id === bundle);
    const bundleId = row?.id || bundle;
    return data.l.filter(entry => kind === 'craft'
      ? isCraftLog(entry) && (entry.bundleId === bundleId || (row && entry.legacyMigration && entry.recipeCosts?.some(cost => row.components.some(component => component.item?.id === cost.id))))
      : entry.autoKind === kind && entry.bundleId === bundleId);
  };

  document.body.innerHTML = `
    <style>
      *{box-sizing:border-box}body{margin:0;background:#eef4f6;color:#203545;font:14px "Microsoft YaHei",sans-serif}.app{display:grid;grid-template-columns:230px minmax(0,1fr);min-height:100vh}aside{background:#143752;color:#fff;padding:28px 16px}.brand{padding:0 10px 30px;color:#e5c369;font-size:22px;font-weight:700}nav{display:grid;gap:4px}nav button{width:100%;padding:12px;border:0;border-radius:7px;background:transparent;color:#cbdce3;text-align:left;font:inherit;cursor:pointer}nav button.active{background:#ffffff1e;color:#fff}.nav-group{display:grid;gap:4px}.subnav{display:none;gap:4px;padding-left:12px}.subnav.open{display:grid}.subnav button{padding-left:22px;font-size:13px}.nav-caret{float:right;opacity:.75}main{max-width:1600px;width:100%;margin:auto;padding:34px}.view{display:none}.view.active{display:block}.header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.sub,.meta{color:#71818c}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:22px 0}.card{background:#fff;border-radius:10px;padding:16px;box-shadow:0 5px 17px #16364b12}.metric b{display:block;color:#147889;font-size:21px;margin-top:5px}.metric.clickable{border:0;text-align:left;width:100%;font:inherit;cursor:pointer}.metric.clickable:hover{outline:2px solid #75b9c3}.btn{border:1px solid #187a8b;border-radius:7px;padding:8px 11px;background:#187a8b;color:#fff;font:inherit;cursor:pointer}.btn.secondary{background:#eff5f6;color:#176d79}.table-wrap{overflow:auto;background:#fff;border:1px solid #cbd6da;border-radius:10px;margin-top:20px}.ledger{border-collapse:collapse;min-width:950px;width:100%;font-family:"Microsoft YaHei",sans-serif}.ledger th{background:#f5f7f7;font-weight:700}.ledger th,.ledger td{border:1px solid #cbd6da;padding:8px;text-align:center;white-space:nowrap}.ledger td.label{text-align:left}.ledger tr.group-row td{background:#e8f1f3;color:#124c59;font-weight:700;text-align:left;padding:0}.group-toggle{display:flex;align-items:center;gap:8px;width:100%;padding:9px 12px;border:0;background:transparent;color:inherit;font:inherit;font-weight:700;text-align:left;cursor:pointer}.group-toggle b{margin-left:auto}.ledger tr.detail td.label{padding-left:28px;color:#23658a}.ledger td.price{color:#176d79;font-weight:700;cursor:pointer}.ledger td.profit{color:#0d7b65;font-weight:700}.ledger td.margin{color:#986b19}.bundle-link{display:inline-flex;align-items:center;gap:7px;border:0;background:transparent;padding:0;color:inherit;font:inherit;font-weight:700;cursor:pointer;text-align:left}.bundle-link:hover{color:#0b8191;text-decoration:underline}.job-badge{display:inline-grid;place-items:center;width:23px;height:23px;flex:0 0 23px;border-radius:50%;background:#dcecf0;font-size:12px;overflow:hidden}.job-badge img{display:block;width:100%;height:100%;object-fit:contain}.job-badge img+span{display:none}.spin-actions{display:inline-flex;border:1px solid #b7c9ce;border-radius:5px;overflow:hidden}.spin-actions button{width:25px;height:25px;border:0;background:#fff;color:#1b6d7d;cursor:pointer;font-size:16px;line-height:1}.spin-actions button+button{border-left:1px solid #b7c9ce}.spin-actions button:disabled{color:#b9c6ca;cursor:not-allowed}.tool-strip td{padding:7px 14px;background:#f7fbfc;text-align:left}.tool-chip{display:inline-flex;align-items:center;gap:10px;padding:7px 10px;border:1px solid #bed4d9;border-radius:8px;background:#fff;box-shadow:0 2px 6px #1231}.tool-chip .meta{font-size:12px}.tool-chip .spin-actions{margin-left:4px}.note{margin-top:12px;color:#71818c;font-size:12px}.empty{padding:24px;color:#71818c;text-align:center}.crystal-grid{display:grid;grid-template-columns:repeat(3,minmax(270px,1fr));gap:16px;margin-top:20px}.crystal-card{overflow:hidden;border:1px solid #d7e2e6;border-radius:12px;background:#fff;box-shadow:0 5px 17px #16364b12}.crystal-card h2{display:flex;align-items:center;gap:10px;margin:0;padding:13px 16px;background:linear-gradient(90deg,color-mix(in srgb,var(--element) 16%,white),#fff);font-size:16px;color:#244554}.crystal-image{position:relative;display:inline-grid;place-items:center;width:32px;height:32px;flex:0 0 32px}.crystal-game-icon,.crystal-icon{width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 2px 2px #0003)}.crystal-table{width:100%;border-collapse:collapse}.crystal-table td{padding:11px 12px;border-top:1px solid #edf1f3;vertical-align:middle}.crystal-table td:nth-child(2),.crystal-table td:nth-child(3){text-align:right;font-variant-numeric:tabular-nums}.crystal-name{display:flex;align-items:center;gap:8px;font-weight:700}.crystal-tier{color:#71818c;font-size:12px}.crystal-price{color:#176d79;font-weight:700}.crystal-action{display:flex;justify-content:flex-end;padding:0 12px 12px}.status{margin-top:10px;color:#a0524d;font-size:12px}.material-category{margin-top:16px;background:#fff;border:1px solid #cbd6da;border-radius:10px;overflow:hidden}.material-category summary{display:flex;justify-content:space-between;padding:13px 16px;color:#244554;font-weight:700;cursor:pointer}.material-category summary span{font-size:12px;color:#71818c;font-weight:400}.material-category .table-wrap{margin:0;border:0;border-radius:0}dialog{border:0;border-radius:12px;min-width:330px;box-shadow:0 18px 60px #1238}.modal{padding:20px}.modal label{display:block;margin:10px 0}.modal input,.modal select{display:block;width:100%;margin-top:4px;padding:8px}#other-material-search{flex:1;min-width:180px;border:1px solid #b7c9ce;border-radius:7px;padding:8px;font:inherit}.modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.price-form{min-width:390px}#bundle-detail-dialog{width:min(1540px,calc(100vw - 32px));max-width:none;max-height:94vh;padding:0;overflow:hidden}#bundle-detail-dialog::backdrop{background:#17374a88}.detail-modal{width:100%;max-height:94vh;overflow-y:auto;overflow-x:hidden;padding:26px}.detail-columns{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-top:18px}.detail-column{min-width:0;border:1px solid #d6e1e4;border-radius:8px;overflow:hidden}.detail-column h3{margin:0;padding:11px 13px;background:#eff6f7;font-size:14px}.material-list{margin:0;padding:0;list-style:none}.material-list li{display:flex;justify-content:space-between;gap:12px;padding:8px 12px;border-top:1px solid #edf1f3;white-space:normal;overflow-wrap:anywhere}.detail-cost{margin-top:16px;padding:12px;background:#eaf5f2;color:#126653;font-weight:700;border-radius:7px}.sales-history{margin-top:20px;border-top:1px solid #d6e1e4;padding-top:18px}.history-head h3{margin:0 0 5px}.history-form{display:grid;grid-template-columns:1fr 100px 1fr auto;gap:10px;align-items:end;margin-top:12px}.history-form label{display:grid;gap:4px;color:#71818c;font-size:12px}.history-form input{min-width:0;padding:8px;border:1px solid #b7c9ce;border-radius:6px;font:inherit}.history-table .ledger{min-width:0}.history-table{margin-top:12px}.equipment-summaries{display:grid;grid-template-columns:repeat(2,minmax(320px,1fr));gap:18px;margin-top:22px}.profit-summary{background:#fff;border:1px solid #cbd6da;border-radius:10px;padding:16px}.profit-summary h2{font-size:16px;margin:0 0 12px;color:#244554}.profit-summary .ledger{min-width:0}.profit-summary .ledger td:last-child{color:#d34c45;font-weight:700}.op-actions{display:flex;justify-content:center;gap:5px}.op-btn{border:1px solid;border-radius:5px;padding:5px 7px;background:#fff;font:12px "Microsoft YaHei",sans-serif;cursor:pointer;white-space:nowrap}.op-btn.craft{border-color:#32966e;color:#18724f;background:#f2fbf6}.op-btn.sale{border-color:#267fa5;color:#126784;background:#eff9fd}.op-btn.undo{border-color:#c7d1d4;color:#61737b}.op-btn:disabled{opacity:.42;cursor:not-allowed}.section-toggle{margin-left:8px;border:1px solid #b8ccd2;border-radius:12px;background:#fff;color:#176d79;padding:2px 8px;font:12px "Microsoft YaHei",sans-serif;cursor:pointer}.tool-strip .tool-chip{width:100%;flex-wrap:wrap}.detail-column .ledger{min-width:0;font-size:13px}.detail-column .ledger th,.detail-column .ledger td{white-space:normal;padding:7px}.refreshing{opacity:.78;cursor:wait}.refreshing::before{content:"↻";display:inline-block;margin-right:5px;animation:spin .7s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:1050px){.crystal-grid{grid-template-columns:repeat(2,minmax(270px,1fr))}}@media(max-width:800px){.app{grid-template-columns:1fr}aside{padding:16px}.brand{padding-bottom:14px}nav{display:flex;flex-wrap:wrap}.nav-group{flex:1;min-width:160px}.subnav{padding-left:8px}.cards{grid-template-columns:1fr 1fr}main{padding:20px}.crystal-grid,.detail-columns,.equipment-summaries{grid-template-columns:1fr}.history-form{grid-template-columns:1fr 1fr}.history-form button{grid-column:1/-1}}@media(max-width:520px){.cards{grid-template-columns:1fr}}
      #purchase-manager-dialog{width:min(1040px,calc(100vw - 32px));max-width:none;max-height:88vh;padding:0;overflow:hidden}#purchase-manager-dialog .modal{max-height:88vh;overflow:auto}.purchase-stats{display:grid;grid-template-columns:repeat(3,minmax(150px,1fr));gap:12px;margin:18px 0}.purchase-stats .card{box-shadow:none;border:1px solid #d8e4e7}.exchange-category-panel{padding:0 16px 16px}.exchange-category-panel .table-wrap{margin-top:12px;border:1px solid #d9e3e6;border-radius:7px}.exchange-category-panel .ledger{min-width:640px}.other-layout{display:grid;grid-template-columns:minmax(260px,.38fr) minmax(420px,1fr);gap:16px;margin-top:20px}.other-search-card{margin:0!important;align-self:start}.other-added-card{margin:0!important;min-height:360px}.grade-selects{display:inline-flex;gap:10px;margin:16px 0 0 16px;vertical-align:top}.grade-selects label{display:inline-grid;gap:5px}.grade-selects select{padding:7px;border:1px solid #b7c9ce;border-radius:6px;background:#fff;font:inherit}.material-tag{display:inline-block;margin:2px;padding:2px 6px;border-radius:10px;background:#e5f2f4;color:#176d79;font-size:11px}.recommend-tag{display:inline-block;margin-right:5px;padding:2px 6px;border-radius:10px;font-size:11px;font-weight:700;border:1px solid transparent}.recommend-market{background:#e1f0fb;color:#17648b;border-color:#b6d9ee}.recommend-npc{background:#fff0df;color:#b8611b;border-color:#f1c58e}.recommend-lavender{background:#eee7fb;color:#6f4ba0;border-color:#d0bce9}.recommend-pepper{background:#edf5d8;color:#627c20;border-color:#cbdca2}.recommend-white-steel{background:#e7eff5;color:#486d88;border-color:#bdcedb}.recommend-yellow-brass{background:#f9efd8;color:#9a681b;border-color:#e3c77e}.recommend-craft{background:#e1f3f4;color:#16727a;border-color:#a9d8db}.recommend-pending{background:#edf0f1;color:#65747a;border-color:#d3dbde}.npc-tag{display:inline-block;margin-right:5px;padding:2px 6px;border-radius:10px;background:#fff0df;color:#b8611b;font-size:11px;font-weight:700}.npc-row td{background:#fff9f1;color:#874d1c}.detail-section td{background:#f1f6f7!important;color:#365767!important;font-weight:700;text-align:left}.detail-section.exchange-section td{background:#f0f4f7!important;color:#4d687c!important}.detail-columns.four{grid-template-columns:repeat(4,minmax(0,1fr))}.overview-chart{margin-top:22px;padding:18px}.overview-chart h2{margin:0;font-size:16px}.chart-legend{display:flex;gap:14px;margin:10px 0;color:#60737d;font-size:12px}.chart-key{display:inline-flex;align-items:center;gap:5px}.chart-key i{display:inline-block;width:10px;height:10px;border-radius:2px}.chart-key .revenue{background:#247ea0}.chart-key .profit{background:#35a274}.chart-svg{width:100%;height:auto;display:block;overflow:visible}.chart-axis{stroke:#c8d5d9;stroke-width:1}.chart-label{fill:#71818c;font-size:11px}@media(max-width:1150px){.detail-columns.four{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:800px){.other-layout{grid-template-columns:1fr}.other-added-card{min-height:0}.purchase-stats{grid-template-columns:1fr}.grade-selects{display:flex;margin-left:0;width:100%}.detail-columns.four{grid-template-columns:1fr}}
    </style>
    <link rel="stylesheet" href="app.css">
    <div class="app desktop-ledger">
      <header class="app-topbar">
        <div class="app-brand"><img class="app-brand-icon" src="assets/gil.svg" alt="" aria-hidden="true">GilFate <span>FF14 成本账本</span></div>
        <nav class="app-primary-nav" aria-label="主导航">
          <button data-page="home">总览</button>
          <button id="equipment-toggle" aria-expanded="false">装备售卖 <span class="nav-caret">⌄</span></button>
          <button id="submarine-toggle" aria-expanded="false">潜水艇售卖 <span class="nav-caret">⌄</span></button>
          <button data-page="leve">理符售卖</button>
          <button data-page="trade">交易市场</button>
          <button id="guide-toggle" aria-expanded="false">材料指导价 <span class="nav-caret">⌄</span></button>
        </nav>
        <div class="app-save-state">本地数据已保存</div><button id="backup-toggle" class="app-utility-button" type="button">数据与更新</button>
      </header>
      <div class="app-contextbar" aria-label="当前页面导航">
        <div id="equipment-subnav" class="context-nav subnav equipment-type-nav"><button data-equipment-category="combat">战职装备</button><button data-equipment-category="gathering">生产采集装备</button></div>
        <div id="submarine-subnav" class="context-nav subnav"><button data-submarine-view="summary">销售利润</button><button data-submarine-view="ledger">潜水艇台账</button></div>
        <div id="leve-subnav" class="context-nav subnav equipment-type-nav"><button data-leve-view="ledger">售卖台账</button><button data-leve-view="recommend">推荐售卖</button></div>
        <div id="trade-subnav" class="context-nav subnav equipment-type-nav"><button data-trade-view="inventory">我的库存材料</button><button data-trade-view="recruitment">招募市场</button></div>
      </div>
      <main>
      <section id="home" class="view"><h1>营业总览</h1><div class="sub">按装备与潜水艇实际售卖记录汇总净利润和近 30 天趋势。</div><div id="metrics"></div><div id="overview-chart"></div></section>
      <section id="equipment" class="view"></section>
      <section id="submarine" class="view"></section>
      <section id="leve" class="view"></section>
      <section id="trade" class="view"></section>
      <section id="guide" class="view"></section>
      </main>
    </div>
    <div id="trade-market-popover" class="trade-market-popover" role="tooltip" hidden></div>
    <dialog id="custom-sale"><form id="custom-sale-form" class="modal"><h2>自定义成交价销售</h2><label>套装 / 分项<select id="custom-row"></select></label><label>成交单价<input id="custom-price" type="number" min="0.01" step="1" required></label><button class="btn">保存销售</button></form></dialog>
    <dialog id="price-template-dialog"><form id="price-template-form" class="modal price-form"><h2 id="price-template-title">统一调整套装价格</h2><div class="sub">保存后会同步更新当前装备类型的所有职业组；之后仍可点击单行套装价进行单独覆盖。</div><label id="price-total-label">套装总价<input id="price-template-total" type="number" min="0" step="1"></label><label>防具价格<input id="price-template-armor" type="number" min="0" step="1"></label><label>首饰价格<input id="price-template-accessory" type="number" min="0" step="1"></label><label id="price-weapon-label">武器价格<input id="price-template-weapon" type="number" min="0" step="1"></label><div class="modal-actions"><button type="button" class="btn secondary" data-close="price-template-dialog">取消</button><button class="btn">保存统一价格</button></div></form></dialog>
    <dialog id="single-price-dialog"><form id="single-price-form" class="modal"><h2 id="single-price-title">调整套装价格</h2><label>套装价<input id="single-price-value" type="number" min="0" step="1"></label><div class="modal-actions"><button type="button" class="btn secondary" data-close="single-price-dialog">取消</button><button class="btn">保存</button></div></form></dialog>
    <dialog id="sales-history-dialog"><div class="modal price-form"><div class="header"><div><h2 id="sales-history-title">销售记录</h2><div class="sub">仅显示当前装备类型的逐笔装备成交。</div></div><button class="btn secondary" data-close="sales-history-dialog">关闭</button></div><div id="sales-history-content"></div></div></dialog>
    <dialog id="overview-sales-dialog"><div class="modal price-form"><div class="header"><div><h2 id="overview-sales-title">销售明细</h2><div class="sub">已完成装备销售的实际成交记录。</div></div><button class="btn secondary" data-close="overview-sales-dialog">关闭</button></div><div id="overview-sales-content"></div></div></dialog>
    <dialog id="auto-sale-dialog"><form id="auto-sale-form" class="modal"><h2>确认装备出售</h2><div id="auto-sale-summary" class="card" style="box-shadow:none;background:#f3f8f9"></div><label>实际成交单价<input id="auto-sale-price" type="number" min="0.01" step="1" required></label><div class="modal-actions"><button type="button" class="btn secondary" data-close="auto-sale-dialog">取消</button><button class="btn">确认售卖</button></div></form></dialog>
    <dialog id="bundle-detail-dialog"><div class="detail-modal"><div class="header"><div><div id="bundle-detail-meta" class="meta"></div><h2 id="bundle-detail-title">装备详情</h2><div class="sub">成品仅作为清单显示；成本仅统计递归展开后的基础制作素材。</div></div><button class="btn secondary" data-close="bundle-detail-dialog">关闭</button></div><div id="bundle-detail-content"></div></div></dialog>
    <dialog id="recipe-reference-dialog"><div class="modal price-form"><div class="header"><div><div id="recipe-reference-meta" class="meta">潜水艇配方参考</div><h2 id="recipe-reference-title">制作配方</h2><div class="sub">此处仅核对官方配方结构，不参与当前市场 / 兑换成本核算。</div></div><button class="btn secondary" data-close="recipe-reference-dialog">关闭</button></div><div id="recipe-reference-content"></div></div></dialog>
    <dialog id="purchase-dialog"><form id="purchase-form" class="modal price-form" novalidate><h2 id="purchase-title">记录采购</h2><label>日期<input id="purchase-date" type="date"></label><div id="purchase-voucher-summary" class="card" style="box-shadow:none;background:#f3f8f9" hidden></div><label id="purchase-kind-label">采购方式<select id="purchase-kind"></select></label><div id="purchase-kind-hint" class="sub" style="margin:-4px 0 10px" hidden></div><div id="purchase-direct-fields"><label>购买数量<input id="purchase-quantity" type="number" min="0" step="any"></label><label>税率<select id="purchase-tax"><option value="0.05">5%</option><option value="0">0%</option></select></label><label>单价<input id="purchase-unit" type="text" inputmode="decimal" autocomplete="off"></label><label>合价（含税）<input id="purchase-total" type="text" inputmode="decimal" autocomplete="off"></label></div><div id="purchase-exchange-fields" hidden><div id="purchase-exchange-note" class="sub"></div><label>兑换次数<input id="purchase-exchange-turns" type="number" min="0" step="any"></label><label id="purchase-source-price-label">凭证单价<input id="purchase-source-price" type="text" inputmode="decimal" autocomplete="off"></label><div id="purchase-exchange-summary" class="card" style="box-shadow:none;background:#f3f8f9"></div></div><p id="purchase-error" role="alert" style="margin:12px 0 0;color:#b5423a" hidden></p><div class="modal-actions"><button class="btn">保存采购</button></div></form></dialog>
    <dialog id="purchase-manager-dialog"><div class="modal"><div class="header"><div><div id="purchase-manager-meta" class="meta">材料采购</div><h2 id="purchase-manager-title">采购价格</h2><div id="purchase-manager-average" class="sub"></div></div><div><button id="purchase-manager-add" class="btn">+ 记录采购</button> <button class="btn secondary" data-close="purchase-manager-dialog">关闭</button></div></div><div id="purchase-manager-content"></div></div></dialog>
    <dialog id="trade-listing-dialog"><form id="trade-listing-form" class="modal price-form" novalidate><div class="header"><div><div class="meta">交易市场 · 我的库存材料</div><h2 id="trade-listing-title">添加材料</h2><div class="sub">本机待售清单，不会变更采购、制作或潜水艇库存。</div></div><button type="button" class="btn secondary" data-close="trade-listing-dialog">关闭</button></div><input id="trade-listing-item-id" type="hidden"><input id="trade-listing-item-name" type="hidden"><label>搜索材料名称或物品 ID<input id="trade-listing-search" autocomplete="off" placeholder="输入名称或物品 ID"></label><div id="trade-listing-results" class="trade-search-results"></div><div id="trade-listing-selected" class="trade-selected-item">请先从搜索结果中选择材料。</div><label id="trade-listing-category-label">来源分类<select id="trade-listing-category"></select></label><div id="trade-listing-category-note" class="trade-input-reference">选择材料后自动识别来源分类。</div><label>组数<input id="trade-listing-groups" type="number" min="1" step="1" value="1" required></label><label>单价（G / 个）<input id="trade-listing-unit-price" type="number" min="1" step="1" required></label><div id="trade-listing-market-reference" class="trade-input-reference">市场参考价：请先选择材料。</div><div class="trade-total-preview"><span>合价</span><b id="trade-listing-total">0 G</b><small id="trade-listing-total-formula">组数 × 1000 × 单价</small></div><p id="trade-listing-error" role="alert" class="status" hidden></p><div class="modal-actions"><button class="btn">保存本机库存材料</button></div></form></dialog>
    <dialog id="trade-quantity-dialog"><form id="trade-quantity-form" class="modal price-form" novalidate><div class="header"><div><div class="meta">交易市场 · 我的库存材料</div><h2>修改库存组数</h2><div id="trade-quantity-material" class="sub"></div></div><button type="button" class="btn secondary" data-close="trade-quantity-dialog">关闭</button></div><input id="trade-quantity-id" type="hidden"><label>组数<input id="trade-quantity-groups" type="number" min="1" step="1" required></label><p id="trade-quantity-error" role="alert" class="status" hidden></p><div class="modal-actions"><button class="btn">保存组数</button></div></form></dialog>
    <dialog id="trade-unit-price-dialog"><form id="trade-unit-price-form" class="modal price-form" novalidate><div class="header"><div><div class="meta">交易市场 · 我的库存材料</div><h2>修改单价</h2><div id="trade-unit-price-material" class="sub"></div></div><button type="button" class="btn secondary" data-close="trade-unit-price-dialog">关闭</button></div><input id="trade-unit-price-id" type="hidden"><label>单价（G / 个）<input id="trade-unit-price-value" type="number" min="0.01" step="1" required></label><p id="trade-unit-price-error" role="alert" class="status" hidden></p><div class="modal-actions"><button class="btn">保存单价</button></div></form></dialog>
    <div id="trade-context-menu" class="trade-context-menu" role="menu" hidden></div>
    <dialog id="craft-scrip-manual-dialog"><form id="craft-scrip-manual-form" class="modal price-form" novalidate><div class="header"><div><div class="meta">材料指导价 &gt; 工票材料</div><h2 id="craft-scrip-manual-title">维护本机工票兑换材料</h2><div class="sub">仅保存到本机配置，不会写入共享资料包，也不会影响其他用户。</div></div><button type="button" class="btn secondary" data-close="craft-scrip-manual-dialog">关闭</button></div><input id="craft-scrip-manual-id" type="hidden"><label>材料名称或物品 ID<input id="craft-scrip-manual-material" autocomplete="off" placeholder="例如 高浓缩炼金药 或 44848" required></label><div id="craft-scrip-manual-resolved" class="sub"></div><label>票种<select id="craft-scrip-manual-ticket"><option value="orange">巧手橙票</option><option value="purple">巧手紫票</option></select></label><label>所需工票<input id="craft-scrip-manual-cost" type="number" min="1" step="1" required></label><label>每次获得数量<input id="craft-scrip-manual-output" type="number" min="1" step="1" value="1" required></label><label>来源说明<input id="craft-scrip-manual-source" placeholder="例如 NPC 兑换 / 资料链接"></label><p id="craft-scrip-manual-error" role="alert" style="margin:12px 0 0;color:#b5423a" hidden></p><div class="modal-actions"><button type="button" class="btn secondary" data-close="craft-scrip-manual-dialog">取消</button><button class="btn">保存本机配置</button></div></form></dialog>
    <dialog id="submarine-sale-dialog"><form id="submarine-sale-form" class="modal"><h2 id="submarine-sale-title">确认潜水艇部件售卖</h2><div id="submarine-sale-summary" class="card" style="box-shadow:none;background:#f3f8f9"></div><label>出售数量<input id="submarine-sale-quantity" type="number" min="1" step="1" value="1"></label><label>实际单价<input id="submarine-sale-price" type="number" min="0.01" step="1" required></label><div class="modal-actions"><button type="button" class="btn secondary" data-close="submarine-sale-dialog">取消</button><button class="btn">确认售卖</button></div></form></dialog>
    <dialog id="submarine-suite-sale-dialog"><form id="submarine-suite-sale-form" class="modal"><h2 id="submarine-suite-sale-title">确认整套售卖</h2><div id="submarine-suite-sale-summary" class="card" style="box-shadow:none;background:#f3f8f9"></div><label>出售套数<input id="submarine-suite-sale-quantity" type="number" min="1" step="1" value="1"></label><label>实际单套成交价<input id="submarine-suite-sale-price" type="number" min="0.01" step="1" required></label><div class="modal-actions"><button type="button" class="btn secondary" data-close="submarine-suite-sale-dialog">取消</button><button class="btn">确认整套售卖</button></div></form></dialog>
    <dialog id="submarine-craft-dialog"><form id="submarine-craft-form" class="modal"><h2 id="submarine-craft-title">制作入库</h2><div id="submarine-craft-summary" class="card" style="box-shadow:none;background:#f3f8f9"></div><label id="submarine-craft-quantity-label">制作数量<input id="submarine-craft-quantity" type="number" min="1" step="1" value="1"></label><div class="modal-actions"><button type="button" class="btn secondary" data-close="submarine-craft-dialog">取消</button><button class="btn">确认制作入库</button></div></form></dialog>
    <dialog id="submarine-suite-dialog"><form id="submarine-suite-form" class="modal price-form"><h2 id="submarine-suite-title">新增潜水艇整套</h2><label>套装简称（船体、船尾、船首、舰桥；0 表示不含）<input id="submarine-suite-code" pattern="[0-5]{4}" maxlength="4" placeholder="例如 3124"></label><label><input id="submarine-suite-modified" type="checkbox" style="display:inline;width:auto;margin-right:6px">使用改级部件</label><label>建议售价<input id="submarine-suite-price" type="number" min="0" step="1"></label><div class="modal-actions"><button type="button" class="btn secondary" data-close="submarine-suite-dialog">取消</button><button class="btn">保存套装</button></div></form></dialog>
    <dialog id="npc-material-dialog"><div class="modal price-form"><div class="header"><div><h2>管理 NPC 购买材料</h2><div class="sub">仅能添加潜水艇推荐材料名录中的材料；加入后会从其他潜水艇分类中排除。</div></div><button class="btn secondary" data-close="npc-material-dialog">关闭</button></div><div id="npc-material-list"></div><hr style="border:0;border-top:1px solid #d6e1e4;margin:18px 0"><h3>添加 NPC 购买材料</h3><label>搜索潜水艇推荐材料<input id="npc-material-search" placeholder="输入名称或物品 ID"></label><div id="npc-material-results"></div><form id="npc-material-form"><input id="npc-material-id" type="hidden"><input id="npc-material-name" type="hidden"><label>NPC 采购价<input id="npc-material-price" type="number" min="0" required></label><label>购买来源<input id="npc-material-source" placeholder="例如 NPC 名称或商店" required></label><div class="modal-actions"><button class="btn">加入 NPC 分类</button></div></form></div></dialog>
    <dialog id="report-reconcile-dialog"><form id="report-reconcile-form" class="modal price-form"><h2>补全销售记录来源</h2><div id="report-reconcile-summary" class="card" style="box-shadow:none;background:#f3f8f9"></div><label>销售日期<input id="report-reconcile-date" type="date" required></label><label>记录名称<input id="report-reconcile-item" required></label><label>销售额<input id="report-reconcile-amount" type="number" min="0" step="1" required></label><label>销售成本<input id="report-reconcile-cost" type="number" min="0" step="1" required></label><label>利润<input id="report-reconcile-profit" type="number" step="1" required></label><label>归属类型<select id="report-reconcile-kind"><option value="equipment">装备销售</option><option value="part">潜水艇单件</option><option value="suite">潜水艇整套</option></select></label><label>对应项目<select id="report-reconcile-target"></select></label><div class="modal-actions"><button type="button" class="btn secondary" data-close="report-reconcile-dialog">取消</button><button class="btn">保存归属</button></div></form></dialog>
    <dialog id="backup-dialog"><div class="modal price-form"><div class="header"><div><h2>数据与更新</h2><div id="backup-status" class="sub">导出可保存本机账本；导入会覆盖当前数据。</div></div><button class="btn secondary" data-close="backup-dialog">关闭</button></div><div class="backup-actions"><button id="backup-export" class="btn secondary" type="button">导出账本 JSON</button><button id="backup-import" class="btn secondary" type="button">导入账本 JSON</button></div><div id="desktop-update-panels" class="update-panels" hidden><section class="update-panel"><div><h3>资料版本</h3><p id="data-update-current" class="sub">正在读取本机资料版本…</p><p id="data-update-latest" class="sub">手动检查后显示最新版本。</p></div><div class="backup-actions"><button id="data-update-check" class="btn secondary" type="button">重新检测</button><button id="data-update-apply" class="btn" type="button" hidden>下载并应用资料</button></div></section><section class="update-panel"><div><h3>客户端版本</h3><p id="desktop-update-current" class="sub">正在读取客户端版本…</p><p id="desktop-update-latest" class="sub">手动检查后显示最新版本。</p></div><div class="backup-actions"><button id="desktop-update-check" class="btn secondary" type="button">重新检测</button><button id="desktop-update-restart" class="btn" type="button" hidden>重启并安装更新</button></div></section></div><input id="backup-import-input" type="file" accept="application/json,.json" hidden></div></dialog>
  `;

  const reportFieldsValid = row => Boolean(row?.date && row?.item && Number.isFinite(Number(row.amount)) && Number.isFinite(Number(row.cost)) && Number.isFinite(Number(row.profit)));
  const reportSales = () => {
    const equipmentIds = new Set([...ledgerRows('770'), ...ledgerRows('750')].map(row => String(row.id)));
    const partIds = new Set((submarineData.parts || []).map(part => String(part.id)));
    const suiteIds = new Set(submarineSuites.map(suite => String(suite.id)));
    const make = (row, store, index, source, valid, reason) => ({ ...row, source: valid ? source : '待核对', sourceStatus: valid ? '已核对' : '待核对', reason: valid ? '' : reason, q: Number(row.q) || 1, reportKey: `${store}:${row.id || index}`, store, storeIndex: index });
    return [
      ...data.l.map((row, index) => ({ row, index })).filter(({ row }) => row.type === '出售').map(({ row, index }) => make(row, 'equipment', index, '装备销售', reportFieldsValid(row) && Boolean(row.bundleId) && equipmentIds.has(String(row.bundleId)), !row.bundleId ? '缺少装备分项标识' : !equipmentIds.has(String(row.bundleId)) ? '装备分项已不存在' : '销售字段不完整')),
      ...submarineSales.map((row, index) => make(row, 'part', index, '潜水艇单件', reportFieldsValid(row) && partIds.has(String(row.partId)), !row.partId ? '缺少潜水艇部件标识' : !partIds.has(String(row.partId)) ? '潜水艇部件已不存在' : '销售字段不完整')),
      ...submarineSuiteSales.map((row, index) => make(row, 'suite', index, '潜水艇整套', reportFieldsValid(row) && suiteIds.has(String(row.suiteId)), !row.suiteId ? '缺少潜水艇套装标识' : !suiteIds.has(String(row.suiteId)) ? '潜水艇套装已不存在' : '销售字段不完整'))
    ].sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')));
  };
  const findReportSale = key => reportSales().find(row => row.reportKey === key);

  function renderHome() {
    const all = reportSales(), day = today(), week = shiftDate(day, -6);
    const periods = [
      ['日', all.filter(row => row.date === day)],
      ['周', all.filter(row => row.date >= week && row.date <= day)],
      ['月', all.filter(row => row.date?.slice(0, 7) === day.slice(0, 7))],
      ['年', all.filter(row => row.date?.slice(0, 4) === day.slice(0, 4))]
    ];
    const sums = rows => rows.reduce((result, row) => ({
      amount: result.amount + (+row.amount || 0), cost: result.cost + (+row.cost || 0), profit: result.profit + (+row.profit || 0)
    }), { amount: 0, cost: 0, profit: 0 });
    document.querySelector('#metrics').className = 'cards';
    document.querySelector('#metrics').innerHTML = periods.map(([name, rows]) => {
      const value = sums(rows);
      return `<button class="card metric clickable" data-overview-period="${name}"><small>${name}净利润 · 查看销售明细</small><b>${money(value.profit)}</b></button>`;
    }).join('');
    const categoryOf = row => {
      if (row.source === '潜水艇单件' || row.source === '潜水艇整套') return '潜水艇售卖';
      if (String(row.bundleId || '').startsWith('770-')) return '战职装备 770 HQ';
      if (String(row.bundleId || '').startsWith('750-')) return '生产采集装备 750 HQ';
      return '装备售卖';
    };
    const categories = [...new Set(all.map(categoryOf))];
    const activeCategories = categories.length ? categories : ['战职装备 770 HQ', '生产采集装备 750 HQ', '潜水艇售卖'];
    const colors = ['#247ea0', '#35a274', '#9a6fcd', '#df8c43', '#d35d66'];
    const days = Array.from({ length: 30 }, (_, index) => {
      const key = shiftDate(day, -29 + index), values = Object.fromEntries(activeCategories.map(category => [category, 0]));
      all.filter(entry => entry.date === key).forEach(entry => { values[categoryOf(entry)] = (values[categoryOf(entry)] || 0) + Number(entry.profit || 0); });
      return { key, values };
    });
    days.forEach(entry => { entry.total = Object.values(entry.values).reduce((sum, value) => sum + Number(value || 0), 0); });
    const figures = days.flatMap(entry => [...Object.values(entry.values), entry.total]), hasChartData = figures.some(value => Math.abs(Number(value || 0)) > 0), minValue = Math.min(0, ...figures), maxValue = Math.max(1, ...figures);
    const width = 1440, height = 250, left = 58, right = 22, top = 24, bottom = 38, plotHeight = height - top - bottom, plotWidth = width - left - right;
    const y = value => top + (maxValue - value) / Math.max(maxValue - minValue, 1) * plotHeight;
    const zero = y(0), slot = plotWidth / days.length, barWidth = Math.max(2, slot * .68 / activeCategories.length);
    const gridValues = hasChartData ? Array.from({ length: 4 }, (_, index) => maxValue - (maxValue - minValue) * index / 3) : [];
    const grid = gridValues.map(value => `<g><line x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}" class="chart-grid"/><text x="${left - 8}" y="${y(value) + 4}" text-anchor="end" class="chart-label">${money(value)}</text></g>`).join('');
    const bars = days.map((entry, index) => {
      const x = left + index * slot + slot * .16, label = `${entry.key}\n${activeCategories.map(category => `${category}：${money(entry.values[category])}`).join('\n')}\n总净利润：${money(entry.total)}`;
      return `<g><title>${label}</title>${activeCategories.map((category, categoryIndex) => { const value = entry.values[category], valueY = y(value); return `<rect x="${x + categoryIndex * barWidth}" y="${Math.min(zero, valueY)}" width="${barWidth - .5}" height="${Math.abs(zero - valueY)}" fill="${colors[categoryIndex % colors.length]}" rx="2"/>`; }).join('')}${index % 5 === 0 || index === days.length - 1 ? `<text x="${x + slot * .32}" y="${height - 18}" text-anchor="middle" class="chart-label">${entry.key.slice(5)}</text>` : ''}</g>`;
    }).join('');
    const linePoints = days.map((entry, index) => `${left + index * slot + slot / 2},${y(entry.total)}`).join(' ');
    const dots = days.map((entry, index) => `<circle cx="${left + index * slot + slot / 2}" cy="${y(entry.total)}" r="2.6" class="chart-total-dot"><title>${entry.key}\n总净利润：${money(entry.total)}</title></circle>`).join('');
    document.querySelector('#overview-chart').innerHTML = `<section class="overview-chart dashboard-chart"><div class="dashboard-chart-head"><div><h2>近 30 天净利润趋势</h2><p>柱状为各业务来源每日净利润，折线为当日总净利润。</p></div><span class="meta">装备品级按实际售卖记录自动识别</span></div><div class="chart-legend">${activeCategories.map((category, index) => `<span class="chart-key"><i style="background:${colors[index % colors.length]}"></i>${category}</span>`).join('')}<span class="chart-key chart-total-key"><i></i>总净利润</span></div><svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="近30天分类净利润柱状图和总净利润折线图">${grid}<line x1="${left}" y1="${zero}" x2="${width - right}" y2="${zero}" class="chart-axis"/>${bars}<polyline points="${linePoints}" class="chart-total-line"/>${dots}</svg></section>`;
    document.querySelectorAll('[data-overview-period]').forEach(button => button.onclick = () => openOverviewSales(button.dataset.overviewPeriod));
  }

  const monthKey = date => String(date || '').slice(0, 7);
  const salesTotals = rows => rows.reduce((result, entry) => ({ amount: result.amount + (+entry.amount || 0), cost: result.cost + (+entry.cost || 0), profit: result.profit + (+entry.profit || 0) }), { amount: 0, cost: 0, profit: 0 });
  const salesTable = (rows, interactive = false) => {
    const totals = rows.reduce((result, entry) => ({ amount: result.amount + (+entry.amount || 0), cost: result.cost + (+entry.cost || 0), profit: result.profit + (+entry.profit || 0) }), { amount: 0, cost: 0, profit: 0 });
    return `<div class="table-wrap history-table"><table class="ledger"><thead><tr><th>日期</th><th>来源状态</th><th>装备 / 潜水艇</th><th>数量</th><th>销售额</th><th>销售成本</th><th>利润</th>${interactive ? '<th>追溯</th>' : ''}</tr></thead><tbody>${rows.map(entry => `<tr class="${entry.sourceStatus === '待核对' ? 'npc-row' : ''}"><td>${entry.date || '—'}</td><td><span class="material-tag">${entry.source || '待核对'}</span>${entry.reason ? `<small class="meta"> · ${entry.reason}</small>` : ''}</td><td class="label">${entry.item || '未命名销售'}</td><td>${entry.q || 1}</td><td>${money(entry.amount)}</td><td>${money(entry.cost)}</td><td class="profit">${money(entry.profit)}</td>${interactive ? `<td>${entry.sourceStatus === '待核对' ? `<button class="btn secondary" data-report-reconcile="${entry.reportKey}">补全来源</button> <button class="btn secondary" data-report-delete="${entry.reportKey}">删除</button>` : `<button class="btn secondary" data-report-view="${entry.reportKey}">查看原记录</button>`}</td>` : ''}</tr>`).join('') || `<tr><td colspan="${interactive ? 8 : 7}" class="empty">该期间暂无销售记录</td></tr>`}</tbody><tfoot><tr><th colspan="4">合计</th><th>${money(totals.amount)}</th><th>${money(totals.cost)}</th><th class="profit">${money(totals.profit)}</th>${interactive ? '<th></th>' : ''}</tr></tfoot></table></div>`;
  };
  function openOverviewSales(period, selectedMonth = '') {
    state.overviewPeriod = period; state.overviewSelectedMonth = selectedMonth;
    const day = today(), week = shiftDate(day, -6);
    const all = reportSales();
    const years = [...new Set(all.map(entry => String(entry.date || '').slice(0, 4)).filter(Boolean).concat(day.slice(0, 4)))].sort().reverse();
    const rows = period === '日' ? all.filter(entry => entry.date === day)
      : period === '周' ? all.filter(entry => entry.date >= week && entry.date <= day)
      : selectedMonth ? all.filter(entry => monthKey(entry.date) === selectedMonth) : [];
    document.querySelector('#overview-sales-title').textContent = selectedMonth ? `${selectedMonth} 销售流水明细` : period + '销售流水明细';
    if (period === '月' && !selectedMonth) {
      document.querySelector('#overview-sales-content').innerHTML = `<label>选择月份<input id="overview-month-picker" type="month" value="${day.slice(0, 7)}"></label><div class="modal-actions"><button id="open-month-detail" class="btn">查看该月明细</button></div>`;
      document.querySelector('#open-month-detail').onclick = () => openOverviewSales('月', document.querySelector('#overview-month-picker').value);
    } else if (period === '年' && !selectedMonth) {
      const defaultYear = state.overviewYear || day.slice(0, 4);
      const monthly = Array.from({ length: 12 }, (_, index) => `${defaultYear}-${String(index + 1).padStart(2, '0')}`).map(month => [month, all.filter(entry => monthKey(entry.date) === month)]);
      document.querySelector('#overview-sales-content').innerHTML = `<label>选择年份<select id="overview-year-picker">${years.map(year => `<option value="${year}" ${year === defaultYear ? 'selected' : ''}>${year} 年</option>`).join('')}</select></label><div class="table-wrap history-table"><table class="ledger"><thead><tr><th>月份</th><th>销售额</th><th>销售成本</th><th>利润</th><th></th></tr></thead><tbody>${monthly.map(([month, entries]) => { const total = salesTotals(entries); return `<tr><td>${month}</td><td>${money(total.amount)}</td><td>${money(total.cost)}</td><td class="profit">${money(total.profit)}</td><td><button class="btn secondary" data-year-month="${month}">查看明细</button></td></tr>`; }).join('')}</tbody></table></div>`;
      document.querySelector('#overview-year-picker').onchange = event => { state.overviewYear = event.target.value; openOverviewSales('年'); };
      document.querySelectorAll('[data-year-month]').forEach(button => button.onclick = () => openOverviewSales('年', button.dataset.yearMonth));
    } else {
      const pending = rows.filter(entry => entry.sourceStatus === '待核对');
      document.querySelector('#overview-sales-content').innerHTML = `${salesTable(rows, true)}${pending.length ? `<section class="sales-history"><h3>待核对销售记录</h3><div class="sub">这些记录仍计入总览；请补全来源或删除错误数据。</div>${salesTable(pending, true)}</section>` : ''}`;
      bindOverviewReportActions();
    }
    const dialog = document.querySelector('#overview-sales-dialog');
    if (!dialog.open) dialog.showModal();
  }
  function reportStore(entry) {
    return entry.store === 'equipment' ? data.l : entry.store === 'part' ? submarineSales : submarineSuiteSales;
  }
  function removeReportSale(entry) {
    const list = reportStore(entry), index = list.findIndex((row, rowIndex) => String(row.id || rowIndex) === entry.reportKey.split(':').slice(1).join(':'));
    if (index < 0) throw new Error('未找到原始销售记录。');
    list.splice(index, 1);
  }
  function openReportRecord(entry) {
    document.querySelector('#overview-sales-dialog').close();
    if (entry.store === 'equipment') {
      const bundle = [...ledgerRows('770'), ...ledgerRows('750')].find(row => String(row.id) === String(entry.bundleId));
      if (!bundle) return alert('对应装备分项已不存在，请先补全来源。');
      state.page = 'equipment'; state.type = String(bundle.id).startsWith('770-') ? '770' : '750'; state.expanded = true; render(); openBundleDetail(bundle);
    } else if (entry.store === 'part') {
      const part = submarineData.parts.find(item => String(item.id) === String(entry.partId));
      if (!part) return alert('对应潜水艇部件已不存在，请先补全来源。');
      state.page = 'submarine'; state.submarineView = 'ledger'; state.submarineExpanded = true; render(); openSubmarineDetail(part);
    } else {
      const suite = submarineSuites.find(item => String(item.id) === String(entry.suiteId));
      if (!suite) return alert('对应潜水艇套装已不存在，请先补全来源。');
      state.page = 'submarine'; state.submarineView = 'ledger'; state.submarineExpanded = true; render(); openSubmarineSuiteDetail(suite);
    }
  }
  function reconcileOptions(kind) {
    if (kind === 'equipment') return [...ledgerRows('770'), ...ledgerRows('750')].map(row => ({ id: row.id, label: `${row.group} · ${row.label}` }));
    if (kind === 'part') return submarineData.parts.map(part => ({ id: part.id, label: part.n }));
    return submarineSuites.map(suite => ({ id: suite.id, label: suiteLabel(suite) }));
  }
  function updateReconcileTargets() {
    const kind = document.querySelector('#report-reconcile-kind').value, select = document.querySelector('#report-reconcile-target'), options = reconcileOptions(kind);
    select.innerHTML = options.map(option => `<option value="${option.id}">${option.label}</option>`).join('');
  }
  function openReportReconcile(entry) {
    state.pendingReportKey = entry.reportKey;
    document.querySelector('#report-reconcile-summary').innerHTML = `<b>${entry.item || '未命名销售'}</b><div class="meta" style="margin-top:8px">${entry.date || '未填写日期'} · 销售额 ${money(entry.amount)} · 成本 ${money(entry.cost)} · ${entry.reason}</div>`;
    document.querySelector('#report-reconcile-date').value = entry.date || today();
    document.querySelector('#report-reconcile-item').value = entry.item || '';
    document.querySelector('#report-reconcile-amount').value = Number(entry.amount || 0);
    document.querySelector('#report-reconcile-cost').value = Number(entry.cost || 0);
    document.querySelector('#report-reconcile-profit').value = Number(entry.profit || 0);
    document.querySelector('#report-reconcile-kind').value = 'equipment';
    updateReconcileTargets();
    document.querySelector('#report-reconcile-dialog').showModal();
  }
  function reconcileReportSale(entry, kind, targetId, patch = {}) {
    const raw = { ...entry, ...patch };
    ['source', 'sourceStatus', 'reason', 'reportKey', 'store', 'storeIndex'].forEach(key => delete raw[key]);
    removeReportSale(entry);
    if (kind === 'equipment') {
      const bundle = reconcileOptions(kind).find(option => String(option.id) === String(targetId));
      if (!bundle) throw new Error('未找到选择的装备分项。');
      data.l.unshift({ ...raw, type: '出售', bundleId: bundle.id, autoKind: 'reconciled-sale' });
    } else if (kind === 'part') {
      const part = submarineData.parts.find(item => String(item.id) === String(targetId));
      if (!part) throw new Error('未找到选择的潜水艇部件。');
      submarineSales.unshift({ ...raw, partId: part.id, item: part.n });
    } else {
      const suite = submarineSuites.find(item => String(item.id) === String(targetId));
      if (!suite) throw new Error('未找到选择的潜水艇套装。');
      submarineSuiteSales.unshift({ ...raw, suiteId: suite.id, item: '潜水艇整套 ' + suiteLabel(suite) });
    }
  }
  function bindOverviewReportActions() {
    document.querySelectorAll('[data-report-view]').forEach(button => button.onclick = () => {
      const entry = findReportSale(button.dataset.reportView); if (entry) openReportRecord(entry);
    });
    document.querySelectorAll('[data-report-reconcile]').forEach(button => button.onclick = () => {
      const entry = findReportSale(button.dataset.reportReconcile); if (entry) openReportReconcile(entry);
    });
    document.querySelectorAll('[data-report-delete]').forEach(button => button.onclick = () => {
      const entry = findReportSale(button.dataset.reportDelete); if (!entry || !confirm('删除这条待核对销售记录？此操作会影响总览统计。')) return;
      try { removeReportSale(entry); save(); openOverviewSales(state.overviewPeriod, state.overviewSelectedMonth); renderHome(); } catch (error) { alert(error.message || '删除失败。'); }
    });
  }

  const guideMaterials = () => {
    if (state.basicCategory === 'crystals') return data.m.filter(isCrystal);
    if (state.basicCategory === 'equipment') return equipmentBaseMaterials();
    if (state.basicCategory === 'submarine') return submarineBaseMaterials().filter(showSubmarineGuideMaterial);
    if (state.basicCategory === 'leve') return leveBaseMaterials();
    if (state.basicCategory === 'scrip') return craftScripExchangeMaterials();
    return data.m.filter(material => otherMaterialIds.includes(String(material.uid)));
  };
  const craftScripRoutesFor = (uid, ticket = null) => craftScripExchanges().filter(route => String(route.itemId) === String(uid) && (!ticket || route.ticket === ticket));
  const craftScripExchangeMaterials = ticket => {
    const ids = new Set(craftScripExchanges().filter(route => !ticket || route.ticket === ticket).map(route => String(route.itemId)));
    return data.m.filter(material => ids.has(String(material.uid))).sort((left, right) => Number(left.uid) - Number(right.uid));
  };
  const craftScripManualRoutes = () => craftScripManualExchanges.map(route => normalizeCraftScripExchange(route, true)).filter(Boolean);
  const findCraftScripMaterial = value => {
    const query = String(value || '').trim();
    if (!query) return null;
    const lower = query.toLowerCase();
    const material = data.m.find(item => String(item.uid) === query || item.n.toLowerCase() === lower);
    if (material) return material;
    const indexed = itemIndex().find(([uid, name]) => String(uid) === query || String(name).toLowerCase() === lower);
    return indexed ? { uid: String(indexed[0]), n: indexed[1] } : null;
  };
  const refreshCraftScripConfig = () => {
    ensureCraftScripMaterials();
    invalidatePlans();
    invalidateGuideIndexes();
    save();
  };
  const craftJobName = recipe => {
    const raw = Number(recipe?.j);
    const key = Number.isFinite(raw) && raw < 9 ? raw + 9 : raw;
    return jobNames['职业 ' + key] || '待核验职业';
  };
  const craftScripCollectibleCandidates = ticket => {
    const minimumLevel = Number(craftScrips.tickets?.[ticket]?.minimumCollectableLevel || 0);
    return (craftScrips.collectables || []).filter(spec => spec.ticket === ticket && spec.active !== false &&
      (!minimumLevel || Number(spec.level || 0) >= minimumLevel) && (!spec.scope || spec.scope === 'regular' || spec.scope === '常规'));
  };
  const craftScripCollectibleCost = spec => {
    const recipe = recipeCandidatesFor(spec.itemId)[0];
    const rows = recipe ? submarineCraftInputBreakdown(spec.itemId) : [];
    const missing = [];
    if (!recipe) missing.push('缺少配方');
    if (!Number(spec.maxPayout || 0)) missing.push('缺少最高档回报');
    if (recipe && !rows.length) missing.push('缺少制作素材');
    if (rows.some(row => !(Number(row.unit) > 0))) missing.push('等待材料价格');
    const batchCost = !missing.length ? rows.reduce((sum, row) => sum + Number(row.batchTotal), 0) : null;
    const yieldCount = Math.max(1, Number(spec.outputQuantity || spec.yield || recipe?.y || 1));
    const payout = Number(spec.maxPayout || 0);
    const unitCost = batchCost == null ? null : craftedUnitComparisonCost(batchCost / yieldCount);
    return { ...spec, recipe, rows, batchCost, yieldCount, unitCost, payout, perScrip: unitCost != null && payout > 0 ? unitCost / payout : null, ready: !missing.length, reason: missing.join('；'), job: spec.job || craftJobName(recipe) };
  };
  const recommendedCraftScripCollectible = ticket => craftScripCollectibleCandidates(ticket)
    .map(craftScripCollectibleCost)
    .filter(spec => spec.ready && Number(spec.perScrip) > 0)
    .sort((left, right) => left.perScrip - right.perScrip)[0] || null;
  // 工票兑换价不是市场价：由该票种当前最低成本收藏品换算为 Gil。
  const craftScripExchangeGilCost = route => {
    const recommendation = recommendedCraftScripCollectible(route.ticket);
    if (!recommendation) return { recommendation: null, perTicket: null, total: null, unit: null };
    const perTicket = Number(recommendation.perScrip || 0);
    const total = perTicket * Number(route.ticketCost || 0);
    const unit = total / Math.max(1, Number(route.outputQuantity || 1));
    return { recommendation, perTicket, total, unit };
  };
  const equipmentBaseMaterials = () => {
    const cacheKey = [state.equipmentCombatTier, state.equipmentGatheringTier].join('|');
    const cached = guideIndexCache.equipment.get(cacheKey);
    if (cached) return data.m.filter(material => cached.has(String(material.uid)));
    const required = new Set();
    const activeTypes = new Set([state.equipmentCombatTier, state.equipmentGatheringTier].filter(Boolean));
    data.r.filter(item => activeTypes.has(item.t)).forEach(item => {
      baseIngredients(item).forEach(({ material }) => { if (material && !isCrystal(material)) required.add(String(material.uid)); });
    });
    guideIndexCache.equipment.set(cacheKey, required);
    return data.m.filter(material => required.has(String(material.uid))).sort((left, right) => Number(left.uid) - Number(right.uid));
  };
  const submarineCatalogIds = () => {
    if (guideIndexCache.catalog) return guideIndexCache.catalog;
    const ids = new Set(), visiting = new Set();
    const visit = uid => {
      uid = String(uid); if (visiting.has(uid)) return;
      visiting.add(uid);
      const node = recipeCandidatesFor(uid)[0];
      if (node) for (let index = 0; index < node.a.length; index += 2) { const child = Number(node.a[index]); if (child > 0) { ids.add(String(child)); visit(child); } }
      visiting.delete(uid);
    };
    (submarineData.parts || []).forEach(part => visit(part.id));
    guideIndexCache.catalog = ids;
    return ids;
  };
  const equipmentCatalogIds = () => {
    const ids = new Set();
    Object.values(baseMaterials.b || {}).forEach(inputs => {
      for (let index = 0; index < inputs.length; index += 2) {
        const uid = Number(inputs[index]); if (uid > 0) ids.add(String(uid));
      }
    });
    return ids;
  };
  // 索引声明超出实际配方范围时只记录待维护项，绝不据此扩充推荐材料目录。
  const sourceScopeAudit = () => {
    const equipment = equipmentCatalogIds(), submarine = submarineCatalogIds(), warnings = [];
    Object.entries(materialSources).forEach(([uid, source]) => {
      if (source.equipmentKinds?.length && !equipment.has(String(uid))) warnings.push({ uid: String(uid), name: source.name, scope: 'equipment' });
      if ((source.nativeSubmarineKinds?.length || source.submarineKinds?.length || source.npc) && !submarine.has(String(uid))) warnings.push({ uid: String(uid), name: source.name, scope: 'submarine' });
    });
    return warnings;
  };
  const materialSourceAudit = sourceScopeAudit();
  const verifiedClassificationAudit = () => {
    const equipment = equipmentCatalogIds(), submarine = submarineCatalogIds();
    const entries = [...new Set([...equipment, ...submarine])].map(uid => {
      const source = materialSources[uid] || {}, fallback = baseMaterials.k?.[uid] || '常规采集品';
      const equipmentKind = source.verified?.equipment || source.equipmentKinds?.[0] || fallback;
      const submarineKind = source.verified?.submarine || source.nativeSubmarineKinds?.[0] || source.submarineKinds?.[0] || (equipmentKind === '神典石材料' ? '军票兑换' : equipmentKind === '灵砂' ? '限时采集品' : equipmentKind);
      return { uid, name: source.name || data.m.find(item => String(item.uid) === uid)?.n || uid, equipment: equipment.has(uid) ? equipmentKind : null, submarine: submarine.has(uid) ? submarineKind : null, verified: Boolean(source.verified), sources: source.verified?.sources || [], status: source.verified ? '已核验' : '待核验' };
    });
    return { scopeWarnings: materialSourceAudit, verified: entries.filter(entry => entry.verified), pending: entries.filter(entry => !entry.verified) };
  };
  window.FF14_MATERIAL_SOURCE_AUDIT = verifiedClassificationAudit();
  if (materialSourceAudit.length) console.warn('材料来源索引存在未被配方引用的待维护项：', materialSourceAudit);
  const submarineBaseMaterials = () => {
    const cached = guideIndexCache.submarine;
    if (cached) return data.m.filter(material => cached.has(String(material.uid)) && !isCrystal(material)).sort((left, right) => Number(left.uid) - Number(right.uid));
    const parts = new Set((submarineData.parts || []).map(part => String(part.id)));
    const required = new Set([...submarineCatalogIds()].filter(uid => {
      if (parts.has(String(uid))) return false;
      const material = data.m.find(item => String(item.uid) === String(uid));
      const isMarketableIntermediate = Boolean(
        material && recipeCandidatesFor(uid).length &&
        (Number(material.mp || 0) > 0 || directPurchaseAverage(material) > 0)
      );
      // 配方叶子、已有来源分类的半成品，以及实际被潜水艇配方使用且可市场采购的半成品均可进入推荐名录。
      // 不能遍历全部来源索引，否则会把装备专用材料错误加入潜水艇。
      return Boolean(npcCandidate(uid) || materialSources[String(uid)]?.nativeSubmarineKinds?.length || materialSources[String(uid)]?.submarineKinds?.length || exchangeRoutesFor(uid).length || !recipeNodeFor(uid) || isMarketableIntermediate);
    }));
    // 薰衣草与风茄虽不是船体配方的叶子材料，却是兑换采购的必要凭证。
    // 将它们纳入同一名录，用户可从材料行记录当次凭证价格。
    voucherCarrierIds.forEach(uid => required.add(String(uid)));
    guideIndexCache.submarine = required;
    return data.m.filter(material => required.has(String(material.uid)) && !isCrystal(material)).sort((left, right) => Number(left.uid) - Number(right.uid));
  };
  const submarineNpcMaterials = () => Object.values(npcMaterialByUid())
    .map(spec => data.m.find(material => String(material.uid) === spec.uid))
    .filter(material => material && recommendedNpcMaterial(material))
    .sort((left, right) => Number(left.uid) - Number(right.uid));
  const submarineNpcComparisons = () => Object.values(npcMaterialByUid()).map(spec => npcComparison(spec.uid)).filter(Boolean).sort((left, right) => Number(left.uid) - Number(right.uid));
  const materialMembership = material => {
    const uid = String(material.uid), cached = guideIndexCache.membership.get(uid);
    if (cached) return cached;
    const labels = [];
    if (equipmentBaseMaterials().some(item => String(item.uid) === String(material.uid))) labels.push('装备推荐材料');
    if (submarineBaseMaterials().some(item => String(item.uid) === String(material.uid)) || npcCandidate(material)) labels.push('潜水艇推荐材料');
    if (leveBaseMaterials().some(item => String(item.uid) === String(material.uid))) labels.push('理符推荐材料');
    if (craftScripRoutesFor(material.uid).length) labels.push('工票材料');
    guideIndexCache.membership.set(uid, labels);
    return labels;
  };
  const sourceKinds = (material, scope) => {
    const source = materialSources[String(material.uid)] || {};
    const verified = source.verified?.[scope];
    const kinds = scope === 'equipment' ? source.equipmentKinds || [] : source.nativeSubmarineKinds || source.submarineKinds || [];
    return [verified, ...kinds].filter(Boolean);
  };
  // 分类由同步后的基础素材索引明确给出；旧数据或外部新增材料才回退到常规采集品。
  const basicKind = material => craftScripRoutesFor(material.uid).length
    ? '能工巧匠工票兑换'
    : sourceKinds(material, 'equipment')[0] || baseMaterials.k?.[String(material.uid)] || '常规采集品';
  // 潜水艇推荐材料按业务约定的单一主分类显示；同一物品的其它获取途径保留为备注。
  const submarineKindPriority = ['NPC 购买材料', '常规采集品', '军票兑换', '薰衣草/风茄兑换', '天穹票兑换', '限时采集品', '怪物掉落', '潜水艇携带材料'];
  const submarineKind = material => {
    return submarineSourceChoice(material).kind;
  };
  const submarineSourceStatus = material => npcCandidate(material) || sourceKinds(material, 'submarine').length || baseMaterials.k?.[String(material.uid)] || material.hqHelperTrade ? '已确认来源' : '待确认来源';
  const otherSearchResults = query => {
    const value = String(query || '').trim().toLowerCase();
    if (!value) return [];
    const current = data.m.filter(material => String(material.uid).includes(value) || material.n.toLowerCase().includes(value));
    const indexed = itemIndex()
      .filter(([uid, name]) => String(uid).includes(value) || String(name).toLowerCase().includes(value))
      .slice(0, 100)
      .map(([uid, n]) => data.m.find(material => String(material.uid) === String(uid)) || { id: 'other-' + uid, uid: String(uid), n, c: 0, mp: 0, u: '' });
    return [...new Map([...current, ...indexed].map(material => [String(material.uid), material])).values()];
  };
  const basicMaterialSearchResults = query => {
    const value = String(query || '').trim().toLowerCase();
    if (!value) return [];
    const ranges = [
      { key: 'equipment', label: '装备推荐材料', materials: equipmentBaseMaterials(), kind: basicKind },
      { key: 'submarine', label: '潜水艇推荐材料', materials: submarineBaseMaterials().filter(showSubmarineGuideMaterial), kind: submarineGuideKind },
      { key: 'leve', label: '理符推荐材料', materials: leveBaseMaterials(), kind: leveGuideKind },
      { key: 'scrip', label: '工票材料', materials: craftScripExchangeMaterials(), kind: material => craftScripRoutesFor(material.uid).map(route => craftScripTicketLabel(route.ticket)).join('／') },
      { key: 'other', label: '其他材料', materials: data.m.filter(material => otherMaterialIds.includes(String(material.uid))), kind: () => '已加入的其他材料' }
    ];
    return ranges.flatMap(range => range.materials
      .filter(material => String(material.uid).includes(value) || String(material.n || '').toLowerCase().includes(value))
      .map(material => ({ material, scope: range.key, scopeLabel: range.label, kind: range.kind(material) })))
      .sort((left, right) => Number(left.material.uid) - Number(right.material.uid));
  };
  const basicSearchCategoryKey = result => {
    if (result.scope === 'other') return '';
    if (result.scope === 'scrip') return '';
    if (result.scope === 'submarine' && result.kind === 'NPC 购买材料') return 'submarine-npc';
    return result.scope + '-' + result.kind;
  };
  const jumpToBasicMaterial = result => {
    state.basicCategory = result.scope;
    if (result.scope === 'scrip') state.craftScripTicket = craftScripRoutesFor(result.material.uid)[0]?.ticket || state.craftScripTicket;
    const categoryKey = basicSearchCategoryKey(result);
    if (categoryKey) state.guideCategories[categoryKey] = true;
    state.basicMaterialSearch = '';
    renderGuide();
    requestAnimationFrame(() => {
      const row = document.querySelector(`[data-guide-material-row="${result.scope}:${result.material.uid}"]`);
      if (!row) return;
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.add('material-search-hit');
      window.setTimeout(() => row.classList.remove('material-search-hit'), 1800);
    });
  };
  const addOtherMaterial = async material => {
    if (!data.m.some(row => String(row.uid) === String(material.uid))) data.m.push(material);
    if (!otherMaterialIds.includes(String(material.uid))) otherMaterialIds.push(String(material.uid));
    invalidateGuideIndexes();
    save();
    await refreshMarket(false, [data.m.find(row => String(row.uid) === String(material.uid))]);
  };
  async function refreshMarket(manual = false, requestedMaterials = null) {
    // 理符材料仅由当前方案或当前理符页显式传入，避免旧理符库遗留项继续参与全局市场请求。
    // NPC 材料也保留市场快照，才能在来源比价中与市场采购公平比较。
    const materials = (requestedMaterials || data.m).filter(material => material?.uid && !material.exchangeTicket && !material.marketExcluded && !isNonMarketSubmarineNode(material) && (requestedMaterials || !material.leveMaterial));
    if (!materials.length) return;
    if (window.materialRefreshRunning) return;
    window.materialRefreshRunning = true;
    state.marketRefreshing = true;
    const refreshPage = state.page, refreshView = state.guideView;
    if (state.page === 'guide' && state.guideView !== 'detail') renderGuide();
    try {
      const failed = [];
      const unavailable = [];
      const targetQuantity = 999;
      // HQ 与 NQ 都可作为材料来源。先读取中国范围均价；仅可能成为最低成本的材料才读取单独大区库存。
      const batchSize = 30;
      const validMarketListings = listings => (Array.isArray(listings) ? listings : [])
        .filter(listing => Number(listing.pricePerUnit) > 0 && Number(listing.quantity) > 0)
        .sort((left, right) => Number(left.pricePerUnit) - Number(right.pricePerUnit));
      const weightedListingPrice = (listings, limit = targetQuantity, useChinaFiftyListingRule = false) => {
        const valid = validMarketListings(listings);
        const firstFifty = valid.slice(0, 50);
        const firstFiftyQuantity = firstFifty.reduce((sum, listing) => sum + Number(listing.quantity || 0), 0);
        const sampledListings = useChinaFiftyListingRule && valid.length > 50 && firstFiftyQuantity < targetQuantity ? firstFifty : valid;
        let remaining = limit, quantity = 0, total = 0;
        sampledListings.forEach(listing => {
          if (remaining <= 0) return;
          const used = Math.min(remaining, Number(listing.quantity));
          quantity += used;
          total += Number(listing.pricePerUnit) * used;
          remaining -= used;
        });
        return quantity > 0 ? { price: total / quantity, quantity, cappedAtFifty: sampledListings === firstFifty } : null;
      };
      const npcMarketSnapshot = (listings, npcPrice) => {
        const eligible = validMarketListings(listings).filter(listing => marketComparisonCost(listing.pricePerUnit) < npcPrice);
        const eligibleQuantity = eligible.reduce((sum, listing) => sum + Number(listing.quantity || 0), 0);
        const sampled = weightedListingPrice(eligible, MARKET_NPC_STOCK_THRESHOLD);
        return {
          eligibleQuantity,
          rawPrice: Number(sampled?.price || 0),
          comparisonPrice: marketComparisonCost(sampled?.price),
          status: sampled ? 'checked' : 'no-listings'
        };
      };
      const listingSummary = listings => (Array.isArray(listings) ? listings : [])
        .filter(listing => Number(listing.pricePerUnit) > 0 && Number(listing.quantity) > 0)
        .sort((left, right) => Number(left.pricePerUnit) - Number(right.pricePerUnit) || Number(right.quantity) - Number(left.quantity))
        .slice(0, 10)
        .map(listing => ({ pricePerUnit: Number(listing.pricePerUnit), quantity: Number(listing.quantity), hq: Boolean(listing.hq), retainerName: String(listing.retainerName || ''), worldName: String(listing.worldName || '') }));
      const requestMarket = async url => {
        let lastError = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          let timeout = null;
          try {
            const controller = new AbortController();
            timeout = setTimeout(() => controller.abort(), 15000);
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) throw new Error(`市场请求失败（${response.status}）`);
            return await response.json();
          } catch (error) {
            lastError = error;
            if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 450));
          } finally {
            if (timeout) clearTimeout(timeout);
          }
        }
        throw lastError;
      };
      for (let index = 0; index < materials.length; index += batchSize) {
        const batch = materials.slice(index, index + batchSize);
        try {
          const ids = batch.map(item => item.uid).join(',');
          const chinaBody = await requestMarket('https://universalis.app/api/v2/China/' + ids + '?listings=999&entries=0');
          const chinaItems = chinaBody.items || (chinaBody.itemID ? { [String(chinaBody.itemID)]: chinaBody } : {});
          const refreshedAt = new Date().toLocaleString('zh-CN');
          batch.forEach(material => {
            const info = chinaItems[String(material.uid)];
            const sampled = weightedListingPrice(info?.listings, targetQuantity, true);
            if (sampled) {
              material.mp = sampled.price;
              material.u = refreshedAt;
              material.marketStatus = 'listing-weighted';
              material.marketSampleQuantity = sampled.quantity;
              material.marketSampleTarget = sampled.cappedAtFifty ? 50 : targetQuantity;
              material.marketListings = listingSummary(info.listings);
            } else {
              material.marketStatus = info ? 'no-listings' : 'not-found';
              delete material.marketListings;
              if (!material.u) material.u = refreshedAt;
              unavailable.push(material.uid);
            }
          });
          invalidatePlans();
          const needsDataCenterCheck = (material, npcPrice) => {
            const market = marketComparisonCost(material.mp);
            if (!(market > 0) || market >= npcPrice) return { required: false, reason: `中国区税后市场均价 ${money(material.mp)} × 1.05 不低于 NPC ${money(npcPrice)}` };
            const costs = [];
            if (recipeCandidatesFor(material.uid).length) costs.push(Number(selfCraftUnitCost(material.uid) || 0));
            if (leveRecipeNode(material.uid)) costs.push(Number(leveRecipeUnitCost(material.uid, new Set(), false) || 0));
            const self = Math.min(...costs.filter(cost => cost > 0));
            if (Number.isFinite(self) && market >= self) return { required: false, reason: `中国区税后市场均价 ${money(material.mp)} × 1.05 不低于自制配方 ${money(self)}` };
            return { required: true };
          };
          const candidateMaterials = batch.filter(material => {
            const npcPrices = [...new Set([
              Number(npcCandidate(material)?.price || 0),
              Number(leveSourceRecord(material.uid)?.npc?.price || 0)
            ].filter(price => price > 0))];
            material.marketNpcSnapshots = Object.fromEntries(npcPrices.map(npcPrice => {
              const check = needsDataCenterCheck(material, npcPrice);
              return [marketNpcSnapshotKey(npcPrice), check.required ? { status: 'pending-data-center', checkedAt: refreshedAt } : { status: 'not-required', checkedAt: refreshedAt, reason: check.reason }];
            }));
            return Object.values(material.marketNpcSnapshots).some(snapshot => snapshot.status === 'pending-data-center');
          });
          const candidateIds = candidateMaterials.map(material => material.uid).join(',');
          const dataCenters = candidateIds ? await Promise.all(CHINA_MARKET_DATA_CENTERS.map(async name => {
            try {
              const body = await requestMarket('https://universalis.app/api/v2/' + encodeURIComponent(name) + '/' + candidateIds + '?listings=999&entries=0');
              return { name, items: body.items || (body.itemID ? { [String(body.itemID)]: body } : {}), unresolved: body.unresolvedItems || [] };
            } catch (error) { return { name, error }; }
          })) : [];
          candidateMaterials.forEach(material => {
            const perDataCenter = {};
            dataCenters.forEach(dataCenter => {
              if (dataCenter.error) { perDataCenter[dataCenter.name] = { status: 'error', updatedAt: refreshedAt }; return; }
              const info = dataCenter.items[String(material.uid)];
              const sample = weightedListingPrice(info?.listings);
              perDataCenter[dataCenter.name] = sample
                ? { status: 'listing-weighted', price: sample.price, quantity: sample.quantity, listingCount: validMarketListings(info.listings).length, updatedAt: refreshedAt }
                : { status: info ? 'no-listings' : 'not-found', quantity: 0, updatedAt: refreshedAt };
              failed.push(...dataCenter.unresolved.map(String));
            });
            material.marketDataCenters = perDataCenter;
            Object.entries(material.marketNpcSnapshots).forEach(([key, snapshot]) => {
              if (snapshot.status !== 'pending-data-center') return;
              const npcPrice = Number(key);
              snapshot.status = 'checked';
              snapshot.dataCenters = Object.fromEntries(CHINA_MARKET_DATA_CENTERS.map(name => {
                const entry = perDataCenter[name];
                if (entry?.status === 'error') return [name, { status: 'error', eligibleQuantity: 0, updatedAt: refreshedAt }];
                const info = dataCenters.find(dataCenter => dataCenter.name === name)?.items?.[String(material.uid)];
                return [name, { ...npcMarketSnapshot(info?.listings, npcPrice), updatedAt: refreshedAt }];
              }));
            });
          });
          failed.push(...(chinaBody.unresolvedItems || []).map(String));
        } catch (error) {
          batch.forEach(material => {
            material.marketStatus = Number(material.mp) > 0 ? 'stale' : 'no-listings';
          });
          failed.push(...batch.map(material => String(material.uid)));
        }
        // 每批最多 30 项；四大区库存只针对可能成为最低成本的材料请求。
        if (index + batchSize < materials.length) await new Promise(resolve => setTimeout(resolve, 140));
      }
      localStorage.setItem('ff14-market-refreshed-at', String(Date.now()));
      invalidateNpcMaterials();
      ensureSubmarineMaterials();
      syncPurchaseCosts();
      save();
      const notices = [];
      if (failed.length) notices.push(`刷新失败：${[...new Set(failed)].join('、')}，已保留原有快照`);
      if (unavailable.length) notices.push(`无市场数据：${[...new Set(unavailable)].join('、')}`);
      state.marketMessage = notices.join('；');
    } catch (error) {
      state.marketMessage = '市场价格刷新失败，已保留最近一次市场快照。';
      if (manual) alert('市场价格刷新失败，请稍后重试。');
    } finally {
      window.materialRefreshRunning = false;
      state.marketRefreshing = false;
      if (state.page === refreshPage && state.guideView === refreshView && state.page === 'guide' && state.guideView !== 'detail') renderGuide();
      else if (state.page === refreshPage && state.page === 'trade') renderTrade();
    }
  }
  function visibleGuideMarketMaterials() {
    if (state.basicCategory === 'crystals') return data.m.filter(material => isCrystal(material));
    const materials = guideMaterials();
    if (state.basicCategory === 'other') return materials;
    if (state.basicCategory === 'scrip') return materials;
    const prefix = state.basicCategory + '-';
    const openKinds = Object.entries(state.guideCategories).filter(([key, open]) => open && key.startsWith(prefix)).map(([key]) => key.slice(prefix.length));
    const visible = !openKinds.length ? [] : materials.filter(material => {
      if (state.basicCategory !== 'submarine' && state.basicCategory !== 'leve') return openKinds.includes(basicKind(material));
      const kind = state.basicCategory === 'leve' ? leveGuideKind(material) : submarineGuideKind(material);
      return openKinds.includes(kind) ||
        (state.basicCategory === 'submarine' && state.guideCategories['submarine-npc'] && kind === 'NPC 购买材料');
    });
    const carriers = state.basicCategory === 'submarine'
      ? Object.keys(exchangeSources.carriers || {}).map(uid => data.m.find(material => String(material.uid) === uid)).filter(Boolean)
      : [];
    return [...new Map([...visible, ...carriers].map(material => [String(material.uid), material])).values()];
  }
  function maybeRefreshMarket() {
    const last = Number(localStorage.getItem('ff14-market-refreshed-at') || 0);
    if (Date.now() - last < 3 * 60 * 60 * 1000 || state.marketRefreshTimer) return;
    state.marketRefreshTimer = setTimeout(() => {
      state.marketRefreshTimer = null;
      if (state.page === 'guide' && state.guideView !== 'detail') refreshMarket(false, visibleGuideMarketMaterials());
    }, 350);
  }
  const retainerInfo = materialOrUid => retainerData[String(typeof materialOrUid === 'object' ? materialOrUid?.uid : materialOrUid)];
  const retainerSummary = info => {
    const [ability, quantity] = info.quantities.at(-1) || [];
    const [level, minutes] = info.times.at(-1) || [];
    return `雇员：鉴别力 ${ability} · ${quantity}个 / ${level}级 · ${minutes}分钟`;
  };
  function decorateRetainerNotes(root) {
    const knownMaterials = [...data.m].sort((left, right) => right.n.length - left.n.length);
    root.querySelectorAll('table.ledger').forEach(table => {
      if (!table.tHead?.textContent.includes('市场平均价')) return;
      table.tBodies[0]?.querySelectorAll('tr').forEach(row => {
        const cell = row.querySelector('td.label');
        const material = cell && knownMaterials.find(item => cell.textContent.includes(item.n));
        const info = material && retainerInfo(material);
        if (!info || cell.querySelector('[data-retainer]')) return;
        const note = document.createElement('small');
        note.className = 'meta'; note.textContent = ' · ' + retainerSummary(info);
        const button = document.createElement('button');
        button.className = 'section-toggle'; button.dataset.retainer = material.uid; button.textContent = '雇员探险';
        button.onclick = () => openRetainerDetail(material.uid);
        cell.append(note, button);
      });
    });
  }
  function decorateSourceNotes(root) {
    if (state.basicCategory !== 'submarine') return;
    const knownMaterials = [...data.m].sort((left, right) => right.n.length - left.n.length);
    root.querySelectorAll('table.ledger').forEach(table => {
      if (!table.tHead?.textContent.includes('市场平均价')) return;
      table.tBodies[0]?.querySelectorAll('tr').forEach(row => {
        const material = knownMaterials.find(item => row.querySelector('td.label')?.textContent.includes(item.n));
        const choice = material && submarineSourceChoice(material);
        if (!choice?.options?.length || row.children[1]?.querySelector('.source-note')) return;
        const alternatives = [...new Set(choice.options.filter(option => option.key !== choice.key && Number(option.price) > 0).map(option => option.label))];
        if (!alternatives.length) return;
        const note = document.createElement('small');
        note.className = 'meta source-note'; note.textContent = ' · 可比价：' + alternatives.join('、');
        row.children[1].append(note);
      });
    });
  }
  function openRetainerDetail(uid) {
    const material = data.m.find(item => String(item.uid) === String(uid)), info = retainerInfo(uid);
    if (!material || !info) return;
    const quantityRows = info.quantities.map(([ability, quantity], index) => `<tr><td>${index ? '鉴别力' : '获得力'}</td><td>${ability}</td><td>${quantity} 个</td></tr>`).join('');
    const timeRows = info.times.map(([level, minutes]) => `<tr><td>${level} 级</td><td>${minutes} 分钟</td></tr>`).join('');
    document.querySelector('#bundle-detail-meta').textContent = '材料指导价 > 雇员探险';
    document.querySelector('#bundle-detail-title').textContent = material.n + '雇员探险';
    document.querySelector('#bundle-detail-content').innerHTML = `<div class="cards"><div class="card"><small>雇员职业</small><b>${info.job}</b></div><div class="card"><small>探险类型</small><b>${info.venture}</b></div></div><div class="detail-columns"><section class="detail-column"><h3>能力与筹集数量</h3><div class="note">第一项为获得力；后续档位为鉴别力。</div><div class="table-wrap history-table"><table class="ledger"><thead><tr><th>能力类型</th><th>所需能力</th><th>筹集数量</th></tr></thead><tbody>${quantityRows}</tbody></table></div></section><section class="detail-column"><h3>雇员等级与筹集时间</h3><div class="table-wrap history-table"><table class="ledger"><thead><tr><th>雇员等级</th><th>筹集时间</th></tr></thead><tbody>${timeRows}</tbody></table></div></section></div>`;
    if (!document.querySelector('#bundle-detail-dialog').open) document.querySelector('#bundle-detail-dialog').showModal();
  }
  function renderGuide() {
    const root = document.querySelector('#guide');
    if (state.guideView === 'detail') return renderPurchaseDetail();
    if (state.basicCategory === 'other' || state.basicCategory === 'leve') { loadItemIndex(); loadItemIconIndex(); }
    const crystals = state.basicCategory === 'crystals';
    const colors = { 火:'#df675c', 冰:'#62b9d7', 风:'#53ae72', 土:'#a98252', 雷:'#9672ce', 水:'#4a8bd8' };
    const fallbackCrystalIcon = element => `<svg class="crystal-icon" viewBox="0 0 32 38" aria-hidden="true"><path fill="${colors[element]}" d="M16 1 29 14 22 35H10L3 14Z"/><path fill="#fff8" d="m16 1 8 13-8 5z"/><path fill="#0002" d="m16 19 6 16H10z"/></svg>`;
    // 水晶与其他物品共用 HqHelper 的 NBB 图标机制；SVG 仅作 CDN 不可用时回退。
    const crystalIcon = (material, element) => {
      const gameIcon = `<img class="item-icon crystal-game-icon" src="assets/crystal-icons/${Number(material.uid)}.png" alt="" loading="eager" decoding="async" onerror="this.hidden=true;this.nextElementSibling.hidden=false">`;
      const fallback = fallbackCrystalIcon(element).replace('aria-hidden="true"', 'aria-hidden="true" hidden');
      return `<span class="crystal-image">${gameIcon}${fallback}</span>`;
    };
    const crystalTitleIcon = (material, element) => `<span class="crystal-title-image"><img class="crystal-element-icon" src="assets/element-icons/${crystalElementIcons[element]}.png" alt="" loading="eager" decoding="async" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="crystal-title-fallback" hidden>${crystalIcon(material, element)}</span></span>`;
    if (crystals) {
      const crystalCards = crystalSpecs.map(([element, shard, crystal, cluster]) => {
        const materialsById = new Map(data.m.map(material => [String(material.uid), material]));
        // 不依赖材料主数据的插入顺序；每种属性固定为碎晶、水晶、晶簇。
        const list = [shard, crystal, cluster].map(uid => materialsById.get(String(uid))).filter(Boolean);
        const titleMaterial = list[1] || list[0];
        return `<article class="crystal-card" style="--element:${colors[element]}"><h2>${crystalTitleIcon(titleMaterial, element)}${element}属性水晶</h2><table class="crystal-table"><tbody>${list.map(material => `<tr><td><div class="crystal-name">${crystalIcon(material, element)}<span>${material.n}<small class="crystal-tier"> · ${material.n.replace(element + '之','')}</small></span></div></td><td><small class="crystal-tier">市场平均价</small><br><span class="crystal-price">${marketPriceLabel(material)}</span></td><td><small class="crystal-tier">采购均价</small><br><b>${purchaseAverage(material) ? money(purchaseAverage(material)) : '未采购'}</b></td><td><button class="btn secondary" data-purchase="${material.id}">采购</button></td></tr>`).join('')}</tbody></table></article>`;
      }).join('');
      const crystalTabs = `<div class="basic-range-toolbar"><div class="basic-range-tabs" role="tablist" aria-label="材料范围"><button type="button" role="tab" data-basic-category="equipment">装备推荐材料</button><button type="button" role="tab" data-basic-category="submarine">潜水艇推荐材料</button><button type="button" role="tab" data-basic-category="leve">理符推荐材料</button><button type="button" role="tab" data-basic-category="crystals" class="active" aria-selected="true">水晶价格</button><button type="button" role="tab" data-basic-category="scrip">工票材料</button><button type="button" role="tab" data-basic-category="other">其他材料</button></div></div>`;
      root.innerHTML = `<div class="header"><div><div class="meta">材料指导价 &gt; 水晶价格</div><h1>水晶价格</h1><div class="sub">市场参考价为 Universalis 中国区 HQ／NQ 挂单的加权价，已含 5% 市场税：最多按前 999 个材料加权；挂单超过 50 条但前 50 条未达 999 个时，仅取前 50 条。</div></div><button id="refresh-market" class="btn${state.marketRefreshing ? ' refreshing' : ''}" ${state.marketRefreshing ? 'disabled' : ''}>${state.marketRefreshing ? '刷新中…' : '统一刷新市场价'}</button></div>${state.marketMessage ? '<div class="status">'+state.marketMessage+'</div>' : ''}${crystalTabs}<div class="crystal-grid">${crystalCards}</div>`;
      root.querySelector('#refresh-market').onclick = () => refreshMarket(true);
      root.querySelectorAll('[data-purchase]').forEach(button => button.onclick = () => { const material = data.m.find(item => item.id === button.dataset.purchase); if (material) openPurchaseManager(material); });
      root.querySelectorAll('[data-basic-category]').forEach(button => button.onclick = () => { state.basicCategory = button.dataset.basicCategory; renderGuide(); });
      maybeRefreshMarket();
      return;
    }
    const materials = guideMaterials();
    const materialTable = list => `<div class="guide-material-grid">${list.map(material => {
      const sourceAware = state.basicCategory === 'submarine' || state.basicCategory === 'leve';
      const choice = state.basicCategory === 'leve' ? leveGuideChoice(material.uid) : sourceAware ? submarineSourceChoice(material) : null;
      const recommendation = sourceAware && (state.basicCategory === 'leve'
        ? leveGuideKind(material) !== '常规采集品'
        : showSubmarineRecommendationTag(material)) ? recommendationTag(choice) : '';
      const scripTags = state.basicCategory === 'equipment'
        ? craftScripRoutesFor(material.uid).map(route => `<span class="scrip-ticket ${route.ticket}">${route.ticket === 'orange' ? '橙票兑换' : '紫票兑换'}</span>`).join('')
        : '';
      const name = itemLabelMarkup(material.uid, material.n) + scripTags;
      const comparable = state.basicCategory === 'leve' ? choice.options?.filter(option => Number(option.price) > 0).length >= 2 : hasComparableSubmarineSources(material);
      const detailAttribute = state.basicCategory === 'leve' ? 'data-leve-source-detail' : 'data-source-detail';
      const label = sourceAware && (comparable || recipeCandidatesFor(material.uid).length || leveRecipeNode(material.uid))
        ? `<button class="bundle-link" ${detailAttribute}="${material.uid}">${name}${recommendation}</button>`
        : `${name}${recommendation}`;
      return `<article class="guide-material-card" data-guide-material-row="${state.basicCategory}:${material.uid}"><div class="guide-material-card-title">${label}</div><dl class="guide-material-prices"><div><dt>市场价格参考</dt><dd>${marketPriceLabel(material)}</dd></div><div><dt>采购平均价</dt><dd>${purchaseAverage(material) ? money(purchaseAverage(material)) : '未采购'}</dd></div></dl><button class="btn secondary guide-material-purchase" data-purchase="${material.id}">采购价格</button></article>`;
    }).join('') || '<div class="empty">暂无材料</div>'}</div>`;
    // “其他材料”搜索结果仍需要显示已有归属；普通分类卡片不再计算或展示该信息。
    const membershipTags = material => materialMembership(material).map(label => `<span class="material-tag">${label}</span>`).join('') || '<span class="meta">未添加</span>';
    const npcTable = (list, scope = 'submarine') => `<div class="table-wrap"><table class="ledger npc-material-table"><thead><tr><th>材料</th><th>NPC 售卖价</th><th>市场价格参考</th><th>采购平均价</th><th>自制价</th><th>购买渠道</th><th>记录采购</th></tr></thead><tbody>${list.map(material => {
      const leve = scope === 'leve', record = leve ? leveSourceRecord(material.uid) : null;
      const spec = leve ? record?.npc : npcCandidate(material), comparison = leve ? null : npcComparison(material.uid);
      const purchase = purchaseAverage(material), craftable = leve ? Boolean(leveRecipeNode(material.uid)) : comparison?.hasCraftRoute;
      const self = leve ? (craftable ? leveRecipeUnitCost(material.uid, new Set(), false) : null) : comparison?.self;
      const choice = leve ? leveGuideChoice(material.uid) : submarineSourceChoice(material);
      const recommendation = recommendationTag(choice), name = itemLabelMarkup(material.uid, material.n);
      const comparable = leve ? choice.options?.filter(option => Number(option.price) > 0).length >= 2 : hasComparableSubmarineSources(material);
      const label = comparable
        ? `<button class="bundle-link" ${leve ? `data-leve-source-detail="${material.uid}"` : `data-source-detail="${material.uid}"`}>${name}${recommendation}</button>`
        : `${name}${recommendation}`;
      const source = spec?.source || '—';
      return `<tr class="npc-row" data-guide-material-row="${scope}:${material.uid}"><td class="label">${label}</td><td>${Number(spec?.price) > 0 ? money(spec.price) : '待核验'}</td><td>${marketNpcPriceLabel(material, spec)}</td><td>${purchase > 0 ? money(purchase) : '未采购'}</td><td>${craftable ? (self == null ? '等待市场价' : money(self)) : '—'}</td><td class="label">${source}</td><td><button class="btn secondary" data-purchase="${material.id}">记录采购</button></td></tr>`;
    }).join('') || '<tr><td colspan="7" class="empty">暂无 NPC 固定材料</td></tr>'}</tbody></table></div>`;
    const categoryTables = state.basicCategory === 'equipment' ? ['常规采集品', '限时采集品', '灵砂', '神典石材料', '怪物掉落', '能工巧匠工票兑换'].map(kind => {
      const list = materials.filter(material => basicKind(material) === kind), key = 'equipment-' + kind;
      if (kind !== '能工巧匠工票兑换') return `<details class="material-category" data-material-category="${key}" ${state.guideCategories[key] ? 'open' : ''}><summary>${kind}<span>${list.length} 项 · 点击展开</span></summary>${state.guideCategories[key] ? materialTable(list) : ''}</details>`;
      return `<details class="material-category" data-material-category="${key}" ${state.guideCategories[key] ? 'open' : ''}><summary>${kind}<span>${list.length} 项 · 点击展开</span></summary>${state.guideCategories[key] ? materialTable(list) : ''}</details>`;
    }).join('') : '';
    const craftScripMaterialTable = (ticket, list = craftScripExchangeMaterials(ticket), emptyText = '此票种暂无已收录兑换材料。') => {
      return `<div class="table-wrap"><table class="ledger"><thead><tr><th>材料</th><th>兑换比例</th><th>兑换价</th><th>市场平均价</th><th>采购平均价</th></tr></thead><tbody>${list.map(material => {
        const routes = craftScripRoutesFor(material.uid, ticket);
        const ratio = routes.map(route => `${craftScripTicketLabel(route.ticket)} ×${route.ticketCost} → ${material.n} ×${route.outputQuantity || 1}`).join('<br>');
        const costs = routes.map(route => { const cost = craftScripExchangeGilCost(route); return cost.unit == null ? '等待补价' : `${money(cost.unit)}<small class="meta">（${money(cost.perTicket)} × ${route.ticketCost} ÷ ${route.outputQuantity}）</small>`; }).join('<br>');
        return `<tr data-guide-material-row="scrip:${material.uid}"><td class="label">${itemLabelMarkup(material.uid, material.n)}</td><td class="label">${ratio}</td><td class="label">${costs}</td><td>${marketPriceLabel(material)}</td><td>${purchaseAverage(material) ? money(purchaseAverage(material)) : '未采购'}</td></tr>`;
      }).join('') || `<tr><td colspan="5" class="empty">${emptyText}</td></tr>`}</tbody></table></div>`;
    };
    const craftScripRecommendation = ticket => {
      const recommendation = recommendedCraftScripCollectible(ticket), label = craftScripTicketLabel(ticket), candidates = craftScripCollectibleCandidates(ticket);
      if (!recommendation) {
        const reasons = candidates.map(craftScripCollectibleCost).map(spec => spec.reason).filter(Boolean);
        const scope = craftScripTicket(ticket).scope || '常规收藏品';
        return `<article class="craft-scrip-recommendation ${ticket} pending"><div class="meta">${label}最低成本收藏品 · ${scope}</div><strong>${candidates.length ? '等待补价或资料补充' : '等待补充收藏品回报资料'}</strong><p>${reasons.length ? [...new Set(reasons)].join('；') : '资料包会在候选同时具备物品 ID、制作职业、配方、每批产出与最高档回报后，自动按每张票成本排序推荐。'}</p></article>`;
      }
      const material = data.m.find(item => String(item.uid) === String(recommendation.itemId));
      return `<article class="craft-scrip-recommendation ${ticket}"><div class="meta">${label}最低成本收藏品</div><button class="bundle-link" data-craft-collectible-detail="${recommendation.itemId}">${itemLabelMarkup(recommendation.itemId, material?.n || recommendation.name || recommendation.itemId)}</button><dl><div><dt>制作职业</dt><dd>${recommendation.job}</dd></div><div><dt>单件制作成本</dt><dd>${money(recommendation.unitCost)}</dd></div><div><dt>最高档回报</dt><dd>${recommendation.payout} 张</dd></div><div><dt>每张票成本</dt><dd>${money(recommendation.perScrip)}</dd></div></dl><p>${money(recommendation.batchCost)} ÷ ${recommendation.yieldCount} 个 ÷ ${recommendation.payout} 张</p></article>`;
    };
    const craftScripCatalog = () => {
      const grouped = new Map();
      ['orange', 'purple'].flatMap(craftScripCollectibleCandidates).map(craftScripCollectibleCost).forEach(spec => {
        const entries = grouped.get(spec.job) || [];
        entries.push(spec); grouped.set(spec.job, entries);
      });
      const rows = [...grouped.entries()].map(([job, entries]) => `<tr class="craft-scrip-job-row"><th colspan="7">${job}</th></tr>${entries.sort((left, right) => left.level - right.level).map(spec => {
        const status = spec.verified && spec.recipe ? (spec.ready ? '已核验' : '等待补价') : '待核验';
        return `<tr><td class="label"><button class="bundle-link" data-craft-collectible-detail="${spec.itemId}">${itemLabelMarkup(spec.itemId, spec.name)}</button></td><td><span class="scrip-ticket ${spec.ticket}">${craftScripTicketLabel(spec.ticket)}</span></td><td>${spec.level}</td><td>${spec.payout || '—'} 张</td><td>${spec.unitCost == null ? '等待补价' : money(spec.unitCost)}</td><td>${spec.perScrip == null ? '—' : money(spec.perScrip)}</td><td><span class="craft-scrip-status ${status === '已核验' ? 'verified' : 'pending'}">${status}</span></td></tr>`;
      }).join('')}`).join('');
      return `<details class="material-category craft-scrip-catalog"><summary>完整收藏品名录<span>八职业 · 56 项 · 点击展开</span></summary><div class="table-wrap"><table class="ledger"><thead><tr><th>收藏品</th><th>票种</th><th>等级</th><th>最高档回报</th><th>单件制作成本</th><th>每张票成本</th><th>资料状态</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="empty">暂无收藏品资料。</td></tr>'}</tbody></table></div></details>`;
    };
    const craftScripManualRows = craftScripManualRoutes();
    const craftScripManualPanel = craftScripManualRows.length ? `<details class="material-category craft-scrip-manual-panel"><summary>本机维护的兑换材料<span>${craftScripManualRows.length} 项 · 点击展开</span></summary><div class="table-wrap"><table class="ledger"><thead><tr><th>材料</th><th>票种</th><th>兑换比例</th><th>来源说明</th><th>状态</th><th>操作</th></tr></thead><tbody>${craftScripManualRows.map(route => `<tr><td class="label">${itemLabelMarkup(route.itemId, data.m.find(item => String(item.uid) === route.itemId)?.n || route.name || route.itemId)}</td><td><span class="scrip-ticket ${route.ticket}">${craftScripTicketLabel(route.ticket)}</span></td><td>${craftScripTicketLabel(route.ticket)} ×${route.ticketCost} → ${Number(route.outputQuantity)} 个</td><td class="label">${route.source || '未填写'}</td><td>${route.active ? '启用' : '停用'}</td><td><button class="btn secondary" data-craft-scrip-manual-edit="${route.id}">编辑</button> <button class="btn secondary" data-craft-scrip-manual-toggle="${route.id}">${route.active ? '停用' : '启用'}</button> <button class="btn secondary" data-craft-scrip-manual-delete="${route.id}">删除</button></td></tr>`).join('')}</tbody></table></div></details>` : '';
    const craftScripExchangeSection = ticket => {
      const all = craftScripExchangeMaterials(ticket);
      const equipmentIds = new Set(equipmentBaseMaterials().map(material => String(material.uid)));
      const used = all.filter(material => equipmentIds.has(String(material.uid)));
      const other = all.filter(material => !equipmentIds.has(String(material.uid)));
      const otherKey = `scrip-other-${ticket}`;
      return `<section class="material-category craft-scrip-exchanges"><div class="craft-scrip-exchange-heading"><div><b>${craftScripTicketLabel(ticket)}兑换材料</b><span>${used.length} 项当前装备可用 · ${other.length} 项其他材料 · Gil 兑换价按最低成本收藏品实时换算</span></div><button class="btn secondary" type="button" data-craft-scrip-manual-add="${ticket}">+ 添加${craftScripTicketLabel(ticket)}兑换材料</button></div><div class="craft-scrip-equipment-group"><div class="craft-scrip-group-label"><b>当前装备可用</b><span>当前 770／750 装备配方实际引用</span></div>${craftScripMaterialTable(ticket, used, '当前选择的 770／750 装备未使用该票种兑换材料。')}</div>${other.length ? `<details class="craft-scrip-subcategory" data-material-category="${otherKey}" ${state.guideCategories[otherKey] ? 'open' : ''}><summary>其他可兑换材料<span>${other.length} 项 · 点击展开</span></summary>${state.guideCategories[otherKey] ? craftScripMaterialTable(ticket, other) : ''}</details>` : ''}</section>`;
    };
    const craftScripContent = state.basicCategory === 'scrip' ? `<section class="craft-scrip-guide"><div class="craft-scrip-exchange-grid">${craftScripExchangeSection('orange')}${craftScripExchangeSection('purple')}</div><div class="craft-scrip-recommendations">${['orange', 'purple'].map(craftScripRecommendation).join('')}</div>${craftScripCatalog()}${craftScripManualPanel}</section>` : '';
    const searchResults = state.basicCategory === 'other' ? otherSearchResults(state.otherSearch) : [];
    // 未纳入预生成索引的“其他材料”只在实际搜索或已加入列表中请求一次 Garland 资料，
    // 不会在首次进入材料页时批量访问外站。
    if (state.basicCategory === 'other') {
      if (state.otherSearch) searchResults.forEach(material => fetchGarlandIcon(material.uid));
      materials.forEach(material => fetchGarlandIcon(material.uid));
    }
    const otherContent = state.basicCategory === 'other' ? `<div class="other-layout"><div class="card other-search-card"><div style="font-weight:700;margin-bottom:10px">搜索并加入其他材料</div><div class="sub">输入 Universalis 物品 ID 或中文名，例如：云杉原木 / 5395。</div><form id="other-material-form" style="display:flex;gap:8px;margin-top:12px"><input id="other-material-search" placeholder="材料 ID 或名称" value="${state.otherSearch}"><button class="btn">搜索</button></form>${state.otherSearch ? `<div class="table-wrap"><table class="ledger"><thead><tr><th>ID</th><th>材料</th><th>已归属</th><th>操作</th></tr></thead><tbody>${searchResults.map(material => { const stored = data.m.find(item => String(item.uid) === String(material.uid)) || { uid: material.uid, n: material.n }; const tags = membershipTags(stored); const joined = otherMaterialIds.includes(String(material.uid)); const used = materialMembership(stored).length; return `<tr><td>${material.uid}</td><td class="label">${itemLabelMarkup(material.uid, material.n)}</td><td>${tags}</td><td><button class="btn secondary" data-add-other="${material.uid}">${joined ? '已加入' : used ? '同时加入其他材料' : '加入'}</button></td></tr>`; }).join('') || `<tr><td colspan="4" class="empty">未找到相符道具，请确认名称或物品 ID。</td></tr>`}</tbody></table></div>` : ''}</div><div class="card other-added-card" style="padding:0"><div style="padding:12px 16px;font-weight:700;color:#244554">已加入的其他材料</div>${materials.length ? materialTable(materials) : '<div class="empty">尚未加入其他材料。可从左侧搜索结果中加入。</div>'}</div></div>` : '';
    const submarineKinds = ['市场采购半成品', '常规采集品', '军票兑换', '薰衣草/风茄兑换', '天穹票兑换', '限时采集品', '怪物掉落', '潜水艇携带材料'];
    const submarineGroups = state.basicCategory === 'submarine'
      ? materials.reduce((groups, material) => {
        const kind = submarineGuideKind(material);
        if (!groups.has(kind)) groups.set(kind, []);
        groups.get(kind).push(material);
        return groups;
      }, new Map(submarineKinds.map(kind => [kind, []])))
      : null;
    const submarineTables = state.basicCategory === 'submarine' ? submarineKinds.map(kind => {
      const list = (submarineGroups.get(kind) || []).sort((left, right) => {
        if (kind === '薰衣草/风茄兑换') {
          const leftVoucher = voucherCarrierIds.has(String(left.uid)), rightVoucher = voucherCarrierIds.has(String(right.uid));
          if (leftVoucher !== rightVoucher) return leftVoucher ? -1 : 1;
        }
        return Number(left.uid) - Number(right.uid);
      }), key = 'submarine-' + kind;
      const ticketSettingsPanel = kind === '天穹票兑换' ? `<form id="ticket-unit-cost-form" class="exchange-category-panel"><div class="sub" style="margin-top:14px">用于后续白钢、黄铜兑换成本预估；历史采购记录保留各自填写的票价快照。</div><label style="display:inline-grid;gap:5px;margin-top:10px">默认天穹票价格（G / 张）<input id="ticket-unit-cost" type="number" min="0.01" step="0.01" value="${ticketUnitCost()}"></label><div class="modal-actions" style="justify-content:flex-start;margin-top:10px"><button class="btn">保存默认价格</button><button type="button" id="reset-ticket-unit-cost" class="btn secondary">恢复 80 G / 张</button></div></form>` : '';
      return `<details class="material-category" data-material-category="${key}" ${state.guideCategories[key] ? 'open' : ''}><summary>${kind}<span>${list.length} 项 · 点击展开</span></summary>${state.guideCategories[key] ? ticketSettingsPanel + materialTable(list) : ''}</details>`;
    }).join('') : '';
    const npcCategoryKey = 'submarine-npc', npcOpen = state.guideCategories[npcCategoryKey] ?? true;
    const submarineContent = state.basicCategory === 'submarine' ? `<details class="material-category" data-material-category="${npcCategoryKey}" ${npcOpen ? 'open' : ''}><summary>NPC 购买材料<span>${submarineNpcMaterials().length} 项 · 固定价格</span></summary><div style="padding:0 16px 12px"><button id="manage-npc-materials" class="btn secondary">管理 NPC 材料</button></div>${npcTable(submarineNpcMaterials())}</details>${submarineTables}` : '';
    const leveKinds = ['NPC 购买材料', '市场采购半成品', '常规采集品', '限时采集品', '灵砂', '军票兑换', '薰衣草/风茄兑换', '天穹票兑换', '怪物掉落', '待核验'];
    const leveGroups = state.basicCategory === 'leve'
      ? materials.reduce((groups, material) => {
        const kind = leveGuideKind(material);
        if (!groups.has(kind)) groups.set(kind, []);
        groups.get(kind).push(material);
        return groups;
      }, new Map(leveKinds.map(kind => [kind, []])))
      : null;
    const leveTables = state.basicCategory === 'leve' ? leveKinds.map(kind => {
      const list = (leveGroups.get(kind) || []).sort((left, right) => Number(left.uid) - Number(right.uid));
      const key = 'leve-' + kind;
      return `<details class="material-category" data-material-category="${key}" ${state.guideCategories[key] ? 'open' : ''}><summary>${kind}<span>${list.length} 项 · 点击展开</span></summary>${state.guideCategories[key] ? (kind === 'NPC 购买材料' ? npcTable(list, 'leve') : materialTable(list)) : ''}</details>`;
    }).join('') : '';
    const leveContent = state.basicCategory === 'leve' ? `<div class="note">仅按所选方案中已加入理符的交付物配方递归汇总。交付成品不按市场价计入成本；下级材料采用当前最低有效来源。</div>${leveTables}` : '';
    const basicContent = state.basicCategory === 'submarine'
      ? submarineContent
      : state.basicCategory === 'leve' ? leveContent
      : state.basicCategory === 'scrip' ? craftScripContent
      : state.basicCategory === 'other' ? otherContent : categoryTables;
    const gradeSelects = state.basicCategory === 'equipment' ? `<div class="grade-selects"><label class="meta">战职装备品级<select id="combat-grade"><option value="770">770 HQ</option><option value="">无</option></select></label><label class="meta">生产采集装备品级<select id="gathering-grade"><option value="750">750 HQ</option><option value="">无</option></select></label></div>` : '';
    const leveGuidePlanValue = levePlans.some(plan => plan.id === state.leveGuidePlan) ? state.leveGuidePlan : '';
    const leveGuideSelects = state.basicCategory === 'leve' ? `<section class="leve-controls leve-guide-controls"><label>职业<select id="leve-guide-job"><option value="">全部职业</option>${(levequests.jobs || []).map(job => `<option value="${job}" ${job === state.leveGuideJob ? 'selected' : ''}>${job}</option>`).join('')}</select></label><label>方案<select id="leve-guide-plan"><option value="" ${!leveGuidePlanValue ? 'selected' : ''}>当前理符方案（${activeLevePlan().name}）</option>${levePlans.map(plan => `<option value="${plan.id}" ${plan.id === leveGuidePlanValue ? 'selected' : ''}>${plan.name}</option>`).join('')}</select></label><label>当前等级<input id="leve-guide-start" type="number" min="1" max="99" step="1" placeholder="不限" value="${state.leveGuideStart}"></label><label>目标等级<input id="leve-guide-target" type="number" min="2" max="100" step="1" placeholder="不限" value="${state.leveGuideTarget}"></label></section>` : '';
    const basicSearchResults = basicMaterialSearchResults(state.basicMaterialSearch);
    const basicSearchValue = String(state.basicMaterialSearch).replace(/[&<>"]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[character]));
    const basicSearch = `<form id="basic-material-search-form" class="basic-material-search" role="search"><input id="basic-material-search" value="${basicSearchValue}" placeholder="搜索材料名称或 ID" aria-label="搜索基础材料"><button class="btn secondary">搜索</button></form>`;
    const basicSelect = `<div class="basic-range-toolbar"><div class="basic-range-tabs" role="tablist" aria-label="材料范围"><button type="button" role="tab" data-basic-category="equipment" aria-selected="${state.basicCategory === 'equipment'}" class="${state.basicCategory === 'equipment' ? 'active' : ''}">装备推荐材料</button><button type="button" role="tab" data-basic-category="submarine" aria-selected="${state.basicCategory === 'submarine'}" class="${state.basicCategory === 'submarine' ? 'active' : ''}">潜水艇推荐材料</button><button type="button" role="tab" data-basic-category="leve" aria-selected="${state.basicCategory === 'leve'}" class="${state.basicCategory === 'leve' ? 'active' : ''}">理符推荐材料</button><button type="button" role="tab" data-basic-category="crystals" aria-selected="false">水晶价格</button><button type="button" role="tab" data-basic-category="scrip" aria-selected="${state.basicCategory === 'scrip'}" class="${state.basicCategory === 'scrip' ? 'active' : ''}">工票材料</button><button type="button" role="tab" data-basic-category="other" aria-selected="${state.basicCategory === 'other'}" class="${state.basicCategory === 'other' ? 'active' : ''}">其他材料</button></div>${basicSearch}</div>${state.basicMaterialSearch ? `<div class="basic-material-search-results" aria-live="polite"><div class="meta">搜索结果 ${basicSearchResults.length} 项</div>${basicSearchResults.length ? `<div class="basic-material-search-list">${basicSearchResults.map((result, index) => `<button type="button" class="basic-material-search-result" data-basic-search-result="${index}"><b>${result.material.n}</b><span>ID ${result.material.uid}</span><em>${result.scopeLabel} · ${result.kind}</em></button>`).join('')}</div>` : '<div class="empty">未在材料指导价目录中找到相符材料。</div>'}</div>` : ''}${gradeSelects}${leveGuideSelects}`;
    const coverage = baseMaterialMeta.coverage || {};
    const source = baseMaterialMeta.sources || {};
    const sourceNotice = `<div class="note">基础素材索引：770 ${coverage['770'] || 0}/77 · 750 ${coverage['750'] || 0}/39 · 非水晶基础材料 ${baseMaterialMeta.nonCrystalLeafCount || 0} 项；灰机 ${source.huiji || 0} 件 · nbb 回退 ${source.nbb || 0} 件。${baseMaterialMeta.missing?.length ? ` 未覆盖：${baseMaterialMeta.missing.join('、')}` : ''}</div>`;
    const basicHeader = state.basicCategory === 'equipment' ? sourceNotice : '';
    root.innerHTML = `<div class="header"><div><div class="meta">材料指导价</div><h1>材料指导价</h1><div class="sub">市场参考价为 Universalis 中国区 HQ／NQ 挂单的加权价，已含 5% 市场税：最多按前 999 个材料加权；挂单超过 50 条但前 50 条未达 999 个时，仅取前 50 条。当它可能低于 NPC 与自制价时，才检查任一单个大区是否有至少 ${MARKET_NPC_STOCK_THRESHOLD} 个合格挂单。</div></div><button id="refresh-market" class="btn${state.marketRefreshing ? ' refreshing' : ''}" ${state.marketRefreshing ? 'disabled' : ''}>${state.marketRefreshing ? '刷新中…' : '统一刷新市场价'}</button></div>${state.marketMessage ? '<div class="status">'+state.marketMessage+'</div>' : ''}${basicSelect + basicHeader + basicContent}`;
    const renderedCategory = state.basicCategory;
    requestAnimationFrame(() => {
      if (state.page !== 'guide' || state.guideView === 'detail' || state.basicCategory !== renderedCategory) return;
      decorateRetainerNotes(root);
      decorateSourceNotes(root);
    });
    root.querySelector('#refresh-market').onclick = () => refreshMarket(true, state.basicCategory === 'leve' ? leveBaseMaterials() : null);
    root.querySelectorAll('[data-purchase]').forEach(button => button.onclick = () => {
      const material = data.m.find(item => item.id === button.dataset.purchase);
      if (material) openPurchaseManager(material);
    });
    root.querySelectorAll('[data-basic-category]').forEach(button => {
      button.onclick = () => {
        const category = button.dataset.basicCategory;
        if (!category || category === state.basicCategory) return;
        state.basicCategory = category;
        renderGuide();
      };
    });
    root.querySelectorAll('[data-craft-scrip-ticket]').forEach(button => button.onclick = () => {
      state.craftScripTicket = button.dataset.craftScripTicket;
      renderGuide();
    });
    root.querySelectorAll('[data-craft-scrip-manual-add]').forEach(button => button.addEventListener('click', () => openCraftScripManualDialog(null, button.dataset.craftScripManualAdd)));
    root.querySelectorAll('[data-craft-scrip-manual-edit]').forEach(button => button.onclick = () => openCraftScripManualDialog(button.dataset.craftScripManualEdit));
    root.querySelectorAll('[data-craft-scrip-manual-toggle]').forEach(button => button.onclick = () => {
      const route = craftScripManualExchanges.find(item => String(item.id) === button.dataset.craftScripManualToggle);
      if (!route) return;
      route.active = route.active === false;
      refreshCraftScripConfig();
      renderGuide();
    });
    root.querySelectorAll('[data-craft-scrip-manual-delete]').forEach(button => button.onclick = () => {
      const route = craftScripManualExchanges.find(item => String(item.id) === button.dataset.craftScripManualDelete);
      if (!route || !confirm(`删除本机维护项“${route.name || route.itemId}”？`)) return;
      craftScripManualExchanges = craftScripManualExchanges.filter(item => String(item.id) !== String(route.id));
      refreshCraftScripConfig();
      renderGuide();
    });
    const basicMaterialSearch = root.querySelector('#basic-material-search-form');
    if (basicMaterialSearch) basicMaterialSearch.onsubmit = event => {
      event.preventDefault();
      state.basicMaterialSearch = root.querySelector('#basic-material-search').value.trim();
      renderGuide();
    };
    root.querySelectorAll('[data-basic-search-result]').forEach(button => button.onclick = () => {
      const result = basicSearchResults[Number(button.dataset.basicSearchResult)];
      if (result) jumpToBasicMaterial(result);
    });
    const combatGrade = root.querySelector('#combat-grade'), gatheringGrade = root.querySelector('#gathering-grade');
    if (combatGrade) { combatGrade.value = state.equipmentCombatTier; combatGrade.onchange = () => { state.equipmentCombatTier = combatGrade.value; renderGuide(); }; }
    if (gatheringGrade) { gatheringGrade.value = state.equipmentGatheringTier; gatheringGrade.onchange = () => { state.equipmentGatheringTier = gatheringGrade.value; renderGuide(); }; }
    root.querySelectorAll('#leve-guide-job,#leve-guide-plan,#leve-guide-start,#leve-guide-target').forEach(input => input.onchange = () => {
      state.leveGuideJob = root.querySelector('#leve-guide-job').value;
      state.leveGuidePlan = root.querySelector('#leve-guide-plan').value;
      state.leveGuideStart = root.querySelector('#leve-guide-start').value;
      state.leveGuideTarget = root.querySelector('#leve-guide-target').value;
      const start = Number(state.leveGuideStart || 0), target = Number(state.leveGuideTarget || 0);
      if ((start && (start < 1 || start > 99)) || (target && (target < 2 || target > 100)) || (start && target && target <= start)) return alert('等级范围须在 1–100 级内，且目标等级高于当前等级。');
      invalidateGuideIndexes();
      renderGuide();
    });
    const otherSearch = root.querySelector('#other-material-form');
    if (otherSearch) otherSearch.onsubmit = event => { event.preventDefault(); state.otherSearch = root.querySelector('#other-material-search').value.trim(); renderGuide(); };
    root.querySelectorAll('[data-add-other]').forEach(button => button.onclick = async () => {
      const material = otherSearchResults(state.otherSearch).find(row => String(row.uid) === button.dataset.addOther);
      if (material) { await addOtherMaterial(material); renderGuide(); }
    });
    root.querySelectorAll('[data-material-category]').forEach(details => details.ontoggle = () => {
      if (state.guideCategories[details.dataset.materialCategory] === details.open) return;
      state.guideCategories[details.dataset.materialCategory] = details.open;
      if (details.open) renderGuide();
    });
    const manageNpc = root.querySelector('#manage-npc-materials');
    if (manageNpc) manageNpc.onclick = openNpcMaterialManager;
    const ticketCostForm = root.querySelector('#ticket-unit-cost-form');
    if (ticketCostForm) ticketCostForm.onsubmit = event => {
      event.preventDefault();
      const value = Number(root.querySelector('#ticket-unit-cost').value || 0);
      if (!(value > 0)) return alert('请输入大于 0 的天穹票默认价格。');
      submarineTicketSettings.defaultUnitCost = value;
      invalidatePlans(); invalidateGuideIndexes(); save(); renderGuide();
    };
    const resetTicketCost = root.querySelector('#reset-ticket-unit-cost');
    if (resetTicketCost) resetTicketCost.onclick = () => {
      submarineTicketSettings.defaultUnitCost = DEFAULT_TICKET_UNIT_COST;
      invalidatePlans(); invalidateGuideIndexes(); save(); renderGuide();
    };
    root.querySelectorAll('[data-npc-detail]').forEach(button => button.onclick = () => openNpcMaterialDetail(button.dataset.npcDetail));
    root.querySelectorAll('[data-source-detail]').forEach(button => button.onclick = () => openSubmarineMaterialSourceDetail(button.dataset.sourceDetail));
    root.querySelectorAll('[data-leve-source-detail]').forEach(button => button.onclick = () => openLeveMaterialSourceDetail(button.dataset.leveSourceDetail));
    root.querySelectorAll('[data-craft-scrip-detail]').forEach(button => button.onclick = () => openCraftScripExchangeDetail(button.dataset.craftScripDetail));
    root.querySelectorAll('[data-craft-collectible-detail]').forEach(button => button.onclick = () => openCraftScripCollectibleDetail(button.dataset.craftCollectibleDetail));
    maybeRefreshMarket();
  }
  function openCraftScripExchangeDetail(uid) {
    const material = data.m.find(item => String(item.uid) === String(uid));
    const routes = craftScripRoutesFor(uid);
    if (!material || !routes.length) return;
    document.querySelector('#bundle-detail-meta').textContent = '材料指导价 > 工票材料';
    document.querySelector('#bundle-detail-title').textContent = material.n + '工票兑换详情';
    const rows = routes.map(route => `<tr><td><span class="scrip-ticket ${route.ticket}">${craftScripTicketLabel(route.ticket)}</span></td><td>${route.ticketCost} 张</td><td>${route.outputQuantity || 1} 个</td><td>${route.source || '工票兑换'}</td></tr>`).join('');
    document.querySelector('#bundle-detail-content').innerHTML = `<div class="cards"><div class="card"><small>市场平均价</small><b>${marketPriceLabel(material)}</b><div class="meta">仅作市场采购参考</div></div><div class="card"><small>采购平均价</small><b>${purchaseAverage(material) ? money(purchaseAverage(material)) : '未采购'}</b><div class="meta">历史采购均价</div></div></div><section class="sales-history"><h3>兑换比例</h3><div class="table-wrap history-table"><table class="ledger"><thead><tr><th>票种</th><th>所需工票</th><th>获得数量</th><th>来源说明</th></tr></thead><tbody>${rows}</tbody></table></div><div class="note">工票仅代表取得方式，不会被虚构为金币固定价，也不改变市场价、采购均价或历史成本。</div></section>`;
    if (!document.querySelector('#bundle-detail-dialog').open) document.querySelector('#bundle-detail-dialog').showModal();
  }
  function openCraftScripManualDialog(id = null, ticketPreset = null) {
    loadItemIndex();
    const dialog = document.querySelector('#craft-scrip-manual-dialog');
    const route = id ? craftScripManualExchanges.find(item => String(item.id) === String(id)) : null;
    state.craftScripManualEditingId = route?.id || null;
    document.querySelector('#craft-scrip-manual-title').textContent = route ? '编辑本机工票兑换材料' : '添加本机工票兑换材料';
    document.querySelector('#craft-scrip-manual-id').value = route?.id || '';
    document.querySelector('#craft-scrip-manual-material').value = route?.name || route?.itemId || '';
    document.querySelector('#craft-scrip-manual-ticket').value = route?.ticket || ticketPreset || 'orange';
    document.querySelector('#craft-scrip-manual-cost').value = route?.ticketCost || '';
    document.querySelector('#craft-scrip-manual-output').value = route?.outputQuantity || 1;
    document.querySelector('#craft-scrip-manual-source').value = route?.source || '';
    document.querySelector('#craft-scrip-manual-resolved').textContent = route ? `当前物品 ID：${route.itemId}` : '可填写已收录材料的中文名或物品 ID；未收录名称可稍后在道具索引加载完成后再试。';
    const error = document.querySelector('#craft-scrip-manual-error'); error.hidden = true; error.textContent = '';
    if (!dialog.open) dialog.showModal();
  }
  function saveCraftScripManualDialog(event) {
    event.preventDefault();
    const materialInput = document.querySelector('#craft-scrip-manual-material');
    const material = findCraftScripMaterial(materialInput.value);
    const ticket = document.querySelector('#craft-scrip-manual-ticket').value;
    const ticketCost = Number(document.querySelector('#craft-scrip-manual-cost').value || 0);
    const outputQuantity = Number(document.querySelector('#craft-scrip-manual-output').value || 0);
    const source = document.querySelector('#craft-scrip-manual-source').value.trim();
    const error = document.querySelector('#craft-scrip-manual-error');
    const fail = (message, input) => { error.textContent = message; error.hidden = false; input?.focus(); };
    if (!material) return fail('未找到材料。请填写已收录的中文名或物品 ID；道具索引仍在加载时可稍后重试。', materialInput);
    if (!(ticketCost > 0)) return fail('请填写大于 0 的所需工票。', document.querySelector('#craft-scrip-manual-cost'));
    if (!(outputQuantity > 0)) return fail('请填写大于 0 的获得数量。', document.querySelector('#craft-scrip-manual-output'));
    const id = state.craftScripManualEditingId || `manual-scrip-${Date.now()}`;
    const route = { id, itemId: String(material.uid), name: material.n, ticket, ticketCost, outputQuantity, source, manual: true, active: true, verified: false, scope: '本机手动维护' };
    const index = craftScripManualExchanges.findIndex(item => String(item.id) === String(id));
    if (index >= 0) craftScripManualExchanges[index] = { ...craftScripManualExchanges[index], ...route };
    else craftScripManualExchanges.push(route);
    refreshCraftScripConfig();
    document.querySelector('#craft-scrip-manual-dialog').close();
    renderGuide();
  }
  function openCraftScripCollectibleDetail(uid) {
    const spec = (craftScrips.collectables || []).find(item => String(item.itemId) === String(uid));
    if (!spec) return;
    const detail = craftScripCollectibleCost(spec), material = data.m.find(item => String(item.uid) === String(uid));
    document.querySelector('#bundle-detail-meta').textContent = '材料指导价 > 工票材料 > 收藏品成本';
    document.querySelector('#bundle-detail-title').textContent = (material?.n || spec.name || uid) + '收藏品成本';
    const rows = detail.rows.map(row => `<tr><td class="label"><button class="bundle-link" data-craft-scrip-ingredient="${row.uid}" data-craft-scrip-root="${spec.itemId}">${itemLabelMarkup(row.uid, materialName(row.uid))}</button></td><td>${row.batchQuantity}</td><td>${recommendationTag(row.choice, row.choice.label)}</td><td>${money(row.unit)}</td><td>${money(row.batchTotal)}</td></tr>`).join('');
    document.querySelector('#bundle-detail-content').innerHTML = `<div class="cards"><div class="card"><small>制作职业</small><b>${detail.job}</b></div><div class="card"><small>每批产出</small><b>${detail.yieldCount} 个</b></div><div class="card"><small>最高档回报</small><b>${detail.payout || '待补充'} ${detail.payout ? `张 ${craftScripTicketLabel(detail.ticket)}` : ''}</b></div><div class="card"><small>每张票成本</small><b>${detail.perScrip == null ? '等待补价' : money(detail.perScrip)}</b></div></div>${detail.reason ? `<div class="note">${detail.reason}，该收藏品暂不参与最低成本推荐。</div>` : ''}<section class="sales-history"><h3>制作材料与成本</h3><div class="table-wrap history-table"><table class="ledger"><thead><tr><th>材料</th><th>批次数量</th><th>采用方式</th><th>单价</th><th>批次合价</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="empty">暂无可用配方</td></tr>'}</tbody><tfoot><tr><th colspan="4">批次材料合价 ÷ 每批产出 ÷ 最高档回报</th><th>${detail.batchCost == null ? '等待补价' : `${money(detail.batchCost)} ÷ ${detail.yieldCount} ÷ ${detail.payout}`}</th></tr></tfoot></table></div></section>`;
    document.querySelectorAll('[data-craft-scrip-ingredient]').forEach(button => button.onclick = () => openCraftScripIngredientDetail(button.dataset.craftScripIngredient, spec.itemId, new Set([String(spec.itemId)])));
    if (!document.querySelector('#bundle-detail-dialog').open) document.querySelector('#bundle-detail-dialog').showModal();
  }
  function openCraftScripIngredientDetail(uid, rootId, trail = new Set()) {
    uid = String(uid);
    const material = data.m.find(item => String(item.uid) === uid) || { id: 'craft-scrip-' + uid, uid, n: materialName(uid) };
    const recipe = recipeCandidatesFor(uid)[0];
    const nextTrail = new Set(trail); nextTrail.add(uid);
    const yieldCount = Math.max(1, Number(recipe?.y || 1));
    const rows = (recipe?.a || []).reduce((result, _, index, list) => {
      if (index % 2) return result;
      const child = String(list[index]), quantity = Number(list[index + 1] || 0);
      if (!child || !(quantity > 0)) return result;
      const childMaterial = data.m.find(item => String(item.uid) === child) || { id: 'craft-scrip-' + child, uid: child, n: materialName(child) };
      const choice = submarineCraftInputChoice(child, nextTrail), hasRecipe = recipeCandidatesFor(child).length > 0 && !nextTrail.has(child);
      result.push(`<tr><td class="label">${hasRecipe ? `<button class="bundle-link" data-craft-scrip-ingredient="${child}" data-craft-scrip-root="${rootId}">${itemLabelMarkup(child, childMaterial.n)}</button>` : itemLabelMarkup(child, childMaterial.n)}</td><td>${quantity}</td><td>${choice.price > 0 ? money(choice.price) : '等待补价'}</td><td>${choice.price > 0 ? money(choice.price * quantity / yieldCount) : '—'}</td><td><button class="btn secondary" data-craft-scrip-purchase="${child}">记录采购</button></td></tr>`);
      return result;
    }, []).join('');
    const root = (craftScrips.collectables || []).find(item => String(item.itemId) === String(rootId));
    document.querySelector('#bundle-detail-meta').textContent = `材料指导价 > 工票材料 > ${root?.name || '收藏品'} > 下级材料`;
    document.querySelector('#bundle-detail-title').textContent = material.n + (recipe ? '制作配方' : '基础材料');
    document.querySelector('#bundle-detail-content').innerHTML = `<div class="modal-actions" style="justify-content:flex-start"><button class="btn secondary" data-craft-scrip-back="${rootId}">返回收藏品成本</button><button class="btn" data-craft-scrip-purchase="${uid}">记录采购</button></div><div class="cards"><div class="card"><small>市场平均价</small><b>${marketPriceLabel(material)}</b></div><div class="card"><small>采购平均价</small><b>${purchaseAverage(material) ? money(purchaseAverage(material)) : '未采购'}</b></div>${recipe ? `<div class="card"><small>每批产出</small><b>${yieldCount} 个</b></div>` : ''}</div>${recipe ? `<section class="sales-history"><h3>直接制作素材</h3><div class="table-wrap history-table"><table class="ledger"><thead><tr><th>材料</th><th>数量</th><th>当前单价</th><th>分摊合价</th><th>采购</th></tr></thead><tbody>${rows}</tbody></table></div></section>` : '<div class="note">该物品没有已收录制作配方，可直接记录采购价格。</div>'}`;
    document.querySelectorAll('[data-craft-scrip-ingredient]').forEach(button => button.onclick = () => openCraftScripIngredientDetail(button.dataset.craftScripIngredient, rootId, nextTrail));
    document.querySelectorAll('[data-craft-scrip-purchase]').forEach(button => button.onclick = () => {
      const target = data.m.find(item => String(item.uid) === String(button.dataset.craftScripPurchase));
      if (target) openPurchaseManager(target);
    });
    document.querySelector('[data-craft-scrip-back]')?.addEventListener('click', () => openCraftScripCollectibleDetail(rootId));
  }
  function openSubmarineMaterialSourceDetail(uid) {
    const material = data.m.find(item => String(item.uid) === String(uid));
    if (!material) return;
    const choice = submarineSourceChoice(material);
    const craftRows = submarineCraftInputBreakdown(material.uid);
    const craftRecipe = recipeCandidatesFor(material.uid)[0], craftYield = Math.max(1, Number(craftRecipe?.y) || 1);
    const craftBatchTotal = craftRows.reduce((sum, row) => sum + row.batchTotal, 0), craftTotal = craftBatchTotal / craftYield;
    const craftMissing = craftRows.some(row => !(row.unit > 0));
    const craftFooter = craftYield > 1
      ? `批次合价 ${craftMissing ? '部分未获取' : money(craftBatchTotal)} ÷ 每批产出 ${craftYield} 个`
      : '按当前来源制作成本';
    const craftTable = craftRows.length ? `<section class="sales-history"><h3>自制成本采用的下级来源${craftYield > 1 ? ` · 每批产出 ${craftYield} 个` : ''}</h3><div class="table-wrap history-table"><table class="ledger"><thead><tr><th>下级材料</th><th>数量</th><th>采用方式</th><th>单价</th><th>${craftYield > 1 ? '批次合价' : '合价'}</th></tr></thead><tbody>${craftRows.map(row => `<tr><td class="label">${itemLabelMarkup(row.uid, materialName(row.uid))}</td><td>${Number(row.batchQuantity.toFixed(4))}</td><td>${recommendationTag(row.choice, row.choice.label)}</td><td>${row.unit > 0 ? money(row.unit) : '未获取'}</td><td>${row.unit > 0 ? money(row.batchTotal) : '—'}</td></tr>`).join('')}</tbody><tfoot><tr><th colspan="4">${craftFooter}</th><th>${craftMissing ? '部分未获取' : money(craftTotal)}</th></tr></tfoot></table></div></section>` : '';
    document.querySelector('#bundle-detail-meta').textContent = '材料指导价 > 潜水艇推荐材料 > 来源比价';
    document.querySelector('#bundle-detail-title').textContent = material.n + '来源比价';
    document.querySelector('#bundle-detail-content').innerHTML = `<div class="cards"><div class="card"><small>推荐方式</small><b>${choice.label}</b><div class="meta">${choice.source}</div></div><div class="card"><small>当前最低有效单价</small><b>${choice.price > 0 ? money(choice.price) : '待补价'}</b><div class="meta">仅比较有效的正数价格</div></div></div>${sourceChoiceComparisonTable(choice)}${craftTable}`;
    if (!document.querySelector('#bundle-detail-dialog').open) document.querySelector('#bundle-detail-dialog').showModal();
  }
  function openNpcMaterialDetail(uid) {
    const material = data.m.find(item => String(item.uid) === String(uid)), comparison = npcComparison(uid), leaves = [...selfCraftLeafIds(uid)].map(leafId => {
      const leaf = data.m.find(item => String(item.uid) === String(leafId)), unit = materialUnitPrice(leaf);
      return { name: materialName(leafId), quantity: 1, cost: unit, uid: Number(leafId) };
    }).sort((left, right) => left.uid - right.uid);
    if (!material || !comparison || !comparison.hasCraftRoute) return;
    document.querySelector('#bundle-detail-meta').textContent = '材料指导价 > 潜水艇推荐材料 > NPC 购买材料';
    document.querySelector('#bundle-detail-title').textContent = material.n + ' 采购与自制详情';
    const choice = npcCostChoice(material, comparison), purchase = purchaseAverage(material);
    document.querySelector('#bundle-detail-content').innerHTML = `<div class="cards"><div class="card"><small>NPC 采购价</small><b>${money(comparison.price)}</b><div class="meta">${comparison.source}</div></div><div class="card"><small>采购平均价</small><b>${purchase > 0 ? money(purchase) : '未采购'}</b><div class="meta">全历史含税采购均价</div></div><div class="card"><small>当前采用成本</small><b>${money(choice.price)}</b><div class="meta">${choice.source}较低</div></div><div class="card"><small>自制价格</small><b>${comparison.self == null ? '等待市场价' : money(comparison.self)}</b><div class="meta">按当前采购均价 / 市场均价递归估算</div></div></div><section class="sales-history"><h3>自制基础素材参考</h3>${costTable(leaves, '参考成本', comparison.self || 0)}</section>`;
    if (!document.querySelector('#bundle-detail-dialog').open) document.querySelector('#bundle-detail-dialog').showModal();
  }
  function openNpcMaterialManager() {
    const dialog = document.querySelector('#npc-material-dialog');
    const catalog = submarineCatalogIds();
    const entries = submarineNpcMaterials();
    document.querySelector('#npc-material-list').innerHTML = `<div class="table-wrap history-table"><table class="ledger"><thead><tr><th>材料</th><th>NPC 售卖价</th><th>采购平均价</th><th>自制价</th><th>购买来源</th><th>记录采购</th><th>操作</th></tr></thead><tbody>${entries.map(material => { const spec = npcMaterial(material), comparison = npcComparison(material.uid), purchase = purchaseAverage(material), craftable = comparison?.hasCraftRoute, name = itemLabelMarkup(material.uid, material.n); return `<tr class="npc-row"><td class="label">${craftable ? `<button class="bundle-link" data-npc-detail="${material.uid}">${name}</button>` : name}</td><td>${money(spec.price)}</td><td>${purchase > 0 ? money(purchase) : '未采购'}</td><td>${craftable ? (comparison.self == null ? '等待市场价' : money(comparison.self)) : '—'}</td><td>${spec.source}</td><td><button class="btn secondary" data-purchase="${material.id}">记录采购</button></td><td><button class="btn secondary" data-npc-remove="${material.uid}">移出 NPC 分类</button></td></tr>`; }).join('') || '<tr><td colspan="7" class="empty">暂无 NPC 固定材料</td></tr>'}</tbody></table></div>`;
    document.querySelector('#npc-material-search').oninput = event => {
      const query = event.target.value.trim().toLowerCase();
      const results = otherSearchResults(query).filter(material => catalog.has(String(material.uid))).slice(0, 30);
      document.querySelector('#npc-material-results').innerHTML = !query ? '' : `<div class="table-wrap history-table"><table class="ledger"><thead><tr><th>材料</th><th>物品 ID</th><th></th></tr></thead><tbody>${results.map(material => `<tr><td class="label">${itemLabelMarkup(material.uid, material.n)}</td><td>${material.uid}</td><td><button class="btn secondary" data-npc-select="${material.uid}">设为 NPC 材料</button></td></tr>`).join('') || '<tr><td colspan="3" class="empty">未找到潜水艇推荐材料名录内的匹配材料。</td></tr>'}</tbody></table></div>`;
      document.querySelectorAll('[data-npc-select]').forEach(button => button.onclick = () => {
        const material = results.find(row => String(row.uid) === button.dataset.npcSelect);
        if (!material) return;
        document.querySelector('#npc-material-id').value = material.uid;
        document.querySelector('#npc-material-name').value = material.n;
        document.querySelector('#npc-material-price').focus();
      });
    };
    document.querySelectorAll('[data-npc-remove]').forEach(button => button.onclick = () => {
      const uid = String(button.dataset.npcRemove), builtIn = Boolean(materialSources[uid]?.npc);
      if (builtIn) npcMaterialConfig.disabled = [...new Set([...(npcMaterialConfig.disabled || []), uid])];
      else delete npcMaterialConfig.added?.[uid];
      invalidateNpcMaterials(); ensureSubmarineMaterials(); syncPurchaseCosts(); save(); openNpcMaterialManager(); renderGuide();
    });
    document.querySelectorAll('[data-purchase]').forEach(button => button.onclick = () => {
      const material = data.m.find(item => item.id === button.dataset.purchase);
      if (material) openPurchaseManager(material);
    });
    document.querySelectorAll('[data-npc-detail]').forEach(button => button.onclick = () => openNpcMaterialDetail(button.dataset.npcDetail));
    if (!dialog.open) dialog.showModal();
  }
  function periodPurchases(material) {
    const now = new Date(), mode = state.purchasePeriod || 'month', start = new Date(now);
    if (mode === 'week') start.setDate(now.getDate() - 6);
    if (mode === 'month') start.setMonth(now.getMonth(), 1);
    if (mode === 'year') start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
    return purchaseRows(material).filter(row => new Date(row.date) >= start);
  }
  function openPurchaseManager(material) {
    state.purchaseManagerMaterialId = material.id;
    renderPurchaseManager();
  }
  const purchaseSourceLabel = row => row?.kind === 'exchange'
    ? `兑换采购 · ${row.exchangeSource || '兑换'}`
    : '直接采购';
  function renderPurchaseManager() {
    const material = data.m.find(item => item.id === state.purchaseManagerMaterialId);
    const dialog = document.querySelector('#purchase-manager-dialog');
    if (!material) { if (dialog.open) dialog.close(); return; }
    const visible = periodPurchases(material);
    const values = visible.map(row => Number(row.unitPrice || 0)).filter(Boolean);
    const quantity = visible.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const average = purchaseAverage(material);
    document.querySelector('#purchase-manager-meta').textContent = isCrystal(material) ? '材料指导价 > 水晶价格' : '材料指导价';
    document.querySelector('#purchase-manager-title').textContent = material.n + '采购价格';
    document.querySelector('#purchase-manager-average').textContent = `全历史采购均价：${purchaseAverage(material) ? money(purchaseAverage(material)) : '暂无采购记录'}`;
    document.querySelector('#purchase-manager-content').innerHTML = `<div class="purchase-stats"><div class="card metric"><small>本期最高单价</small><b>${values.length ? money(Math.max(...values)) : '—'}</b></div><div class="card metric"><small>本期最低单价</small><b>${values.length ? money(Math.min(...values)) : '—'}</b></div><div class="card metric"><small>采购平均单价</small><b>${average ? money(average) : '—'}</b></div></div><div class="filter"><button class="btn secondary" data-manager-period="week">周</button><button class="btn secondary" data-manager-period="month">月</button><button class="btn secondary" data-manager-period="year">年</button></div><div class="table-wrap"><table class="ledger"><thead><tr><th>日期</th><th>来源</th><th>购买数量</th><th>单价</th><th>税率</th><th>合价（含税）</th><th>操作</th></tr></thead><tbody>${visible.map(row => `<tr><td>${row.date}</td><td>${purchaseSourceLabel(row)}</td><td>${row.quantity}</td><td>${money(row.unitPrice)}</td><td>${Math.round(row.tax * 100)}%</td><td>${money(row.total)}</td><td><button class="btn secondary" data-manager-edit="${row.id}">编辑</button> <button class="btn secondary" data-manager-delete="${row.id}">删除</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">本期暂无采购记录</td></tr>'}</tbody></table></div>`;
    document.querySelector('#purchase-manager-add').onclick = () => openPurchase(material);
    document.querySelectorAll('[data-manager-period]').forEach(button => {
      button.classList.toggle('active', button.dataset.managerPeriod === (state.purchasePeriod || 'month'));
      button.onclick = () => { state.purchasePeriod = button.dataset.managerPeriod; renderPurchaseManager(); };
    });
    document.querySelectorAll('[data-manager-edit]').forEach(button => button.onclick = () => { const entry = purchases.find(row => row.id === button.dataset.managerEdit); if (entry) openPurchase(material, entry); });
    document.querySelectorAll('[data-manager-delete]').forEach(button => button.onclick = () => {
      const index = purchases.findIndex(row => row.id === button.dataset.managerDelete);
      if (index < 0 || !confirm('删除这条采购记录？删除后会重算采购均价。')) return;
      purchases.splice(index, 1); refreshNpcRecommendations(); save(); renderPurchaseManager(); renderGuide();
    });
    if (!dialog.open) dialog.showModal();
  }
  function renderPurchaseDetail() {
    const material = data.m.find(item => item.id === state.selectedMaterial);
    if (!material) { state.guideView = 'basic'; state.basicCategory = 'equipment'; return renderGuide(); }
    const visible = periodPurchases(material);
    const values = visible.map(row => row.unitPrice);
    const quantity = visible.reduce((sum, row) => sum + row.quantity, 0);
    const average = quantity ? visible.reduce((sum, row) => sum + row.total, 0) / quantity : 0;
    const title = isCrystal(material) ? '水晶价格' : '材料指导价';
    document.querySelector('#guide').innerHTML = `<div class="header"><div><div class="meta">材料指导价 &gt; ${title} &gt; ${material.n}</div><h1>${material.n}采购价格</h1><div class="sub">采购均价 ${purchaseAverage(material) ? money(purchaseAverage(material)) : '未采购'}</div></div><div><button id="back-guide" class="btn secondary">← 返回材料价格</button> <button id="add-purchase" class="btn">+ 记录采购</button></div></div><div class="cards"><div class="card metric"><small>本期最高单价</small><b>${values.length ? money(Math.max(...values)) : '—'}</b></div><div class="card metric"><small>本期最低单价</small><b>${values.length ? money(Math.min(...values)) : '—'}</b></div><div class="card metric"><small>本期平均单价</small><b>${values.length ? money(average) : '—'}</b></div></div><div class="filter"><button class="btn secondary" data-period="week">周</button><button class="btn secondary" data-period="month">月</button><button class="btn secondary" data-period="year">年</button></div><div class="table-wrap"><table class="ledger"><thead><tr><th>日期</th><th>购买数量</th><th>单价</th><th>税率</th><th>合价（含税）</th><th>操作</th></tr></thead><tbody>${visible.map(row => `<tr><td>${row.date}</td><td>${row.quantity}</td><td>${money(row.unitPrice)}</td><td>${Math.round(row.tax * 100)}%</td><td>${money(row.total)}</td><td><button class="btn secondary" data-edit-purchase="${row.id}">编辑</button> <button class="btn secondary" data-delete-purchase="${row.id}">删除</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">本期暂无采购记录</td></tr>'}</tbody></table></div>`;
    document.querySelector('#back-guide').onclick = () => { state.guideView = 'basic'; state.basicCategory = isCrystal(material) ? 'crystals' : state.basicCategory; state.selectedMaterial = null; render(); };
    document.querySelector('#add-purchase').onclick = () => openPurchase(material);
    document.querySelectorAll('[data-edit-purchase]').forEach(button => button.onclick = () => openPurchase(material, purchases.find(row => row.id === button.dataset.editPurchase)));
    document.querySelectorAll('[data-delete-purchase]').forEach(button => button.onclick = () => {
      const index = purchases.findIndex(row => row.id === button.dataset.deletePurchase);
      if (index < 0 || !confirm('删除这条采购记录？删除后会重算采购均价。')) return;
      purchases.splice(index, 1); refreshNpcRecommendations(); save(); renderPurchaseDetail();
    });
    document.querySelectorAll('[data-period]').forEach(button => {
      button.classList.toggle('active', button.dataset.period === (state.purchasePeriod || 'month'));
      button.onclick = () => { state.purchasePeriod = button.dataset.period; renderPurchaseDetail(); };
    });
  }
  function openPurchase(material, purchase = null) {
    const matchingRoutes = exchangeRoutesFor(material.uid).map(route => ({ ...route, index: route.routeIndex }));
    const kind = document.querySelector('#purchase-kind');
    const kindHint = document.querySelector('#purchase-kind-hint');
    const purchaseError = document.querySelector('#purchase-error');
    kind.innerHTML = `<option value="direct">直接市场购买</option>${matchingRoutes.map(route => `<option value="exchange:${route.index}">${route.kind} · ${route.label}</option>`).join('')}`;
    kind.value = purchase?.kind === 'exchange' ? `exchange:${purchase.exchangeRoute}` : 'direct';
    document.querySelector('#purchase-kind-label').hidden = matchingRoutes.length === 0;
    kindHint.hidden = matchingRoutes.length === 0;
    kindHint.textContent = matchingRoutes.length ? `可选：市场购买、${matchingRoutes.map(route => route.kind).filter((value, index, values) => values.indexOf(value) === index).join('、')}` : '';
    purchaseError.hidden = true;
    purchaseError.textContent = '';
    document.querySelector('#purchase-voucher-summary').hidden = true;
    document.querySelector('#purchase-title').textContent = (purchase ? '编辑采购 ' : '采购 ') + material.n;
    document.querySelector('#purchase-date').value = purchase?.date || today();
    document.querySelector('#purchase-quantity').value = purchase?.kind === 'exchange' ? '' : (purchase?.quantity || '');
    document.querySelector('#purchase-tax').value = String(purchase?.tax ?? 0.05);
    document.querySelector('#purchase-unit').value = purchase?.kind === 'exchange' ? '' : moneyInputValue(purchase?.unitPrice);
    document.querySelector('#purchase-total').value = purchase?.kind === 'exchange' ? '' : moneyInputValue(purchase?.total);
    document.querySelector('#purchase-exchange-turns').value = purchase?.exchangeTurns || 1;
    document.querySelector('#purchase-source-price').value = moneyInputValue(purchase?.exchangeSourceUnitPrice);
    state.purchaseEditMode = 'unit'; state.selectedMaterial = material.id;
    state.editingPurchaseId = purchase?.id || null;
    const syncMode = (applyDefault = false) => {
      const routeIndex = kind.value.startsWith('exchange:') ? Number(kind.value.slice(9)) : null;
      const route = routeIndex == null ? null : exchangeSources.routes?.[routeIndex];
      const exchangeFields = document.querySelector('#purchase-exchange-fields'), directFields = document.querySelector('#purchase-direct-fields');
      exchangeFields.hidden = !route; directFields.hidden = Boolean(route);
      if (!route) return;
      const sourceMaterial = route.carrierId ? data.m.find(item => String(item.uid) === String(route.carrierId)) : null;
      const sourceField = document.querySelector('#purchase-source-price');
      const defaultPrice = route.carrierId ? directSourceChoice(sourceMaterial).price : ticketUnitCost();
      if (applyDefault && sourceField.value === '') sourceField.value = moneyInputValue(defaultPrice);
      sourceField.readOnly = false;
      document.querySelector('#purchase-source-price-label').firstChild.textContent = route.carrierId ? `${sourceMaterial?.n || '凭证'}单价（G / 个）` : '天穹票单价（G / 张）';
      document.querySelector('#purchase-exchange-note').textContent = route.carrierId
        ? `不维护凭证库存；本次兑换按填写的 ${sourceMaterial?.n || '凭证'} 单价结转。`
        : `天穹票不可囤货；每次使用 ${route.ticketCost} 张，默认 ${money(ticketUnitCost())} / 张。`;
      const turns = Math.max(0, Number(document.querySelector('#purchase-exchange-turns').value || 0));
      const outputQuantity = Number(route.outputs?.[String(material.uid)] || 0) * turns;
      const sourceQuantity = route.carrierId ? turns : turns * Number(route.ticketCost || 0);
      const total = nonNegativeNumber(document.querySelector('#purchase-source-price').value) * sourceQuantity;
      document.querySelector('#purchase-exchange-summary').innerHTML = `获得数量：<b>${outputQuantity}</b> · 合价：<b>${money(total)}</b> · 换算单价：<b>${outputQuantity ? money(total / outputQuantity) : '—'}</b>`;
    };
    state.syncPurchaseMode = syncMode;
    kind.onchange = () => {
      normalizePurchaseMoneyInputs();
      clearPurchaseError();
      document.querySelector('#purchase-source-price').value = '';
      syncMode(true);
    };
    document.querySelector('#purchase-exchange-turns').oninput = () => syncMode(false);
    document.querySelector('#purchase-source-price').oninput = () => syncMode(false);
    syncMode(true);
    document.querySelector('#purchase-dialog').showModal();
  }

  const equipmentProfitSummary = category => {
    const options = availableEquipmentGrades(category);
    const selected = options.find(option => option.id === state.equipmentSummaryTiers?.[category]) || options[0];
    if (!selected) return '';
    const rows = ledgerRows(selected.id);
    const realizedProfit = bundle => sales().filter(entry => entry.bundleId === bundle.id).reduce((sum, entry) => sum + Number(entry.profit || 0), 0);
    const groupStats = [...new Set(rows.map(item => item.group))].map(group => [group, rows.filter(item => item.group === group).reduce((sum, item) => sum + realizedProfit(item), 0)]);
    const totalProfit = groupStats.reduce((sum, [, profit]) => sum + profit, 0);
    const label = category === 'combat' ? '战职装备' : '生产采集装备';
    return `<section class="profit-summary equipment-profit-summary"><div class="profit-summary-header"><h2>${label}</h2><label class="equipment-summary-tier"><span>装备品级</span><select data-equipment-summary-tier="${category}">${options.map(option => `<option value="${option.id}" ${option.id === selected.id ? 'selected' : ''}>${option.label}</option>`).join('')}</select></label></div><table class="ledger"><tbody><tr><th>合计利润</th><td>${money(totalProfit)}</td></tr>${groupStats.map(([group, profit]) => `<tr><td>${group}</td><td>${money(profit)}</td></tr>`).join('')}</tbody></table><div class="note">统计已完成装备销售的实际净利润。</div></section>`;
  };
  function openSalesHistory() {
    const prefix = state.type + '-';
    const rows = sales().filter(entry => String(entry.bundleId || '').startsWith(prefix));
    document.querySelector('#sales-history-title').textContent = state.type === '770' ? '战职装备销售记录' : '生产采集装备销售记录';
    document.querySelector('#sales-history-content').innerHTML = `<div class="table-wrap history-table"><table class="ledger"><thead><tr><th>日期</th><th>职业 / 分项</th><th>数量</th><th>成交额</th><th>销售成本</th><th>利润</th></tr></thead><tbody>${rows.map(entry => `<tr><td>${entry.date}</td><td class="label">${entry.item}</td><td>${entry.q}</td><td>${money(entry.amount)}</td><td>${money(entry.cost)}</td><td class="profit">${money(entry.profit)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">暂无销售记录</td></tr>'}</tbody></table></div>`;
    document.querySelector('#sales-history-dialog').showModal();
  }
  function renderEquipment() {
    const root = document.querySelector('#equipment');
    if (!state.type) {
      root.innerHTML = `<div class="header"><div><div class="meta">装备售卖 · 7.5</div><h1>装备销售利润统计</h1><div class="sub">选择上方“战职装备”或“生产采集装备”进入对应品级台账。</div></div></div><div class="equipment-summaries">${equipmentProfitSummary('combat')}${equipmentProfitSummary('gathering')}</div>`;
      root.querySelectorAll('[data-equipment-summary-tier]').forEach(select => select.onchange = event => {
        const category = event.currentTarget.dataset.equipmentSummaryTier;
        state.equipmentSummaryTiers[category] = event.currentTarget.value;
        renderEquipment();
      });
      return;
    }
    const combat = state.type === '770';
    const rows = tableRows(state.type);
    const gradeCategory = equipmentCategoryFor(state.type);
    const gradeOptions = availableEquipmentGrades(gradeCategory);
    const tier = gradeOptions.find(option => option.id === state.type)?.label || (combat ? '770 HQ' : '750 HQ');
    const actionMarkup = (item, kind) => kind === 'craft'
      ? `<div class="op-actions"><button class="op-btn craft" data-action="craft-plus" data-row="${item.id}">制作入库 +1</button><button class="op-btn undo" data-action="craft-minus" data-row="${item.id}" ${automaticLogs('craft', item.id).length ? '' : 'disabled'}>撤销</button></div>`
      : `<div class="op-actions"><button class="op-btn sale" data-action="sale-plus" data-row="${item.id}" ${inventory(item) ? '' : 'disabled'}>售卖 +1</button><button class="op-btn undo" data-action="sale-minus" data-row="${item.id}" ${automaticLogs('sale', item.id).length ? '' : 'disabled'}>撤销</button></div>`;
    const toolLabel = combat ? '武器' : '工具';
    root.innerHTML = `<div class="header"><div><div class="meta">装备售卖 &gt; ${combat ? '战职装备' : '生产采集装备'} &gt; 7.5</div><h1>${combat ? '战职装备售卖台账' : '生产采集装备售卖台账'}</h1><div class="sub">7.5 · ${tier} · 点击职业组可展开；防具、首饰和${toolLabel}默认收起。</div></div><div class="equipment-page-actions"><label class="equipment-grade-picker"><span>装备品级</span><select id="equipment-tier">${gradeOptions.map(option => `<option value="${option.id}" ${option.id === state.type ? 'selected' : ''}>${option.label}</option>`).join('')}</select></label><button id="back" class="btn secondary">← 返回装备售卖</button> <button id="open-history" class="btn secondary">销售记录</button> <button id="open-template" class="btn secondary">统一调整套装价格</button> <button id="open-custom" class="btn">自定义成交价</button></div></div><div class="table-wrap"><table class="ledger"><thead><tr><th>职业 / 分项</th><th>库存数量</th><th>制作</th><th>售卖</th><th>成本价</th><th>套装价</th><th>利润</th><th>利润比</th></tr></thead><tbody>${rows.map(item => {
      if (item.header) return `<tr class="group-row"><td colspan="8"><button class="group-toggle" data-group="${item.header}">${iconMarkup(groupIconPaths[item.header], item.header, 'role')}<span>${item.header}</span><b>${state.equipmentGroups[item.header] ? '⌃' : '⌄'}</b></button></td></tr>`;
      if (!state.equipmentGroups[item.group]) return '';
      const partsKey = item.group + '-parts';
      if ((item.pricePart === 'armor' || item.pricePart === 'accessory') && !state.equipmentSections[partsKey]) return '';
      const cost = unitCost(item), price = priceFor(item), profit = price - cost, inventoryCount = inventory(item);
      const icon = item.job ? iconMarkup(jobIconPaths[item.job], item.label) : iconMarkup(groupIconPaths[item.group], item.label, 'role');
      const tool = item.tool;
      const toolKey = item.id + '-tool';
      const toolMarkup = tool && state.equipmentSections[toolKey] ? `<tr class="tool-strip"><td colspan="8"><div class="tool-chip"><button class="bundle-link" data-detail="${tool.id}">${iconMarkup(jobIconPaths[item.job], tool.label)}${tool.label}</button><span class="meta">成本 ${money(unitCost(tool))} · 售价 ${money(priceFor(tool))} · 库存 ${inventory(tool)}</span>${actionMarkup(tool, 'craft')}${actionMarkup(tool, 'sale')}</div></td></tr>` : '';
      const partsToggle = item.pricePart === 'gear' ? `<button class="section-toggle" data-section="${partsKey}">${state.equipmentSections[partsKey] ? '收起防具 / 首饰' : '展开防具 / 首饰'}</button>` : '';
      const toolToggle = tool ? `<button class="section-toggle" data-section="${toolKey}">${state.equipmentSections[toolKey] ? '收起' + toolLabel : '展开' + toolLabel}</button>` : '';
      return `<tr class="${item.indent ? 'detail' : ''}"><td class="label"><button class="bundle-link" data-detail="${item.id}">${icon}${item.label}</button>${partsToggle}${toolToggle}</td><td><b>${inventoryCount}</b></td><td>${actionMarkup(item, 'craft')}</td><td>${actionMarkup(item, 'sale')}</td><td>${money(cost)}</td><td class="price" data-price="${item.id}">${money(price)}</td><td class="profit">${money(profit)}</td><td class="margin">${cost ? Math.round(profit / cost * 100) + '%' : '—'}</td></tr>${toolMarkup}`;
    }).join('')}</tbody></table></div><div class="note">制作与售卖数量不显示；库存数量自动按“制作 − 售卖”计算。售卖 + 按当前套装价自动入账。</div>`;
    root.querySelector('#back').onclick = () => { state.type = null; state.expanded = true; render(); };
    root.querySelector('#equipment-tier').onchange = event => { state.type = event.currentTarget.value; render(); };
    root.querySelector('#open-history').onclick = openSalesHistory;
    root.querySelector('#open-template').onclick = openPriceTemplate;
    root.querySelector('#open-custom').onclick = openCustomSale;
    root.querySelectorAll('[data-group]').forEach(button => button.onclick = () => { state.equipmentGroups[button.dataset.group] = !state.equipmentGroups[button.dataset.group]; renderEquipment(); });
    root.querySelectorAll('[data-section]').forEach(button => button.onclick = () => { state.equipmentSections[button.dataset.section] = !state.equipmentSections[button.dataset.section]; renderEquipment(); });
    const allRows = ledgerRows(state.type);
    root.querySelectorAll('[data-action]').forEach(button => button.onclick = () => changeBundle(button.dataset.action, allRows.find(item => item.id === button.dataset.row)));
    root.querySelectorAll('[data-price]').forEach(cell => cell.onclick = () => editPrice(allRows.find(item => item.id === cell.dataset.price)));
    root.querySelectorAll('[data-detail]').forEach(button => button.onclick = () => openBundleDetail(allRows.find(item => item.id === button.dataset.detail)));
  }

  const submarineRow = part => ({ id: 'submarine-' + part.id, partId: part.id, group: part.n.replace(/(船体|船尾|船首|舰桥)$/, ''), label: part.n, priceKey: 'submarine-price-' + part.id, components: componentList([[part.id, 1]]) });
  const submarineRows = () => (submarineData.parts || []).map(submarineRow);
  const submarineStock = part => submarineStocks[part.id] || { q: 0, v: 0, made: 0, sold: 0 };
  const setSubmarineStock = (part, value) => { submarineStocks[part.id] = value; };
  const submarinePrice = part => prices['submarine-price-' + part.id] || 0;
  const submarineHistory = part => submarineSales.filter(sale => Number(sale.partId) === Number(part.id));
  const submarineSlots = ['船体', '船尾', '船首', '舰桥'];
  const suiteLabel = suite => suite.label || (suite.code + (suite.modified ? '改' : ''));
  const suiteParts = suite => suite.code.split('').map((digit, index) => {
    const level = Number(digit), slot = submarineSlots[index];
    if (!level) return null;
    return submarineData.parts.find(part => part.part === slot && (suite.modified ? /改级/.test(part.n) : !/改级/.test(part.n)) && new RegExp('^' + ['','鲨鱼','甲鲎','须鲸','腔棘鱼','希尔德拉'][level]).test(part.n)) || null;
  });
  const suitePrice = suite => prices[suite.priceKey] || 0;
  const suiteStock = suite => {
    const parts = suiteParts(suite).filter(Boolean);
    return parts.length ? Math.min(...parts.map(part => submarineStock(part).q)) : 0;
  };
  const suiteCost = suite => suiteParts(suite).filter(Boolean).reduce((sum, part) => {
    const value = submarineStock(part); return sum + (value.q ? value.v / value.q : productionPlan(submarineRow(part)).total);
  }, 0);
  const suiteHistory = suite => submarineSuiteSales.filter(sale => sale.suiteId === suite.id);
  const lastSubmarineOperation = (kind, targetId) => submarineOperations.find(entry => entry.kind === kind && String(entry.targetId) === String(targetId));
  const submarineOperation = (kind, targetId, quantity, deltas, saleId = null) => {
    submarineOperations.unshift({ id: 'sub-op-' + Date.now() + '-' + Math.random().toString(16).slice(2), kind, targetId: String(targetId), quantity, deltas, saleId, date: today() });
  };
  function submarineSellSuite(suite, price, date = today(), quantity = 1) {
    quantity = Math.max(1, Number(quantity) || 1);
    price = Number(price || 0);
    if (!(price > 0)) throw new Error('请填写大于 0 的实际成交单价。');
    const parts = suiteParts(suite).filter(Boolean);
    if (!parts.length || suiteStock(suite) < quantity) throw new Error('该整套库存不足，不能售卖。');
    const recipeCosts = parts.map(part => { const value = submarineStock(part), cost = value.v / value.q * quantity; return { partId: part.id, qty: quantity, cost }; });
    recipeCosts.forEach(entry => { const part = submarineData.parts.find(item => Number(item.id) === Number(entry.partId)); const value = submarineStock(part); value.q -= entry.qty; value.v -= entry.cost; value.sold = (value.sold || 0) + entry.qty; setSubmarineStock(part, value); });
    const cost = recipeCosts.reduce((sum, row) => sum + row.cost, 0), amount = price * quantity;
    const sale = { id: 'sub-suite-sale-' + Date.now(), suiteId: suite.id, item: '潜水艇整套 ' + suiteLabel(suite), date, q: quantity, amount, cost, profit: amount - cost, recipeCosts };
    submarineSuiteSales.unshift(sale);
    submarineOperation('suite-sale', suite.id, quantity, recipeCosts.map(entry => ({ ...entry })), sale.id);
  }
  function openSubmarineSuiteSale(suite) {
    state.pendingSubmarineSuite = suite.id;
    const cost = suiteCost(suite), stockCount = suiteStock(suite), price = suitePrice(suite);
    document.querySelector('#submarine-suite-sale-title').textContent = '确认整套售卖 · ' + suiteLabel(suite);
    document.querySelector('#submarine-suite-sale-price').value = '';
    document.querySelector('#submarine-suite-sale-price').placeholder = price ? `建议售价 ${Math.round(price)} G` : '请填写实际成交单价';
    document.querySelector('#submarine-suite-sale-quantity').value = 1;
    document.querySelector('#submarine-suite-sale-quantity').max = stockCount;
    document.querySelector('#submarine-suite-sale-summary').innerHTML = `<div>当前可售 ${stockCount} 套 · ${suiteParts(suite).filter(Boolean).map(part => part.n).join('、')}</div><div style="margin-top:8px">成本 ${money(cost)} · 建议售价 ${money(price)} · 预计利润 ${money(price - cost)}</div>`;
    document.querySelector('#submarine-suite-sale-dialog').showModal();
  }
  function openSubmarineSuiteEditor(suite = null) {
    state.editingSubmarineSuite = suite?.id || null;
    document.querySelector('#submarine-suite-title').textContent = suite ? '编辑潜水艇整套' : '新增潜水艇整套';
    document.querySelector('#submarine-suite-code').value = suite?.code || '';
    document.querySelector('#submarine-suite-modified').checked = Boolean(suite?.modified);
    document.querySelector('#submarine-suite-price').value = suite ? suitePrice(suite) : '';
    document.querySelector('#submarine-suite-dialog').showModal();
  }
  function submarineCraft(part, quantity = 1) {
    quantity = Math.max(1, Number(quantity) || 1);
    const bundle = submarineRow(part), plan = productionPlan(bundle);
    if (plan.missing.length) throw new Error('缺少成本：' + plan.missing.join('、'));
    const value = submarineStock(part);
    const cost = plan.total * quantity;
    value.q += quantity; value.v += cost; value.made = (value.made || 0) + quantity;
    setSubmarineStock(part, value);
    submarineOperation('part-craft', part.id, quantity, [{ partId: part.id, qty: quantity, cost }]);
  }
  function submarineCraftSuite(suite, quantity = 1) {
    quantity = Math.max(1, Number(quantity) || 1);
    const parts = suiteParts(suite).filter(Boolean);
    if (!parts.length) throw new Error('该整套未包含可制作部件。');
    const deltas = parts.map(part => { const plan = productionPlan(submarineRow(part)); if (plan.missing.length) throw new Error('缺少成本：' + plan.missing.join('、')); return { partId: part.id, qty: quantity, cost: plan.total * quantity }; });
    deltas.forEach(entry => { const part = submarineData.parts.find(item => Number(item.id) === Number(entry.partId)); const value = submarineStock(part); value.q += entry.qty; value.v += entry.cost; value.made = (value.made || 0) + entry.qty; setSubmarineStock(part, value); });
    submarineOperation('suite-craft', suite.id, quantity, deltas);
  }
  function submarineSell(part, price, date = today(), quantity = 1) {
    quantity = Math.max(1, Number(quantity) || 1);
    price = Number(price || 0);
    if (!(price > 0)) throw new Error('请填写大于 0 的实际成交单价。');
    const value = submarineStock(part);
    if (value.q < quantity) throw new Error('部件库存不足，不能售卖。');
    const cost = value.v / value.q * quantity;
    value.q -= quantity; value.v -= cost; value.sold = (value.sold || 0) + quantity;
    setSubmarineStock(part, value);
    const amount = price * quantity;
    const sale = { id: 'sub-sale-' + Date.now(), partId: part.id, item: part.n, date, q: quantity, amount, cost, profit: amount - cost };
    submarineSales.unshift(sale);
    submarineOperation('part-sale', part.id, quantity, [{ partId: part.id, qty: quantity, cost }], sale.id);
  }
  function undoSubmarineOperation(kind, targetId) {
    const index = submarineOperations.findIndex(entry => entry.kind === kind && String(entry.targetId) === String(targetId));
    if (index < 0) throw new Error('没有可撤销的最近操作。');
    const operation = submarineOperations[index], craft = /craft$/.test(kind);
    if (craft && operation.deltas.some(entry => submarineStock(submarineData.parts.find(part => Number(part.id) === Number(entry.partId))).q < entry.qty)) throw new Error('已有部件售出，不能撤销这次制作。');
    operation.deltas.forEach(entry => {
      const part = submarineData.parts.find(item => Number(item.id) === Number(entry.partId)), value = submarineStock(part);
      if (craft) { value.q -= entry.qty; value.v -= entry.cost; value.made = Math.max(0, (value.made || 0) - entry.qty); }
      else { value.q += entry.qty; value.v += entry.cost; value.sold = Math.max(0, (value.sold || 0) - entry.qty); }
      setSubmarineStock(part, value);
    });
    if (!craft) {
      const list = kind === 'suite-sale' ? submarineSuiteSales : submarineSales;
      const saleIndex = list.findIndex(entry => entry.id === operation.saleId);
      if (saleIndex >= 0) list.splice(saleIndex, 1);
    }
    submarineOperations.splice(index, 1);
  }
  const netDeltas = (entries, deltasFor, signFor, idKey) => entries.reduce((totals, entry) => {
    const sign = signFor(entry);
    deltasFor(entry).forEach(delta => {
      const id = String(delta[idKey]);
      if (!id || !Number(delta.qty)) return;
      const value = totals.get(id) || { q: 0, v: 0 };
      value.q += sign * Number(delta.qty);
      value.v += sign * Number(delta.cost || 0);
      totals.set(id, value);
    });
    return totals;
  }, new Map());
  function migrateLegacyInventories() {
    let changed = false;
    const submarineNet = netDeltas(submarineOperations, entry => entry.deltas || [], entry => /craft$/.test(entry.kind) ? 1 : -1, 'partId');
    submarineData.parts.forEach(part => {
      const current = submarineStock(part), tracked = submarineNet.get(String(part.id)) || { q: 0, v: 0 };
      const quantity = Math.max(0, Number(current.q || 0) - tracked.q);
      if (!quantity) return;
      submarineOperations.unshift({ id: 'legacy-sub-op-' + part.id, kind: 'part-craft', targetId: String(part.id), quantity, deltas: [{ partId: part.id, qty: quantity, cost: Math.max(0, Number(current.v || 0) - tracked.v) }], date: today(), legacyMigration: true });
      changed = true;
    });
    const equipmentNet = netDeltas(data.l.filter(entry => entry.type === '制作' || entry.type === '出售'), entry => entry.recipeCosts || [], entry => entry.type === '制作' ? 1 : -1, 'id');
    const activeItems = new Map(['770', '750'].flatMap(ledgerRows).flatMap(bundle => bundle.components).filter(component => component.item).map(component => [String(component.item.id), component.item]));
    activeItems.forEach((item, id) => {
      const current = stock(id), tracked = equipmentNet.get(id) || { q: 0, v: 0 };
      const quantity = Math.max(0, Number(current.q || 0) - tracked.q);
      if (!quantity) return;
      const cost = Math.max(0, Number(current.v || 0) - tracked.v);
      data.l.unshift({ id: 'legacy-craft-' + id, date: today(), type: '制作', item: '历史入库 · ' + item.n, q: quantity, amount: cost, cost, autoKind: 'legacy-craft', bundleId: 'legacy-stock-' + id, recipeCosts: [{ id: item.id, qty: quantity, cost }], legacyMigration: true });
      changed = true;
    });
    return changed;
  }
  function openSubmarineCraft(target, isSuite = false) {
    state.pendingSubmarineCraft = { id: target.id, isSuite };
    document.querySelector('#submarine-craft-title').textContent = '制作入库 · ' + (isSuite ? suiteLabel(target) : target.n);
    document.querySelector('#submarine-craft-quantity-label').firstChild.textContent = isSuite ? '制作套数' : '制作数量';
    document.querySelector('#submarine-craft-quantity').value = 1;
    document.querySelector('#submarine-craft-summary').innerHTML = isSuite ? `<div>${suiteParts(target).filter(Boolean).map(part => part.n).join('、')}</div><div class="meta" style="margin-top:8px">每套预计成本 ${money(suiteCost(target))}</div>` : `<div>${target.n}</div><div class="meta" style="margin-top:8px">每件预计成本 ${money(productionPlan(submarineRow(target)).total)}</div>`;
    document.querySelector('#submarine-craft-dialog').showModal();
  }
  function openSubmarineSale(part) {
    const stockValue = submarineStock(part), price = submarinePrice(part), cost = stockValue.q ? stockValue.v / stockValue.q : 0;
    state.pendingSubmarineSale = part.id;
    document.querySelector('#submarine-sale-quantity').value = 1;
    document.querySelector('#submarine-sale-quantity').max = stockValue.q;
    document.querySelector('#submarine-sale-price').value = '';
    document.querySelector('#submarine-sale-price').placeholder = price ? `建议售价 ${Math.round(price)} G` : '请填写实际成交单价';
    document.querySelector('#submarine-sale-title').textContent = '确认售卖 · ' + part.n;
    document.querySelector('#submarine-sale-summary').innerHTML = `<div>当前库存 ${stockValue.q}</div><div style="margin-top:8px">售价 ${money(price)} · 销售成本 ${money(cost)} · 预计利润 ${money(price - cost)}</div>`;
    document.querySelector('#submarine-sale-dialog').showModal();
  }
  const submarineRawRecipe = (uid, parentJob = null) => {
    const recipes = submarineData.g?.[String(uid)] || recipeCandidatesFor(uid);
    return recipes.find(recipe => parentJob != null && Number(recipe.j) === Number(parentJob)) || recipes[0] || null;
  };
  const submarineRawInputs = (recipe, quantity = 1) => {
    if (!recipe) return [];
    const yieldCount = Math.max(1, Number(recipe.y) || 1), inputs = [];
    for (let index = 0; index < recipe.a.length; index += 2) {
      const uid = Number(recipe.a[index]), amount = Number(recipe.a[index + 1] || 0);
      if (uid > 0 && amount > 0) inputs.push({ uid, quantity: quantity * amount / yieldCount, parentJob: recipe.j });
    }
    return inputs;
  };
  const submarineMaterialSourceMarkup = material => {
    const choice = submarineSourceChoice(material);
    const npc = npcCandidate(material);
    return `<div class="cards"><div class="card"><small>当前推荐方式</small><b>${choice.label}</b><div class="meta">${choice.source}</div></div><div class="card"><small>当前参考单价</small><b>${choice.price > 0 ? money(choice.price) : '待补价'}</b><div class="meta">仅比较有效的正数价格</div></div>${npc ? `<div class="card"><small>NPC 购买来源</small><b>${money(npc.price)}</b><div class="meta">${npc.source || 'NPC 商店'}</div></div>` : ''}</div>${sourceChoiceComparisonTable(choice)}`;
  };
  function openSubmarineMaterialDetail(uid) {
    const material = data.m.find(item => String(item.uid) === String(uid));
    if (!material) return;
    if (submarineRawRecipe(uid)) return openSubmarineRecipeReference(uid, true);
    document.querySelector('#recipe-reference-meta').textContent = '潜水艇售卖 > 材料详情';
    document.querySelector('#recipe-reference-title').textContent = material.n + '材料详情';
    document.querySelector('#recipe-reference-content').innerHTML = submarineMaterialSourceMarkup(material);
    document.querySelector('#recipe-reference-dialog').showModal();
  }
  function openSubmarineRecipeReference(uid, includeSource = false) {
    const recipe = submarineRawRecipe(uid);
    if (!recipe) return;
    const material = data.m.find(item => String(item.uid) === String(uid)) || { uid: String(uid), n: materialName(uid) };
    const yieldCount = Math.max(1, Number(recipe.y) || 1);
    // 参考窗口按一整批配方展示；成本表尾再除以产出量得到单件成本。
    const direct = submarineRawInputs(recipe, yieldCount);
    const leaves = new Map();
    const expand = (itemId, quantity, parentJob = null, trail = new Set()) => {
      const node = submarineRawRecipe(itemId, parentJob), key = `${itemId}@${node?.id || node?.j || 'leaf'}`;
      if (!node || trail.has(key)) {
        leaves.set(String(itemId), (leaves.get(String(itemId)) || 0) + quantity);
        return;
      }
      const next = new Set(trail); next.add(key);
      submarineRawInputs(node, quantity).forEach(input => expand(input.uid, input.quantity, input.parentJob, next));
    };
    expand(uid, yieldCount);
    const pricedRows = rows => rows.map(row => {
      const material = data.m.find(item => String(item.uid) === String(row.uid)) || { uid: String(row.uid), n: materialName(row.uid) };
      const choice = submarineSourceChoice(material), unit = Number(choice.price || 0), total = unit * Number(row.quantity || 0);
      return { ...row, choice, unit, total };
    });
    const materialRows = rows => rows.map(row => `<tr><td class="label">${recommendationTag(row.choice)}${itemLabelMarkup(row.uid, materialName(row.uid))}</td><td>${Number(row.quantity.toFixed(4))}</td><td>${row.unit > 0 ? money(row.unit) : '未获取'}</td><td>${row.unit > 0 ? money(row.total) : '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">暂无配方数据</td></tr>';
    const referenceTable = (rows, label) => {
      const priced = pricedRows(rows), total = priced.reduce((sum, row) => sum + row.total, 0), missing = priced.some(row => !(row.unit > 0));
      const footer = yieldCount > 1
        ? `${label} · 批次合价 ${missing ? '部分未获取' : money(total)} ÷ 每批产出 ${yieldCount} 个`
        : label;
      return `<div class="table-wrap history-table"><table class="ledger"><thead><tr><th>材料</th><th>数量</th><th>参考单价</th><th>${yieldCount > 1 ? '批次合价' : '参考合价'}</th></tr></thead><tbody>${materialRows(priced)}</tbody><tfoot><tr><th colspan="3">${footer}</th><th>${missing ? '部分未获取' : money(total / yieldCount)}</th></tr></tfoot></table></div>`;
    };
    const leafRows = [...leaves.entries()].map(([itemId, quantity]) => ({ uid: Number(itemId), quantity })).sort((left, right) => left.uid - right.uid);
    const chosenCostRows = submarineCraftInputBreakdown(uid).map(row => ({ ...row, quantity: row.batchQuantity }));
    document.querySelector('#recipe-reference-meta').textContent = includeSource ? '潜水艇售卖 > 材料详情' : '潜水艇配方参考';
    document.querySelector('#recipe-reference-title').textContent = materialName(uid) + (includeSource ? '材料详情' : '制作配方参考');
    document.querySelector('#recipe-reference-content').innerHTML = `${includeSource ? submarineMaterialSourceMarkup(material) : ''}<div class="cards"><div class="card"><small>制作职业</small><b>${recipe.j === 0 ? '部队合建' : '职业 ' + recipe.j}</b></div><div class="card"><small>每批产出</small><b>${yieldCount}</b></div></div><section class="sales-history"><h3>直接制作素材</h3>${referenceTable(direct, '直接素材参考成本')}</section><section class="sales-history"><h3>当前最低来源制作成本</h3>${referenceTable(chosenCostRows, '按当前来源制作成本')}</section><section class="sales-history"><h3>递归基础素材参考</h3>${referenceTable(leafRows, '基础素材参考成本')}</section>`;
    document.querySelector('#recipe-reference-dialog').showModal();
  }
  function openLeveMaterialSourceDetail(uid) {
    uid = String(uid || '');
    const material = leveMaterial(uid);
    if (!material) return;
    const choice = leveCraftInputChoice(uid);
    const craftRows = leveCraftInputBreakdown(uid);
    const recipe = leveRecipeNode(uid), yieldCount = Math.max(1, Number(recipe?.y || 1));
    const craftBatchTotal = craftRows.reduce((sum, row) => sum + Number(row.batchTotal || 0), 0);
    const craftMissing = craftRows.some(row => !(Number(row.unit) > 0));
    const craftUnit = leveRecipeUnitCost(uid, new Set(), false);
    const craftTable = craftRows.length ? `<section class="sales-history"><h3>自制成本采用的下级来源${yieldCount > 1 ? ` · 每批产出 ${yieldCount} 个` : ''}</h3><div class="table-wrap history-table"><table class="ledger"><thead><tr><th>下级材料</th><th>数量</th><th>采用方式</th><th>单价</th><th>${yieldCount > 1 ? '批次合价' : '合价'}</th></tr></thead><tbody>${craftRows.map(row => `<tr><td class="label">${itemLabelMarkup(row.uid, row.name)}</td><td>${Number(row.batchQuantity.toFixed(4))}</td><td>${recommendationTag(row.choice, row.choice.label)}</td><td>${row.unit > 0 ? money(row.unit) : '未获取'}</td><td>${row.unit > 0 ? money(row.batchTotal) : '—'}</td></tr>`).join('')}</tbody><tfoot><tr><th colspan="4">${yieldCount > 1 ? `批次合价 ${craftMissing ? '部分未获取' : money(craftBatchTotal)} ÷ 每批产出 ${yieldCount} 个` : '按当前来源制作成本'}</th><th>${craftMissing ? '部分未获取' : money(craftUnit || 0)}</th></tr></tfoot></table></div></section>` : '';
    document.querySelector('#bundle-detail-meta').textContent = '材料指导价 > 理符推荐材料 > 来源比价';
    document.querySelector('#bundle-detail-title').textContent = material.n + '来源比价';
    document.querySelector('#bundle-detail-content').innerHTML = `<div class="cards"><div class="card"><small>推荐方式</small><b>${choice.label}</b><div class="meta">${choice.source}</div></div><div class="card"><small>当前最低有效单价</small><b>${choice.price > 0 ? money(choice.price) : '待补价'}</b><div class="meta">仅比较有效的正数价格</div></div></div>${sourceChoiceComparisonTable(choice)}${craftTable}`;
    if (!document.querySelector('#bundle-detail-dialog').open) document.querySelector('#bundle-detail-dialog').showModal();
  }
  function openLeveRecipeReference(uid, isDelivery = false) {
    uid = String(uid || '');
    const recipe = leveRecipeNode(uid), material = leveMaterial(uid);
    document.querySelector('#bundle-detail-meta').textContent = '理符售卖 > 交付物制作成本';
    document.querySelector('#bundle-detail-title').textContent = (material?.n || materialName(uid)) + '详情';
    if (!recipe) {
      document.querySelector('#bundle-detail-content').innerHTML = `<div class="note">Garland Tools 未导入该交付物的制作配方；该物品不能作为制作流程或递归成本计算依据。</div>`;
      document.querySelector('#bundle-detail-dialog').showModal();
      return;
    }
    const yieldCount = Math.max(1, Number(recipe.y) || 1);
    const sourceChoiceFor = itemId => leveCraftInputChoice(itemId);
    const isNpcTerminal = itemId => sourceChoiceFor(itemId).key === 'npc';
    const isExchangeTerminal = itemId => isExchangeChoice(sourceChoiceFor(itemId));
    const isMarketTerminal = itemId => ['direct-purchase', 'direct-market'].includes(sourceChoiceFor(itemId).key);
    const isMarketIntermediate = itemId => isMarketTerminal(itemId) && Boolean(leveRecipeNode(itemId));
    const isTerminal = itemId => sourceChoiceFor(itemId).key !== 'craft';
    const makeRequest = (itemId, quantity) => {
      const choice = sourceChoiceFor(itemId), unit = Number(choice.price || 0);
      return { uid: Number(itemId), name: leveMaterial(itemId)?.n || materialName(itemId), quantity: Number(quantity || 0), cost: unit * Number(quantity || 0), sourceChoice: choice };
    };
    const merge = requests => {
      const rows = new Map();
      requests.forEach(request => {
        const key = String(request.uid), previous = rows.get(key) || { ...request, quantity: 0, cost: 0, pinnedNpc: isNpcTerminal(request.uid), pinnedExchange: isExchangeTerminal(request.uid), pinnedMarket: isMarketIntermediate(request.uid) };
        previous.quantity += Number(request.quantity || 0);
        previous.cost += Number(request.cost || 0);
        rows.set(key, previous);
      });
      return [...rows.values()].sort((left, right) => Number(right.pinnedNpc) - Number(left.pinnedNpc) || Number(right.pinnedExchange) - Number(left.pinnedExchange) || Number(right.pinnedMarket) - Number(left.pinnedMarket) || left.uid - right.uid);
    };
    const recipeInputs = (itemId, quantity) => {
      const node = leveRecipeNode(itemId);
      if (!node) return [];
      const unitQuantity = Number(quantity || 0) / Math.max(1, Number(node.y) || 1);
      return Array.from({ length: node.a.length / 2 }, (_, index) => makeRequest(node.a[index * 2], unitQuantity * Number(node.a[index * 2 + 1] || 0))).filter(row => row.uid && row.quantity > 0);
    };
    // 一个交付物为成本单位：根物品固定按 Garland 配方展开，后续节点才比较最低有效来源。
    const direct = merge(recipeInputs(uid, 1));
    const basicRequests = [], expandBasic = (request, trail = new Set()) => {
      const key = `${request.uid}@${leveRecipeNode(request.uid)?.id || 'base'}`;
      if (trail.has(key) || isTerminal(request.uid) || !leveRecipeNode(request.uid)) { basicRequests.push(request); return; }
      const next = new Set(trail); next.add(key);
      recipeInputs(request.uid, request.quantity).forEach(child => expandBasic(child, next));
    };
    direct.forEach(request => expandBasic(request));
    const basic = merge(basicRequests), unitCost = leveRecipeUnitCost(uid, new Set(), false, !isDelivery);
    const missing = basic.filter(row => !(Number(row.sourceChoice?.price) > 0)).map(row => row.name);
    const finished = [{ uid: Number(uid), name: material?.n || materialName(uid), quantity: 1, cost: Number(unitCost || 0), hq: isDelivery }];
    const leveCostTable = (rows, label, total, grouped = false) => {
      const visibleRows = rows;
      const rowHtml = row => {
        const missingCost = !(Number(row.cost) > 0) && Number(row.quantity) > 0;
        const unit = Number(row.quantity) ? Number(row.cost || 0) / Number(row.quantity) : 0;
        const tag = grouped && row.sourceChoice && (row.pinnedNpc || row.pinnedExchange || row.pinnedMarket) ? recommendationTag(row.sourceChoice) : '';
        const name = row.timeSurcharge ? `<span class="item-label"><span>${row.name}</span></span>` : `<button class="submarine-material-link" data-leve-recipe-purchase="${row.uid}">${itemLabelMarkup(row.uid, row.name, row.hq ? { hq: true } : {})}</button>`;
        return `<tr><td class="label">${tag}${name}</td><td>${Number(row.quantity.toFixed(4))}</td><td>${missingCost ? '未获取' : money(unit)}</td><td>${missingCost ? '—' : money(row.cost)}</td></tr>`;
      };
      const sections = grouped ? [
        ['NPC 固定价材料', visibleRows.filter(row => row.pinnedNpc)],
        ['兑换推荐材料', visibleRows.filter(row => !row.pinnedNpc && row.pinnedExchange)],
        ['市场采购材料', visibleRows.filter(row => !row.pinnedNpc && !row.pinnedExchange && row.pinnedMarket)],
        ['其余材料', visibleRows.filter(row => !row.pinnedNpc && !row.pinnedExchange && !row.pinnedMarket)]
      ].filter(([, entries]) => entries.length).map(([title, entries]) => `<tr class="detail-section"><td colspan="4">${title}</td></tr>${entries.map(rowHtml).join('')}`).join('') : rows.map(rowHtml).join('');
      const incomplete = visibleRows.some(row => !(Number(row.cost) > 0) && Number(row.quantity) > 0);
      return `<div class="table-wrap history-table"><table class="ledger"><thead><tr><th>材料 / 成品</th><th>数量</th><th>单价</th><th>合价</th></tr></thead><tbody>${sections || '<tr><td colspan="4" class="empty">暂无配方数据</td></tr>'}</tbody><tfoot><tr><th colspan="3">${label}</th><th>${incomplete ? '部分未获取' : money(total)}</th></tr></tfoot></table></div>`;
    };
    const source = recipe.sourceUrl ? `<a href="${recipe.sourceUrl}" target="_blank" rel="noreferrer">查看 Garland 配方</a>` : 'Garland 来源未记录';
    document.querySelector('#bundle-detail-content').innerHTML = `${missing.length ? `<div class="status">以下基础材料未获取单价：${[...new Set(missing)].join('、')}。</div>` : ''}<div class="detail-columns three"><section class="detail-column"><h3>成品清单</h3>${leveCostTable(finished, '成品清单总成本', unitCost || 0)}</section><section class="detail-column"><h3>直接素材</h3>${leveCostTable(direct, '直接素材总成本', unitCost || 0, true)}</section><section class="detail-column"><h3>基础素材</h3>${leveCostTable(basic, '基础素材总成本', unitCost || 0, true)}</section></div><p class="meta" style="margin-top:14px">${source} · 以制作 1 个${isDelivery ? ' HQ 交付物' : '材料'}为成本口径；每批产出 ${yieldCount} 个。</p>`;
    document.querySelectorAll('[data-leve-recipe-purchase]').forEach(button => button.onclick = () => { const target = leveMaterial(button.dataset.leveRecipePurchase); if (target) openPurchaseManager(target); });
    document.querySelector('#bundle-detail-dialog').showModal();
  }
  // 潜水艇详情的合建层保持工房根配方；下层只沿统一生产计划实际展开的节点展示。
  // 这样 NPC、市场与兑换成本终点不会泄漏下级素材，且每一栏都能复用同一份批次成本分摊。
  function submarineDetailLayers(plan, part) {
    const rawRecipe = submarineRawRecipe;
    const rawInputs = submarineRawInputs;
    const materialFor = uid => data.m.find(material => String(material.uid) === String(uid)) || { uid: String(uid), n: materialName(uid) };
    const sourceChoiceFor = uid => submarineSourceChoice(materialFor(uid));
    const isNpcTerminal = uid => sourceChoiceFor(uid).key === 'npc';
    const isExchangeTerminal = uid => isExchangeChoice(sourceChoiceFor(uid));
    const isMarketTerminal = uid => ['direct-purchase', 'direct-market'].includes(sourceChoiceFor(uid).key);
    // 仅可制作的非潜水艇部件半成品才进入“市场采购材料”分区；
    // 矿石、水晶等市场原材料仍是成本终点，但保留在“其余材料”。
    const isMarketIntermediateTerminal = uid => isMarketTerminal(uid) && Boolean(rawRecipe(uid)) && !submarinePartIds().has(String(uid));
    // 市场、NPC 与兑换均为实际取得成本终点；只有推荐自制的半成品才继续展开配方。
    const isCostTerminal = uid => isNpcTerminal(uid) || isExchangeTerminal(uid) || isMarketTerminal(uid);
    const planKeyFor = (uid, parentJob = null) => {
      const node = recipeNodeFor(uid, parentJob, 'submarine');
      return node ? nodeKey(uid, node) : `leaf@${uid}`;
    };
    // 原始配方用于展示层级；当前采用 NPC / 兑换渠道的子项保留其渠道单价，
    // 其余成本再在可制作子项间分摊，避免详情出现不属于任何取得方式的混合单价。
    const distributeCost = (requests, totalCost) => {
      if (!requests.length) return requests;
      const weighted = requests.map(request => {
        const choice = sourceChoiceFor(request.uid), terminal = isCostTerminal(request.uid);
        return { ...request, choice, terminal, weight: Number(choice.price || 0) * Number(request.quantity || 0) };
      });
      const fixedCost = weighted.filter(request => request.terminal).reduce((sum, request) => sum + request.weight, 0);
      const flexible = weighted.filter(request => !request.terminal);
      const distributable = Math.max(0, Number(totalCost || 0) - fixedCost);
      const totalWeight = flexible.reduce((sum, request) => sum + request.weight, 0) || flexible.reduce((sum, request) => sum + Number(request.quantity || 0), 0) || 1;
      let allocated = 0;
      return weighted.map((request, index) => {
        if (request.terminal) return { ...request, cost: request.weight };
        const remainingFlexible = flexible.at(-1) === request;
        const cost = remainingFlexible ? distributable - allocated : distributable * ((request.weight || request.quantity || 0) / totalWeight);
        allocated += cost;
        return { ...request, cost };
      });
    };
    const merge = (requests, pinnedNpcIds = new Set(), pinnedExchangeIds = new Set(), pinnedMarketIds = new Set()) => {
      const rows = new Map();
      requests.forEach(request => {
        const key = String(request.uid), sourceChoice = sourceChoiceFor(request.uid), existing = rows.get(key) || {
          uid: Number(request.uid), name: materialName(request.uid), quantity: 0, cost: 0,
          pinnedNpc: pinnedNpcIds.has(key), pinnedExchange: pinnedExchangeIds.has(key),
          pinnedMarket: pinnedMarketIds.has(key),
          sourceChoice
        };
        existing.quantity += Number(request.quantity || 0);
        existing.cost += request.cost ?? plan.allocationCost(request.key || planKeyFor(request.uid, request.parentJob), Number(request.quantity || 0));
        rows.set(key, existing);
      });
      // 仅“由合建层直接下放”的 NPC 终点置顶；原本属于直接/基础层的 NPC 材料保留原排序。
      return [...rows.values()].sort((left, right) => Number(right.pinnedNpc) - Number(left.pinnedNpc) || Number(right.pinnedExchange) - Number(left.pinnedExchange) || Number(right.pinnedMarket) - Number(left.pinnedMarket) || left.uid - right.uid);
    };
    const rootRecipe = rawRecipe(part.id);
    const root = plan.roots.find(entry => Number(entry.uid) === Number(part.id));
    const rootEntry = root && plan.nodes.get(root.key);
    // 优先使用计划中的根节点输入（包含配方产出批次），异常时才回退到原始工房配方。
    const assemblyRequests = rootEntry
      ? rootEntry.inputs.map(input => ({ ...input, quantity: input.quantity * root.quantity / Math.max(rootEntry.needed, 1), parentJob: rootEntry.node.j }))
      : rawInputs(rootRecipe, 1).map(request => ({ ...request, key: planKeyFor(request.uid, request.parentJob) }));
    const requestCost = request => request.cost ?? plan.allocationCost(request.key || planKeyFor(request.uid, request.parentJob), Number(request.quantity || 0));
    const childRequests = request => {
      const requestKey = request.key || planKeyFor(request.uid, request.parentJob);
      // 生产计划已经把外购、NPC、兑换材料作为叶子时，详情也必须在此终止，
      // 不能继续展开后再人为分摊成本。
      if (requestKey.startsWith('leaf@') || isCostTerminal(request.uid)) return [{ ...request, key: requestKey, cost: requestCost(request) }];
      const recipe = rawRecipe(request.uid, request.parentJob);
      if (!recipe) return [{ ...request, key: requestKey, cost: requestCost(request) }];
      return distributeCost(rawInputs(recipe, request.quantity), requestCost(request));
    };
    // 合建材料为 NPC / 兑换终点时，本身作为直接素材终点，并在各自分区中标记。
    const directRequests = assemblyRequests.flatMap(childRequests);
    // 直接素材的顶部来源分区只收纳由合建层直接下放的终点；下级材料仍保留原配方位置。
    const directPinnedNpcIds = new Set(assemblyRequests.filter(request => isNpcTerminal(request.uid)).map(request => String(request.uid)));
    const directPinnedExchangeIds = new Set(assemblyRequests.filter(request => isExchangeTerminal(request.uid)).map(request => String(request.uid)));
    const directPinnedMarketIds = new Set(assemblyRequests.filter(request => isMarketIntermediateTerminal(request.uid)).map(request => String(request.uid)));
    const basicRequests = [];
    const expandBasic = (request, trail = new Set()) => {
      const requestKey = request.key || planKeyFor(request.uid, request.parentJob);
      if (trail.has(requestKey) || requestKey.startsWith('leaf@') || isCostTerminal(request.uid)) { basicRequests.push({ ...request, key: requestKey }); return; }
      const recipe = rawRecipe(request.uid, request.parentJob);
      if (!recipe) { basicRequests.push({ ...request, key: requestKey }); return; }
      const next = new Set(trail); next.add(requestKey);
      distributeCost(rawInputs(recipe, request.quantity), requestCost(request)).forEach(child => expandBasic(child, next));
    };
    directRequests.forEach(request => expandBasic(request));
    // 基础素材将实际采用 NPC / 兑换成本、因而停止递归的材料置顶。
    const basicPinnedNpcIds = new Set(basicRequests.filter(request => isNpcTerminal(request.uid)).map(request => String(request.uid)));
    const basicPinnedExchangeIds = new Set(basicRequests.filter(request => isExchangeTerminal(request.uid)).map(request => String(request.uid)));
    const basicPinnedMarketIds = new Set(basicRequests.filter(request => isMarketIntermediateTerminal(request.uid)).map(request => String(request.uid)));
    return { assembly: merge(assemblyRequests), direct: merge(directRequests, directPinnedNpcIds, directPinnedExchangeIds, directPinnedMarketIds), basic: merge(basicRequests, basicPinnedNpcIds, basicPinnedExchangeIds, basicPinnedMarketIds) };
  }
  function openSubmarineDetail(part, showBasicNpc = true) {
    const plan = productionPlan(submarineRow(part)), layers = submarineDetailLayers(plan, part), history = submarineHistory(part);
    document.querySelector('#bundle-detail-meta').textContent = '潜水艇售卖 > ' + part.n;
    document.querySelector('#bundle-detail-title').textContent = part.n + '详情';
    const direct = layers.direct;
    const basic = showBasicNpc ? layers.basic : layers.basic.filter(row => !row.pinnedNpc);
    const costOptions = { timeCost: plan.timeCost, craftedOutputs: plan.craftedOutputs };
    document.querySelector('#bundle-detail-content').innerHTML = `${plan.missing.length ? `<div class="status">以下基础材料未获取单价：${plan.missing.join('、')}。</div>` : ''}<div class="detail-columns four"><section class="detail-column"><h3>成品清单</h3>${costTable(plan.finished, '成品清单总成本', plan.total, { ...costOptions, submarine: true })}</section><section class="detail-column"><h3>合建制作材料</h3>${costTable(layers.assembly, '合建制作材料总成本', plan.total, { ...costOptions, submarine: true })}</section><section class="detail-column"><h3>直接素材</h3>${costTable(direct, '直接素材总成本', plan.total, { ...costOptions, npcSection: true, sourceSections: true, submarine: true })}</section><section class="detail-column"><h3>基础素材 <button class="section-toggle" data-sub-detail-basic>${showBasicNpc ? '隐藏 NPC 材料' : '显示 NPC 材料'}</button></h3>${costTable(basic, '基础素材总成本', plan.basicTotal, { ...costOptions, reconcile: false, npcSection: showBasicNpc, sourceSections: true, submarine: true })}</section></div><section class="sales-history"><div class="history-head"><h3>历史销售记录</h3></div><div class="table-wrap history-table"><table class="ledger"><thead><tr><th>日期</th><th>销售额</th><th>销售成本</th><th>利润</th></tr></thead><tbody>${history.map(entry => `<tr><td>${entry.date}</td><td>${money(entry.amount)}</td><td>${money(entry.cost)}</td><td class="profit">${money(entry.profit)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">暂无销售记录</td></tr>'}</tbody></table></div></section>`;
    document.querySelector('[data-sub-detail-basic]').onclick = () => openSubmarineDetail(part, !showBasicNpc);
    document.querySelectorAll('[data-submarine-material-detail]').forEach(button => button.onclick = () => openSubmarineMaterialDetail(Number(button.dataset.submarineMaterialDetail)));
    if (!document.querySelector('#bundle-detail-dialog').open) document.querySelector('#bundle-detail-dialog').showModal();
  }
  const submarineSalesTotals = rows => rows.reduce((total, row) => ({ amount: total.amount + Number(row.amount || 0), cost: total.cost + Number(row.cost || 0), profit: total.profit + Number(row.profit || 0), quantity: total.quantity + Number(row.q || 1) }), { amount: 0, cost: 0, profit: 0, quantity: 0 });
  function openSubmarineReport(title, records) {
    document.querySelector('#overview-sales-title').textContent = title;
    document.querySelector('#overview-sales-content').innerHTML = salesTable(records.map(row => ({ ...row, source: row.suiteId ? '潜水艇整套' : '潜水艇单件', q: Number(row.q) || 1 })));
    document.querySelector('#overview-sales-dialog').showModal();
  }
  function openSubmarineSuiteDetail(suite) {
    const parts = suiteParts(suite).filter(Boolean), history = suiteHistory(suite), cost = suiteCost(suite), price = suitePrice(suite);
    document.querySelector('#bundle-detail-meta').textContent = '潜水艇售卖 > 整套 ' + suiteLabel(suite);
    document.querySelector('#bundle-detail-title').textContent = suiteLabel(suite) + ' 套装详情';
    document.querySelector('#bundle-detail-content').innerHTML = `<div class="cards"><div class="card"><small>剩余套数</small><b>${suiteStock(suite)}</b></div><div class="card"><small>每套成本</small><b>${money(cost)}</b></div><div class="card"><small>建议售价</small><b>${money(price)}</b></div><div class="card"><small>预计利润</small><b>${money(price - cost)}</b></div></div><div class="table-wrap history-table"><table class="ledger"><thead><tr><th>部位</th><th>部件</th><th>库存</th><th>单件成本</th></tr></thead><tbody>${parts.map(part => `<tr><td>${part.part}</td><td class="label"><button class="bundle-link" data-suite-part-detail="${part.id}">${itemLabelMarkup(part.id, part.n)}</button></td><td>${submarineStock(part).q}</td><td>${money(submarineStock(part).q ? submarineStock(part).v / submarineStock(part).q : productionPlan(submarineRow(part)).total)}</td></tr>`).join('')}</tbody></table></div><section class="sales-history"><h3>整套销售历史</h3>${salesTable(history.map(row => ({ ...row, source: '潜水艇整套' })))}</section>`;
    document.querySelectorAll('[data-suite-part-detail]').forEach(button => button.onclick = () => openSubmarineDetail(submarineData.parts.find(part => String(part.id) === button.dataset.suitePartDetail)));
    if (!document.querySelector('#bundle-detail-dialog').open) document.querySelector('#bundle-detail-dialog').showModal();
  }
  const tradeMaterial = itemId => data.m.find(material => String(material.uid) === String(itemId));
  const tradeCategoryOrder = ['botanist', 'miner', 'combat', 'crystal', 'other'];
  const tradeCategoryLabels = { botanist: '园艺', miner: '采矿', combat: '战职', crystal: '水晶', other: '其他' };
  const tradeDisplayName = material => material?.n || material?.name || '';
  const isTradeCrystal = material => isCrystal({ n: tradeDisplayName(material) });
  const staticTradeCategoryCandidates = material => {
    if (isTradeCrystal(material)) return ['crystal'];
    const uid = String(material?.uid || material?.itemId || '');
    const source = materialSources[uid] || {};
    const categories = new Set((source.tradeCategories || []).filter(category => tradeCategoryOrder.includes(category)));
    if (retainerData[uid]?.job === '园艺工') categories.add('botanist');
    if (retainerData[uid]?.job === '采矿工') categories.add('miner');
    const kinds = [...(source.nativeSubmarineKinds || []), ...(source.submarineKinds || []), ...(source.equipmentKinds || [])];
    if (kinds.includes('怪物掉落')) categories.add('combat');
    return [...categories].sort((left, right) => tradeCategoryOrder.indexOf(left) - tradeCategoryOrder.indexOf(right));
  };
  const sortTradeCategories = categories => [...new Set(categories || [])]
    .filter(category => tradeCategoryOrder.includes(category))
    .sort((left, right) => tradeCategoryOrder.indexOf(left) - tradeCategoryOrder.indexOf(right));
  const tradeSourceParserVersion = 2;
  const garlandItemSourceUrl = uid => `https://www.garlandtools.org/db/doc/item/en/3/${encodeURIComponent(uid)}.json`;
  const garlandCoreSourceUrl = 'https://www.garlandtools.org/db/doc/core/en/3/data.json';
  const garlandCoreCacheIsFresh = cache => cache?.version === garlandVentureCoreCacheVersion
    && cache?.ventureIndex && cache?.jobCategories
    && Date.now() - Date.parse(cache.fetchedAt || '') < garlandVentureCoreCacheTtl;
  const compactGarlandVentureCore = core => ({
    version: garlandVentureCoreCacheVersion,
    fetchedAt: new Date().toISOString(),
    ventureIndex: Object.fromEntries(Object.entries(core?.ventureIndex || {}).map(([id, venture]) => [id, {
      id: Number(venture?.id || id), jobs: Number(venture?.jobs), lvl: Number(venture?.lvl)
    }])),
    jobCategories: Object.fromEntries(Object.entries(core?.jobCategories || {}).map(([id, category]) => [id, {
      id: Number(category?.id || id), name: String(category?.name || ''), jobs: Array.isArray(category?.jobs) ? category.jobs.map(Number) : []
    }]))
  });
  const loadGarlandVentureCore = ({ force = false } = {}) => {
    if (!force && garlandCoreCacheIsFresh(garlandVentureCoreCache)) {
      const cacheAge = Date.now() - Date.parse(garlandVentureCoreCache.fetchedAt);
      if (cacheAge > garlandVentureCoreCacheTtl / 2 && !garlandVentureCoreRequest) loadGarlandVentureCore({ force: true }).catch(() => {});
      return Promise.resolve(garlandVentureCoreCache);
    }
    if (garlandVentureCoreRequest) return garlandVentureCoreRequest;
    garlandVentureCoreRequest = fetch(garlandCoreSourceUrl, { cache: 'no-store' })
      .then(response => response.ok ? response.json() : Promise.reject(new Error(`Garland 核心资料返回 ${response.status}`)))
      .then(core => {
        const compact = compactGarlandVentureCore(core);
        if (!Object.keys(compact.ventureIndex).length || !Object.keys(compact.jobCategories).length) throw new Error('Garland 核心资料缺少雇员职业索引');
        garlandVentureCoreCache = compact;
        save();
        return compact;
      })
      .finally(() => { garlandVentureCoreRequest = null; });
    return garlandVentureCoreRequest;
  };
  const garlandVentureCategories = (ventureId, core) => {
    const venture = core?.ventureIndex?.[String(ventureId)];
    const jobCategory = venture ? core?.jobCategories?.[String(venture.jobs)] : null;
    if (!venture || !jobCategory) return { categories: [], evidence: null };
    const jobs = new Set((jobCategory.jobs || []).map(Number));
    const categories = [];
    if (jobs.has(17)) categories.push('miner');
    if (jobs.has(18)) categories.push('botanist');
    if (/disciple(?:s)? of (?:war|magic)|war or magic/i.test(jobCategory.name || '')) categories.push('combat');
    const resolved = sortTradeCategories(categories);
    return {
      categories: resolved,
      evidence: resolved.length ? `Garland 雇员探险：${jobCategory.name || resolved.map(category => tradeCategoryLabels[category]).join('／')}（Lv.${venture.lvl || '—'}）` : null
    };
  };
  // item 文档给出节点、怪物和雇员编号；雇员职业则由 Garland 核心资料的 ventureIndex / jobCategories 实时解析。
  const garlandSourceCategories = (payload, core) => {
    const item = payload?.item || {};
    const categories = [];
    const evidence = [];
    if (Array.isArray(item.nodes) && item.nodes.length) {
      if ([48, 54].includes(Number(item.category))) categories.push('miner');
      if ([45, 50, 51].includes(Number(item.category))) categories.push('botanist');
      evidence.push('采集节点');
    }
    if (Array.isArray(item.mobs) && item.mobs.length) { categories.push('combat'); evidence.push('怪物掉落'); }
    (item.ventures || []).forEach(ventureId => {
      const resolved = garlandVentureCategories(ventureId, core);
      categories.push(...resolved.categories);
      if (resolved.evidence) evidence.push(resolved.evidence);
    });
    return { categories: sortTradeCategories(categories), evidence };
  };
  const tradeSourceEvidence = (material, cached = null) => {
    const source = materialSources[String(material?.uid || material?.itemId || '')] || {};
    const verified = source?.verified?.evidence || [];
    return [...new Set([...(cached?.evidence || []), ...verified])];
  };
  const tradeSourceResolution = material => {
    if (!material) return { ready: false, categories: [], status: 'empty' };
    if (isTradeCrystal(material)) return { ready: true, categories: ['crystal'], status: 'local' };
    const uid = String(material.uid || material.itemId || '');
    const staticCategories = staticTradeCategoryCandidates(material);
    const cached = tradeSourceCache[uid];
    // 已核验覆盖层可修正早期“无分类”缓存；缓存只能补充，不能覆盖资料包中的明确结论。
    if (staticCategories.length) return { ready: true, categories: staticCategories, status: 'static', cached };
    if (cached?.verified && cached.parserVersion === tradeSourceParserVersion) return { ready: true, categories: sortTradeCategories(cached.categories), status: 'cached', cached };
    if (state.tradeSourceLoading.has(uid)) return { ready: false, categories: [], status: 'loading' };
    if (state.tradeSourceFailures.has(uid)) return { ready: false, categories: [], status: 'failed' };
    return { ready: false, categories: [], status: 'pending' };
  };
  const tradeCategoryCandidates = material => tradeSourceResolution(material).categories;
  const fetchTradeSource = async (material, { refresh = true } = {}) => {
    const uid = String(material?.uid || material?.itemId || '');
    if (!/^\d+$/.test(uid) || isTradeCrystal(material) || state.tradeSourceLoading.has(uid)) return tradeSourceResolution(material);
    state.tradeSourceLoading.add(uid);
    state.tradeSourceFailures.delete(uid);
    try {
      const payload = await fetch(garlandItemSourceUrl(uid), { cache: 'no-store' })
        .then(response => response.ok ? response.json() : Promise.reject(new Error(`Garland 返回 ${response.status}`)));
      const garlandItem = payload?.item;
      if (!garlandItem || Number(garlandItem.id) !== Number(uid)) throw new Error('Garland 未返回匹配的物品资料');
      const core = Array.isArray(garlandItem.ventures) && garlandItem.ventures.length ? await loadGarlandVentureCore() : null;
      const garlandSource = garlandSourceCategories(payload, core);
      const categories = sortTradeCategories([...garlandSource.categories, ...staticTradeCategoryCandidates(material)]);
      const icon = Number(garlandItem?.icon || 0);
      if (icon > 0) {
        garlandIconCache[uid] = icon;
        localStorage.setItem(garlandIconCacheKey, JSON.stringify(garlandIconCache));
      }
      tradeSourceCache[uid] = {
        itemId: uid,
        name: material.n || material.name || garlandItem?.name || uid,
        categories,
        evidence: [...new Set([...garlandSource.evidence, ...tradeSourceEvidence(material)])],
        sourceUrl: garlandItemSourceUrl(uid),
        garlandUrl: garlandItemSourceUrl(uid),
        queriedAt: new Date().toISOString(),
        verified: true,
        garlandVerified: true,
        parserVersion: tradeSourceParserVersion
      };
      save();
      return tradeSourceResolution(material);
    } catch (error) {
      state.tradeSourceFailures.set(uid, error?.message || '来源查询失败');
      return tradeSourceResolution(material);
    } finally {
      state.tradeSourceLoading.delete(uid);
      if (refresh && document.querySelector('#trade-listing-dialog[open] #trade-listing-item-id')?.value === uid) {
        document.querySelector('#trade-listing-search')?.dispatchEvent(new Event('input'));
      }
    }
  };
  const tradeListingCategory = listing => {
    if (tradeCategoryOrder.includes(listing?.category)) return listing.category;
    const categories = tradeCategoryCandidates(tradeMaterial(listing?.itemId) || listing);
    return categories.length === 1 ? categories[0] : 'other';
  };
  const tradeGroupSize = material => isTradeCrystal(material) || Number(material?.groupSize) === 9999 ? 9999 : 999;
  const tradePriceMultiplier = material => isTradeCrystal(material) || Number(material?.groupSize) === 9999 ? 10000 : 1000;
  const tradeTotal = listing => Number(listing.groups || 0) * tradePriceMultiplier(tradeMaterial(listing.itemId) || listing) * Number(listing.unitPrice || 0);
  let activeTradePopover = null, tradePopoverHideTimer = null;
  const tradeMarketPopoverContent = material => {
    const listings = Array.isArray(material?.marketListings) ? material.marketListings : [];
    const details = listings.length
      ? `<div class="trade-market-listings">${listings.map(listing => `<div><span>[${listing.hq ? 'HQ' : 'NQ'}] ${money(listing.pricePerUnit)} × ${moneyFormatter.format(listing.quantity)} = ${money(listing.pricePerUnit * listing.quantity)}</span><small>${listing.retainerName || '匿名雇员'}${listing.worldName ? `（${listing.worldName}）` : ''}</small></div>`).join('')}</div>`
      : `<p>${material?.marketStatus === 'no-listings' ? '当前没有 HQ／NQ 挂单。' : material?.marketStatus === 'stale' ? '市场刷新失败，暂无可展示的最近挂单。' : '尚未缓存挂单；请刷新市场参考。'}</p>`;
    return `<b>中国区当前 HQ／NQ 挂单</b><em>${material?.u ? `刷新于 ${material.u}` : '未刷新'}</em>${details}`;
  };
  const hideTradeMarketPopover = (delayed = false) => {
    clearTimeout(tradePopoverHideTimer);
    const hide = () => { activeTradePopover = null; document.querySelector('#trade-market-popover').hidden = true; };
    if (delayed) tradePopoverHideTimer = setTimeout(hide, 120); else hide();
  };
  const positionTradeMarketPopover = () => {
    if (!activeTradePopover?.anchor?.isConnected) return hideTradeMarketPopover();
    const popover = document.querySelector('#trade-market-popover'), rect = activeTradePopover.anchor.getBoundingClientRect();
    const gap = 9, margin = 12, width = Math.min(470, window.innerWidth - margin * 2);
    popover.style.width = width + 'px';
    popover.style.left = Math.max(margin, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - margin)) + 'px';
    popover.style.top = (rect.bottom + gap) + 'px';
    const height = popover.getBoundingClientRect().height;
    const top = rect.bottom + gap + height <= window.innerHeight - margin ? rect.bottom + gap : Math.max(margin, rect.top - height - gap);
    popover.style.top = top + 'px';
  };
  const showTradeMarketPopover = (anchor, material) => {
    clearTimeout(tradePopoverHideTimer);
    const popover = document.querySelector('#trade-market-popover');
    activeTradePopover = { anchor };
    popover.innerHTML = tradeMarketPopoverContent(material);
    popover.hidden = false;
    positionTradeMarketPopover();
  };
  const tradeMarketReference = material => {
    if (!material) return '未获取';
    if (material.marketExcluded) return '不查询市场价';
    return `<button type="button" class="trade-market-reference" data-trade-market-reference="${material.uid}">${Number(material.mp) > 0 ? money(marketComparisonCost(material.mp)) : marketPriceLabel(material)}</button>`;
  };
  const ensureTradeMaterial = candidate => {
    const uid = String(candidate?.uid || '').trim();
    if (!uid) return null;
    let material = tradeMaterial(uid);
    if (!material) {
      material = { id: 'trade-' + uid, uid, n: String(candidate.n || uid), c: 0, mp: 0, u: '' };
      data.m.push(material);
    }
    return material;
  };
  const renderTradeCategorySelect = (material, selectedCategory) => {
    const select = document.querySelector('#trade-listing-category'), note = document.querySelector('#trade-listing-category-note');
    const resolution = tradeSourceResolution(material);
    const categories = resolution.categories;
    const options = categories.length ? categories : resolution.ready ? ['other'] : [];
    const value = options.includes(selectedCategory) ? selectedCategory : options[0];
    select.innerHTML = options.map(category => `<option value="${category}">${tradeCategoryLabels[category]}</option>`).join('');
    select.value = value;
    select.disabled = !material || !resolution.ready || options.length <= 1;
    const noteText = !material ? '选择材料后将实时查询 Garland Tools 的来源资料。'
      : !resolution.ready && resolution.status === 'loading' ? '正在实时查询来源分类，请稍候…'
      : !resolution.ready && resolution.status === 'failed' ? '来源查询失败，请重试后再保存；为避免误分类，不能暂归“其他”。'
      : categories.length > 1 ? '该材料有多种已核验来源，请选择本条库存的归类。'
      : categories.length ? `已按${resolution.status === 'static' ? 'Garland 已核验' : 'Garland 实时核验'}来源归为“${tradeCategoryLabels[value]}”。`
      : '实时核验未发现园艺、采矿或战职来源，已归入“其他”。';
    note.textContent = noteText;
  };
  function openTradeListingDialog(listing = null) {
    state.tradeEditingId = listing?.id || null;
    state.tradeSearch = '';
    const material = listing ? tradeMaterial(listing.itemId) : null;
    document.querySelector('#trade-listing-title').textContent = listing ? '编辑本机库存材料' : '添加本机库存材料';
    document.querySelector('#trade-listing-item-id').value = listing?.itemId || '';
    document.querySelector('#trade-listing-item-name').value = listing?.name || material?.n || '';
    document.querySelector('#trade-listing-search').value = listing?.name || material?.n || '';
    document.querySelector('#trade-listing-groups').value = listing?.groups || 1;
    document.querySelector('#trade-listing-unit-price').value = listing?.unitPrice || '';
    document.querySelector('#trade-listing-error').hidden = true;
    const refresh = () => {
      const selectedId = document.querySelector('#trade-listing-item-id').value;
      const selected = tradeMaterial(selectedId);
      const groups = Number(document.querySelector('#trade-listing-groups').value || 0), unitPrice = Number(document.querySelector('#trade-listing-unit-price').value || 0);
      const multiplier = tradePriceMultiplier(selected);
      document.querySelector('#trade-listing-total').textContent = money(groups * multiplier * unitPrice);
      document.querySelector('#trade-listing-total-formula').textContent = `组数 × ${multiplier} × 单价`;
      document.querySelector('#trade-listing-selected').innerHTML = selected ? `${itemLabelMarkup(selected.uid, selected.n)}<span>${tradeGroupSize(selected)} 个 / 组</span>` : '请先从搜索结果中选择材料。';
      document.querySelector('#trade-listing-market-reference').textContent = selected ? `市场参考价（单价）：${marketPriceLabel(selected)}` : '市场参考价：请先选择材料。';
      renderTradeCategorySelect(selected, document.querySelector('#trade-listing-category').value || listing?.category);
      const query = state.tradeSearch.trim();
      const results = query ? otherSearchResults(query).slice(0, 20) : [];
      document.querySelector('#trade-listing-results').innerHTML = results.length ? results.map(item => `<button type="button" class="trade-search-result" data-trade-select="${item.uid}">${itemLabelMarkup(item.uid, item.n)}<small>ID ${item.uid}</small></button>`).join('') : query ? '<div class="meta">未找到匹配材料；道具索引加载后请重试。</div>' : '';
      document.querySelectorAll('[data-trade-select]').forEach(button => button.onclick = () => {
        const chosen = otherSearchResults(state.tradeSearch).find(item => String(item.uid) === button.dataset.tradeSelect);
        const selectedMaterial = ensureTradeMaterial(chosen);
        if (!selectedMaterial) return;
        document.querySelector('#trade-listing-item-id').value = selectedMaterial.uid;
        document.querySelector('#trade-listing-item-name').value = selectedMaterial.n;
        document.querySelector('#trade-listing-search').value = selectedMaterial.n;
        state.tradeSearch = '';
        fetchGarlandIcon(selectedMaterial.uid);
        refresh();
        fetchTradeSource(selectedMaterial);
      });
    };
    document.querySelector('#trade-listing-search').oninput = event => { state.tradeSearch = event.target.value; refresh(); };
    document.querySelector('#trade-listing-groups').oninput = refresh;
    document.querySelector('#trade-listing-unit-price').oninput = refresh;
    loadItemIndex(); loadItemIconIndex(); refresh();
    if (material) fetchTradeSource(material);
    document.querySelector('#trade-listing-dialog').showModal();
  }
  const hideTradeContextMenu = () => {
    const menu = document.querySelector('#trade-context-menu');
    menu.hidden = true;
    menu.innerHTML = '';
  };
  const showTradeContextMenu = (event, listing, mode) => {
    event.preventDefault();
    const menu = document.querySelector('#trade-context-menu');
    menu.innerHTML = mode === 'quantity'
      ? `<button type="button" data-trade-context-quantity="${listing.id}">修改组数</button>`
      : mode === 'unit-price'
        ? `<button type="button" data-trade-context-unit-price="${listing.id}">修改单价</button>`
      : `<button type="button" data-trade-context-edit="${listing.id}">编辑材料</button><button type="button" class="danger" data-trade-context-delete="${listing.id}">删除材料</button>`;
    const margin = 8, width = 142;
    menu.style.left = Math.min(event.clientX, window.innerWidth - width - margin) + 'px';
    menu.style.top = Math.min(event.clientY, window.innerHeight - 100 - margin) + 'px';
    menu.hidden = false;
    menu.querySelector('[data-trade-context-quantity]')?.addEventListener('click', () => openTradeQuantityDialog(listing));
    menu.querySelector('[data-trade-context-unit-price]')?.addEventListener('click', () => openTradeUnitPriceDialog(listing));
    menu.querySelector('[data-trade-context-edit]')?.addEventListener('click', () => openTradeListingDialog(listing));
    menu.querySelector('[data-trade-context-delete]')?.addEventListener('click', () => {
      const index = tradeInventory.findIndex(entry => entry.id === listing.id);
      if (index >= 0 && confirm('删除这条本机库存材料？')) { tradeInventory.splice(index, 1); save(); renderTrade(); }
    });
  };
  function openTradeQuantityDialog(listing) {
    hideTradeContextMenu();
    const material = tradeMaterial(listing.itemId) || listing;
    document.querySelector('#trade-quantity-id').value = listing.id;
    document.querySelector('#trade-quantity-groups').value = listing.groups;
    document.querySelector('#trade-quantity-material').textContent = `${tradeDisplayName(material)} · ${tradeGroupSize(material)} 个 / 组`;
    document.querySelector('#trade-quantity-error').hidden = true;
    document.querySelector('#trade-quantity-dialog').showModal();
  }
  function openTradeUnitPriceDialog(listing) {
    hideTradeContextMenu();
    const material = tradeMaterial(listing.itemId) || listing;
    document.querySelector('#trade-unit-price-id').value = listing.id;
    document.querySelector('#trade-unit-price-value').value = listing.unitPrice;
    document.querySelector('#trade-unit-price-material').textContent = `${tradeDisplayName(material)} · 当前合价 ${money(tradeTotal(listing))}`;
    document.querySelector('#trade-unit-price-error').hidden = true;
    document.querySelector('#trade-unit-price-dialog').showModal();
  }
  const revalidateTradeInventorySources = () => {
    const targets = tradeInventory.filter(listing => {
      const uid = String(listing.itemId || '');
      return /^\d+$/.test(uid) && !isTradeCrystal(tradeMaterial(uid) || listing) && !state.tradeSourceAudited.has(uid);
    });
    if (!targets.length) return;
    targets.forEach(listing => state.tradeSourceAudited.add(String(listing.itemId)));
    Promise.all(targets.map(async listing => {
      const material = tradeMaterial(listing.itemId) || listing;
      const resolution = await fetchTradeSource(material, { refresh: false });
      if (listing.categoryOrigin === 'manual' || resolution.categories.length !== 1) return false;
      const category = resolution.categories[0];
      if (listing.category === category && listing.categoryOrigin === 'auto') return false;
      listing.category = category;
      listing.categoryOrigin = 'auto';
      listing.updatedAt = new Date().toLocaleString('zh-CN');
      return true;
    })).then(changed => {
      if (!changed.some(Boolean)) return;
      save();
      if (state.page === 'trade' && state.tradeView === 'inventory') renderTrade();
    });
  };
  function renderTrade() {
    if (activeTradePopover) hideTradeMarketPopover();
    const root = document.querySelector('#trade');
    const categories = tradeCategoryOrder.filter(category => tradeInventory.some(listing => tradeListingCategory(listing) === category));
    const categorySections = categories.map(category => {
      const rows = tradeInventory.filter(listing => tradeListingCategory(listing) === category).sort((left, right) => Number(left.itemId) - Number(right.itemId));
      return `<section class="trade-category-section"><h2>${tradeCategoryLabels[category]}</h2><div class="table-wrap"><table class="ledger trade-ledger"><colgroup><col class="trade-col-material"><col class="trade-col-unit"><col class="trade-col-groups"><col class="trade-col-total"><col class="trade-col-market"></colgroup><thead><tr><th>材料</th><th>单价</th><th>库存组数</th><th>合价</th><th>市场参考价</th></tr></thead><tbody>${rows.map(listing => { const material = tradeMaterial(listing.itemId) || { uid: listing.itemId, n: listing.name || listing.itemId, groupSize: listing.groupSize }; return `<tr><td class="label"><span class="trade-context-target" tabindex="0" data-trade-name-context="${listing.id}">${itemLabelMarkup(material.uid, material.n)}</span></td><td><span class="trade-context-target" tabindex="0" data-trade-unit-price-context="${listing.id}">${money(listing.unitPrice)}</span></td><td><span class="trade-context-target" tabindex="0" data-trade-quantity-context="${listing.id}">${Number(listing.groups)} 组</span></td><td class="price">${money(tradeTotal(listing))}</td><td>${tradeMarketReference(material)}</td></tr>`; }).join('')}</tbody></table></div></section>`;
    }).join('');
    const inventoryContent = `<div class="header"><div><div class="meta">交易市场 · 本机数据</div><h1>我的库存材料</h1><div class="sub">独立的待售材料清单，不会影响采购、制作或潜水艇库存。普通材料 999 个 / 组，水晶 9999 个 / 组；普通材料合价按组数 × 1000 × 单价，水晶按组数 × 10000 × 单价计算。右键材料名称可编辑或删除，右键库存组数可修改数量，右键单价可修改报价。</div></div><div class="trade-actions"><button id="trade-refresh-market" class="btn secondary" ${state.marketRefreshing ? 'disabled' : ''}>${state.marketRefreshing ? '正在刷新…' : '刷新市场参考'}</button><button id="trade-add-listing" class="btn">+ 添加材料</button></div></div>${categorySections ? `<div class="trade-category-sections">${categorySections}</div>` : '<div class="empty trade-empty">尚未添加本机库存材料；添加后会显示对应来源分类。</div>'}`;
    const recruitmentContent = `<div class="trade-unavailable"><div class="meta">交易市场 · 招募市场</div><h1>招募市场准备中</h1><p>当前版本仅保存你的本机待售材料，不会上传任何库存、采购、成本或销售数据。</p><p>开放前将接入账号、公开上架、服务器筛选、分页浏览、下架与举报机制；届时仅同步你主动公开的材料报价。</p></div>`;
    root.innerHTML = state.tradeView === 'inventory' ? inventoryContent : recruitmentContent;
    root.querySelector('#trade-add-listing')?.addEventListener('click', () => openTradeListingDialog());
    root.querySelector('#trade-refresh-market')?.addEventListener('click', () => refreshMarket(true, tradeInventory.map(listing => tradeMaterial(listing.itemId)).filter(Boolean)));
    root.querySelectorAll('[data-trade-name-context]').forEach(target => {
      const listing = tradeInventory.find(entry => entry.id === target.dataset.tradeNameContext);
      target.oncontextmenu = event => listing && showTradeContextMenu(event, listing, 'name');
    });
    root.querySelectorAll('[data-trade-quantity-context]').forEach(target => {
      const listing = tradeInventory.find(entry => entry.id === target.dataset.tradeQuantityContext);
      target.oncontextmenu = event => listing && showTradeContextMenu(event, listing, 'quantity');
    });
    root.querySelectorAll('[data-trade-unit-price-context]').forEach(target => {
      const listing = tradeInventory.find(entry => entry.id === target.dataset.tradeUnitPriceContext);
      target.oncontextmenu = event => listing && showTradeContextMenu(event, listing, 'unit-price');
    });
    root.querySelectorAll('[data-trade-market-reference]').forEach(button => {
      const material = tradeMaterial(button.dataset.tradeMarketReference);
      button.addEventListener('mouseenter', () => showTradeMarketPopover(button, material));
      button.addEventListener('mouseleave', () => hideTradeMarketPopover(true));
      button.addEventListener('focus', () => showTradeMarketPopover(button, material));
      button.addEventListener('blur', () => hideTradeMarketPopover());
    });
    if (state.tradeView === 'inventory') revalidateTradeInventorySources();
  }
  // 默认方案一沿用 20–100 级攻略；自定义方案可从完整生产理符库选择 1–100 级任务。
  const leveGuideStartLevel = 1;
  const levePlanRoutes = () => {
    const planEntries = new Map((activeLevePlan()?.entries || []).map(entry => [String(entry.leveId), entry]));
    return allLeveRoutes.flatMap(route => {
      const entry = planEntries.get(leveCatalogKey(route));
      const submissions = Math.max(1, Number(route.submissionsPerAllowance || 1));
      const unitQuantity = Math.max(1, Number(route.itemsPerAllowance || 1)) * submissions;
      return entry ? [{ ...route, routeAllowances: entry.allowances, routeQuantity: Number(entry.quantity || 0) || entry.allowances * unitQuantity }] : [];
    });
  };
  const leveRouteRows = () => levePlanRoutes().filter(row => row.job === state.leveJob
    && Number(row.level) >= Number(state.leveStart)
    && Number(row.level) < Number(state.leveTarget));
  const leveExperiencePlan = (routes, start, target, hqMultiplier, serverDouble) => {
    const levelExperience = levequests.levelExperience || [];
    const requiredExperience = levelExperience.slice(start, target).reduce((sum, value) => sum + Number(value || 0), 0);
    let currentLevel = start, currentLevelExperience = 0, plannedExperience = 0, theoreticalExperience = 0, level90LostExperience = 0, targetOverflowExperience = 0;
    const gainUntilLevel = (experience, stopLevel) => {
      let remaining = Math.max(0, Number(experience || 0)), received = 0;
      while (remaining > 0 && currentLevel < stopLevel) {
        const levelRequirement = Math.max(0, Number(levelExperience[currentLevel] || 0));
        const needed = Math.max(0, levelRequirement - currentLevelExperience);
        if (!(needed > 0)) { currentLevel += 1; currentLevelExperience = 0; continue; }
        const used = Math.min(remaining, needed);
        currentLevelExperience += used;
        remaining -= used;
        received += used;
        if (currentLevelExperience >= levelRequirement) { currentLevel += 1; currentLevelExperience = 0; }
      }
      return { received, overflow: remaining };
    };
    const rows = routes.map(row => {
      const allowances = Math.max(0, Number(row.routeAllowances || 0));
      const submissions = Math.max(1, Number(row.submissionsPerAllowance || 1));
      const experiencePerSubmission = Math.max(0, Number(row.experiencePerSubmission || 0));
      const baseExperiencePerAllowance = experiencePerSubmission * submissions * hqMultiplier;
      let routeTheoreticalExperience = 0, routeExperience = 0, routeLevel90LostExperience = 0, routeTargetOverflowExperience = 0;
      let serverDoubleAllowances = 0;
      let reachesLevel90 = false, reachesLevel90Allowance = null, reachesLevel100 = false, reachesLevel100Allowance = null;
      // 额度、交付物与成本始终固定；只有低于 90 级的理符经验会在升到 90 时停止。
      if (Number(row.level) < 90) {
        for (let allowance = 1; allowance <= allowances; allowance += 1) {
          const serverMultiplier = serverDouble && currentLevel < 90 ? 2 : 1;
          const experiencePerAllowance = baseExperiencePerAllowance * serverMultiplier;
          routeTheoreticalExperience += experiencePerAllowance;
          if (serverMultiplier > 1) serverDoubleAllowances += 1;
          if (currentLevel >= 90) { routeLevel90LostExperience += experiencePerAllowance; continue; }
          const beforeLevel = currentLevel;
          const gain = gainUntilLevel(experiencePerAllowance, 90);
          routeExperience += gain.received;
          routeLevel90LostExperience += gain.overflow;
          if (beforeLevel < 90 && currentLevel >= 90) {
            reachesLevel90 = true;
            reachesLevel90Allowance = allowance;
          }
        }
      } else if (target === 100) {
        for (let allowance = 1; allowance <= allowances; allowance += 1) {
          // 服务器双倍经验在角色达到 90 级后立即失效；90 级及以上理符仍按 HQ 倍率获得经验。
          const serverMultiplier = serverDouble && currentLevel < 90 ? 2 : 1;
          const experiencePerAllowance = baseExperiencePerAllowance * serverMultiplier;
          routeTheoreticalExperience += experiencePerAllowance;
          if (serverMultiplier > 1) serverDoubleAllowances += 1;
          if (currentLevel >= 100) { routeTargetOverflowExperience += experiencePerAllowance; continue; }
          const beforeLevel = currentLevel;
          const gain = gainUntilLevel(experiencePerAllowance, 100);
          routeExperience += gain.received;
          routeTargetOverflowExperience += gain.overflow;
          if (beforeLevel < 100 && currentLevel >= 100) {
            reachesLevel100 = true;
            reachesLevel100Allowance = allowance;
          }
        }
      } else {
        for (let allowance = 1; allowance <= allowances; allowance += 1) {
          const serverMultiplier = serverDouble && currentLevel < 90 ? 2 : 1;
          const experiencePerAllowance = baseExperiencePerAllowance * serverMultiplier;
          routeTheoreticalExperience += experiencePerAllowance;
          if (serverMultiplier > 1) serverDoubleAllowances += 1;
          routeExperience += experiencePerAllowance;
        }
      }
      theoreticalExperience += routeTheoreticalExperience;
      plannedExperience += routeExperience;
      level90LostExperience += routeLevel90LostExperience;
      targetOverflowExperience += routeTargetOverflowExperience;
      return {
        ...row,
        submissions,
        experiencePerSubmission,
        experiencePerAllowance: baseExperiencePerAllowance,
        serverDoubleAllowances,
        serverBaseAllowances: allowances - serverDoubleAllowances,
        plannedAllowances: allowances,
        plannedQuantity: Number(row.routeQuantity || 0) || allowances * submissions * Math.max(1, Number(row.itemsPerAllowance || 1)),
        plannedExperience: routeExperience,
        theoreticalExperience: routeTheoreticalExperience,
        level90LostExperience: routeLevel90LostExperience,
        targetOverflowExperience: routeTargetOverflowExperience,
        reachesLevel90,
        reachesLevel90Allowance,
        reachesLevel100,
        reachesLevel100Allowance
      };
    });
    return {
      rows,
      requiredExperience,
      plannedExperience,
      theoreticalExperience,
      level90LostExperience,
      targetOverflowExperience,
      lostExperience: level90LostExperience + targetOverflowExperience,
      overflowExperience: targetOverflowExperience,
      shortfallExperience: Math.max(0, requiredExperience - plannedExperience),
      endingLevel: start
    };
  };
  const levePlanById = id => levePlans.find(plan => plan.id === id) || activeLevePlan();
  const leveSaleLines = spec => {
    const plan = levePlanById(spec.planId), start = Number(spec.start), target = Number(spec.target);
    const matched = route => route.job === spec.job && Number(route.level) >= start && Number(route.level) < target;
    const unitQuantity = route => Math.max(1, Number(route.itemsPerAllowance || 1)) * Math.max(1, Number(route.submissionsPerAllowance || 1));
    if (plan.system) {
      const variant = spec.double ? 'double' : 'normal';
      return allLeveRoutes.filter(route => matched(route) && Number(route.systemPlan?.[variant] || 0) > 0).map(route => ({
        leveId: Number(route.leveId), allowances: Number(route.systemPlan[variant]), quantity: Number(route.systemQuantity?.[variant] || 0) || Number(route.systemPlan[variant]) * unitQuantity(route), route
      }));
    }
    const entries = new Map((plan.entries || []).map(entry => [String(entry.leveId), entry]));
    return allLeveRoutes.filter(route => matched(route) && entries.has(leveCatalogKey(route))).map(route => {
      const entry = entries.get(leveCatalogKey(route)), allowances = Math.max(1, Number(entry.allowances || 1));
      return { leveId: Number(route.leveId), allowances, quantity: Number(entry.quantity || 0) || allowances * unitQuantity(route), route };
    });
  };
  const leveSaleDraft = spec => ({
    spec: { ...spec },
    lines: leveSaleLines(spec).map(line => {
      const material = leveKnownMaterial(line.route), cost = leveRecipeCost(line.route);
      return { leveId: line.leveId, level: line.route.level, quest: line.route.quest, item: line.route.item, itemId: line.route.itemId, itemIcon: line.route.itemIcon,
        allowances: line.allowances, quantity: line.quantity, hq: line.route.job !== '捕鱼人', unitCost: Number(cost.unit || 0), costReason: cost.reason || '' };
    })
  });
  const leveSaleTotals = draft => (draft?.lines || []).reduce((total, line) => {
    const quantity = Math.max(0, Number(line.quantity || 0)), unitCost = Number(line.unitCost || 0);
    total.quantity += quantity;
    if (!(unitCost > 0) && quantity > 0) total.pending += 1;
    total.cost += quantity * unitCost;
    return total;
  }, { quantity: 0, cost: 0, pending: 0 });
  const leveSaleLabel = sale => `${sale.job} · ${sale.start}–${sale.target} 级`;
  const levePricePresetKey = (job, start, target, double) => [job, Number(start), Number(target), double ? 'double' : 'normal'].join('|');
  const levePriceRanges = job => {
    const firstLevel = job === '捕鱼人' ? 15 : 20;
    const segments = [[firstLevel, 30], [30, 40], [40, 50], [50, 60], [60, 70], [70, 80], [80, 90], [90, 100]];
    return [...segments, [firstLevel, 90], [firstLevel, 100]];
  };
  const levePresetPrice = (job, start, target, double) => {
    const price = Number(levePricePresets[levePricePresetKey(job, start, target, double)] || 0);
    return price > 0 ? price : null;
  };
  const leveSuggestedPrice = ({ job, start, target, double }) => {
    const exact = levePresetPrice(job, start, target, double);
    if (exact != null) return { price: exact, source: '精确套餐预设' };
    let cursor = Number(start), total = 0;
    while (cursor < Number(target)) {
      const segment = levePriceRanges(job).find(([from, to]) => from === cursor && to <= Number(target) && to - from <= 15);
      if (!segment) return null;
      const price = levePresetPrice(job, segment[0], segment[1], double);
      if (price == null) return null;
      total += price; cursor = segment[1];
    }
    return total > 0 ? { price: total, source: '分段预设合计' } : null;
  };
  const saveLevePresetPrice = (job, start, target, double, value) => {
    const key = levePricePresetKey(job, start, target, double), price = Math.round(Number(value || 0));
    if (price > 0) levePricePresets[key] = price;
    else delete levePricePresets[key];
    save();
  };
  const saveLevePresetPrices = updates => {
    updates.forEach(({ job, start, target, double, value }) => {
      const key = levePricePresetKey(job, start, target, double), price = Math.round(Number(value || 0));
      if (price > 0) levePricePresets[key] = price;
      else delete levePricePresets[key];
    });
    if (updates.length) save();
  };
  const leveRangeSupportedByJob = (job, start, target) => Number(start) >= (job === '捕鱼人' ? 15 : 20) && Number(target) <= 100 && Number(target) > Number(start);
  function renderLevePricePresets() {
    const root = document.querySelector('#leve');
    const standardKeys = new Set();
    const cards = allLeveJobs.map(job => {
      const rows = levePriceRanges(job).map(([start, target]) => {
        const normalKey = levePricePresetKey(job, start, target, false), doubleKey = levePricePresetKey(job, start, target, true);
        standardKeys.add(normalKey); standardKeys.add(doubleKey);
        return `<tr><td>${start}–${target}</td><td><input type="number" min="0" step="1" placeholder="未设置" value="${levePresetPrice(job, start, target, false) || ''}" data-leve-preset-price="${normalKey}" data-job="${job}" data-start="${start}" data-target="${target}" data-double="0"></td><td><input type="number" min="0" step="1" placeholder="未设置" value="${levePresetPrice(job, start, target, true) || ''}" data-leve-preset-price="${doubleKey}" data-job="${job}" data-start="${start}" data-target="${target}" data-double="1"></td></tr>`;
      }).join('');
      return `<section class="leve-price-card"><h2>${job}</h2><table class="leve-price-table"><thead><tr><th>等级区间</th><th>无优待</th><th>优待</th></tr></thead><tbody>${rows}</tbody></table></section>`;
    }).join('');
    const customGroups = new Map();
    Object.entries(levePricePresets).forEach(([key, value]) => {
      const [job, start, target, variant] = key.split('|');
      if (standardKeys.has(key) || !(Number(value) > 0)) return;
      const groupKey = [job, start, target].join('|');
      const group = customGroups.get(groupKey) || { job, start: Number(start), target: Number(target), normal: null, double: null };
      group[variant] = Number(value); customGroups.set(groupKey, group);
    });
    const customRows = [...customGroups.values()].sort((left, right) => left.job.localeCompare(right.job, 'zh-CN') || left.start - right.start || left.target - right.target)
      .map(row => `<tr><td>${row.job}</td><td>${row.start}–${row.target}</td><td>${row.normal ? money(row.normal) : '—'}</td><td>${row.double ? money(row.double) : '—'}</td><td><button class="btn secondary" data-leve-preset-delete="${row.job}|${row.start}|${row.target}">删除</button></td></tr>`).join('');
    const allStandardRanges = [...new Map(allLeveJobs.flatMap(job => levePriceRanges(job)).map(([start, target]) => [`${start}|${target}`, [start, target]])).values()]
      .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
    const batchPanel = `<section class="leve-price-batch"><form id="leve-batch-preset-form" class="leve-batch-preset-form"><fieldset class="leve-job-fieldset"><legend>适用职业</legend><div class="leve-job-checks">${allLeveJobs.map(job => `<label><input type="checkbox" value="${job}" data-leve-batch-job> ${job}</label>`).join('')}</div><div class="leve-job-actions"><button class="btn secondary" type="button" data-leve-batch-select-all>全选</button><button class="btn secondary" type="button" data-leve-batch-clear-all>取消</button></div></fieldset><label>等级区间<select id="leve-batch-preset-range"><option value="">请先选择职业</option>${allStandardRanges.map(([start, target]) => `<option value="${start}|${target}" hidden disabled>${start}–${target}</option>`).join('')}</select><small id="leve-batch-range-hint">只显示所选职业共同支持的区间。</small></label><label>无优待价格<input id="leve-batch-preset-normal" type="number" min="0" step="1" placeholder="留空不修改"></label><label>优待价格<input id="leve-batch-preset-double" type="number" min="0" step="1" placeholder="留空不修改"></label><button class="btn">批量保存</button></form></section>`;
    root.innerHTML = `<div class="header"><div><h1>批量理符预设价格</h1><div class="sub">价格为一整套理符交付物的总售价；优待表示服务器双倍经验。留空即不设置，创建订单时会优先使用精确套餐价。</div></div><div class="leve-view-tabs"><button class="btn secondary" data-leve-view="planner">升级规划</button><button class="btn secondary" data-leve-sale-view="orders">售卖台账</button><button class="btn" disabled>价格预设</button></div></div>${batchPanel}<section class="leve-price-grid">${cards}</section><section class="sales-history leve-custom-price"><div class="header"><div><h2>自定义套餐价</h2><div class="sub">用于 30–100、60–100 等标准表外区间；精确套餐价会优先于分段价格。</div></div></div><form id="leve-custom-preset-form" class="leve-custom-price-form"><label>职业<select id="leve-custom-preset-job">${allLeveJobs.map(job => `<option value="${job}">${job}</option>`).join('')}</select></label><label>起始等级<input id="leve-custom-preset-start" type="number" min="15" max="99" step="1" value="20"></label><label>目标等级<input id="leve-custom-preset-target" type="number" min="16" max="100" step="1" value="100"></label><label>无优待价格<input id="leve-custom-preset-normal" type="number" min="0" step="1" placeholder="可留空"></label><label>优待价格<input id="leve-custom-preset-double" type="number" min="0" step="1" placeholder="可留空"></label><button class="btn">保存套餐价</button></form><div class="table-wrap"><table class="ledger"><thead><tr><th>职业</th><th>等级区间</th><th>无优待</th><th>优待</th><th>操作</th></tr></thead><tbody>${customRows || '<tr><td colspan="5" class="empty">暂无自定义套餐价。</td></tr>'}</tbody></table></div></section>`;
    root.querySelector('.leve-view-tabs')?.remove();
    const ledgerTabs = document.createElement('div');
    ledgerTabs.className = 'leve-ledger-tabs';
    ledgerTabs.innerHTML = '<button class="btn secondary" data-leve-sale-view="orders">订单台账</button><button class="btn" disabled>价格预设</button>';
    root.querySelector('.leve-price-batch').before(ledgerTabs);
    root.querySelectorAll('[data-leve-sale-view]').forEach(button => button.onclick = () => { state.leveSaleView = button.dataset.leveSaleView; renderLeveSales(); });
    const batchRange = root.querySelector('#leve-batch-preset-range'), batchHint = root.querySelector('#leve-batch-range-hint');
    const updateBatchRanges = () => {
      const jobs = [...root.querySelectorAll('[data-leve-batch-job]:checked')].map(input => input.value);
      [...batchRange.options].forEach(option => {
        if (!option.value) return;
        const [start, target] = option.value.split('|').map(Number), supported = jobs.length && jobs.every(job => leveRangeSupportedByJob(job, start, target));
        option.hidden = !supported; option.disabled = !supported;
        if (!supported && option.selected) batchRange.value = '';
      });
      batchHint.textContent = jobs.length ? '只显示所选职业共同支持的区间。' : '请至少选择一个职业。';
    };
    root.querySelectorAll('[data-leve-batch-job]').forEach(input => input.onchange = updateBatchRanges);
    root.querySelector('[data-leve-batch-select-all]').onclick = () => {
      root.querySelectorAll('[data-leve-batch-job]').forEach(input => { input.checked = true; });
      updateBatchRanges();
    };
    root.querySelector('[data-leve-batch-clear-all]').onclick = () => {
      root.querySelectorAll('[data-leve-batch-job]').forEach(input => { input.checked = false; });
      updateBatchRanges();
    };
    root.querySelector('#leve-batch-preset-form').onsubmit = event => {
      event.preventDefault();
      const jobs = [...root.querySelectorAll('[data-leve-batch-job]:checked')].map(input => input.value), [start, target] = batchRange.value.split('|').map(Number);
      const normal = root.querySelector('#leve-batch-preset-normal').value.trim(), double = root.querySelector('#leve-batch-preset-double').value.trim();
      if (!jobs.length) return alert('请先选择至少一个职业。');
      if (!(start && target)) return alert('请选择所有已选职业均支持的等级区间。');
      if (!normal && !double) return alert('请至少填写无优待或优待其中一项价格。');
      const updates = jobs.flatMap(job => [normal ? { job, start, target, double: false, value: normal } : null, double ? { job, start, target, double: true, value: double } : null].filter(Boolean));
      saveLevePresetPrices(updates); renderLevePricePresets();
    };
    root.querySelectorAll('[data-leve-preset-price]').forEach(input => input.onchange = event => {
      const field = event.currentTarget;
      saveLevePresetPrice(field.dataset.job, field.dataset.start, field.dataset.target, field.dataset.double === '1', field.value);
    });
    root.querySelector('#leve-custom-preset-form').onsubmit = event => {
      event.preventDefault();
      const job = root.querySelector('#leve-custom-preset-job').value, start = Number(root.querySelector('#leve-custom-preset-start').value || 0), target = Number(root.querySelector('#leve-custom-preset-target').value || 0);
      const minimum = job === '捕鱼人' ? 15 : 20;
      if (start < minimum || target <= start || target > 100) return alert(`${job} 的等级范围必须在 ${minimum}–100 级内，且目标等级高于起始等级。`);
      saveLevePresetPrice(job, start, target, false, root.querySelector('#leve-custom-preset-normal').value);
      saveLevePresetPrice(job, start, target, true, root.querySelector('#leve-custom-preset-double').value);
      renderLevePricePresets();
    };
    root.querySelectorAll('[data-leve-preset-delete]').forEach(button => button.onclick = () => {
      const [job, start, target] = button.dataset.levePresetDelete.split('|');
      if (!confirm(`删除 ${job} ${start}–${target} 的自定义套餐价？`)) return;
      saveLevePresetPrice(job, start, target, false, 0); saveLevePresetPrice(job, start, target, true, 0);
      renderLevePricePresets();
    });
  }
  function renderLeveSales() {
    if (state.leveSaleView === 'prices') return renderLevePricePresets();
    loadItemIconIndex();
    const root = document.querySelector('#leve'), draft = state.leveSaleDraft;
    const initialSpec = { planId: activeLevePlanId, job: state.leveJob, start: state.leveJob === '捕鱼人' ? Math.max(15, Number(state.leveStart || 15)) : Number(state.leveStart), target: Number(state.leveTarget), double: Boolean(state.leveDouble) };
    const initialQuote = leveSuggestedPrice(initialSpec);
    const defaults = draft?.spec || { ...initialSpec, salePrice: initialQuote?.price || '' };
    const totals = leveSaleTotals(draft), salePrice = Math.max(0, Number(draft?.spec?.salePrice || 0)), profit = salePrice - totals.cost;
    const optionJobs = allLeveJobs.map(job => `<option value="${job}" ${job === defaults.job ? 'selected' : ''}>${job}</option>`).join('');
    const orders = [...leveSales].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    root.innerHTML = `<div class="header"><div><h1>理符售卖台账</h1><div class="sub">按方案生成整套交付物；保存后数量与成本固定，不受后续价格或方案调整影响。</div></div><div class="leve-view-tabs"><button class="btn secondary" data-leve-view="planner">升级规划</button><button class="btn" disabled>售卖台账</button><button class="btn secondary" data-leve-sale-view="prices">价格预设</button></div></div><section class="leve-controls leve-sale-controls"><label>理符方案<select id="leve-sale-plan">${levePlans.map(plan => `<option value="${plan.id}" ${plan.id === defaults.planId ? 'selected' : ''}>${plan.name}</option>`).join('')}</select></label><label>职业<select id="leve-sale-job">${optionJobs}</select></label><label>起始等级<input id="leve-sale-start" type="number" min="${defaults.job === '捕鱼人' ? 15 : 1}" max="99" value="${defaults.start}"></label><label>目标等级<input id="leve-sale-target" type="number" min="${defaults.job === '捕鱼人' ? 16 : 2}" max="100" value="${defaults.target}"></label><label class="leve-double"><input id="leve-sale-double" type="checkbox" ${defaults.double ? 'checked' : ''}>服务器优待（双倍经验）</label><label>订单总售价<input id="leve-sale-price" type="number" min="0" step="1" value="${defaults.salePrice || ''}" placeholder="G">${draft ? '' : `<small id="leve-sale-price-hint" ${initialQuote ? '' : 'hidden'}>${initialQuote ? `已带入：${initialQuote.source}` : ''}</small>`}</label><button class="btn" id="leve-sale-generate">生成交付清单</button></section>${draft ? `<section class="sales-history leve-sale-preview"><div class="header"><div><h2>待保存交易 · ${leveSaleLabel(draft.spec)}</h2><div class="sub">${levePlanById(draft.spec.planId).name} · ${draft.spec.double ? '服务器优待（双倍经验）' : '无优待'}</div></div><div class="leve-sale-totals"><span>交付物 ${totals.quantity}</span><span>锁定成本 ${money(totals.cost)}</span><span class="profit">预计利润 ${money(profit)}</span></div></div><div class="table-wrap"><table class="ledger"><thead><tr><th>等级</th><th>理符任务</th><th>所需道具</th><th>数量</th><th>锁定单价</th><th>锁定成本</th><th>操作</th></tr></thead><tbody>${draft.lines.map((line, index) => `<tr><td>${line.level}</td><td class="label">${line.quest}</td><td class="label">${itemLabelMarkup(line.itemId, line.item, { hq: line.hq })}</td><td><input class="leve-sale-quantity" type="number" min="0" step="1" value="${line.quantity}" data-leve-sale-line="${index}"></td><td>${line.unitCost > 0 ? money(line.unitCost) : line.costReason || '等待补价'}</td><td>${line.unitCost > 0 ? money(line.unitCost * line.quantity) : '—'}</td><td><button class="btn secondary" data-leve-sale-remove="${index}">移除</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">所选方案在该职业与等级区间没有理符任务。</td></tr>'}</tbody></table></div>${totals.pending ? `<p class="status">有 ${totals.pending} 项交付物尚未补价；请在材料指导价中补齐成本后再保存订单。</p>` : ''}<div class="modal-actions"><button class="btn" id="leve-sale-save" ${totals.pending || !draft.lines.length || !(salePrice > 0) ? 'disabled' : ''}>保存交易</button></div></section>` : ''}<section class="sales-history"><h2>已保存交易</h2><div class="table-wrap"><table class="ledger"><thead><tr><th>日期</th><th>职业／等级</th><th>方案</th><th>经验环境</th><th>总售价</th><th>总成本</th><th>利润</th><th><th>利润率</th><th></th></tr></thead><tbody>${orders.map(order => { const margin = order.cost > 0 ? `${Math.round(order.profit / order.cost * 100)}%` : '—'; return `<tr><td>${order.date}</td><td class="label">${leveSaleLabel(order)}</td><td>${order.planName}</td><td>${order.double ? '服务器优待' : '无优待'}</td><td>${money(order.salePrice)}</td><td>${money(order.cost)}</td><td class="profit">${money(order.profit)}</td><td>${margin}</td><td><button class="btn secondary" data-leve-sale-detail="${order.id}">详情</button> <button class="btn secondary" data-leve-sale-delete="${order.id}">删除</button></td></tr>`; }).join('') || '<tr><td colspan="9" class="empty">暂无已保存交易。</td></tr>'}</tbody></table></div></section>`;
    const ordersHeader = [...root.querySelectorAll('.sales-history .ledger thead tr')].find(row => row.children.length === 10);
    ordersHeader?.children[7]?.remove();
    document.querySelector('#leve-sale-draft-dialog')?.remove();
    const preview = root.querySelector('.leve-sale-preview');
    let draftRoot = root;
    if (preview) {
      const dialog = document.createElement('dialog');
      dialog.id = 'leve-sale-draft-dialog'; dialog.className = 'leve-sale-draft-dialog';
      const blockedReason = totals.pending ? `有 ${totals.pending} 项交付物尚未补价，暂不能保存交易。`
        : !draft.lines.length ? '交付清单为空，暂不能保存交易。'
          : !(salePrice > 0) ? '请先填写大于 0 的订单总售价，才能保存交易。' : '';
      dialog.innerHTML = `<div class="modal leve-sale-draft-modal"><div class="header"><div><h2>交付清单</h2><div class="sub">保存后任务、数量、售价与成本将冻结。</div></div><button class="btn secondary" type="button" data-leve-sale-cancel>取消本次交易</button></div><label class="leve-sale-draft-price">订单总售价<input id="leve-sale-draft-price" type="number" min="0" step="1" value="${draft.spec.salePrice || ''}" placeholder="G"></label>${preview.innerHTML}${blockedReason ? `<p class="status">${blockedReason}</p>` : ''}</div>`;
      preview.remove(); document.body.append(dialog); dialog.showModal(); draftRoot = dialog;
      dialog.querySelector('[data-leve-sale-cancel]').onclick = () => { state.leveSaleDraft = null; dialog.close(); renderLeveSales(); };
      dialog.querySelector('#leve-sale-draft-price').onchange = event => { draft.spec.salePrice = Math.max(0, Number(event.currentTarget.value || 0)); renderLeveSales(); };
    }
    root.querySelector('.leve-view-tabs')?.remove();
    const ledgerTabs = document.createElement('div');
    ledgerTabs.className = 'leve-ledger-tabs';
    ledgerTabs.innerHTML = '<button class="btn" disabled>订单台账</button><button class="btn secondary" data-leve-sale-view="prices">价格预设</button>';
    root.querySelector('.leve-sale-controls').before(ledgerTabs);
    root.querySelectorAll('[data-leve-sale-view]').forEach(button => button.onclick = () => { state.leveSaleView = button.dataset.leveSaleView; state.leveSaleDraft = null; renderLeveSales(); });
    const refreshSuggestedSalePrice = () => {
      const job = root.querySelector('#leve-sale-job').value, start = Number(root.querySelector('#leve-sale-start').value || 0), target = Number(root.querySelector('#leve-sale-target').value || 0), double = root.querySelector('#leve-sale-double').checked;
      const minimum = job === '捕鱼人' ? 15 : 20, quote = leveSuggestedPrice({ job, start, target, double });
      root.querySelector('#leve-sale-start').min = String(minimum);
      root.querySelector('#leve-sale-target').min = String(minimum + 1);
      root.querySelector('#leve-sale-price').value = quote?.price || '';
      const priceHint = root.querySelector('#leve-sale-price-hint');
      if (priceHint) { priceHint.hidden = !quote; priceHint.textContent = quote ? `已带入：${quote.source}` : ''; }
    };
    root.querySelectorAll('#leve-sale-job,#leve-sale-start,#leve-sale-target,#leve-sale-double').forEach(input => input.onchange = refreshSuggestedSalePrice);
    root.querySelector('#leve-sale-generate').onclick = () => {
      const job = root.querySelector('#leve-sale-job').value, start = Number(root.querySelector('#leve-sale-start').value || 0), target = Number(root.querySelector('#leve-sale-target').value || 0);
      if (target <= start || start < (job === '捕鱼人' ? 15 : 1) || target > 100) return alert(job === '捕鱼人' ? '捕鱼人支持 15–100 级，目标等级必须高于起始等级。' : '请填写有效的等级区间。');
      state.leveSaleDraft = leveSaleDraft({ planId: root.querySelector('#leve-sale-plan').value, job, start, target, double: root.querySelector('#leve-sale-double').checked, salePrice: root.querySelector('#leve-sale-price').value });
      renderLeveSales();
    };
    draftRoot.querySelectorAll('.leve-sale-quantity').forEach(input => input.onchange = event => { const line = draft?.lines[Number(event.currentTarget.dataset.leveSaleLine)]; if (!line) return; line.quantity = Math.max(0, Number(event.currentTarget.value || 0)); renderLeveSales(); });
    draftRoot.querySelectorAll('[data-leve-sale-remove]').forEach(button => button.onclick = () => { draft.lines.splice(Number(button.dataset.leveSaleRemove), 1); renderLeveSales(); });
    draftRoot.querySelector('#leve-sale-save')?.addEventListener('click', () => {
      const current = state.leveSaleDraft, currentTotals = leveSaleTotals(current), value = Number(current?.spec?.salePrice || 0);
      if (!current || currentTotals.pending || !(value > 0)) return;
      leveSales.unshift({ id: `leve-sale-${Date.now()}`, date: today(), createdAt: new Date().toISOString(), planId: current.spec.planId, planName: levePlanById(current.spec.planId).name, job: current.spec.job, start: current.spec.start, target: current.spec.target, double: current.spec.double, salePrice: value, cost: currentTotals.cost, profit: value - currentTotals.cost, lines: current.lines.map(line => ({ ...line })) });
      save(); state.leveSaleDraft = null; renderLeveSales();
    });
    root.querySelectorAll('[data-leve-sale-delete]').forEach(button => button.onclick = () => { const order = leveSales.find(item => item.id === button.dataset.leveSaleDelete); if (!order || !confirm(`确认删除 ${leveSaleLabel(order)} 的售卖记录？`)) return; leveSales = leveSales.filter(item => item.id !== order.id); save(); renderLeveSales(); });
    root.querySelectorAll('[data-leve-sale-detail]').forEach(button => button.onclick = () => { const order = leveSales.find(item => item.id === button.dataset.leveSaleDetail); if (!order) return; const rows = order.lines.map(line => `<tr><td>${line.level}</td><td class="label">${line.quest}</td><td class="label">${itemLabelMarkup(line.itemId, line.item, { hq: line.hq })}</td><td>${line.quantity}</td><td>${money(line.unitCost)}</td><td>${money(line.unitCost * line.quantity)}</td></tr>`).join(''); document.querySelector('#bundle-detail-content').innerHTML = `<div class="header"><div><h2>${leveSaleLabel(order)} 售卖明细</h2><div class="sub">${order.date} · ${order.planName} · ${order.double ? '服务器优待' : '无优待'}</div></div></div><div class="cards"><article class="card"><small>订单总售价</small><b>${money(order.salePrice)}</b></article><article class="card"><small>锁定成本</small><b>${money(order.cost)}</b></article><article class="card"><small>利润</small><b class="profit">${money(order.profit)}</b></article></div><div class="table-wrap"><table class="ledger"><thead><tr><th>等级</th><th>理符任务</th><th>所需道具</th><th>数量</th><th>锁定单价</th><th>锁定成本</th></tr></thead><tbody>${rows}</tbody></table></div>`; document.querySelector('#bundle-detail-dialog').showModal(); });
  }
  function renderLeve() {
    if (state.leveView === 'ledger') return renderLeveSales();
    loadItemIconIndex();
    const start = Number(state.leveStart), target = Number(state.leveTarget);
    const minimumLevel = state.leveJob === '捕鱼人' ? 15 : leveGuideStartLevel;
    const validRange = Number.isInteger(start) && Number.isInteger(target) && start >= minimumLevel && target <= 100 && target > start;
    const routes = validRange ? leveRouteRows() : [];
    const hqMultiplier = state.leveJob === '捕鱼人' ? 1 : 2;
    const plan = validRange ? leveExperiencePlan(routes, start, target, hqMultiplier, state.leveDouble) : { rows: [], requiredExperience: 0, plannedExperience: 0, theoreticalExperience: 0, lostExperience: 0, overflowExperience: 0, shortfallExperience: 0, endingLevel: start };
    const summary = plan.rows.reduce((total, row) => {
      const cost = leveRecipeCost(row), quantity = Number(row.plannedQuantity || 0);
      total.allowances += Number(row.plannedAllowances || 0);
      total.quantity += quantity;
      if (quantity > 0 && Number(cost.unit) > 0) total.cost += cost.unit * quantity;
      else if (quantity > 0) total.pending += 1;
      if (!(Number(row.experiencePerSubmission) > 0)) total.unverified += 1;
      return total;
    }, { allowances: 0, quantity: 0, cost: 0, pending: 0, unverified: 0 });
    const rows = plan.rows.map((row, index) => {
      const material = leveKnownMaterial(row), cost = leveRecipeCost(row), submissions = Number(row.submissions || 1), xp = Number(row.experiencePerSubmission || 0);
      const allowances = Number(row.plannedAllowances || 0);
      const baseFactors = [`经验 ${moneyFormatter.format(xp)}`, `物品数量 ${submissions}`, `额度 ${allowances}`, ...(hqMultiplier > 1 ? ['HQ 2'] : [])];
      const itemLabel = material ? itemLabelMarkup(material.uid, row.item, { hq: hqMultiplier > 1 }) : `${row.item} <span class="meta">（待核验物品 ID）</span>`;
      const plannedQuantity = Number(row.plannedQuantity || 0);
      const totalCost = cost.unit * plannedQuantity;
      const costFormula = `单件当前成本 ${money(cost.unit)} × 物品数量 ${plannedQuantity} = ${money(totalCost)}`;
      const doubleAllowances = Number(row.serverDoubleAllowances || 0), normalAllowances = Number(row.serverBaseAllowances || 0);
      const baseExperienceFormula = doubleAllowances === allowances && allowances > 0
        ? `${baseFactors.join(' × ')} × 服务器双倍经验 2 = ${moneyFormatter.format(row.theoreticalExperience)}`
        : doubleAllowances > 0
          ? `经验 ${moneyFormatter.format(xp)} × 物品数量 ${submissions}${hqMultiplier > 1 ? ' × HQ 2' : ''} ×（额度 ${doubleAllowances} × 服务器双倍经验 2 + 额度 ${normalAllowances}）= ${moneyFormatter.format(row.theoreticalExperience)}`
          : `${baseFactors.join(' × ')} = ${moneyFormatter.format(row.theoreticalExperience)}`;
      const experienceFormula = row.reachesLevel90
        ? `${baseExperienceFormula}；第 ${row.reachesLevel90Allowance} 额度达到 90 级，实际获得 ${moneyFormatter.format(row.plannedExperience)}，90级失效 ${moneyFormatter.format(row.level90LostExperience)}`
        : row.reachesLevel100
          ? `${baseExperienceFormula}；第 ${row.reachesLevel100Allowance} 额度达到 100 级，实际获得 ${moneyFormatter.format(row.plannedExperience)}，溢出 ${moneyFormatter.format(row.targetOverflowExperience)}`
          : row.level90LostExperience > 0
            ? `${baseExperienceFormula}；已达到 90 级，实际获得 ${moneyFormatter.format(row.plannedExperience)}，90级失效 ${moneyFormatter.format(row.level90LostExperience)}`
            : row.targetOverflowExperience > 0
              ? `${baseExperienceFormula}；已达到 100 级，实际获得 ${moneyFormatter.format(row.plannedExperience)}，溢出 ${moneyFormatter.format(row.targetOverflowExperience)}`
              : baseExperienceFormula;
      const costLabel = allowances > 0
        ? cost.unit > 0 ? `<span class="leve-metric" tabindex="0" data-tooltip="${costFormula}">${money(totalCost)}</span>` : cost.reason
        : '—';
      const experience = !(xp > 0) ? '等待任务匹配' : allowances > 0
        ? `<span class="leve-metric" tabindex="0" data-tooltip="${experienceFormula}">${moneyFormatter.format(row.plannedExperience)}</span>` : '—';
      const levelMarker = row.reachesLevel90 ? '<span class="leve-level-marker">达到90级</span>' : row.reachesLevel100 ? '<span class="leve-level-marker leve-100-marker">达到100级</span>' : '';
      return `<tr data-leve-plan-row="${row.leveId}"><td>${row.level}</td><td class="label"><b>${row.quest}</b>${levelMarker}</td><td class="label">${material ? `<button class="bundle-link" data-leve-detail="${material.uid}">${itemLabel}</button>` : itemLabel}</td><td>${plannedQuantity}</td><td>${allowances}</td><td>${experience}</td><td>${costLabel}</td><td class="label">${row.place || '待补充地点'}${row.note ? `<br><small>${row.note}</small>` : ''}</td></tr>`;
    }).join('');
    const root = document.querySelector('#leve');
    root.innerHTML = `<div class="header"><div><div class="meta">理符售卖 · 生产职业升级规划</div><h1>理符售卖推荐</h1><div class="sub">方案一严格依据 7.0 制作理符攻略：服务器双倍开启时使用对应的双倍经验表。成本直接使用材料库的最新参考价，全部按高品质交付计算。</div></div></div><section class="leve-controls"><label>职业<select id="leve-job">${(levequests.jobs || []).map(job => `<option value="${job}" ${job === state.leveJob ? 'selected' : ''}>${job}</option>`).join('')}</select></label><label>当前等级<input id="leve-start" type="number" min="20" max="99" step="1" value="${start}"></label><label>目标等级<input id="leve-target" type="number" min="21" max="100" step="1" value="${target}"></label><label class="leve-double"><input id="leve-double" type="checkbox" ${state.leveDouble ? 'checked' : ''}>服务器双倍经验</label></section>${validRange ? '' : '<p class="status">攻略范围为 20–100 级，目标等级必须高于当前等级。</p>'}<div class="cards leve-summary"><article class="card"><small>升级所需经验</small><b>${moneyFormatter.format(plan.requiredExperience)}</b><div class="meta">${start} → ${target} 级</div></article><section class="leve-experience-summary"><article class="card"><small>实际获得经验</small><b>${moneyFormatter.format(plan.plannedExperience)}</b></article><article class="card"><small>理论获得经验</small><b>${moneyFormatter.format(plan.theoreticalExperience)}</b><div class="meta">到达90级溢出 ${moneyFormatter.format(plan.level90LostExperience)} 经验 · 到达100级溢出 ${moneyFormatter.format(plan.targetOverflowExperience)} 经验</div></article></section><article class="card leve-plan-volume"><div class="leve-summary-pair"><div><small>理符额度</small><b>${summary.allowances}</b></div><div><small>交付物总数</small><b>${summary.quantity}</b></div></div></article><article class="card leve-cost-summary"><small>预计交付成本</small><b>${summary.pending ? '等待补价' : money(summary.cost)}</b>${summary.pending ? `<div class="meta">${summary.pending} 项等待补价，未计入总计</div>` : ''}</article></div><div class="table-wrap"><table class="ledger leve-ledger"><thead><tr><th>等级</th><th>理符任务</th><th>所需道具</th><th>物品数量</th><th>理符额度</th><th>经验</th><th>当前成本</th><th>接取地点</th></tr></thead><tbody>${rows || `<tr><td colspan="8" class="empty">${validRange ? '该等级范围暂无已导入路线。' : '请先填写有效等级范围。'}</td></tr>`}</tbody></table></div>`;
    // 完整生产理符库与当前方案分离：默认方案可恢复，自定义方案只保存在本机。
    root.querySelector('#leve-start').min = String(minimumLevel);
    root.querySelector('#leve-target').min = String(minimumLevel + 1);
    const leveJobSelector = root.querySelector('#leve-job');
    leveJobSelector.innerHTML = allLeveJobs.map(job => `<option value="${job}" ${job === state.leveJob ? 'selected' : ''}>${job}</option>`).join('');
    root.querySelector('.header .sub').textContent = state.leveJob === '捕鱼人'
      ? '捕鱼人支持 15–100 级，普通品质交付；服务器优待开启时使用对应额度，达到 90 级后双倍经验失效。'
      : '默认方案一使用 7.0 的 20–100 级推荐路线；自定义方案可从完整生产理符库添加 1–100 级任务。全部按高品质交付计算；达到 90 级后，服务器双倍经验与 90 以下理符经验均失效。';
    const activePlan = activeLevePlan();
    const controls = root.querySelector('.leve-controls');
    const planSelector = document.createElement('label');
    planSelector.className = 'leve-plan-selector';
    planSelector.innerHTML = `理符方案<select id="leve-plan">${levePlans.map(plan => `<option value="${plan.id}" ${plan.id === activePlan.id ? 'selected' : ''}>${plan.name}</option>`).join('')}</select>`;
    controls.prepend(planSelector);
    const planActions = document.createElement('div');
    planActions.className = 'leve-plan-actions';
    planActions.innerHTML = `<button class="btn secondary" id="leve-plan-edit">${state.levePlanEditing ? '完成编辑' : '编辑方案'}</button><button class="btn secondary" id="leve-plan-create">+ 新建方案</button>${activePlan.system ? '<button class="btn secondary" id="leve-plan-restore">恢复默认方案</button>' : '<button class="btn secondary" id="leve-plan-delete">删除方案</button>'}`;
    controls.append(planActions);
    if (state.levePlanEditing) {
      const search = state.leveCatalogSearch.trim().toLocaleLowerCase('zh-CN');
      const selectedIds = new Set(activePlan.entries.map(entry => String(entry.leveId)));
      const versionGroups = [
        ['2.0', '重生之境'], ['3.0', '苍穹之禁城'], ['4.0', '红莲之狂潮'],
        ['5.0', '暗影之逆焰'], ['6.0', '晓月之终途'], ['7.0', '金曦之遗辉'], ['unverified', '待核验']
      ];
      const catalogRoutes = allLeveRoutes.filter(route => route.job === state.leveJob
        && (!search || `${route.quest} ${route.item}`.toLocaleLowerCase('zh-CN').includes(search)))
        .sort((left, right) => versionGroups.findIndex(([key]) => key === left.expansion) - versionGroups.findIndex(([key]) => key === right.expansion) || left.level - right.level || left.leveId - right.leveId);
      const editor = document.createElement('section');
      editor.className = 'leve-plan-catalog';
      editor.innerHTML = `<div class="header"><div><h2>理符库 · ${state.leveJob}</h2><div class="sub">按版本分类；已加入当前方案的理符会高亮显示。</div></div><b>${catalogRoutes.length} 条</b></div><input id="leve-catalog-search" placeholder="搜索理符任务或所需道具" value="${state.leveCatalogSearch}"><div class="leve-plan-list"><div class="leve-plan-columns"><span></span><span>理符任务</span><span>所需道具</span><span>经验值</span></div>${versionGroups.map(([key, title]) => {
        const routes = catalogRoutes.filter(route => (route.expansion || 'unverified') === key);
        const open = Boolean(search) || state.leveCatalogCollapsed[key] === false;
        return routes.length ? `<details class="leve-plan-version" data-leve-version="${key}" ${open ? 'open' : ''}><summary>${title}<small>${routes.length} 条</small></summary>${routes.map(route => {
          const selected = selectedIds.has(leveCatalogKey(route));
          const itemIcon = Number(route.itemIcon || 0) > 0 ? `<img class="item-icon leve-plan-item-icon" src="https://www.garlandtools.org/files/icons/item/${Number(route.itemIcon)}.png" alt="" aria-hidden="true" loading="lazy" decoding="async" onerror="this.remove()">` : '';
          return `<div class="leve-plan-row ${selected ? 'is-selected' : ''}" ${selected ? `data-leve-plan-locate="${route.leveId}" role="button" tabindex="0" title="定位到左侧理符列表中的 ${route.quest}"` : ''}><button class="leve-plan-dot ${selected ? 'selected' : 'add'}" ${selected ? 'disabled' : `data-leve-plan-toggle="${route.leveId}"`} title="${selected ? '已加入当前方案，点击任务可定位左侧列表' : `添加 ${route.item}`}" aria-label="${selected ? '已加入当前方案，点击任务可定位左侧列表' : `添加 ${route.item}`}">${selected ? '✓' : '+'}</button><span class="leve-plan-task"><b>${route.quest}</b><small>Lv.${route.level} · ${route.submissionsPerAllowance} 次 / 额度</small></span><span class="leve-plan-item">${itemIcon}<span>${route.item}</span></span><b class="leve-plan-xp">${moneyFormatter.format(route.experiencePerSubmission || 0)}</b></div>`;
        }).join('')}</details>` : '';
      }).join('') || '<p class="empty">没有匹配的理符。</p>'}</div>`;
      const tableWrap = root.querySelector('.leve-ledger')?.closest('.table-wrap');
      if (tableWrap) {
        const layout = document.createElement('section');
        layout.className = 'leve-plan-edit-layout';
        tableWrap.replaceWith(layout); layout.append(tableWrap, editor);
        const ledger = layout.querySelector('.leve-ledger');
        const rows = leveRouteRows();
        if (rows.length) {
          ledger.tHead.rows[0].insertCell().outerHTML = '<th>编辑</th>';
          Array.from(ledger.tBodies[0].rows).forEach((row, index) => {
            const route = rows[index];
            if (!route) return;
            const cell = row.insertCell();
            cell.innerHTML = `<label class="leve-plan-allowance">额度<input type="number" min="1" step="1" value="${route.routeAllowances}" data-leve-plan-allowance="${route.leveId}"></label><button class="leve-plan-remove" data-leve-plan-remove="${route.leveId}" title="移除 ${route.quest}" aria-label="移除 ${route.quest}">移除</button>`;
          });
        }
      }
      const updateCatalogSearch = input => {
        const value = input.value, selectionStart = input.selectionStart, selectionEnd = input.selectionEnd;
        state.leveCatalogSearch = value;
        renderLeve();
        const nextInput = root.querySelector('#leve-catalog-search');
        if (!nextInput) return;
        nextInput.focus({ preventScroll: true });
        nextInput.setSelectionRange(selectionStart, selectionEnd);
      };
      const catalogSearchInput = editor.querySelector('#leve-catalog-search');
      catalogSearchInput.oninput = event => {
        // 中文输入法在候选组词期间会连续触发 input；此时重绘会中断组词。
        if (!event.isComposing) updateCatalogSearch(event.currentTarget);
      };
      catalogSearchInput.oncompositionend = event => updateCatalogSearch(event.currentTarget);
      editor.querySelectorAll('[data-leve-version]').forEach(group => group.ontoggle = event => {
        state.leveCatalogCollapsed[event.currentTarget.dataset.leveVersion] = !event.currentTarget.open;
      });
      root.querySelectorAll('[data-leve-plan-toggle]').forEach(button => button.onclick = () => {
        const leveId = Number(button.dataset.levePlanToggle);
        const catalogScrollTop = editor.querySelector('.leve-plan-list')?.scrollTop || 0;
        activePlan.entries = selectedIds.has(String(leveId)) ? activePlan.entries.filter(entry => Number(entry.leveId) !== leveId) : [...activePlan.entries, { leveId, allowances: 1 }];
        saveLevePlans(); renderLeve();
        const nextCatalogList = root.querySelector('.leve-plan-list');
        if (nextCatalogList) nextCatalogList.scrollTop = catalogScrollTop;
      });
      const locateLevePlanRow = leveId => {
        const target = root.querySelector(`[data-leve-plan-row="${leveId}"]`);
        if (!target) return;
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        target.classList.remove('leve-plan-locate-target');
        void target.offsetWidth;
        target.classList.add('leve-plan-locate-target');
        window.setTimeout(() => target.classList.remove('leve-plan-locate-target'), 1800);
      };
      root.querySelectorAll('[data-leve-plan-locate]').forEach(row => {
        row.onclick = () => locateLevePlanRow(row.dataset.levePlanLocate);
        row.onkeydown = event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          locateLevePlanRow(row.dataset.levePlanLocate);
        };
      });
      root.querySelectorAll('[data-leve-plan-remove]').forEach(button => button.onclick = () => {
        const route = allLeveRoutes.find(item => Number(item.leveId) === Number(button.dataset.levePlanRemove));
        if (!route || !confirm(`确认从“${activePlan.name}”移除理符？\n\n${route.quest}\n所需道具：${route.item}`)) return;
        activePlan.entries = activePlan.entries.filter(entry => Number(entry.leveId) !== Number(button.dataset.levePlanRemove)); saveLevePlans(); renderLeve();
      });
      root.querySelectorAll('[data-leve-plan-allowance]').forEach(input => input.onchange = event => {
        const entry = activePlan.entries.find(item => Number(item.leveId) === Number(event.currentTarget.dataset.levePlanAllowance));
        if (entry) entry.allowances = Math.max(1, Number(event.currentTarget.value || 1)); saveLevePlans(); renderLeve();
      });
    }
    root.querySelector('#leve-plan').onchange = event => { activeLevePlanId = event.currentTarget.value; state.leveCatalogSearch = ''; saveLevePlans(); renderLeve(); };
    root.querySelector('#leve-plan-edit').onclick = () => { state.levePlanEditing = !state.levePlanEditing; state.leveCatalogSearch = ''; renderLeve(); };
    root.querySelector('#leve-plan-create').onclick = () => {
      const name = prompt('新方案名称', `方案${levePlans.length + 1}`)?.trim();
      if (!name) return;
      const id = `custom-${Date.now()}`;
      levePlans.push({ id, name, system: false, entries: activePlan.entries.map(entry => ({ ...entry })) }); activeLevePlanId = id; state.levePlanEditing = true; saveLevePlans(); renderLeve();
    };
    root.querySelector('#leve-plan-restore')?.addEventListener('click', () => {
      if (!confirm('恢复方案一的默认路线？当前对方案一的调整会被覆盖。')) return;
      activePlan.entries = systemLevePlanEntries(); saveLevePlans(); renderLeve();
    });
    root.querySelector('#leve-plan-delete')?.addEventListener('click', () => {
      if (!confirm(`删除“${activePlan.name}”？此操作不可恢复。`)) return;
      levePlans = levePlans.filter(plan => plan.id !== activePlan.id); activeLevePlanId = levePlans[0].id; state.levePlanEditing = false; saveLevePlans(); renderLeve();
    });
    root.querySelectorAll('#leve-job,#leve-start,#leve-target,#leve-double').forEach(input => input.onchange = () => {
      const previousDouble = state.leveDouble;
      state.leveJob = root.querySelector('#leve-job').value; state.leveStart = Number(root.querySelector('#leve-start').value || 0); state.leveTarget = Number(root.querySelector('#leve-target').value || 0); state.leveDouble = root.querySelector('#leve-double').checked;
      if (state.leveJob === '捕鱼人') {
        state.leveStart = Math.max(15, state.leveStart);
        state.leveTarget = Math.max(16, state.leveTarget);
      }
      if (previousDouble !== state.leveDouble && activeLevePlan()?.system) { activeLevePlan().entries = systemLevePlanEntries(); activeLevePlan().planVersion = systemLevePlanVersion; saveLevePlans(); }
      renderLeve();
    });
    root.querySelectorAll('[data-leve-detail]').forEach(button => button.onclick = () => openLeveRecipeReference(button.dataset.leveDetail, true));
  }
  function renderSubmarineSummary() {
    {
      const root = document.querySelector('#submarine');
      const suiteRows = submarineSuites.map(suite => { const total = submarineSalesTotals(suiteHistory(suite)); return `<tr><td class="label"><button class="bundle-link" data-summary-suite="${suite.id}">${suiteLabel(suite)}</button></td><td>${total.quantity}</td><td class="profit">${money(total.profit)}</td><td class="margin">${total.cost ? Math.round(total.profit / total.cost * 100) + '%' : '—'}</td></tr>`; }).join('') || '<tr><td colspan="4" class="empty">暂无整套销售记录</td></tr>';
      const slots = ['船体', '船尾', '船首', '舰桥'];
      const levelNames = [...new Set(submarineData.parts.map(part => part.n.replace(/(船体|船尾|船首|舰桥)$/, '')))];
      const partRows = levelNames.map(level => `<tr><td class="label">${level}</td>${slots.map(slot => { const part = submarineData.parts.find(item => item.part === slot && item.n.replace(/(船体|船尾|船首|舰桥)$/, '') === level); if (!part) return '<td>—</td>'; const total = submarineSalesTotals(submarineHistory(part)); return `<td><button class="bundle-link" data-summary-part="${part.id}" title="${part.n}">${total.quantity ? money(total.profit) : '—'}</button></td>`; }).join('')}</tr>`).join('');
      root.innerHTML = `<div class="header"><div><div class="meta">潜水艇售卖</div><h1>潜水艇销售利润统计</h1><div class="sub">整套利润与单件利润分开统计；点击名称或利润可查看销售明细。</div></div><button id="go-submarine-ledger" class="btn">进入潜水艇台账</button></div><section class="profit-summary" style="margin-top:20px"><h2>整套利润</h2><div class="table-wrap history-table"><table class="ledger"><thead><tr><th>套装简称</th><th>已售套数</th><th>利润</th><th>利润率</th></tr></thead><tbody>${suiteRows}</tbody></table></div></section><section class="profit-summary" style="margin-top:20px"><h2>单件售卖总利润</h2><div class="table-wrap history-table"><table class="ledger"><thead><tr><th>潜水艇名称</th>${slots.map(slot => `<th>${slot}</th>`).join('')}</tr></thead><tbody>${partRows || `<tr><td colspan="${slots.length + 1}" class="empty">暂无单件部件</td></tr>`}</tbody></table></div></section>`;
      const suiteProfit = submarineSalesTotals(submarineSuiteSales).profit;
      const partProfit = submarineSalesTotals(submarineSales).profit;
      const totalProfit = suiteProfit + partProfit;
      const primaryTotal = document.createElement('section');
      primaryTotal.className = 'submarine-total-profit';
      primaryTotal.innerHTML = `<div><small>潜水艇销售合计利润</small><b class="profit">${money(totalProfit)}</b></div><div class="submarine-total-breakdown"><span>整套利润 <b class="profit">${money(suiteProfit)}</b></span><span>单件利润 <b class="profit">${money(partProfit)}</b></span></div>`;
      const profitBoard = document.createElement('section');
      profitBoard.className = 'submarine-profit-board';
      profitBoard.innerHTML = `<div class="submarine-profit-board-title"><b>利润分项</b><span>整套利润与单件售卖利润</span></div><div class="submarine-profit-columns"></div>`;
      const [suiteSection, partSection] = root.querySelectorAll('section.profit-summary');
      suiteSection.classList.add('submarine-profit-pane');
      partSection.classList.add('submarine-profit-pane');
      profitBoard.querySelector('.submarine-profit-columns').append(suiteSection, partSection);
      root.querySelector('.header').after(primaryTotal);
      primaryTotal.after(profitBoard);
      root.querySelector('#go-submarine-ledger').onclick = () => { state.submarineView = 'ledger'; renderSubmarine(); };
      root.querySelectorAll('[data-summary-suite]').forEach(button => button.onclick = () => openSubmarineSuiteDetail(submarineSuites.find(item => item.id === button.dataset.summarySuite)));
      root.querySelectorAll('[data-summary-part]').forEach(button => button.onclick = () => { const part = submarineData.parts.find(item => String(item.id) === button.dataset.summaryPart); if (part) openSubmarineReport(part.n + ' 销售明细', submarineHistory(part)); });
      return;
    }
    const root = document.querySelector('#submarine'), suite = submarineSalesTotals(submarineSuiteSales), part = submarineSalesTotals(submarineSales), stockValue = Object.values(submarineStocks).reduce((sum, value) => sum + Number(value.v || 0), 0), stockCount = Object.values(submarineStocks).reduce((sum, value) => sum + Number(value.q || 0), 0);
    root.innerHTML = `<div class="header"><div><h1>潜水艇销售利润</h1><div class="sub">整套与单件销售独立统计，并同步计入总览销售流水。</div></div><button id="go-submarine-ledger" class="btn">进入潜水艇台账</button></div><div class="cards"><button class="card metric clickable" data-sub-report="suite"><small>整套销售 · 查看明细</small><b>${money(suite.amount)}</b><div class="meta">${suite.quantity} 套 · 成本 ${money(suite.cost)} · 利润 ${money(suite.profit)}</div></button><button class="card metric clickable" data-sub-report="part"><small>单件销售 · 查看明细</small><b>${money(part.amount)}</b><div class="meta">${part.quantity} 件 · 成本 ${money(part.cost)} · 利润 ${money(part.profit)}</div></button><div class="card metric"><small>潜水艇销售合计</small><b>${money(suite.amount + part.amount)}</b><div class="meta">成本 ${money(suite.cost + part.cost)} · 利润 ${money(suite.profit + part.profit)}</div></div><div class="card metric"><small>当前部件库存</small><b>${stockCount}</b><div class="meta">库存成本 ${money(stockValue)}</div></div></div><section class="profit-summary"><h2>整套销售利润</h2><div class="table-wrap history-table"><table class="ledger"><thead><tr><th>套装</th><th>销售套数</th><th>销售额</th><th>成本</th><th>利润</th><th>利润率</th></tr></thead><tbody>${submarineSuites.map(item => { const total = submarineSalesTotals(suiteHistory(item)); return `<tr data-sub-suite-report="${item.id}"><td class="label"><button class="bundle-link" data-suite-detail="${item.id}">${suiteLabel(item)}</button></td><td>${total.quantity}</td><td>${money(total.amount)}</td><td>${money(total.cost)}</td><td class="profit">${money(total.profit)}</td><td class="margin">${total.cost ? Math.round(total.profit / total.cost * 100) + '%' : '—'}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">暂无整套配置</td></tr>'}</tbody></table></div></section><section class="profit-summary"><h2>单件销售利润</h2><div class="table-wrap history-table"><table class="ledger"><thead><tr><th>部件</th><th>销售数量</th><th>销售额</th><th>成本</th><th>利润</th><th>利润率</th></tr></thead><tbody>${submarineData.parts.map(item => { const total = submarineSalesTotals(submarineHistory(item)); return `<tr data-sub-part-report="${item.id}"><td class="label"><button class="bundle-link" data-submarine-detail="${item.id}">${item.n}</button></td><td>${total.quantity}</td><td>${money(total.amount)}</td><td>${money(total.cost)}</td><td class="profit">${money(total.profit)}</td><td class="margin">${total.cost ? Math.round(total.profit / total.cost * 100) + '%' : '—'}</td></tr>`; }).join('')}</tbody></table></div></section>`;
    root.querySelector('#go-submarine-ledger').onclick = () => { state.submarineView = 'ledger'; renderSubmarine(); };
    root.querySelectorAll('[data-sub-report]').forEach(button => button.onclick = () => openSubmarineReport(button.dataset.subReport === 'suite' ? '潜水艇整套销售明细' : '潜水艇单件销售明细', button.dataset.subReport === 'suite' ? submarineSuiteSales : submarineSales));
    root.querySelectorAll('[data-suite-detail]').forEach(button => button.onclick = () => openSubmarineSuiteDetail(submarineSuites.find(item => item.id === button.dataset.suiteDetail)));
    root.querySelectorAll('[data-sub-suite-report]').forEach(row => row.onclick = event => { if (!event.target.closest('button')) openSubmarineReport('整套 ' + suiteLabel(submarineSuites.find(item => item.id === row.dataset.subSuiteReport)) + ' 销售明细', suiteHistory(submarineSuites.find(item => item.id === row.dataset.subSuiteReport))); });
    root.querySelectorAll('[data-sub-part-report]').forEach(row => row.onclick = event => { if (!event.target.closest('button')) { const part = submarineData.parts.find(item => String(item.id) === row.dataset.subPartReport); openSubmarineReport(part.n + ' 销售明细', submarineHistory(part)); } });
    root.querySelectorAll('[data-submarine-detail]').forEach(button => button.onclick = () => openSubmarineDetail(submarineData.parts.find(part => String(part.id) === button.dataset.submarineDetail)));
  }
  function renderSubmarine() {
    if (state.submarineView !== 'ledger') return renderSubmarineSummary();
    const root = document.querySelector('#submarine'), rows = submarineRows(), groups = [...new Set(rows.map(row => row.group))];
    // 兼容旧台账模板；统计区会在挂载后移除，利润仅在父级页面呈现。
    const statisticRows = [];
    const suiteRows = submarineSuites.map(suite => { const parts = suiteParts(suite), cost = suiteCost(suite), price = suitePrice(suite), profit = price - cost; return `<tr><td class="label"><button class="bundle-link" data-suite-detail="${suite.id}">${suiteLabel(suite)}</button></td><td><b>${suiteStock(suite)}</b></td><td><button class="op-btn craft" data-suite-craft="${suite.id}">制作入库</button><button class="op-btn undo" data-suite-undo-craft="${suite.id}" ${lastSubmarineOperation('suite-craft', suite.id) ? '' : 'disabled'}>撤销</button></td><td><button class="op-btn sale" data-suite-sell="${suite.id}" ${suiteStock(suite) ? '' : 'disabled'}>整套出售</button><button class="op-btn undo" data-suite-undo-sale="${suite.id}" ${lastSubmarineOperation('suite-sale', suite.id) ? '' : 'disabled'}>撤销</button></td><td class="price" data-suite-price="${suite.id}">${money(price)}</td><td>${money(cost)}</td><td class="profit">${money(profit)}</td><td class="margin">${cost ? Math.round(profit / cost * 100) + '%' : '—'}</td>${parts.map(part => `<td>${part ? `<span title="库存 ${submarineStock(part).q}">${part.n.replace(/级(船体|船尾|船首|舰桥)$/, '')} <small class="meta">${submarineStock(part).q}</small></span>` : '0'}</td>`).join('')}<td class="compact-actions"><button class="btn secondary" data-suite-edit="${suite.id}">编辑</button><button class="btn secondary" data-suite-delete="${suite.id}">删除</button></td></tr>`; }).join('');
    root.innerHTML = `<div class="header"><div><div class="meta">潜水艇售卖</div><h1>潜水艇售卖台账</h1><div class="sub">整套与单件均支持按数量制作、出售与撤销。</div></div><button id="add-submarine-suite" class="btn">+ 新增整套</button></div><section class="profit-summary" style="margin-top:20px"><h2>潜水艇销售利润统计</h2><div class="table-wrap history-table"><table class="ledger"><thead><tr><th>类别</th><th>套装 / 部件</th><th>已售数量</th><th>利润</th><th>利润率</th><th>明细</th></tr></thead><tbody>${statisticRows.map(row => `<tr><td>${row.type}</td><td class="label">${row.detail === 'suite' ? `<button class="bundle-link" data-suite-detail="${row.id}">${row.label}</button>` : `<button class="bundle-link" data-submarine-detail="${row.id}">${row.label}</button>`}</td><td>${row.total.quantity}</td><td class="profit">${money(row.total.profit)}</td><td class="margin">${row.total.cost ? Math.round(row.total.profit / row.total.cost * 100) + '%' : '—'}</td><td><button class="btn secondary" data-submarine-stat-detail="${row.detail}:${row.id}">查看销售明细</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">暂无潜水艇销售记录</td></tr>'}</tbody></table></div></section><div class="table-wrap"><table class="ledger"><thead><tr><th>套装简称</th><th>剩余套数</th><th>制作入库</th><th>整套出售</th><th>建议售价</th><th>成本</th><th>利润</th><th>利润率</th><th>船体</th><th>船尾</th><th>船首</th><th>舰桥</th><th>操作</th></tr></thead><tbody>${suiteRows || '<tr><td colspan="13" class="empty">暂无潜水艇整套</td></tr>'}</tbody></table></div><details id="submarine-parts-details" class="material-category" style="margin-top:20px" ${state.submarinePartsOpen ? 'open' : ''}><summary>单部件制作与售卖<span>按等级展开</span></summary><div class="table-wrap"><table class="ledger"><thead><tr><th>潜水艇等级 / 部件</th><th>库存</th><th>制作</th><th>售卖</th><th>建议售价</th><th>成本价</th><th>利润</th><th>利润率</th></tr></thead><tbody>${groups.map(group => { const expanded = state.submarineGroups[group]; return `<tr class="group-row"><td colspan="8"><button class="group-toggle" data-submarine-group="${group}"><span>${group}</span><b>${expanded ? '⌃' : '⌄'}</b></button></td></tr>${expanded ? rows.filter(row => row.group === group).map(row => { const part = submarineData.parts.find(item => item.id === row.partId), value = submarineStock(part), cost = value.q ? value.v / value.q : productionPlan(row).total, price = submarinePrice(part), profit = price - cost; return `<tr class="detail"><td class="label"><button class="bundle-link" data-submarine-detail="${part.id}">${part.n}</button></td><td><b>${value.q}</b></td><td><button class="op-btn craft" data-submarine-craft="${part.id}">制作入库</button><button class="op-btn undo" data-submarine-undo-craft="${part.id}" ${lastSubmarineOperation('part-craft', part.id) ? '' : 'disabled'}>撤销</button></td><td><button class="op-btn sale" data-submarine-sell="${part.id}" ${value.q ? '' : 'disabled'}>出售</button><button class="op-btn undo" data-submarine-undo-sale="${part.id}" ${lastSubmarineOperation('part-sale', part.id) ? '' : 'disabled'}>撤销</button></td><td class="price" data-submarine-price="${part.id}">${money(price)}</td><td>${money(cost)}</td><td class="profit">${money(profit)}</td><td class="margin">${cost ? Math.round(profit / cost * 100) + '%' : '—'}</td></tr>`; }).join('') : ''}`; }).join('')}</tbody></table></div></details>`;
    // 利润统计只在“潜水艇售卖”父级页面展示，台账保持为纯操作区。
    root.querySelector('section.profit-summary')?.remove();
    root.querySelector('#submarine-parts-details').ontoggle = event => { state.submarinePartsOpen = event.currentTarget.open; };
    root.querySelectorAll('[data-submarine-group]').forEach(button => button.onclick = () => { state.submarineGroups[button.dataset.submarineGroup] = !state.submarineGroups[button.dataset.submarineGroup]; renderSubmarine(); });
    root.querySelectorAll('[data-submarine-craft]').forEach(button => button.onclick = () => openSubmarineCraft(submarineData.parts.find(part => String(part.id) === button.dataset.submarineCraft)));
    root.querySelectorAll('[data-suite-craft]').forEach(button => button.onclick = () => openSubmarineCraft(submarineSuites.find(suite => suite.id === button.dataset.suiteCraft), true));
    root.querySelectorAll('[data-submarine-sell]').forEach(button => button.onclick = () => openSubmarineSale(submarineData.parts.find(part => String(part.id) === button.dataset.submarineSell)));
    root.querySelectorAll('[data-submarine-undo-craft],[data-submarine-undo-sale],[data-suite-undo-craft],[data-suite-undo-sale]').forEach(button => button.onclick = () => { const isSuite = button.hasAttribute('data-suite-undo-craft') || button.hasAttribute('data-suite-undo-sale'); const sale = button.hasAttribute('data-submarine-undo-sale') || button.hasAttribute('data-suite-undo-sale'); const targetId = button.dataset.submarineUndoCraft || button.dataset.submarineUndoSale || button.dataset.suiteUndoCraft || button.dataset.suiteUndoSale; try { undoSubmarineOperation((isSuite ? 'suite' : 'part') + '-' + (sale ? 'sale' : 'craft'), targetId); save(); renderSubmarine(); } catch (error) { alert(error.message || '撤销失败。'); } });
    root.querySelectorAll('[data-submarine-detail]').forEach(button => button.onclick = () => openSubmarineDetail(submarineData.parts.find(part => String(part.id) === button.dataset.submarineDetail)));
    root.querySelectorAll('[data-suite-detail]').forEach(button => button.onclick = () => openSubmarineSuiteDetail(submarineSuites.find(suite => suite.id === button.dataset.suiteDetail)));
    root.querySelectorAll('[data-submarine-price]').forEach(cell => { cell.onclick = () => { const part = submarineData.parts.find(item => String(item.id) === cell.dataset.submarinePrice); state.editingPriceKey = 'submarine-price-' + part.id; document.querySelector('#single-price-title').textContent = '调整' + part.n + '建议售价'; document.querySelector('#single-price-value').value = submarinePrice(part) || ''; document.querySelector('#single-price-dialog').showModal(); }; });
    root.querySelector('#add-submarine-suite').onclick = () => openSubmarineSuiteEditor();
    root.querySelectorAll('[data-suite-sell]').forEach(button => button.onclick = () => openSubmarineSuiteSale(submarineSuites.find(suite => suite.id === button.dataset.suiteSell)));
    root.querySelectorAll('[data-suite-edit]').forEach(button => button.onclick = () => openSubmarineSuiteEditor(submarineSuites.find(suite => suite.id === button.dataset.suiteEdit)));
    root.querySelectorAll('[data-suite-delete]').forEach(button => button.onclick = () => { const index = submarineSuites.findIndex(suite => suite.id === button.dataset.suiteDelete); if (index >= 0 && confirm('删除该整套配置？历史销售记录会保留。')) { submarineSuites.splice(index, 1); save(); renderSubmarine(); } });
    root.querySelectorAll('[data-suite-price]').forEach(cell => cell.onclick = () => { const suite = submarineSuites.find(item => item.id === cell.dataset.suitePrice); state.editingPriceKey = suite.priceKey; document.querySelector('#single-price-title').textContent = '调整整套 ' + suiteLabel(suite) + '建议售价'; document.querySelector('#single-price-value').value = suitePrice(suite) || ''; document.querySelector('#single-price-dialog').showModal(); });
  }

  const aggregate = pairs => Object.values(pairs.reduce((result, [name, quantity, uid]) => {
    const key = String(uid || name);
    result[key] = result[key] || { name, uid: Number(uid) || 0, quantity: 0 };
    result[key].quantity += Number(quantity || 0);
    return result;
  }, {})).sort((left, right) => (left.uid || Number.MAX_SAFE_INTEGER) - (right.uid || Number.MAX_SAFE_INTEGER) || left.name.localeCompare(right.name, 'zh-CN'));
  const materialUnitPrice = material => {
    if (!material) return 0;
    const direct = directSourceChoice(material);
    return direct.price || marketComparisonCost(material.mp) || 0;
  };
  const costTable = (rows, totalLabel, total, options = {}) => {
    const withTimeCost = rows;
    const priced = withTimeCost.map(entry => {
      const choice = entry.timeSurcharge ? null : (options.submarine ? (entry.sourceChoice || submarineSourceChoice(data.m.find(material => String(material.uid) === String(entry.uid)) || { uid: String(entry.uid) })) : null);
      return { ...entry, missing: !entry.cost && entry.quantity > 0, npc: choice?.key === 'npc' ? npcMaterial(entry.uid) : undefined, sourceChoice: choice };
    });
    // 金币显示按整数取整。完整展示时将舍入尾差附加到最后一行，保证用户看到的行合价之和等于表尾总价。
    if (options.reconcile !== false && options.npcSection !== false && priced.length) {
      const displayedTotal = Math.round(total || 0);
      const displayedRows = priced.reduce((sum, entry) => sum + Math.round(entry.cost || 0), 0);
      const target = priced.filter(entry => !entry.missing).at(-1);
      if (target) target.displayCost = Math.max(0, Math.round(target.cost || 0) + displayedTotal - displayedRows);
    }
    priced.forEach(entry => {
      entry.displayCost = entry.displayCost ?? Math.round(entry.cost || 0);
      entry.unit = entry.quantity ? entry.displayCost / entry.quantity : 0;
    });
    const sourceSections = options.sourceSections ?? options.npcSection;
    const npcHeader = sourceSections && priced.some(entry => entry.pinnedNpc) ? '<tr class="detail-section"><td colspan="4">NPC 固定价材料</td></tr>' : '';
    const exchangeHeader = sourceSections && priced.some(entry => entry.pinnedExchange) ? '<tr class="detail-section exchange-section"><td colspan="4">兑换推荐材料</td></tr>' : '';
    const marketHeader = sourceSections && priced.some(entry => entry.pinnedMarket) ? '<tr class="detail-section market-section"><td colspan="4">市场采购材料</td></tr>' : '';
    const regularHeader = sourceSections && priced.some(entry => !entry.pinnedNpc && !entry.pinnedExchange && !entry.pinnedMarket) ? '<tr class="detail-section"><td colspan="4">其余材料</td></tr>' : '';
    const rowHtml = entry => {
      const hasRecipe = !entry.timeSurcharge && Boolean(submarineRawRecipe(entry.uid));
      const isTerminal = entry.sourceChoice?.key && entry.sourceChoice.key !== 'craft' && entry.sourceChoice.key !== 'pending';
      const sourceTag = options.submarine && (entry.sourceChoice?.key === 'npc' || isExchangeChoice(entry.sourceChoice) || (hasRecipe && isTerminal)) ? recommendationTag(entry.sourceChoice) : '';
      const canOpenDetail = options.submarine && Boolean(sourceTag);
      const label = entry.timeSurcharge ? `<span class="item-label"><span>${entry.name}</span></span>` : itemLabelMarkup(entry.uid, entry.name);
      const name = canOpenDetail ? `<button class="submarine-material-link" data-submarine-material-detail="${entry.uid}">${label}</button>` : label;
      const source = entry.source ? `<small class="meta">采用：${entry.source}</small>` : '';
      return `<tr class="${entry.npc ? 'npc-row' : ''}"><td class="label">${sourceTag}${name}${source}</td><td>${entry.quantity}</td><td>${entry.missing ? '未获取' : money(entry.unit)}</td><td>${entry.missing ? '—' : money(entry.displayCost)}</td></tr>`;
    };
    const npcRows = priced.filter(entry => entry.pinnedNpc).map(rowHtml).join('');
    const exchangeRows = priced.filter(entry => !entry.pinnedNpc && entry.pinnedExchange).map(rowHtml).join('');
    const marketRows = priced.filter(entry => !entry.pinnedNpc && !entry.pinnedExchange && entry.pinnedMarket).map(rowHtml).join('');
    const regularRows = priced.filter(entry => !entry.pinnedNpc && !entry.pinnedExchange && !entry.pinnedMarket).map(rowHtml).join('');
    const body = priced.length
      ? (sourceSections ? `${npcHeader}${npcRows}${exchangeHeader}${exchangeRows}${marketHeader}${marketRows}${regularHeader}${regularRows}` : priced.map(rowHtml).join(''))
      : '<tr><td colspan="4" class="empty">暂无数据</td></tr>';
    return `<div class="table-wrap history-table"><table class="ledger"><thead><tr><th>材料 / 成品</th><th>数量</th><th>单价</th><th>合价</th></tr></thead><tbody>${body}</tbody><tfoot><tr><th colspan="3">${totalLabel}</th><th>${money(total)}</th></tr></tfoot></table></div>`;
  };
  function openBundleDetail(bundle) {
    const plan = productionPlan(bundle);
    const history = data.l.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.type === '出售' && entry.bundleId === bundle.id);
    document.querySelector('#bundle-detail-meta').textContent = `装备售卖 > ${bundle.group} > ${bundle.label}`;
    document.querySelector('#bundle-detail-title').textContent = `${bundle.label}装备详情`;
    const incomplete = bundle.components.filter(component => component.item && !hasCompleteBaseRecipe(component.item)).map(component => component.item.n);
    const missingPrices = plan.missing;
    const costOptions = { reconcile: false };
    const costSummary = `<section class="sales-history equipment-cost-summary"><div class="history-head"><div><h3>装备制作成本构成</h3><div class="sub">装备一律按完整配方自制到底：基础原料成本与成品清单成本一致。</div></div></div><div class="cards"><div class="card"><small>基础原料成本</small><b>${money(plan.basicTotal)}</b></div><div class="card"><small>装备制作总成本</small><b>${money(plan.total)}</b></div></div></section>`;
    document.querySelector('#bundle-detail-content').innerHTML = `${incomplete.length ? `<div class="status">基础配方不完整：${incomplete.join('、')}。该套装不可制作入账。</div>` : ''}${missingPrices.length ? `<div class="status">以下材料未获取单价：${missingPrices.join('、')}。请刷新市场价或添加采购记录后再制作。</div>` : ''}<div class="detail-columns"><section class="detail-column"><h3>成品清单</h3>${costTable(plan.finished, '成品清单总成本', plan.total, costOptions)}</section><section class="detail-column"><h3>制作素材：直接</h3>${costTable(plan.direct, '直接素材实际成本', plan.direct.reduce((sum, row) => sum + row.cost, 0), costOptions)}</section><section class="detail-column"><h3>制作素材：基础</h3>${costTable(plan.basic, '基础原料实际成本', plan.basicTotal, costOptions)}</section></div>${costSummary}<section class="sales-history"><div class="history-head"><div><h3>历史销售记录</h3><div class="sub">新增与删除记录都会同步回写该职业 / 分项的成品库存。</div></div></div><form id="detail-sale-form" class="history-form"><label>销售日期<input id="detail-sale-date" type="date" value="${today()}"></label><label>数量<input id="detail-sale-quantity" type="number" min="1" max="${inventory(bundle)}" value="1"></label><label>成交单价<input id="detail-sale-price" type="number" min="0.01" step="1" placeholder="建议售价 ${Math.round(priceFor(bundle))} G" required></label><button class="btn" ${inventory(bundle) ? '' : 'disabled'}>+ 新增销售记录</button></form><div class="table-wrap history-table"><table class="ledger"><thead><tr><th>日期</th><th>数量</th><th>成交额</th><th>销售成本</th><th>利润</th><th></th></tr></thead><tbody>${history.map(({ entry, index }) => `<tr><td>${entry.date}</td><td>${entry.q}</td><td>${money(entry.amount)}</td><td>${money(entry.cost)}</td><td class="profit">${money(entry.profit)}</td><td><button class="btn secondary" data-delete-sale="${index}">删除</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">暂无销售记录</td></tr>'}</tbody></table></div></section>`;
    document.querySelector('#detail-sale-form').onsubmit = event => {
      event.preventDefault();
      try {
        sell(bundle, Number(document.querySelector('#detail-sale-price').value || 0), document.querySelector('#detail-sale-date').value || today(), Number(document.querySelector('#detail-sale-quantity').value || 1), 'manual-sale');
        save(); refreshBundleDetail(bundle);
      } catch (error) { alert(error.message || '新增销售记录失败。'); }
    };
    document.querySelectorAll('[data-delete-sale]').forEach(button => button.onclick = () => {
      const log = data.l[Number(button.dataset.deleteSale)];
      if (!log || log.bundleId !== bundle.id) return;
      restoreSaleLog(log); data.l.splice(Number(button.dataset.deleteSale), 1); save(); refreshBundleDetail(bundle);
    });
    if (!document.querySelector('#bundle-detail-dialog').open) document.querySelector('#bundle-detail-dialog').showModal();
  }
  const refreshBundleDetail = bundle => {
    document.querySelector('#bundle-detail-dialog').close();
    render();
    openBundleDetail(bundle);
  };

  function craftPlan(bundle) {
    const plan = productionPlan(bundle);
    if (plan.missing.length) throw new Error('缺少成本：' + plan.missing.join('、'));
    const recipeCosts = plan.finished.map(row => {
      const item = bundle.components.find(component => component.item && Number(component.item.itemId) === row.uid)?.item;
      if (!item) throw new Error('套装中存在未匹配的成品配方。');
      return { id: item.id, qty: row.quantity, cost: row.cost };
    });
    return { recipeCosts, cost: plan.total };
  }
  function craft(bundle) {
    const plan = craftPlan(bundle);
    plan.recipeCosts.forEach(entry => {
      const value = stock(entry.id);
      value.q += entry.qty; value.v += entry.cost; value.made = (value.made || 0) + entry.qty;
      data.p[entry.id] = value;
    });
    data.l.unshift({ date: today(), type: '制作', item: bundle.label, q: 1, amount: plan.cost, cost: plan.cost, autoKind: 'craft', bundleId: bundle.id, recipeCosts: plan.recipeCosts });
  }
  function undoCraft(bundle) {
    const logIndex = data.l.findIndex(entry => isCraftLog(entry) && (entry.bundleId === bundle.id || (entry.legacyMigration && entry.recipeCosts?.some(cost => bundle.components.some(component => component.item?.id === cost.id)))));
    if (logIndex < 0) throw new Error('没有可撤销的自动制作记录。');
    const log = data.l[logIndex];
    if (log.recipeCosts.some(entry => stock(entry.id).q < (entry.qty || 1))) throw new Error('已有成品售出，不能撤销这次制作。');
    log.recipeCosts.forEach(entry => {
      const value = stock(entry.id);
      const entryQty = entry.qty || 1;
      value.q -= entryQty; value.v -= entry.cost; value.made = Math.max(0, (value.made || 0) - entryQty);
      data.p[entry.id] = value;
    });
    data.l.splice(logIndex, 1);
  }
  function sell(bundle, customPrice, saleDate = today(), quantity = 1, autoKind = 'sale') {
    quantity = Math.max(1, Number(quantity) || 1);
    customPrice = Number(customPrice || 0);
    if (!(customPrice > 0)) throw new Error('请填写大于 0 的实际成交单价。');
    if (inventory(bundle) < quantity) throw new Error('库存不足，不能售卖。');
    const recipeCosts = bundle.components.map(component => {
      const value = stock(component.item.id), componentQty = component.qty * quantity;
      return { id: component.item.id, qty: componentQty, cost: value.v / value.q * componentQty };
    });
    const cost = recipeCosts.reduce((sum, entry) => sum + entry.cost, 0), amount = customPrice * quantity;
    recipeCosts.forEach(entry => {
      const value = stock(entry.id);
      value.q -= entry.qty; value.v -= entry.cost; value.sold = (value.sold || 0) + entry.qty;
      data.p[entry.id] = value;
    });
    data.l.unshift({ date: saleDate, type: '出售', item: bundle.label, q: quantity, amount, cost, profit: amount - cost, autoKind, bundleId: bundle.id, recipeCosts });
  }
  function restoreSaleLog(log) {
    (log.recipeCosts || []).forEach(entry => {
      const value = stock(entry.id);
      const entryQty = entry.qty || Number(log.q) || 1;
      value.q += entryQty; value.v += entry.cost; value.sold = Math.max(0, (value.sold || 0) - entryQty);
      data.p[entry.id] = value;
    });
  }
  function undoSale(bundle) {
    const logIndex = data.l.findIndex(entry => entry.autoKind === 'sale' && entry.bundleId === bundle.id);
    if (logIndex < 0) throw new Error('没有可撤销的自动售卖记录。');
    const log = data.l[logIndex];
    restoreSaleLog(log);
    data.l.splice(logIndex, 1);
  }
  function openAutoSaleConfirm(bundle) {
    state.pendingAutoSale = bundle.id;
    const price = priceFor(bundle), cost = unitCost(bundle);
    document.querySelector('#auto-sale-price').value = '';
    document.querySelector('#auto-sale-price').placeholder = price ? `建议售价 ${Math.round(price)} G` : '请填写实际成交单价';
    document.querySelector('#auto-sale-summary').innerHTML = `<b>${bundle.label}</b><div class="meta" style="margin-top:8px">出售 1 套；请填写实际成交单价。</div><div style="margin-top:10px">建议售价 ${money(price)} · 成本 ${money(cost)} · 预计利润（按建议售价）${money(price - cost)} · 当前库存 ${inventory(bundle)}</div>`;
    document.querySelector('#auto-sale-dialog').showModal();
  }
  function changeBundle(action, bundle) {
    try {
      if (action === 'craft-plus') craft(bundle);
      if (action === 'craft-minus') undoCraft(bundle);
      if (action === 'sale-plus') return openAutoSaleConfirm(bundle);
      if (action === 'sale-minus') undoSale(bundle);
      save(); render();
    } catch (error) { alert(error.message || '操作失败。'); }
  }
  function editPrice(bundle) {
    state.editingPriceKey = bundle.priceKey;
    document.querySelector('#single-price-title').textContent = '调整' + bundle.label + '价格';
    document.querySelector('#single-price-value').value = priceFor(bundle) || '';
    document.querySelector('#single-price-dialog').showModal();
  }
  function openPriceTemplate() {
    const rows = ledgerRows(state.type);
    const current = part => priceFor(rows.find(item => item.pricePart === part) || { priceKey: '' });
    const combat = state.type === '770';
    document.querySelector('#price-template-title').textContent = combat ? '统一调整战职套装价格' : '统一调整生产采集套装价格';
    document.querySelector('#price-total-label').firstChild.textContent = combat ? '套装总价（含武器）' : '套装总价（含主副手）';
    document.querySelector('#price-weapon-label').firstChild.textContent = combat ? '武器价格' : '主副手价格';
    document.querySelector('#price-template-total').value = current('total') || '';
    document.querySelector('#price-template-armor').value = current('armor') || '';
    document.querySelector('#price-template-accessory').value = current('accessory') || '';
    document.querySelector('#price-template-weapon').value = prices[`${state.type}-template-weapon`] || '';
    document.querySelector('#price-template-dialog').showModal();
  }
  document.querySelector('#price-template-form').onsubmit = event => {
    event.preventDefault();
    const values = {
      total: Math.max(0, Number(document.querySelector('#price-template-total').value || 0)),
      armor: Math.max(0, Number(document.querySelector('#price-template-armor').value || 0)),
      accessory: Math.max(0, Number(document.querySelector('#price-template-accessory').value || 0)),
      weapon: Math.max(0, Number(document.querySelector('#price-template-weapon').value || 0))
    };
    ledgerRows(state.type).forEach(item => {
      if (item.pricePart === 'gear') delete prices[item.priceKey];
      else prices[item.priceKey] = values[item.pricePart] || 0;
    });
    prices[`${state.type}-template-weapon`] = values.weapon;
    save(); document.querySelector('#price-template-dialog').close(); renderEquipment();
  };
  function openCustomSale() {
    const rows = ledgerRows(state.type);
    const select = document.querySelector('#custom-row');
    select.innerHTML = rows.map(item => `<option value="${item.id}">${item.group} · ${item.label}（库存 ${inventory(item)}）</option>`).join('');
    const update = () => {
      const active = rows.find(item => item.id === select.value);
      document.querySelector('#custom-price').value = priceFor(active);
    };
    select.onchange = update; update();
    document.querySelector('#custom-sale').showModal();
  }
  document.querySelector('#custom-sale-form').onsubmit = event => {
    event.preventDefault();
    const bundle = ledgerRows(state.type).find(item => item.id === document.querySelector('#custom-row').value);
    try { sell(bundle, Number(document.querySelector('#custom-price').value || 0), today(), 1, 'custom-sale'); save(); document.querySelector('#custom-sale').close(); render(); } catch (error) { alert(error.message || '操作失败。'); }
  };
  document.querySelector('#auto-sale-form').onsubmit = event => {
    event.preventDefault();
    const bundle = ledgerRows(state.type).find(item => item.id === state.pendingAutoSale);
    try {
      if (!bundle) throw new Error('未找到待售套装。');
      sell(bundle, Number(document.querySelector('#auto-sale-price').value || 0)); save(); document.querySelector('#auto-sale-dialog').close(); state.pendingAutoSale = null; render();
    } catch (error) { alert(error.message || '售卖失败。'); }
  };
  document.querySelector('#single-price-form').onsubmit = event => {
    event.preventDefault();
    if (!state.editingPriceKey) return;
    prices[state.editingPriceKey] = Math.max(0, Number(document.querySelector('#single-price-value').value || 0));
    save(); document.querySelector('#single-price-dialog').close();
    if (state.page === 'submarine') renderSubmarine(); else renderEquipment();
  };
  document.querySelector('#trade-listing-form').onsubmit = async event => {
    event.preventDefault();
    const itemId = document.querySelector('#trade-listing-item-id').value, groups = Number(document.querySelector('#trade-listing-groups').value || 0), unitPrice = Number(document.querySelector('#trade-listing-unit-price').value || 0), category = document.querySelector('#trade-listing-category').value, error = document.querySelector('#trade-listing-error');
    const fail = (message, input) => { error.textContent = message; error.hidden = false; input?.focus(); };
    const material = tradeMaterial(itemId);
    if (!material) return fail('请先从搜索结果中选择材料。', document.querySelector('#trade-listing-search'));
    if (!(groups > 0) || !Number.isInteger(groups)) return fail('组数必须是大于 0 的整数。', document.querySelector('#trade-listing-groups'));
    if (!(unitPrice > 0)) return fail('请填写大于 0 的单价。', document.querySelector('#trade-listing-unit-price'));
    const sourceResolution = tradeSourceResolution(material);
    if (!sourceResolution.ready) return fail('来源查询失败或仍在进行中，请重试后再保存。', document.querySelector('#trade-listing-search'));
    const categoryOptions = sourceResolution.categories;
    if (!tradeCategoryOrder.includes(category) || (categoryOptions.length && !categoryOptions.includes(category))) return fail('请选择有效的来源分类。', document.querySelector('#trade-listing-category'));
    const timestamp = new Date().toLocaleString('zh-CN');
    const entry = { id: state.tradeEditingId || 'trade-' + Date.now() + '-' + Math.random().toString(16).slice(2), itemId: String(material.uid), name: material.n, category: category || 'other', categoryOrigin: categoryOptions.length > 1 ? 'manual' : 'auto', groups, groupSize: tradeGroupSize(material), unitPrice, total: groups * tradePriceMultiplier(material) * unitPrice, createdAt: state.tradeEditingId ? (tradeInventory.find(row => row.id === state.tradeEditingId)?.createdAt || timestamp) : timestamp, updatedAt: timestamp, visibility: 'local', remoteId: null, syncStatus: 'local' };
    const index = tradeInventory.findIndex(row => row.id === state.tradeEditingId);
    if (index >= 0) tradeInventory[index] = entry;
    else tradeInventory.unshift(entry);
    save();
    document.querySelector('#trade-listing-dialog').close();
    state.tradeEditingId = null;
    renderTrade();
    await refreshMarket(false, [material]);
  };
  document.querySelector('#trade-quantity-form').onsubmit = event => {
    event.preventDefault();
    const id = document.querySelector('#trade-quantity-id').value, groups = Number(document.querySelector('#trade-quantity-groups').value || 0), error = document.querySelector('#trade-quantity-error');
    const listing = tradeInventory.find(entry => entry.id === id);
    if (!listing) { error.textContent = '未找到该库存材料，请关闭后重试。'; error.hidden = false; return; }
    if (!(groups > 0) || !Number.isInteger(groups)) { error.textContent = '组数必须是大于 0 的整数。'; error.hidden = false; document.querySelector('#trade-quantity-groups').focus(); return; }
    const material = tradeMaterial(listing.itemId) || listing;
    listing.groups = groups;
    listing.groupSize = tradeGroupSize(material);
    listing.total = tradeTotal(listing);
    listing.updatedAt = new Date().toLocaleString('zh-CN');
    save();
    document.querySelector('#trade-quantity-dialog').close();
    renderTrade();
  };
  document.querySelector('#trade-unit-price-form').onsubmit = event => {
    event.preventDefault();
    const id = document.querySelector('#trade-unit-price-id').value, unitPrice = Number(document.querySelector('#trade-unit-price-value').value || 0), error = document.querySelector('#trade-unit-price-error');
    const listing = tradeInventory.find(entry => entry.id === id);
    if (!listing) { error.textContent = '未找到该库存材料，请关闭后重试。'; error.hidden = false; return; }
    if (!(unitPrice > 0)) { error.textContent = '单价必须大于 0。'; error.hidden = false; document.querySelector('#trade-unit-price-value').focus(); return; }
    listing.unitPrice = unitPrice;
    listing.total = tradeTotal(listing);
    listing.updatedAt = new Date().toLocaleString('zh-CN');
    save();
    document.querySelector('#trade-unit-price-dialog').close();
    renderTrade();
  };
  document.querySelector('#submarine-sale-form').onsubmit = event => {
    event.preventDefault();
    const part = submarineData.parts.find(item => Number(item.id) === Number(state.pendingSubmarineSale));
    try { if (!part) throw new Error('未找到待售潜水艇部件。'); submarineSell(part, Number(document.querySelector('#submarine-sale-price').value || 0), today(), Number(document.querySelector('#submarine-sale-quantity').value || 1)); save(); document.querySelector('#submarine-sale-dialog').close(); state.pendingSubmarineSale = null; renderSubmarine(); }
    catch (error) { alert(error.message || '售卖失败。'); }
  };
  document.querySelector('#submarine-suite-sale-form').onsubmit = event => {
    event.preventDefault();
    const suite = submarineSuites.find(item => item.id === state.pendingSubmarineSuite);
    try { if (!suite) throw new Error('未找到待售潜水艇整套。'); submarineSellSuite(suite, Number(document.querySelector('#submarine-suite-sale-price').value || 0), today(), Number(document.querySelector('#submarine-suite-sale-quantity').value || 1)); save(); document.querySelector('#submarine-suite-sale-dialog').close(); state.pendingSubmarineSuite = null; renderSubmarine(); }
    catch (error) { alert(error.message || '整套售卖失败。'); }
  };
  document.querySelector('#submarine-craft-form').onsubmit = event => {
    event.preventDefault();
    const pending = state.pendingSubmarineCraft, quantity = Number(document.querySelector('#submarine-craft-quantity').value || 1);
    try {
      if (!pending) throw new Error('未找到待制作项目。');
      if (pending.isSuite) submarineCraftSuite(submarineSuites.find(item => item.id === pending.id), quantity);
      else submarineCraft(submarineData.parts.find(item => Number(item.id) === Number(pending.id)), quantity);
      save(); document.querySelector('#submarine-craft-dialog').close(); state.pendingSubmarineCraft = null; renderSubmarine();
    } catch (error) { alert(error.message || '制作失败。'); }
  };
  document.querySelector('#report-reconcile-kind').onchange = updateReconcileTargets;
  document.querySelector('#report-reconcile-form').onsubmit = event => {
    event.preventDefault();
    const entry = findReportSale(state.pendingReportKey), kind = document.querySelector('#report-reconcile-kind').value, targetId = document.querySelector('#report-reconcile-target').value;
    try {
      if (!entry || !targetId) throw new Error('未找到待补全的销售记录或归属项目。');
      const patch = {
        date: document.querySelector('#report-reconcile-date').value || today(),
        item: document.querySelector('#report-reconcile-item').value.trim(),
        amount: Number(document.querySelector('#report-reconcile-amount').value || 0),
        cost: Number(document.querySelector('#report-reconcile-cost').value || 0),
        profit: Number(document.querySelector('#report-reconcile-profit').value || 0)
      };
      if (!patch.item) throw new Error('请填写销售记录名称。');
      reconcileReportSale(entry, kind, targetId, patch); save(); document.querySelector('#report-reconcile-dialog').close(); state.pendingReportKey = null;
      openOverviewSales(state.overviewPeriod, state.overviewSelectedMonth); renderHome();
    } catch (error) { alert(error.message || '补全来源失败。'); }
  };
  document.querySelector('#submarine-suite-form').onsubmit = event => {
    event.preventDefault();
    const code = document.querySelector('#submarine-suite-code').value.trim();
    const modified = document.querySelector('#submarine-suite-modified').checked;
    if (!/^[0-5]{4}$/.test(code) || !/[1-5]/.test(code)) return alert('套装简称必须为四位 0–5 数字，且至少包含一个部件。');
    const existing = submarineSuites.find(item => item.id === state.editingSubmarineSuite);
    const id = existing?.id || ('suite-' + Date.now());
    const suite = { id, code, modified, label: code + (modified ? '改' : ''), priceKey: existing?.priceKey || ('submarine-suite-' + id) };
    if (existing) Object.assign(existing, suite); else submarineSuites.push(suite);
    prices[suite.priceKey] = Math.max(0, Number(document.querySelector('#submarine-suite-price').value || 0));
    save(); document.querySelector('#submarine-suite-dialog').close(); renderSubmarine();
  };
  document.querySelector('#npc-material-form').onsubmit = event => {
    event.preventDefault();
    const uid = String(document.querySelector('#npc-material-id').value || '');
    const name = document.querySelector('#npc-material-name').value || materialName(uid);
    const price = Number(document.querySelector('#npc-material-price').value || 0);
    const source = document.querySelector('#npc-material-source').value.trim();
    if (!submarineCatalogIds().has(uid) || !price || !source) return alert('请选择潜水艇推荐材料名录内的材料，并填写 NPC 采购价和购买来源。');
    npcMaterialConfig.added = npcMaterialConfig.added || {};
    npcMaterialConfig.added[uid] = { name, price, source, manual: true };
    npcMaterialConfig.disabled = (npcMaterialConfig.disabled || []).filter(value => String(value) !== uid);
    invalidateNpcMaterials(); ensureSubmarineMaterials(); syncPurchaseCosts(); save();
    document.querySelector('#npc-material-price').value = '';
    document.querySelector('#npc-material-source').value = '';
    document.querySelector('#npc-material-search').value = '';
    openNpcMaterialManager(); renderGuide();
  };
  const backupDialog = document.querySelector('#backup-dialog');
  const backupStatus = document.querySelector('#backup-status');
  const setBackupStatus = message => { backupStatus.textContent = message; };
  const downloadBackup = backup => {
    const file = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(file), link = document.createElement('a');
    link.href = url;
    link.download = `gilfate-backup-${today()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const desktopBridge = window.ff14Desktop;
  const desktopUpdatePanels = document.querySelector('#desktop-update-panels');
  const dataUpdateCurrent = document.querySelector('#data-update-current');
  const dataUpdateLatest = document.querySelector('#data-update-latest');
  const dataUpdateApply = document.querySelector('#data-update-apply');
  const desktopUpdateCurrent = document.querySelector('#desktop-update-current');
  const desktopUpdateLatest = document.querySelector('#desktop-update-latest');
  const clientUpdatePanel = desktopUpdatePanels.querySelector('.update-panel:nth-child(2)');
  if (desktopBridge && clientUpdatePanel) {
    clientUpdatePanel.insertAdjacentHTML('beforeend', `<details id="update-source-settings" class="update-source-settings"><summary>更新下载源</summary><div id="update-source-options" class="update-source-options"></div><label id="update-source-custom" class="update-source-custom" hidden>自定义加速服务地址<input id="update-source-custom-input" type="url" inputmode="url" autocomplete="url" placeholder="例如 https://ghfast.top/"></label><div class="update-source-actions"><button id="update-source-save" class="btn secondary" type="button">保存下载源</button><button id="update-source-test" class="btn secondary" type="button">连接检测</button></div><p id="update-source-warning" class="update-source-warning" hidden>第三方加速服务由其运营方提供，可用性与安全性无法由 GilFate 保证。</p><p id="update-source-status" class="update-source-status">正在读取下载源设置…</p></details>`);
  }
  const updateSourceOptions = document.querySelector('#update-source-options');
  const updateSourceCustom = document.querySelector('#update-source-custom');
  const updateSourceCustomInput = document.querySelector('#update-source-custom-input');
  const updateSourceSave = document.querySelector('#update-source-save');
  const updateSourceTest = document.querySelector('#update-source-test');
  const updateSourceWarning = document.querySelector('#update-source-warning');
  const updateSourceStatus = document.querySelector('#update-source-status');
  let updateSourceBusy = false;
  const selectedUpdateSource = () => updateSourceOptions?.querySelector('input[name="update-source"]:checked')?.value || 'direct';
  const updateSourceValue = () => ({ id: selectedUpdateSource(), customUrl: updateSourceCustomInput?.value || '' });
  const setUpdateSourceBusy = busy => {
    updateSourceBusy = Boolean(busy);
    updateSourceOptions?.querySelectorAll('input').forEach(input => { input.disabled = updateSourceBusy; });
    if (updateSourceCustomInput) updateSourceCustomInput.disabled = updateSourceBusy;
    if (updateSourceSave) updateSourceSave.disabled = updateSourceBusy;
    if (updateSourceTest) updateSourceTest.disabled = updateSourceBusy;
  };
  const refreshUpdateSourceVisibility = () => {
    const isCustom = selectedUpdateSource() === 'custom';
    if (updateSourceCustom) updateSourceCustom.hidden = !isCustom;
    if (updateSourceWarning) updateSourceWarning.hidden = selectedUpdateSource() === 'direct';
  };
  const renderUpdateSource = source => {
    if (!updateSourceOptions) return;
    const options = Array.isArray(source?.options) ? source.options : [];
    updateSourceOptions.innerHTML = options.map(option => `<label class="update-source-option"><input type="radio" name="update-source" value="${option.id}"${option.id === source.id ? ' checked' : ''}>${option.name}</label>`).join('');
    if (updateSourceCustomInput) updateSourceCustomInput.value = source.customUrl || '';
    updateSourceOptions.querySelectorAll('input').forEach(input => { input.onchange = refreshUpdateSourceVisibility; });
    refreshUpdateSourceVisibility();
    setUpdateSourceBusy(source.busy || updateSourceBusy);
  };
  const refreshUpdateSource = async () => {
    if (!desktopBridge?.getUpdateSource || !updateSourceStatus) return;
    updateSourceStatus.textContent = '正在读取下载源设置…';
    try {
      const source = await desktopBridge.getUpdateSource();
      renderUpdateSource(source);
      updateSourceStatus.textContent = `当前使用：${source.name}。`;
    } catch (error) {
      updateSourceStatus.textContent = error.message || '无法读取下载源设置。';
    }
  };
  const formatDataVersion = info => info?.version ? String(info.version) : '未读取到资料版本';
  const refreshDataStatus = async () => {
    const result = await desktopBridge?.getDataStatus();
    if (!result?.available) {
      dataUpdateCurrent.textContent = result?.message || '无法读取本机资料版本。';
      return;
    }
    dataUpdateCurrent.textContent = `当前资料：${formatDataVersion(result.current)}${result.source === 'cache' ? '（已下载）' : '（内置）'}`;
    desktopUpdateCurrent.textContent = `当前版本：v${result.clientVersion || '—'}`;
  };
  document.querySelector('#backup-toggle').onclick = () => {
    setBackupStatus(desktopBridge ? '客户端数据保存在本机。导入会覆盖当前账本。' : '导出可保存浏览器账本；导入会覆盖当前数据。');
    desktopUpdatePanels.hidden = !desktopBridge;
    if (desktopBridge) { refreshDataStatus(); refreshUpdateSource(); }
    if (!backupDialog.open) backupDialog.showModal();
  };
  document.querySelector('#backup-export').onclick = async () => {
    try {
      const backup = createBackup();
      if (!desktopBridge) { downloadBackup(backup); setBackupStatus('账本备份已开始下载。'); return; }
      const result = await desktopBridge.exportBackup(backup);
      setBackupStatus(result.canceled ? '已取消导出。' : `备份已保存：${result.filePath}`);
    } catch (error) { setBackupStatus(error.message || '导出备份失败。'); }
  };
  const importBackup = async backup => {
    try { restoreBackup(backup); } catch (error) { setBackupStatus(error.message || '导入备份失败。'); }
  };
  const backupImportInput = document.querySelector('#backup-import-input');
  document.querySelector('#backup-import').onclick = async () => {
    if (!desktopBridge) { backupImportInput.value = ''; backupImportInput.click(); return; }
    const result = await desktopBridge.importBackup();
    if (result.canceled) return setBackupStatus('已取消导入。');
    if (result.error) return setBackupStatus(result.error);
    await importBackup(result.backup);
  };
  backupImportInput.onchange = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { await importBackup(JSON.parse(await file.text())); } catch (error) { setBackupStatus(error.message || '无法读取备份文件。'); }
  };
  document.querySelector('#desktop-update-check').onclick = async () => {
    const result = await desktopBridge?.checkForUpdates();
    if (result?.message) desktopUpdateLatest.textContent = result.message;
  };
  updateSourceSave?.addEventListener('click', async () => {
    if (!desktopBridge?.saveUpdateSource || updateSourceBusy) return;
    updateSourceStatus.textContent = '正在保存下载源…';
    const result = await desktopBridge.saveUpdateSource(updateSourceValue());
    if (!result?.available) {
      updateSourceStatus.textContent = result?.message || '保存下载源失败。';
      return;
    }
    renderUpdateSource(result);
    updateSourceStatus.textContent = result.message || `已切换为 ${result.name}。`;
  });
  updateSourceTest?.addEventListener('click', async () => {
    if (!desktopBridge?.testUpdateSource || updateSourceBusy) return;
    updateSourceTest.disabled = true;
    updateSourceStatus.textContent = '正在检测连接…';
    const result = await desktopBridge.testUpdateSource(updateSourceValue());
    updateSourceTest.disabled = updateSourceBusy;
    updateSourceStatus.textContent = result?.message || '连接检测失败。';
  });
  document.querySelector('#data-update-check').onclick = async () => {
    dataUpdateLatest.textContent = '正在检查资料更新…';
    dataUpdateApply.hidden = true;
    const result = await desktopBridge?.checkDataUpdates();
    if (!result?.available) {
      dataUpdateLatest.textContent = result?.message || '资料更新检查失败。';
      return;
    }
    dataUpdateLatest.textContent = result.updateAvailable
      ? `最新资料：${formatDataVersion(result.latest)}`
      : '当前资料已是最新版本。';
    dataUpdateApply.hidden = !result.updateAvailable;
  };
  document.querySelector('#data-update-apply').onclick = async () => {
    if (!confirm('下载并应用最新资料？已完成的采购、制作与销售历史不会被修改。')) return;
    dataUpdateApply.disabled = true;
    dataUpdateApply.textContent = '正在下载…';
    const result = await desktopBridge?.applyDataUpdate();
    dataUpdateApply.disabled = false;
    dataUpdateApply.textContent = '下载并应用资料';
    if (!result?.available) {
      dataUpdateLatest.textContent = result?.message || '资料更新失败，已保留当前资料。';
      return;
    }
    dataUpdateLatest.textContent = result.message;
    dataUpdateApply.hidden = true;
    await refreshDataStatus();
    if (result.updated && confirm('资料已下载，立即重载以使用新资料吗？')) location.reload();
  };
  document.querySelector('#desktop-update-restart').onclick = () => desktopBridge?.restartToUpdate();
  if (desktopBridge) desktopBridge.onUpdateStatus(status => {
    desktopUpdateLatest.textContent = status.message || '客户端更新状态已更新。';
    setUpdateSourceBusy(status.state === 'available' || status.state === 'downloading');
    const restart = document.querySelector('#desktop-update-restart');
    restart.hidden = status.state !== 'downloaded';
    if (status.state === 'downloaded' && confirm(`${status.message}\n现在重启并安装吗？`)) desktopBridge.restartToUpdate();
  });
  document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => document.querySelector('#' + button.dataset.close).close());
  document.querySelector('#craft-scrip-manual-form').onsubmit = saveCraftScripManualDialog;
  document.querySelector('#craft-scrip-manual-material').addEventListener('input', event => {
    const material = findCraftScripMaterial(event.target.value);
    document.querySelector('#craft-scrip-manual-resolved').textContent = material ? `已识别：${material.n}（ID ${material.uid}）` : '未识别为当前已加载物品；可继续输入物品 ID，或等待道具索引加载完成。';
    document.querySelector('#craft-scrip-manual-error').hidden = true;
  });
  document.querySelectorAll('dialog').forEach(dialog => {
    let beganOnBackdrop = false;
    dialog.addEventListener('pointerdown', event => { beganOnBackdrop = event.target === dialog; });
    dialog.addEventListener('pointercancel', () => { beganOnBackdrop = false; });
    dialog.addEventListener('click', event => {
      if (beganOnBackdrop && event.target === dialog) dialog.close();
      beganOnBackdrop = false;
    });
  });
  const purchaseQuantity = document.querySelector('#purchase-quantity');
  const purchaseTax = document.querySelector('#purchase-tax');
  const purchaseUnit = document.querySelector('#purchase-unit');
  const purchaseTotal = document.querySelector('#purchase-total');
  const purchaseSourcePrice = document.querySelector('#purchase-source-price');
  const purchaseExchangeTurns = document.querySelector('#purchase-exchange-turns');
  const purchaseError = document.querySelector('#purchase-error');
  const nonNegativeNumber = value => {
    const number = Number(String(value ?? '').trim());
    return Number.isFinite(number) && number >= 0 ? number : 0;
  };
  const moneyInputValue = value => {
    const number = nonNegativeNumber(value);
    return Number(value) > 0 ? number.toFixed(2) : '';
  };
  const normalizeMoneyInput = input => {
    const text = String(input.value ?? '').trim();
    if (!text) return 0;
    const value = nonNegativeNumber(text);
    input.value = value.toFixed(2);
    return value;
  };
  const normalizePurchaseMoneyInputs = () => [purchaseUnit, purchaseTotal, purchaseSourcePrice].forEach(normalizeMoneyInput);
  const clearPurchaseError = () => { purchaseError.hidden = true; purchaseError.textContent = ''; };
  const showPurchaseError = (message, input) => {
    purchaseError.textContent = message;
    purchaseError.hidden = false;
    input?.focus();
  };
  const syncPurchaseForm = () => {
    const quantity = nonNegativeNumber(purchaseQuantity.value), tax = nonNegativeNumber(purchaseTax.value);
    if (!(quantity > 0)) return;
    if (state.purchaseEditMode === 'total') {
      purchaseUnit.value = (nonNegativeNumber(purchaseTotal.value) / quantity / (1 + tax)).toFixed(2);
    } else {
      purchaseTotal.value = (quantity * nonNegativeNumber(purchaseUnit.value) * (1 + tax)).toFixed(2);
    }
  };
  [purchaseQuantity, purchaseUnit, purchaseTotal, purchaseSourcePrice, purchaseExchangeTurns].forEach(input => {
    input.addEventListener('click', () => input.select());
    input.addEventListener('input', clearPurchaseError);
  });
  [purchaseUnit, purchaseTotal, purchaseSourcePrice].forEach(input => input.addEventListener('blur', () => {
    normalizeMoneyInput(input);
    if (input !== purchaseSourcePrice) syncPurchaseForm();
    else state.syncPurchaseMode?.(false);
  }));
  purchaseUnit.oninput = () => { state.purchaseEditMode = 'unit'; syncPurchaseForm(); };
  purchaseTotal.oninput = () => { state.purchaseEditMode = 'total'; syncPurchaseForm(); };
  purchaseQuantity.oninput = syncPurchaseForm;
  purchaseTax.onchange = syncPurchaseForm;
  document.querySelector('#purchase-form').onsubmit = event => {
    event.preventDefault();
    const material = data.m.find(item => item.id === state.selectedMaterial);
    const mode = document.querySelector('#purchase-kind').value;
    let entry;
    if (mode.startsWith('exchange:')) {
      const routeIndex = Number(mode.slice(9)), route = exchangeSources.routes?.[routeIndex];
      normalizeMoneyInput(purchaseSourcePrice);
      const turns = nonNegativeNumber(document.querySelector('#purchase-exchange-turns').value);
      const sourceUnitPrice = nonNegativeNumber(purchaseSourcePrice.value);
      const outputPerTurn = Number(route?.outputs?.[String(material?.uid)] || 0);
      const sourceQuantity = route?.carrierId ? turns : turns * Number(route?.ticketCost || 0);
      const quantity = turns * outputPerTurn, total = sourceQuantity * sourceUnitPrice;
      if (!material || !route || !(turns > 0) || !(quantity > 0)) return showPurchaseError('请填写大于 0 的兑换次数。', document.querySelector('#purchase-exchange-turns'));
      if (!(sourceUnitPrice > 0) || !(total > 0)) return showPurchaseError('请填写大于 0 的凭证单价。', purchaseSourcePrice);
      entry = {
        id: state.editingPurchaseId || 'exchange-' + Date.now(), kind: 'exchange', materialId: material.id,
        date: document.querySelector('#purchase-date').value || today(), quantity, unitPrice: total / quantity, total, tax: 0,
        exchangeRoute: routeIndex, exchangeSource: route.label, exchangeOutputUid: String(material.uid),
        exchangeTurns: turns, exchangeSourceUnitPrice: sourceUnitPrice, exchangeSourceQuantity: sourceQuantity
      };
    } else {
      normalizeMoneyInput(purchaseUnit); normalizeMoneyInput(purchaseTotal); syncPurchaseForm();
      const quantity = nonNegativeNumber(purchaseQuantity.value), tax = nonNegativeNumber(purchaseTax.value), unitPrice = nonNegativeNumber(purchaseUnit.value), total = nonNegativeNumber(purchaseTotal.value);
      if (!material || !(quantity > 0)) return showPurchaseError('请填写大于 0 的购买数量。', purchaseQuantity);
      if (!(unitPrice > 0) && !(total > 0)) return showPurchaseError('请填写大于 0 的单价或合价。', state.purchaseEditMode === 'total' ? purchaseTotal : purchaseUnit);
      entry = { id: state.editingPurchaseId || 'purchase-' + Date.now(), materialId: material.id, date: document.querySelector('#purchase-date').value || today(), quantity, unitPrice, total, tax };
    }
    const index = purchases.findIndex(row => row.id === state.editingPurchaseId);
    if (index >= 0) purchases[index] = entry;
    else purchases.unshift(entry);
    refreshNpcRecommendations(); save(); document.querySelector('#purchase-dialog').close();
    if (document.querySelector('#purchase-manager-dialog').open) { renderPurchaseManager(); renderGuide(); }
    else if (state.guideView === 'detail') renderPurchaseDetail();
    else renderGuide();
  };
  document.querySelectorAll('.app-primary-nav button[data-page]').forEach(button => button.onclick = () => {
    state.page = button.dataset.page; state.expanded = false; state.guideExpanded = false; state.submarineExpanded = false; render();
  });
  document.querySelector('#equipment-toggle').onclick = () => { state.page = 'equipment'; state.type = null; state.expanded = true; state.submarineExpanded = false; state.guideExpanded = false; render(); };
  document.querySelectorAll('[data-equipment-category]').forEach(button => button.onclick = () => {
    const grade = availableEquipmentGrades(button.dataset.equipmentCategory)[0];
    if (!grade) return alert('该装备类型暂无可用的品级数据。');
    state.page = 'equipment'; state.type = grade.id; state.expanded = true; state.submarineExpanded = false; state.guideExpanded = false; render();
  });
  document.querySelector('#submarine-toggle').onclick = () => { state.page = 'submarine'; state.submarineView = 'summary'; state.submarineExpanded = true; state.expanded = false; state.guideExpanded = false; render(); };
  document.querySelectorAll('[data-submarine-view]').forEach(button => button.onclick = () => { state.page = 'submarine'; state.submarineView = button.dataset.submarineView; state.submarineExpanded = true; state.expanded = false; state.guideExpanded = false; render(); });
  document.querySelector('.app-primary-nav button[data-page="leve"]').onclick = () => { state.page = 'leve'; state.leveView = 'ledger'; state.leveSaleView = 'orders'; state.leveSaleDraft = null; state.expanded = false; state.submarineExpanded = false; state.guideExpanded = false; render(); };
  document.querySelectorAll('#leve-subnav [data-leve-view]').forEach(button => button.onclick = () => {
    state.page = 'leve'; state.leveView = button.dataset.leveView;
    if (state.leveView === 'ledger') { state.leveSaleView = 'orders'; state.leveSaleDraft = null; }
    state.expanded = false; state.submarineExpanded = false; state.guideExpanded = false; render();
  });
  document.querySelector('.app-primary-nav button[data-page="trade"]').onclick = () => { state.page = 'trade'; state.tradeView = 'inventory'; state.expanded = false; state.submarineExpanded = false; state.guideExpanded = false; render(); };
  document.querySelectorAll('[data-trade-view]').forEach(button => button.onclick = () => { state.page = 'trade'; state.tradeView = button.dataset.tradeView; state.expanded = false; state.submarineExpanded = false; state.guideExpanded = false; render(); });
  document.querySelector('#guide-toggle').onclick = () => { state.page = 'guide'; state.guideView = 'basic'; state.selectedMaterial = null; state.guideExpanded = true; state.expanded = false; state.submarineExpanded = false; render(); };
  document.querySelector('#trade-market-popover').addEventListener('mouseenter', () => clearTimeout(tradePopoverHideTimer));
  document.querySelector('#trade-market-popover').addEventListener('mouseleave', () => hideTradeMarketPopover(true));
  window.addEventListener('resize', positionTradeMarketPopover);
  document.addEventListener('scroll', () => { if (activeTradePopover) hideTradeMarketPopover(); }, true);
  document.addEventListener('click', event => { if (!event.target.closest('#trade-context-menu')) hideTradeContextMenu(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hideTradeContextMenu(); });
  function render() {
    document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === state.page));
    document.querySelectorAll('.app-primary-nav button[data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === state.page));
    const equipmentOpen = state.page === 'equipment', submarineOpen = state.page === 'submarine', guideOpen = state.page === 'guide', tradeOpen = state.page === 'trade', leveOpen = state.page === 'leve';
    document.querySelector('#equipment-toggle').classList.toggle('active', equipmentOpen);
    document.querySelector('#equipment-toggle').setAttribute('aria-expanded', String(equipmentOpen));
    document.querySelector('#equipment-toggle .nav-caret').textContent = equipmentOpen ? '⌃' : '⌄';
    document.querySelector('#equipment-subnav').classList.toggle('open', equipmentOpen);
    document.querySelectorAll('[data-equipment-category]').forEach(button => button.classList.toggle('active', state.page === 'equipment' && Boolean(state.type) && button.dataset.equipmentCategory === equipmentCategoryFor(state.type)));
    document.querySelector('#submarine-toggle').classList.toggle('active', submarineOpen);
    document.querySelector('#submarine-toggle').setAttribute('aria-expanded', String(submarineOpen));
    document.querySelector('#submarine-toggle .nav-caret').textContent = submarineOpen ? '⌃' : '⌄';
    document.querySelector('#submarine-subnav').classList.toggle('open', submarineOpen);
    document.querySelectorAll('[data-submarine-view]').forEach(button => button.classList.toggle('active', state.page === 'submarine' && button.dataset.submarineView === state.submarineView));
    document.querySelector('#guide-toggle').classList.toggle('active', guideOpen);
    document.querySelector('#guide-toggle').setAttribute('aria-expanded', String(guideOpen));
    document.querySelector('#guide-toggle .nav-caret').textContent = guideOpen ? '⌃' : '⌄';
    document.querySelector('.app-contextbar').classList.toggle('has-open-nav', equipmentOpen || submarineOpen || leveOpen || tradeOpen);
    document.querySelector('#leve-subnav').classList.toggle('open', leveOpen);
    document.querySelectorAll('#leve-subnav [data-leve-view]').forEach(button => button.classList.toggle('active', leveOpen && button.dataset.leveView === state.leveView));
    document.querySelector('#trade-subnav').classList.toggle('open', tradeOpen);
    document.querySelectorAll('[data-trade-view]').forEach(button => button.classList.toggle('active', state.page === 'trade' && button.dataset.tradeView === state.tradeView));
    if (state.page === 'home') renderHome();
    else if (state.page === 'equipment') renderEquipment();
    else if (state.page === 'submarine') renderSubmarine();
    else if (state.page === 'leve') renderLeve();
    else if (state.page === 'trade') renderTrade();
    else if (state.page === 'guide') renderGuide();
  }
  if (migrateLegacyInventories()) save();
  render();
  const desktopMigrationNoticeKey = 'ff14-desktop-migration-notice-seen';
  const hasDesktopLedgerData = backupStorageKeys.some(key => localStorage.getItem(key) !== null);
  if (desktopBridge && !hasDesktopLedgerData && !localStorage.getItem(desktopMigrationNoticeKey)) {
    localStorage.setItem(desktopMigrationNoticeKey, '1');
    setTimeout(() => {
      setBackupStatus('首次使用客户端：网页版本的数据不会自动带入。请先在网页导出账本 JSON，再在这里导入。');
      if (!backupDialog.open) backupDialog.showModal();
    }, 300);
  }
  // 首屏先完成渲染；完整材料市场价在后台分批刷新，避免启动时阻塞导航与台账操作。
  preloadJobIcons();
  setTimeout(() => refreshMarket(false), 450);
  setInterval(() => {
    if (state.page === 'guide' && state.guideView !== 'detail') refreshMarket(false, visibleGuideMarketMaterials());
  }, 3 * 60 * 60 * 1000);
});
