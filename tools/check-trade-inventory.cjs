const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'fantasy.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'app.css'), 'utf8');
const between = (start, end) => {
  const left = source.indexOf(start), right = source.indexOf(end, left);
  assert.ok(left >= 0 && right > left, `missing section: ${start}`);
  return source.slice(left, right);
};
const materials = [
  { uid: '1', n: '云杉原木', groupSize: 999 },
  { uid: '2', n: '火之碎晶', groupSize: 9999 }
];
const legacy = [
  { id: 'old-wood', itemId: '1', name: '云杉原木', groups: 2, groupSize: 999, unitPrice: 100, total: 200000, category: 'botanist' },
  { id: 'old-crystal', itemId: '2', name: '火之碎晶', groups: 1, groupSize: 9999, unitPrice: 7, total: 70000, category: 'crystal' }
];
const storage = new Map([['ff14-trade-inventory', JSON.stringify(legacy)]]);
const context = vm.createContext({
  localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  tradeInventory: legacy, tradeInventoryStorageKey: 'ff14-trade-inventory', data: { m: materials }, Date, Math
});
vm.runInContext(between('  const tradeWarehouseStorageKey =', '  const tradeSourceCacheStorageKey ='), context);
assert.deepEqual(legacy.map(row => row.quantity), [1998, 9999], '旧组数换成准确的实际数量');
assert.ok(legacy.every(row => row.priceMode === 'group'), '旧库存沿用按组计价');
assert.deepEqual(legacy.map(row => row.total), [200000, 70000], '迁移不改账面合价');
assert.equal(JSON.parse(storage.get('ff14-trade-inventory'))[0].quantity, 1998, '迁移持久化，可供备份');

context.tradeMaterial = id => materials.find(row => row.uid === String(id));
context.isTradeCrystal = row => row?.n?.includes('碎晶') || Number(row?.groupSize) === 9999;
context.money = value => `${value} G`;
vm.runInContext(between('  const tradeGroupSize =', '  let activeTradePopover =') + '\nthis.tradeMath = { tradeGroupSize, tradeQuantity, tradeQuantityLabel, tradeBillableQuantity, tradeTotal, tradeTotalLabel };', context);
const math = context.tradeMath;
assert.equal(math.tradeTotal(legacy[0]), 200000, '普通材料历史合价保持不变');
assert.equal(math.tradeTotal(legacy[1]), 70000, '水晶历史合价保持不变');
assert.equal(math.tradeQuantityLabel({ itemId: '1', quantity: 500 }), '500 个');
assert.equal(math.tradeQuantityLabel({ itemId: '1', quantity: 999 }), '1 组');
assert.equal(math.tradeQuantityLabel({ itemId: '1', quantity: 1200 }), '1 组 201 个');
assert.equal(math.tradeQuantityLabel({ itemId: '2', quantity: 10000 }), '1 组 1 个');
assert.equal(math.tradeTotal({ itemId: '1', quantity: 1200, priceMode: 'group', unitPrice: 100 }), 120100);
assert.equal(math.tradeTotal({ itemId: '1', quantity: 1200, priceMode: 'item', unitPrice: 100 }), 120000);
assert.equal(math.tradeTotal({ itemId: '2', quantity: 10000, priceMode: 'group', unitPrice: 7 }), 70007);
assert.equal(math.tradeTotal({ itemId: '2', quantity: 10000, priceMode: 'item', unitPrice: 7 }), 70000);
assert.equal(math.tradeTotal({ itemId: '1', quantity: 500, priceMode: 'group', unitPrice: null }), null);
assert.equal(math.tradeTotalLabel({ itemId: '1', quantity: 500, unitPrice: null }), '—');

const elements = new Map();
const element = selector => {
  if (!elements.has(selector)) elements.set(selector, { value: '', hidden: true, textContent: '', focus() { this.focused = true; }, close() { this.open = false; } });
  return elements.get(selector);
};
let saves = 0, renders = 0;
context.document = { querySelector: element };
context.state = { tradeEditingId: null };
context.tradeCategoryIds = () => ['botanist', 'crystal', 'other'];
context.tradeLocations = () => [{ id: 'bag', name: '背包' }];
context.tradeWarehouseSettings = { warehouses: [{ id: 'warehouse-1', name: '角色一' }], activeWarehouseId: 'overview', activeLocationId: 'all' };
context.tradeGroupSize = math.tradeGroupSize;
context.tradePriceMultiplier = row => Number(row?.groupSize) === 9999 ? 10000 : 1000;
context.save = () => { saves++; };
context.renderTrade = () => { renders++; };
context.refreshMarket = async () => {};
vm.runInContext(between("  document.querySelector('#trade-listing-form').onsubmit =", "  const normalizeSubmarineSalePrice ="), context);
const fill = ({ itemId = '1', quantity = '500', price = '', mode = 'group', category = 'botanist' } = {}) => {
  element('#trade-listing-item-id').value = itemId;
  element('#trade-listing-quantity').value = quantity;
  element('#trade-listing-unit-price').value = price;
  element('#trade-listing-price-mode').value = mode;
  element('#trade-listing-category').value = category;
  element('#trade-listing-warehouse').value = 'warehouse-1';
  element('#trade-listing-location').value = 'bag';
  element('#trade-listing-note').value = '第一行\n第二行';
};

