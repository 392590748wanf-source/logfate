(function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const kinds = new Set(['part-craft', 'suite-craft', 'part-sale', 'suite-sale']);
  const isCraft = operation => operation.kind.endsWith('-craft');
  const fail = message => { throw new Error(message); };
  const quantity = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
  const money = value => value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
  const near = (left, right) => Math.abs(left - right) <= Math.max(0.00001, Math.abs(right) * 1e-10);
  const dateValid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

  // Operations are stored newest first. Dates are editable labels, never ordering keys.
  // Legacy migration entries describe opening inventory and must precede real operations.
  const chronological = operations => [...operations].reverse().sort((a, b) => Number(Boolean(b.legacyMigration)) - Number(Boolean(a.legacyMigration)));

  function change(snapshot, patch, undoMode = false) {
    const before = clone(snapshot), next = clone(snapshot);
    const original = before.operations.find(operation => operation.id === patch.operationId);
    if (!original || before.operations.filter(operation => operation.id === patch.operationId).length !== 1) fail('未找到唯一的历史操作记录。');
    if (!kinds.has(original.kind) || original.legacyMigration) fail('该历史记录无法可靠恢复，只能查看。');
    if (!Array.isArray(original.deltas) || !original.deltas.length) fail('该记录缺少历史部件信息，只能查看。');
    const affected = new Set(original.deltas.map(delta => String(delta.partId)));
    let changed;
    do {
      changed = false;
      for (const operation of before.operations) {
        if (operation.deltas?.some(delta => affected.has(String(delta.partId)))) {
          for (const delta of operation.deltas) {
            if (!affected.has(String(delta.partId))) { affected.add(String(delta.partId)); changed = true; }
          }
        }
      }
    } while (changed);
    const related = before.operations.filter(operation => operation.deltas?.some(delta => affected.has(String(delta.partId))));
    const suiteIds = new Set(related.filter(operation => String(operation.kind).startsWith('suite-')).map(operation => String(operation.targetId)));
    const parts = new Map(before.parts.map(part => [String(part.id), part]));
    const salesFor = (ledger, operation) => operation.kind === 'suite-sale' ? ledger.suiteSales : ledger.partSales;
    const saleFor = (ledger, operation) => {
      const matches = salesFor(ledger, operation).filter(sale => sale.id === operation.saleId);
      if (matches.length !== 1) fail('历史销售记录关联不完整，不能保存。');
      return matches[0];
    };
    const net = new Map([...affected].map(id => [id, { q: 0, v: 0, made: 0, sold: 0 }]));
    for (const operation of related) {
      if (!kinds.has(operation.kind) || !quantity(operation.quantity)) fail('历史操作数量或类型无效，不能保存。');
      const unique = new Set();
      for (const delta of operation.deltas) {
        const id = String(delta.partId);
        if (!parts.has(id) || unique.has(id) || !quantity(delta.qty) || Number(delta.qty) !== Number(operation.quantity) || !money(delta.cost)) fail('历史部件、数量或成本信息不完整，不能保存。');
        unique.add(id);
        const total = net.get(id), sign = isCraft(operation) ? 1 : -1;
        total.q += sign * Number(delta.qty); total.v += sign * Number(delta.cost);
        total[isCraft(operation) ? 'made' : 'sold'] += Number(delta.qty);
      }
      if (!isCraft(operation)) {
        const sale = saleFor(before, operation);
        const target = operation.kind === 'suite-sale' ? sale.suiteId : sale.partId;
        if (String(target) !== String(operation.targetId) || Number(sale.q) !== Number(operation.quantity) || !money(sale.amount)
          || !money(sale.cost) || !near(Number(sale.cost), operation.deltas.reduce((sum, delta) => sum + Number(delta.cost), 0))) fail('历史销售与库存操作不一致，不能保存。');
        if (related.filter(row => !isCraft(row) && row.kind === operation.kind && row.saleId === operation.saleId).length !== 1) fail('历史销售关联重复，不能保存。');
      }
    }
    for (const sale of before.partSales) {
      if (affected.has(String(sale.partId)) && !related.some(operation => operation.kind === 'part-sale' && operation.saleId === sale.id)) fail('相关单件销售缺少库存操作，只能查看历史记录。');
    }
    for (const sale of before.suiteSales) {
      if ((suiteIds.has(String(sale.suiteId)) || sale.recipeCosts?.some(delta => affected.has(String(delta.partId))))
        && !related.some(operation => operation.kind === 'suite-sale' && operation.saleId === sale.id)) fail('相关整套销售缺少库存操作，只能查看历史记录。');
    }
    const opening = {};
    for (const id of affected) {
      const current = before.stocks[id] || { q: 0, v: 0, made: 0, sold: 0 }, total = net.get(id);
      if (!Number.isSafeInteger(Number(current.q)) || Number(current.q) < 0 || !money(current.v)
        || !Number.isSafeInteger(Number(current.made || 0)) || Number(current.made || 0) < 0
        || !Number.isSafeInteger(Number(current.sold || 0)) || Number(current.sold || 0) < 0) fail('当前库存数据无效，不能保存。');
      let q = Number(current.q) - total.q, v = Number(current.v) - total.v;
      if (near(v, 0)) v = 0;
      if (q < 0 || v < 0 || (q === 0 && v !== 0)) fail(parts.get(id).n + '的历史库存基线不一致，不能保存。');
      opening[id] = { ...current, q, v, made: Math.max(0, Number(current.made || 0) - total.made), sold: Math.max(0, Number(current.sold || 0) - total.sold) };
    }
    // Validate the recovered baseline against original quantities and weighted costs.
    const originalStock = clone(opening);
    for (const operation of chronological(related)) {
      for (const delta of operation.deltas) {
        const stock = originalStock[String(delta.partId)];
        if (!isCraft(operation) && stock.q < Number(delta.qty)) fail('原始入库与销售顺序无法恢复，只能查看历史记录。');
        if (isCraft(operation)) { stock.q += Number(delta.qty); stock.v += Number(delta.cost); }
        else {
          const expected = stock.v / stock.q * Number(delta.qty);
          if (!near(expected, Number(delta.cost))) fail(parts.get(String(delta.partId)).n + '的历史销售成本与库存基线不一致，只能查看。');
          stock.q -= Number(delta.qty); stock.v -= expected;
          if (!stock.q) stock.v = 0;
        }
      }
    }
    let operation = next.operations.find(row => row.id === patch.operationId);
    if (patch.deleteRecord || patch.deleteSale || undoMode) {
      if (isCraft(operation) && !patch.deleteRecord && !undoMode) fail('该操作只支持删除销售记录。');
      if (!isCraft(operation)) {
        const sale = saleFor(next, operation), list = salesFor(next, operation);
        list.splice(list.indexOf(sale), 1);
      }
      next.operations.splice(next.operations.indexOf(operation), 1);
    } else {
      if (patch.date !== undefined) {
        if (!dateValid(patch.date)) fail('请填写有效日期。');
        operation.date = patch.date;
      }
      if (patch.quantity !== undefined) {
        if (!quantity(patch.quantity)) fail('数量必须是大于 0 的整数。');
        operation.quantity = Number(patch.quantity);
      }
      if (isCraft(operation)) {
        operation.deltas.forEach(delta => {
          const unit = patch.unitCosts ? patch.unitCosts[String(delta.partId)] : Number(delta.cost) / Number(delta.qty);
          if (!money(unit)) fail('请填写各部件有效的非负入库成本。');
          delta.qty = operation.quantity; delta.cost = Number(unit) * operation.quantity;
          if (!Number.isFinite(delta.cost)) fail('入库成本过大。');
        });
      } else {
        const sale = saleFor(next, operation);
        if (patch.unitPrice !== undefined) {
          const price = Math.ceil(Number(patch.unitPrice));
          if (!Number.isSafeInteger(price) || price <= 0) fail('请填写大于 0 的实际成交价。');
          sale.amount = price * operation.quantity;
          if (!Number.isSafeInteger(sale.amount)) fail('销售金额过大，不能可靠保存。');
        } else sale.amount = Number(sale.amount) / Number(sale.q) * operation.quantity;
        sale.date = patch.date ?? sale.date; sale.q = operation.quantity;
        operation.deltas.forEach(delta => { delta.qty = operation.quantity; });
      }
    }
    Object.assign(next.stocks, clone(opening));
    for (const row of chronological(next.operations.filter(row => row.deltas?.some(delta => affected.has(String(delta.partId)))))) {
      for (const delta of row.deltas) {
        const id = String(delta.partId), stock = next.stocks[id], qty = Number(delta.qty);
        if (isCraft(row)) { stock.q += qty; stock.v += Number(delta.cost); stock.made += qty; }
        else {
          if (stock.q < qty) fail(`${parts.get(id).n}在 ${row.date || '该次销售'} 库存不足：可用 ${stock.q} 件，需要 ${qty} 件。`);
          delta.cost = stock.v / stock.q * qty;
          stock.q -= qty; stock.v -= delta.cost; stock.sold += qty;
          if (!stock.q) stock.v = 0;
        }
        if (!Number.isFinite(stock.v) || stock.v < 0) fail('重算后的库存成本无效，不能保存。');
      }
      if (!isCraft(row)) {
        const sale = saleFor(next, row);
        sale.cost = row.deltas.reduce((sum, delta) => sum + delta.cost, 0);
        sale.profit = Number(sale.amount) - sale.cost;
        if (!Number.isFinite(sale.profit)) fail('销售金额无效，不能保存。');
        if (row.kind === 'suite-sale') sale.recipeCosts = clone(row.deltas);
      }
    }
    return next;
  }
  const api = {
    edit: (snapshot, patch) => change(snapshot, patch),
    undo: (snapshot, operationId) => change(snapshot, { operationId }, true)
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FF14_SUBMARINE_LEDGER = api;
})(typeof window === 'object' ? window : globalThis);
