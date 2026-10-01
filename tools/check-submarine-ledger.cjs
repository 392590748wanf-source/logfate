const assert = require('node:assert/strict');
const { edit, undo } = require('../submarine-ledger.js');
const copy = value => JSON.parse(JSON.stringify(value));
const approx = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.00001, `${actual} != ${expected}`);
const parts = [{ id: 1, n: '船体' }, { id: 2, n: '船尾' }, { id: 3, n: '船首' }];
const delta = (partId, qty, cost) => ({ partId, qty, cost });
const craft = (id, targetId, qty, deltas, kind = 'suite-craft') => ({ id, targetId, quantity: qty, deltas, kind, date: '2026-09-01' });
const sale = (id, targetId, qty, deltas, saleId, kind = 'suite-sale') => ({ id, targetId, quantity: qty, deltas, saleId, kind, date: '2026-09-02' });
const fixture = () => ({
  parts,
  stocks: { 1: { q: 6, v: 1080, made: 15, sold: 9 }, 2: { q: 5, v: 1000, made: 10, sold: 5 }, 3: { q: 2, v: 100, made: 5, sold: 3 } },
  operations: [
    sale('single-op', 1, 1, [delta(1, 1, 180)], 'single', 'part-sale'),
    sale('b-sale-op', 'b', 3, [delta(1, 3, 540), delta(3, 3, 150)], 'b-sale'),
    craft('b-craft', 'b', 5, [delta(1, 5, 1300), delta(3, 5, 250)]),
    sale('a-sale-op', 'a', 5, [delta(1, 5, 500), delta(2, 5, 1000)], 'a-sale'),
    craft('a-craft-new', 'a', 5, [delta(1, 5, 500), delta(2, 5, 1000)]),
    craft('a-craft', 'a', 5, [delta(1, 5, 500), delta(2, 5, 1000)])
  ],
  suiteSales: [
    { id: 'b-sale', suiteId: 'b', date: '2026-09-02', q: 3, amount: 3000, cost: 690, profit: 2310, recipeCosts: [delta(1, 3, 540), delta(3, 3, 150)] },
    { id: 'a-sale', suiteId: 'a', date: '2026-09-02', q: 5, amount: 5000, cost: 1500, profit: 3500, recipeCosts: [delta(1, 5, 500), delta(2, 5, 1000)] }
  ],
  partSales: [{ id: 'single', partId: 1, date: '2026-09-03', q: 1, amount: 500, cost: 180, profit: 320 }]
});
// Snapshot replay agrees with current stock; opening inventory is recovered, not discarded.
const original = fixture(), before = JSON.stringify(original);
const replayed = edit(original, { operationId: 'a-craft' });
for (const id of [1, 2, 3]) { assert.equal(replayed.stocks[id].q, original.stocks[id].q); approx(replayed.stocks[id].v, original.stocks[id].v); }
assert.equal(JSON.stringify(original), before);

// A past cost edit reprices later sales in both shared suites and single-part sales.
const repriced = edit(original, { operationId: 'a-craft', quantity: 5, unitCosts: { 1: 200, 2: 300 }, date: '2026-10-01' });
approx(repriced.suiteSales.find(row => row.id === 'a-sale').cost, 2000);
approx(repriced.suiteSales.find(row => row.id === 'b-sale').cost, 765);
approx(repriced.partSales[0].cost, 205);
approx(repriced.stocks[1].v, 1230);
assert.equal(repriced.operations.at(-1).date, '2026-10-01');
assert.deepEqual(repriced.operations.map(row => row.id), original.operations.map(row => row.id));

// Sale count, date and rounded unit price update costs and operations together.
const revised = edit(original, { operationId: 'a-sale-op', quantity: 4, unitPrice: 1234.1, date: '2026-10-03' });
const updatedSale = revised.suiteSales.find(row => row.id === 'a-sale');
assert.equal(updatedSale.amount, 4940); assert.equal(updatedSale.q, 4); assert.equal(updatedSale.date, '2026-10-03');
approx(updatedSale.cost, 1200); assert.equal(revised.stocks[1].q, 7); assert.equal(revised.stocks[2].q, 6);
assert.equal(revised.operations.find(row => row.id === 'a-sale-op').quantity, 4);
assert.equal(revised.operations.find(row => row.id === 'a-sale-op').date, '2026-10-03');
approx(revised.partSales[0].cost, (600 + 1300) / 11);