(async () => {
  fill();
  await element('#trade-listing-form').onsubmit({ preventDefault() {} });
  const created = legacy[0];
  assert.equal(created.quantity, 500);
  assert.equal(created.groups, 0, '不足一组仍保留零散库存');
  assert.equal(created.priceMode, 'group', '新增默认按组计价');
  assert.equal(created.unitPrice, null, '不填单价可保存');
  assert.equal(created.total, null, '无价格不伪装成 0 G');
  assert.equal(created.note, '第一行\n第二行', '备注保留在详情数据');
  assert.deepEqual(JSON.parse(JSON.stringify(created)).quantity, 500, 'JSON 往返保留零散数量');
  assert.equal(JSON.parse(JSON.stringify(created)).priceMode, 'group', 'JSON 往返保留计价方式');
  assert.equal(saves, 1);

  context.state.tradeEditingId = created.id;
  fill({ quantity: '1200', price: '100', mode: 'item' });
  await element('#trade-listing-form').onsubmit({ preventDefault() {} });
  assert.equal(legacy[0].quantity, 1200);
  assert.equal(legacy[0].priceMode, 'item');
  assert.equal(legacy[0].total, 120000);
  context.state.tradeEditingId = created.id;
  fill({ quantity: '1200', price: '100', mode: 'group' });
  await element('#trade-listing-form').onsubmit({ preventDefault() {} });
  assert.equal(legacy[0].total, 120100);
  context.state.tradeEditingId = created.id;
  fill({ quantity: '1.5', price: '100' });
  await element('#trade-listing-form').onsubmit({ preventDefault() {} });
  assert.match(element('#trade-listing-error').textContent, /整数/);
  assert.equal(legacy[0].quantity, 1200, '非法数量不会覆盖记录');

  element('#trade-quantity-id').value = created.id;
  element('#trade-quantity-value').value = '999';
  element('#trade-quantity-form').onsubmit({ preventDefault() {} });
  assert.equal(legacy[0].quantity, 999);
  assert.equal(legacy[0].total, 100000, '右键数量编辑沿用单条计价方式');
  element('#trade-unit-price-id').value = created.id;
  element('#trade-unit-price-value').value = '';
  element('#trade-unit-price-form').onsubmit({ preventDefault() {} });
  assert.equal(legacy[0].unitPrice, null, '右键价格编辑可清空');
  assert.equal(legacy[0].total, null);
  assert.equal(saves, 5);
  assert.equal(renders, 5);

  const toggle = { addEventListener(_name, handler) { this.click = handler; } };
  const tradeRoot = { innerHTML: '', querySelector: selector => selector === '#trade-toggle-prices' ? toggle : null, querySelectorAll: () => [] };
  context.document = { querySelector: selector => selector === '#trade' ? tradeRoot : element(selector) };
  context.state = { tradeView: 'inventory', tradeHidePrices: true, tradeGlobalSearch: '', tradeWarehouseSearch: '', marketRefreshing: false };
  context.tradeInventoryHelpListeners = null;
  context.activeTradePopover = null;
  context.tradeInventoryHelpText = '库存材料说明';
  context.tradeWarehouseSettings = { warehouses: [{ id: 'warehouse-1', name: '角色一' }], retainers: {}, activeWarehouseId: 'overview', activeLocationId: 'all' };
  context.tradeWarehouseId = () => 'warehouse-1';
  context.tradeLocationId = () => 'bag';
  context.tradeLocationLabel = () => '背包';
  context.tradeCategoryLabel = id => ({ botanist: '园艺', crystal: '水晶' }[id] || id);
  context.tradeListingCategory = row => row.category;
  context.tradeSearchMatches = (row, query) => `${row.name} ${row.note || ''}`.includes(query);
  context.tradeMarketReference = () => '631 G';
  context.itemLabelMarkup = (_id, name) => name;
  context.escapeTradeHtml = value => String(value);
  context.marketRefreshWarning = () => '';
  context.marketRefreshButtonLabel = label => label;
  context.bindTradeInventoryHelp = () => {};
  context.revalidateTradeInventorySources = () => {};
  vm.runInContext(between('  function renderTrade() {', '  // 默认方案一') + '\nthis.renderInventory = renderTrade;', context);
  context.renderInventory();
  assert.match(tradeRoot.innerHTML, /<th>市场参考价<\/th>/);
  assert.doesNotMatch(tradeRoot.innerHTML, /<th>单价<\/th>|<th>合价<\/th>|<th>备注<\/th>/, '默认隐藏库存价并删除备注列');
  assert.match(tradeRoot.innerHTML, /显示价格/);
  toggle.click();
  assert.match(tradeRoot.innerHTML, /<th>单价<\/th><th>合价<\/th>/, '点击后同时显示单价和合价');
  assert.match(tradeRoot.innerHTML, /隐藏价格/);
  assert.match(tradeRoot.innerHTML, /未设置/, '空价格有明确显示状态');

  class InlineInput {
    constructor() { this.handlers = {}; this.value = ''; }
    setAttribute() {}
    addEventListener(name, handler) { this.handlers[name] = handler; }
    setCustomValidity() {}
    reportValidity() { this.reported = true; }
    focus() {}
    select() {}
    fire(name, event = {}) { this.handlers[name](event); }
  }
  class InlineTarget {
    constructor(text) { this._text = text; this.input = null; this.classList = { add() {}, remove() {} }; }
    get textContent() { return this._text; }
    set textContent(value) { this._text = value; this.input = null; }
    querySelector() { return this.input; }
    append(input) { this.input = input; }
    focus() {}
  }
  context.document = { createElement: () => new InlineInput(), querySelector: selector => selector === '#trade' ? tradeRoot : element(selector) };
  context.hideTradeContextMenu = () => {};
  vm.runInContext(between('  const editTradeCell =', '  const revalidateTradeInventorySources =') + '\nthis.editTradeCell = editTradeCell;', context);
  const inlineListing = { itemId: '1', quantity: 999, groups: 1, groupSize: 999, priceMode: 'group', unitPrice: 100 };
  const quantityTarget = new InlineTarget('1 组');
  context.editTradeCell(quantityTarget, inlineListing, 'quantity');
  quantityTarget.input.value = '1200';
  quantityTarget.input.fire('keydown', { key: 'Enter', preventDefault() {}, stopPropagation() {} });
  assert.equal(inlineListing.quantity, 1200, '双击后输入的是实际个数');
  assert.equal(inlineListing.total, 120100);
  const priceTarget = new InlineTarget('100 G');
  context.editTradeCell(priceTarget, inlineListing, 'unitPrice');
  priceTarget.input.value = '';
  priceTarget.input.fire('keydown', { key: 'Enter', preventDefault() {}, stopPropagation() {} });
  assert.equal(inlineListing.unitPrice, null, '行内单价允许清空');
  assert.equal(inlineListing.total, null);

  assert.match(source, /tradeHidePrices: true/, '每次打开默认隐藏库存价格');
  assert.match(source, /button\[data-page="trade"\]'\)\.onclick = \(\) => \{ state\.page = 'trade'; state\.tradeView = 'inventory'; state\.tradeHidePrices = true;/, '重新进入交易市场时恢复隐藏价格');
  assert.match(source, /showPrices \? '<th>单价<\/th><th>合价<\/th>' : ''/, '单价和合价同步显隐');
  assert.match(source, /<th>市场参考价<\/th>\$\{showPrices/, '市场参考价始终显示');
  assert.doesNotMatch(between('  function renderTrade() {', '  // 默认方案一'), /<th>备注<\/th>|data-trade-note-context/, '列表没有备注列或行内备注入口');
  assert.match(source, /id="trade-listing-note"/, '详情仍可编辑备注');
  assert.match(source, /listing\.note \|\| ''/, '搜索仍可匹配备注');
  assert.match(css, /\.trade-category-sections \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/, '桌面分类双栏');
  assert.match(css, /@media \(max-width: 1280px\) \{\s*\.trade-category-sections \{ grid-template-columns: 1fr; \}/, '窄屏单栏');
  assert.match(css, /\.trade-ledger-no-prices \.trade-col-material/, '隐藏价格时使用精简列宽');
  console.log('Trade inventory quantity, price and layout checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
