(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MarketWatch = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const builtInCategories = [
    { id: 'materials', name: '材料' },
    { id: 'consumables', name: '食物药品' },
    { id: 'furniture', name: '家具' },
    { id: 'other', name: '其他' }
  ];
  const priorities = ['high', 'medium', 'low'];
  const qualities = ['all', 'hq', 'nq'];
  const chinaDataCenters = ['陆行鸟', '莫古力', '猫小胖', '豆豆柴'];
  const chinaScopeKey = 'region:China';
  function normalizeScope(value) {
    const dataCenter = chinaDataCenters.includes(value?.dataCenter) ? value.dataCenter : 'China';
    const worldId = dataCenter === 'China' ? null : positiveInteger(value?.worldId);
    return { dataCenter, worldId };
  }
  const scopeKey = value => {
    const scope = normalizeScope(value);
    return scope.worldId ? `world:${scope.worldId}` : scope.dataCenter === 'China' ? chinaScopeKey : `dc:${scope.dataCenter}`;
  };
  const scopePath = value => String(normalizeScope(value).worldId || normalizeScope(value).dataCenter);
  function normalizeWorldCatalog(dataCenters, worlds) {
    const names = new Map((Array.isArray(worlds) ? worlds : []).map(row => [positiveInteger(row?.id), String(row?.name || '')]));
    return chinaDataCenters.map(name => {
      const row = (Array.isArray(dataCenters) ? dataCenters : []).find(entry => entry?.name === name && ['中国', 'China'].includes(entry?.region));
      return { name, worlds: (Array.isArray(row?.worlds) ? row.worlds : []).map(id => ({ id: positiveInteger(id), name: names.get(positiveInteger(id)) })).filter(world => world.id && world.name) };
    });
  }
  function scopeLabel(value, catalog = []) {
    const scope = normalizeScope(value);
    if (scope.dataCenter === 'China') return '中国区汇总';
    const world = catalog.find(row => row.name === scope.dataCenter)?.worlds?.find(row => row.id === scope.worldId);
    return world ? `${scope.dataCenter} · ${world.name}` : `${scope.dataCenter} · 全大区`;
  }
  function listingWorldName(row, catalog = [], scope = null) {
    if (String(row?.worldName || '').trim()) return String(row.worldName).trim();
    const worldID = positiveInteger(row?.worldID) || normalizeScope(scope).worldId;
    if (!worldID) return '未知服务器';
    const world = catalog.flatMap(dataCenter => dataCenter.worlds || []).find(entry => entry.id === worldID);
    return world?.name || `服务器 ID ${worldID}`;
  }
  const positiveInteger = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  function normalizeCraftRecipes(raw) {
    return (Array.isArray(raw) ? raw : []).map((recipe, index) => {
      const ingredients = Array.isArray(recipe?.a) ? recipe.a : (Array.isArray(recipe?.ingredients) ? recipe.ingredients : []).flatMap(row => [row.id, row.amount]);
      const pairs = [];
      for (let i = 0; i < ingredients.length; i += 2) {
        const id = positiveInteger(ingredients[i]), quantity = positiveInteger(ingredients[i + 1]);
        if (id && quantity) pairs.push(id, quantity);
      }
      return { id: String(recipe?.id || `recipe-${index}`), job: Number(recipe?.j ?? recipe?.job) || 0,
        level: Number(recipe?.l ?? recipe?.lvl) || 0, yield: positiveInteger(recipe?.y ?? recipe?.yield) || 1,
        ingredients: pairs, sourceUrl: String(recipe?.sourceUrl || '') };
    }).filter(recipe => recipe.ingredients.length);
  }
  function quoteCraftRecipe(recipe, prices = {}) {
    const rows = [];
    for (let i = 0; i < recipe.ingredients.length; i += 2) {
      const uid = String(recipe.ingredients[i]), quantity = recipe.ingredients[i + 1];
      const choice = prices[uid] || {}, unitPrice = Number(choice.price) > 0 ? Number(choice.price) : null;
      rows.push({ uid, quantity, unitPrice, source: choice.source || '待补价', total: unitPrice === null ? null : unitPrice * quantity });
    }
    const missing = rows.filter(row => row.total === null).map(row => row.uid);
    const batchTotal = missing.length ? null : rows.reduce((sum, row) => sum + row.total, 0);
    return { rows, missing, batchTotal, unitTotal: batchTotal === null ? null : batchTotal / recipe.yield };
  }
  function cheapestCraftRecipeIndex(recipes, prices) {
    const complete = recipes.map((recipe, index) => ({ index, quote: quoteCraftRecipe(recipe, prices) }))
      .filter(row => row.quote.unitTotal !== null).sort((a, b) => a.quote.unitTotal - b.quote.unitTotal || a.index - b.index);
    return complete[0]?.index ?? 0;
  }

  function normalizeSettings(input, legacyIds = []) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const seenNames = new Set(builtInCategories.map(category => category.name));
    const customCategories = [];
    for (const entry of Array.isArray(source.customCategories) ? source.customCategories : []) {
      const id = String(entry?.id || ''), name = String(entry?.name || '').trim().slice(0, 24);
      if (!/^custom-[\w-]+$/.test(id) || !name || seenNames.has(name) || customCategories.some(category => category.id === id)) continue;
      seenNames.add(name);
      customCategories.push({ id, name });
    }
    const categoryIds = new Set([...builtInCategories, ...customCategories].map(category => category.id));
    const items = {};
    const rawItems = source.items && typeof source.items === 'object' && !Array.isArray(source.items) ? source.items : {};
    const ids = [...new Set([...(Array.isArray(legacyIds) ? legacyIds : []), ...Object.keys(rawItems)].map(String).filter(id => /^\d+$/.test(id)))];
    ids.forEach((uid, index) => {
      const row = rawItems[uid] || {};
      const below = positiveInteger(row.below), above = positiveInteger(row.above);
      items[uid] = {
        categoryId: categoryIds.has(row.categoryId) ? row.categoryId : 'other',
        priority: priorities.includes(row.priority) ? row.priority : 'medium',
        quality: qualities.includes(row.quality) ? row.quality : 'all',
        below: below && above && below >= above ? null : below,
        above,
        order: Number.isSafeInteger(row.order) && row.order >= 0 ? row.order : index,
        alertStates: (() => {
          const states = {};
          for (const [key, value] of Object.entries(row.alertStates && typeof row.alertStates === 'object' ? row.alertStates : {})) {
            if (/^(region:China|dc:|world:\d+)/.test(key) && ['inside', 'below', 'above'].includes(value)) states[key] = value;
          }
          if (!states[chinaScopeKey]) states[chinaScopeKey] = ['inside', 'below', 'above'].includes(row.alertState) ? row.alertState : 'inside';
          return states;
        })()
      };
    });
    const alerts = (Array.isArray(source.alerts) ? source.alerts : []).filter(alert =>
      alert && items[String(alert.uid)] && ['below', 'above'].includes(alert.kind) && Number(alert.price) > 0 && Number(alert.at) > 0
    ).slice(-100).map(alert => ({ uid: String(alert.uid), kind: alert.kind, price: Number(alert.price), at: Number(alert.at), read: Boolean(alert.read), scopeKey: String(alert.scopeKey || chinaScopeKey), scopeLabel: String(alert.scopeLabel || '中国区汇总') }));
    return { customCategories, items, alerts, marketScope: normalizeScope(source.marketScope) };
  }

  const matchesQuality = (row, quality) => quality === 'all' || Boolean(row?.hq) === (quality === 'hq');
  function summarizeListings(listings, quality = 'all', maxUnits = 999) {
    const valid = (Array.isArray(listings) ? listings : [])
      .filter(row => matchesQuality(row, quality) && Number(row.pricePerUnit) > 0 && Number(row.quantity) > 0)
      .sort((left, right) => Number(left.pricePerUnit) - Number(right.pricePerUnit));
    if (!valid.length) return { minimum: null, average: null, sampleUnits: 0, listings: [] };
    let remaining = maxUnits, total = 0, sampleUnits = 0;
    for (const row of valid) {
      if (!remaining) break;
      const units = Math.min(remaining, Number(row.quantity));
      total += Number(row.pricePerUnit) * units;
      sampleUnits += units;
      remaining -= units;
    }
    return {
      minimum: Number(valid[0].pricePerUnit),
      average: sampleUnits ? total / sampleUnits : null,
      sampleUnits,
      listings: valid.slice(0, 10).map(row => ({
        pricePerUnit: Number(row.pricePerUnit), quantity: Number(row.quantity), hq: Boolean(row.hq),
        worldID: positiveInteger(row.worldID), worldName: String(row.worldName || ''), retainerName: String(row.retainerName || '')
      }))
    };
  }

  const dayKey = timestamp => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
  function summarizeSales(entries, quality = 'all', now = Date.now(), truncated = false) {
    const days = Array.from({ length: 14 }, (_, index) => dayKey(now - (13 - index) * 86400000));
    const daily = new Map(days.map(day => [day, { total: 0, units: 0 }]));
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!matchesQuality(entry, quality) || !(Number(entry.pricePerUnit) > 0) || !(Number(entry.quantity) > 0)) continue;
      const time = Number(entry.timestamp) * 1000;
      if (!Number.isFinite(time) || time > now || now - time > 14 * 86400000) continue;
      const bucket = daily.get(dayKey(time));
      if (!bucket) continue;
      bucket.total += Number(entry.pricePerUnit) * Number(entry.quantity);
      bucket.units += Number(entry.quantity);
    }
    const buckets = days.map(day => ({ day, units: daily.get(day).units, price: daily.get(day).units ? daily.get(day).total / daily.get(day).units : null }));
    const recent = buckets.slice(7), previous = buckets.slice(0, 7);
    const recentUnits = recent.reduce((sum, bucket) => sum + bucket.units, 0);
    const previousUnits = previous.reduce((sum, bucket) => sum + bucket.units, 0);
    const recentActiveDays = recent.filter(bucket => bucket.units).length;
    const previousActiveDays = previous.filter(bucket => bucket.units).length;
    const weighted = values => {
      const units = values.reduce((sum, bucket) => sum + bucket.units, 0);
      return units ? values.reduce((sum, bucket) => sum + Number(bucket.price || 0) * bucket.units, 0) / units : null;
    };
    const earlyPrice = weighted(recent.slice(0, 4)), latePrice = weighted(recent.slice(4));
    const earlyDays = recent.slice(0, 4).filter(bucket => bucket.units).length;
    const lateDays = recent.slice(4).filter(bucket => bucket.units).length;
    const direction = !truncated && earlyDays >= 2 && lateDays >= 2 && earlyPrice > 0
      ? latePrice > earlyPrice * 1.05 ? 'up' : latePrice < earlyPrice * .95 ? 'down' : 'flat'
      : 'insufficient';
    const salesDirection = !truncated && previousActiveDays >= 2 && recentActiveDays >= 2
      ? recentUnits > previousUnits * 1.2 ? 'up' : recentUnits < previousUnits * .8 ? 'down' : 'flat'
      : 'insufficient';
    return { points: recent.map(bucket => bucket.price), averageSalePrice: weighted(recent), recentUnits, previousUnits, direction, salesDirection, truncated };
  }

  const chinaOffset = 8 * 60 * 60 * 1000;
  const chinaDayStart = timestamp => Math.floor((timestamp + chinaOffset) / 86400000) * 86400000 - chinaOffset;
  const chinaDayLabel = timestamp => new Date(timestamp + chinaOffset).toISOString().slice(0, 10);
  const chinaHourLabel = timestamp => new Date(timestamp + chinaOffset).toISOString().slice(0, 13);
  function aggregateSalesHistory(entries, quality = 'all', now = Date.now(), truncated = false) {
    const daily = {}, hourly = {};
    const firstDay = chinaDayStart(now) - 29 * 86400000;
    const firstHour = chinaDayStart(now) - 2 * 86400000;
    let oldestTimestamp = null;
    for (const entry of Array.isArray(entries) ? entries : []) {
      const time = Number(entry?.timestamp) * 1000;
      if (!Number.isFinite(time) || time > now) continue;
      oldestTimestamp = oldestTimestamp === null ? time : Math.min(oldestTimestamp, time);
      if (!matchesQuality(entry, quality) || !(Number(entry.pricePerUnit) > 0) || !(Number(entry.quantity) > 0)) continue;
      const units = Number(entry.quantity), total = Number(entry.pricePerUnit) * units;
      if (time >= firstDay) {
        const key = chinaDayLabel(time), bucket = daily[key] || (daily[key] = { total: 0, units: 0 });
        bucket.total += total; bucket.units += units;
      }
      if (time >= firstHour) {
        const key = chinaHourLabel(time), bucket = hourly[key] || (hourly[key] = { total: 0, units: 0 });
        bucket.total += total; bucket.units += units;
      }
    }
    return { daily, hourly, oldestTimestamp, truncated: Boolean(truncated), updatedAt: now };
  }

  function salesForPeriod(history, period = 'week', now = Date.now()) {
    if (!history || !['week', 'month', 'today', 'yesterday'].includes(period)) return null;
    const today = chinaDayStart(now);
    const hourly = period === 'today' || period === 'yesterday';
    const count = period === 'today' ? Math.floor((now - today) / 3600000) + 1 : hourly ? 24 : period === 'month' ? 30 : 7;
    const start = hourly ? today - (period === 'yesterday' ? 86400000 : 0) : today - (count - 1) * 86400000;
    const step = hourly ? 3600000 : 86400000;
    const source = hourly ? history.hourly || {} : history.daily || {};
    const points = Array.from({ length: count }, (_, index) => {
      const time = start + index * step;
      const key = hourly ? chinaHourLabel(time) : chinaDayLabel(time);
      const bucket = source[key];
      const units = Number(bucket?.units) || 0;
      return { key, label: hourly ? key.slice(11) + ':00' : key.slice(5), price: units ? Number(bucket.total) / units : null, units };
    });
    const complete = !history.truncated || Number(history.oldestTimestamp) <= start;
    const units = points.reduce((sum, point) => sum + point.units, 0);
    const total = points.reduce((sum, point) => sum + (point.price || 0) * point.units, 0);
    return { points, averageSalePrice: complete && units ? total / units : null, units: complete ? units : null, complete };
  }

  function alertTransition(item, minimum, marketKey = chinaScopeKey) {
    const previous = item.alertStates?.[marketKey] || item.alertState || 'inside';
    if (!(Number(minimum) > 0)) return { state: previous, alert: null };
    const state = item.below && minimum < item.below ? 'below' : item.above && minimum > item.above ? 'above' : 'inside';
    return { state, alert: state !== 'inside' && state !== previous ? state : null };
  }

  function sparkline(points, width = 112, height = 28) {
    const values = points.map(value => Number(value) > 0 ? Number(value) : null);
    const valid = values.filter(value => value !== null);
    if (valid.length < 2) return '';
    const min = Math.min(...valid), max = Math.max(...valid), spread = max - min || 1;
    return values.map((value, index) => value === null ? null : [
      (index * width / (values.length - 1)).toFixed(1),
      (height - 3 - (value - min) / spread * (height - 6)).toFixed(1)
    ]).filter(Boolean).map(point => point.join(',')).join(' ');
  }

  return { builtInCategories, chinaDataCenters, chinaScopeKey, priorities, qualities, escapeHtml, normalizeCraftRecipes, quoteCraftRecipe, cheapestCraftRecipeIndex, normalizeScope, scopeKey, scopePath, scopeLabel, listingWorldName, normalizeWorldCatalog, normalizeSettings, summarizeListings, summarizeSales, aggregateSalesHistory, salesForPeriod, alertTransition, sparkline };
});