// Deletion restores stock, removes only the corresponding sale/operation and reprices later sales.
const deleted = edit(original, { operationId: 'a-sale-op', deleteSale: true });
assert.equal(deleted.suiteSales.length, 1); assert.equal(deleted.operations.length, original.operations.length - 1);
assert.equal(deleted.stocks[1].q, 11); assert.equal(deleted.stocks[2].q, 10);
approx(deleted.stocks[2].v, 2000);
assert.equal(deleted.stocks[1].sold, 4);

// Reduce an入库 batch safely, preserve original part identities, and reject insufficient historical stock.
const smaller = edit(original, { operationId: 'a-craft-new', quantity: 4, unitCosts: { 1: 100, 2: 200 } });
assert.equal(smaller.stocks[1].q, 5); assert.equal(smaller.stocks[2].q, 4);
assert.deepEqual(smaller.operations.find(row => row.id === 'a-craft-new').deltas.map(row => row.partId), [1, 2]);
assert.throws(() => edit(original, { operationId: 'a-sale-op', quantity: 999 }), /库存不足/);
assert.throws(() => edit(original, { operationId: 'a-craft', quantity: 0 }), /整数/);
assert.throws(() => edit(original, { operationId: 'a-sale-op', quantity: 1.5 }), /整数/);
assert.throws(() => edit(original, { operationId: 'a-sale-op', unitPrice: NaN }), /成交价/);
assert.throws(() => edit(original, { operationId: 'a-sale-op', date: '2026-02-30' }), /日期/);
assert.throws(() => edit(original, { operationId: 'a-craft', unitCosts: { 1: -1, 2: 1 } }), /成本/);
assert.throws(() => edit(original, { operationId: 'a-craft', deleteSale: true }), /只支持删除销售/);
// Delete inbound batches without rewriting historical combinations or operation order.
const inboundDeleted = edit(original, { operationId: 'a-craft', deleteRecord: true });
assert.equal(inboundDeleted.operations.length, original.operations.length - 1);
assert.ok(!inboundDeleted.operations.some(row => row.id === 'a-craft'));
assert.equal(inboundDeleted.stocks[1].q, 1); approx(inboundDeleted.stocks[1].v, 260);
assert.equal(inboundDeleted.stocks[1].made, 10);
assert.equal(inboundDeleted.stocks[2].q, 0); assert.equal(inboundDeleted.stocks[2].v, 0);
approx(inboundDeleted.suiteSales.find(row => row.id === 'b-sale').cost, 930);
approx(inboundDeleted.partSales[0].cost, 260);
assert.deepEqual(inboundDeleted.operations.map(row => row.id), original.operations.filter(row => row.id !== 'a-craft').map(row => row.id));
assert.deepEqual(edit(original, { operationId: 'a-sale-op', deleteRecord: true }), deleted);
assert.throws(() => edit(original, { operationId: 'b-craft', deleteRecord: true }), /船首.*库存不足/);
const inboundSaved = JSON.stringify(inboundDeleted);
assert.throws(() => edit(inboundDeleted, { operationId: 'a-craft-new', deleteRecord: true }), /库存不足/);
assert.equal(JSON.stringify(inboundDeleted), inboundSaved);
assert.equal(JSON.stringify(original), before);

// Invalid or unlinked legacy records stay readable, but cannot mutate the ledger.
const broken = fixture(); broken.operations.find(row => row.id === 'a-sale-op').saleId = 'missing';
assert.throws(() => edit(broken, { operationId: 'a-craft' }), /关联/);
assert.throws(() => edit(broken, { operationId: 'a-craft', deleteRecord: true }), /关联/);
const orphan = fixture(); orphan.operations = orphan.operations.filter(row => row.id !== 'single-op');
assert.throws(() => edit(orphan, { operationId: 'a-craft' }), /缺少库存操作/);
const baseline = fixture(); baseline.stocks[1].q = 0;
assert.throws(() => edit(baseline, { operationId: 'a-craft' }), /基线/);
const inconsistentCost = fixture(); inconsistentCost.stocks[1].v += 100;
assert.throws(() => edit(inconsistentCost, { operationId: 'a-craft' }), /基线/);

// A migrated opening balance stored at the front of the array still precedes original sales.
const legacy = {
  parts, stocks: { 1: { q: 2, v: 200, made: 5, sold: 3 } }, partSales: [],
  operations: [
    { ...craft('legacy', 1, 5, [delta(1, 5, 500)], 'part-craft'), legacyMigration: true },
    sale('legacy-sale-op', 'legacy-suite', 3, [delta(1, 3, 300)], 'legacy-sale')
  ],
  suiteSales: [{ id: 'legacy-sale', suiteId: 'legacy-suite', q: 3, amount: 600, cost: 300, profit: 300, date: '2026-09-02', recipeCosts: [delta(1, 3, 300)] }]
};
const restored = edit(legacy, { operationId: 'legacy-sale-op', deleteSale: true });
assert.equal(restored.stocks[1].q, 5); assert.equal(restored.stocks[1].v, 500);
const openingFixture = copy(legacy);
openingFixture.operations = [openingFixture.operations[1], { ...openingFixture.operations[0], legacyMigration: false }];
openingFixture.stocks[1] = { q: 4, v: 400, made: 5, sold: 3 };
const openingRestored = edit(openingFixture, { operationId: 'legacy-sale-op', deleteSale: true });
assert.equal(openingRestored.stocks[1].q, 7); assert.equal(openingRestored.stocks[1].v, 700);
assert.deepEqual(edit(copy(repriced), { operationId: 'a-craft' }).stocks, repriced.stocks);

// Existing undo shares replay rules, including mixed-cost stock and single sales.
assert.deepEqual(undo(original, 'a-sale-op'), deleted);
const singleUndone = undo(repriced, 'single-op');
assert.equal(singleUndone.stocks[1].q, 7);
approx(singleUndone.stocks[1].v, 1435);
assert.equal(singleUndone.partSales.length, 0);
assert.throws(() => undo(original, 'b-craft'), /库存不足/);
const latestCraft = copy(original);
latestCraft.operations.unshift(craft('last-part-craft', 1, 2, [delta(1, 2, 800)], 'part-craft'));
latestCraft.stocks[1].q += 2; latestCraft.stocks[1].v += 800; latestCraft.stocks[1].made += 2;
assert.deepEqual(undo(latestCraft, 'last-part-craft').stocks, original.stocks);
// Single-part edit/delete uses the same shared ledger engine as suites.
const editedSingle = edit(original, { operationId: 'single-op', quantity: 2, unitPrice: 500.2, date: '2026-10-04' });
assert.equal(editedSingle.partSales[0].q, 2); assert.equal(editedSingle.partSales[0].amount, 1002);
assert.equal(editedSingle.partSales[0].date, '2026-10-04');
approx(editedSingle.partSales[0].cost, 360); approx(editedSingle.partSales[0].profit, 642);
assert.equal(editedSingle.stocks[1].q, 5);
assert.deepEqual(edit(original, { operationId: 'single-op', deleteRecord: true }), undo(original, 'single-op'));
assert.throws(() => edit(original, { operationId: 'single-op', quantity: 99 }), /库存不足/);
const singleInbound = edit(latestCraft, { operationId: 'last-part-craft', quantity: 3, unitCosts: { 1: 150 } });
assert.equal(singleInbound.stocks[1].q, 9); approx(singleInbound.stocks[1].v, 1530);
assert.deepEqual(edit(latestCraft, { operationId: 'last-part-craft', deleteRecord: true }).stocks, original.stocks);
const sharedAfterSingle = copy(latestCraft);
sharedAfterSingle.operations.unshift(sale('after-single-craft', 'b', 2, [delta(1, 2, 470), delta(3, 2, 100)], 'after-single-sale'));
sharedAfterSingle.suiteSales.unshift({ id: 'after-single-sale', suiteId: 'b', date: '2026-10-01', q: 2, amount: 2000, cost: 570, profit: 1430, recipeCosts: [delta(1, 2, 470), delta(3, 2, 100)] });
sharedAfterSingle.stocks[1] = { q: 6, v: 1410, made: 17, sold: 11 };
sharedAfterSingle.stocks[3] = { q: 0, v: 0, made: 5, sold: 5 };
const linked = edit(sharedAfterSingle, { operationId: 'last-part-craft', quantity: 3, unitCosts: { 1: 150 } });
approx(linked.suiteSales[0].cost, 440); approx(linked.suiteSales[0].profit, 1560);
assert.equal(linked.stocks[1].q, 7); approx(linked.stocks[1].v, 1190);
assert.equal(JSON.stringify(original), before);

// Exercise persistence and configuration deletion handlers with isolated localStorage.
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../fantasy.js'), 'utf8');
const fn = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const storage = new Map(), stockRef = {}, opsRef = [], suiteRef = [], partRef = [];
const elements = new Map();
const element = selector => {
  if (!elements.has(selector)) elements.set(selector, { open: false, textContent: '', close() { this.open = false; } });
  return elements.get(selector);
};
const context = vm.createContext({
  localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
  document: { querySelector: element }, submarineStocks: stockRef, submarineOperations: opsRef,
  submarineData: { parts }, submarineEditorStatus: () => element('#submarine-suite-editor-status'),
  submarineSuiteSales: suiteRef, submarineSales: partRef, submarineSuites: [{ id: 'a' }, { id: 'b' }],
  state: { editingSubmarineSuite: 'a' }, confirm: () => true,
  renderHome() {}, renderSubmarine() {}, renderSubmarineSuiteRecords() {}, openSubmarineSuiteDetail() {}
});
vm.runInContext(fn('  function commitSubmarineLedger(next) {', '  function showSubmarineRecordError('), context);
context.next = repriced;
vm.runInContext('commitSubmarineLedger(next)', context);
assert.deepEqual(stockRef, repriced.stocks);
for (const [key, expected] of Object.entries({ 'ff14-submarine-stocks': repriced.stocks, 'ff14-submarine-operations': repriced.operations, 'ff14-submarine-suite-sales': repriced.suiteSales, 'ff14-submarine-sales': repriced.partSales })) {
  assert.deepEqual(JSON.parse(storage.get(key)), expected);
  assert.ok(source.slice(source.indexOf('const backupStorageKeys ='), source.indexOf('const backupFormat =')).includes(key));
}
const saved = JSON.stringify(Object.fromEntries(storage)), refs = JSON.stringify([stockRef, opsRef, suiteRef, partRef]);
const setter = context.localStorage.setItem; let writes = 0;
context.localStorage.setItem = (key, value) => { if (++writes === 2) throw new Error('quota'); setter(key, value); };
context.next = revised;
assert.throws(() => vm.runInContext('commitSubmarineLedger(next)', context), /保存失败/);
assert.equal(JSON.stringify(Object.fromEntries(storage)), saved);
assert.equal(JSON.stringify([stockRef, opsRef, suiteRef, partRef]), refs);
context.localStorage.setItem = setter;
vm.runInContext(fn("  document.querySelector('#submarine-suite-delete').onclick =", "  document.querySelector('#submarine-suite-form').onsubmit ="), context);
element('#submarine-suite-delete').onclick();
assert.equal(context.submarineSuites.length, 1); assert.equal(context.submarineSuites[0].id, 'b');
assert.equal(JSON.stringify([stockRef, opsRef, suiteRef, partRef]), refs);
assert.deepEqual(JSON.parse(storage.get('ff14-submarine-suites')), [{ id: 'b' }]);

// Both record deletion entry points use the same confirmed, transactional handler.
context.window = { FF14_SUBMARINE_LEDGER: { edit } };
context.submarineLedgerSnapshot = () => ({ stocks: stockRef, operations: opsRef, suiteSales: suiteRef, partSales: partRef, parts });
vm.runInContext(fn('  function showSubmarineRecordError(', '  function openSubmarineRecordEditor('), context);
context.next = original; vm.runInContext('commitSubmarineLedger(next)', context);
const cancelSaved = JSON.stringify(Object.fromEntries(storage));
context.confirm = () => false;
vm.runInContext("deleteSubmarineRecord('a-craft')", context);
assert.equal(JSON.stringify(Object.fromEntries(storage)), cancelSaved);
let confirmation = '';
context.confirm = message => { confirmation = message; return true; };
element('#submarine-record-dialog').open = true;
vm.runInContext("deleteSubmarineRecord('a-craft')", context);
assert.match(confirmation, /入库记录.*扣除/);
assert.deepEqual(stockRef, inboundDeleted.stocks);
assert.equal(element('#submarine-record-dialog').open, false);
context.next = original; vm.runInContext('commitSubmarineLedger(next)', context);
const rejectSaved = JSON.stringify(Object.fromEntries(storage));
element('#submarine-record-dialog').open = true;
vm.runInContext("deleteSubmarineRecord('b-craft')", context);
assert.match(element('#submarine-record-error').textContent, /船首.*库存不足/);
assert.equal(element('#submarine-record-dialog').open, true);
assert.deepEqual(stockRef, original.stocks);
assert.equal(JSON.stringify(Object.fromEntries(storage)), rejectSaved);
element('#submarine-record-dialog').open = false;
vm.runInContext("deleteSubmarineRecord('b-craft')", context);
assert.match(element('#submarine-suite-editor-status').textContent, /库存不足/);

// Verify editable inbound and sales rows both render deletion controls.
context.document.querySelectorAll = () => [];
context.suiteHistory = suite => suiteRef.filter(row => row.suiteId === suite.id);
context.submarineRecordIssue = () => '';
context.submarineRecordParts = () => '历史部件组合';
context.suiteEditorEscape = value => String(value ?? '');
context.money = value => String(value);
vm.runInContext(fn('  function renderSubmarineSuiteRecords(', '  function commitSubmarineLedger(next) {'), context);
vm.runInContext("renderSubmarineSuiteRecords({id:'a'})", context);
assert.match(element('#submarine-suite-crafts-editor').innerHTML, /data-suite-record-delete="a-craft"/);
assert.match(element('#submarine-suite-sales-editor').innerHTML, /data-suite-record-delete="a-sale-op"/);
context.submarineRecordIssue = () => '历史关联不完整';
vm.runInContext("renderSubmarineSuiteRecords({id:'a'})", context);
assert.ok(!element('#submarine-suite-crafts-editor').innerHTML.includes('data-suite-record-delete'));

// Single editor filters out suite sales/inbound and uses per-piece labels.
context.submarineRecordIssue = () => '';
context.next = latestCraft; vm.runInContext('commitSubmarineLedger(next)', context);
vm.runInContext('renderSubmarineSuiteRecords({id:1}, true)', context);
const singleSalesMarkup = element('#submarine-part-sales-editor').innerHTML;
assert.match(singleSalesMarkup, /单件销售记录/); assert.match(singleSalesMarkup, /单件成交价/);
assert.match(singleSalesMarkup, /data-suite-record-edit="single-op"/);
assert.ok(!singleSalesMarkup.includes('a-sale-op'));
const singleCraftMarkup = element('#submarine-part-crafts-editor').innerHTML;
assert.match(singleCraftMarkup, /入库件数/);
assert.match(singleCraftMarkup, /data-suite-record-delete="last-part-craft"/);
assert.ok(!singleCraftMarkup.includes('a-craft'));
assert.ok(source.includes('data-submarine-part-edit="${part.id}"'));
assert.ok(source.includes('<th>利润率</th><th>操作</th></tr></thead><tbody>${groups.map'));

// Suggested unit price is saved before in-memory mutation, and storage errors leave it intact.
context.prices = {};
context.state.editingSubmarinePart = 1;
element('#submarine-part-price').value = '456.2';
vm.runInContext(fn("  document.querySelector('#submarine-part-form').onsubmit =", "  document.querySelector('#submarine-suite-form').onsubmit ="), context);
element('#submarine-part-form').onsubmit({ preventDefault() {} });
assert.equal(context.prices['submarine-price-1'], 457);
assert.equal(JSON.parse(storage.get('ff14-fantasy-prices'))['submarine-price-1'], 457);
assert.match(element('#submarine-part-editor-status').textContent, /已保存/);
context.localStorage.setItem = () => { throw new Error('保存失败'); };
element('#submarine-part-price').value = '999';
element('#submarine-part-form').onsubmit({ preventDefault() {} });
assert.equal(context.prices['submarine-price-1'], 457);
context.localStorage.setItem = setter;
console.log('Submarine ledger regression checks passed.');
