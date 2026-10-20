const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'fantasy.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'app.css'), 'utf8');
const between = (start, end) => {
  const left = source.indexOf(start), right = source.indexOf(end, left);
  assert.ok(left >= 0 && right > left, `missing source section: ${start}`);
  return source.slice(left, right);
};

const storage = new Map();
const inventory = [
  { id: 'old-1', itemId: '1', category: 'botanist', groups: 90, unitPrice: 100 },
  { id: 'old-2', itemId: '1', category: 'botanist', groups: 25, unitPrice: 120 }
];
const controls = new Map();
const element = id => {
  if (!controls.has(id)) controls.set(id, {
    value: '', hidden: false, open: false, textContent: '', innerHTML: '',
    showModal() { this.open = true; }, close() { this.open = false; }, focus() { this.focused = true; }
  });
  return controls.get(id);
};
let saved = 0, rendered = 0, confirmed = true;
const categoryList = {
  _innerHTML: '', buttonSets: new Map(), inputs: new Map(),
  get innerHTML() { return this._innerHTML; },
  set innerHTML(value) { this._innerHTML = value; this.buttonSets.clear(); this.inputs.clear(); },
  querySelectorAll(selector) {
    const kind = selector.includes('rename') ? 'tradeCategoryRename' : 'tradeCategoryDelete';
    if (!this.buttonSets.has(kind)) this.buttonSets.set(kind, context.tradeWarehouseSettings.customCategories.map(category => ({ dataset: { [kind]: category.id }, onclick: null })));
    return this.buttonSets.get(kind);
  },
  querySelector(selector) {
    const id = /\[data-trade-category-name="([^"]+)"\]/.exec(selector)?.[1];
    if (!this.inputs.has(id)) this.inputs.set(id, { value: context.tradeWarehouseSettings.customCategories.find(category => category.id === id)?.name || '', focus() {} });
    return this.inputs.get(id);
  }
};
controls.set('#trade-category-list', categoryList);
const context = vm.createContext({
  localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value)
  },
  tradeInventory: inventory,
  tradeInventoryStorageKey: 'ff14-trade-inventory',
  document: { querySelector: element },
  state: { tradeEditingId: null },
  tradeMaterial: () => null,
  save: () => { saved++; }, renderTrade: () => { rendered++; },
  confirm: () => confirmed,
  Date, Math
});
vm.runInContext(between('  const tradeWarehouseStorageKey =', '  const tradeSourceCacheStorageKey =') + '\nthis.tradeWarehouseSettings = tradeWarehouseSettings; this.normalizeTradeWarehouseSettings = normalizeTradeWarehouseSettings;', context);
vm.runInContext(between('  const tradeCategoryOrder =', '  const tradeDisplayName =') + '\nthis.categoryTools = { tradeCategoryIds, tradeCategoryLabel, tradeWarehouseId, tradeWarehouseNumberLabel, validTradeName };', context);
assert.deepEqual(Array.from(context.tradeWarehouseSettings.warehouses, row => row.name), ['仓库一', '仓库二', '仓库三']);
assert.equal(context.tradeWarehouseSettings.activeWarehouseId, 'warehouse-1');
assert.ok(inventory.every(row => row.warehouseId === 'warehouse-1'), '旧库存全部迁入仓库一');
assert.deepEqual(inventory.map(row => [row.groups, row.unitPrice]), [[90, 100], [25, 120]], '迁移不合并同材料记录，也不改数量或单价');
assert.equal(JSON.parse(storage.get('ff14-trade-warehouses')).warehouses.length, 3, '默认仓库持久化');
assert.equal(context.categoryTools.tradeWarehouseNumberLabel(4), '四');
assert.throws(() => context.categoryTools.validTradeName('园艺', [{ id: 'botanist', name: '园艺' }]), /已存在/);

const editor = between('  const tradeCategoryNameEntries =', '  const hideTradeContextMenu =');
vm.runInContext(editor + '\nthis.openTradeCategoryDialog = openTradeCategoryDialog;', context);
context.openTradeCategoryDialog();
assert.equal(element('#trade-category-dialog').open, true);
element('#trade-category-new-name').value = '待上架';
element('#trade-category-create-form').onsubmit({ preventDefault() {} });
const custom = context.tradeWarehouseSettings.customCategories[0];
assert.equal(custom.name, '待上架');
assert.match(custom.id, /^custom:/);
assert.ok(context.categoryTools.tradeCategoryIds().includes(custom.id));
inventory[0].category = custom.id;
inventory[0].categoryOrigin = 'manual';
categoryList.querySelector(`[data-trade-category-name="${custom.id}"]`).value = '准备出售';
categoryList.querySelectorAll('[data-trade-category-rename]')[0].onclick();
assert.equal(context.tradeWarehouseSettings.customCategories[0].name, '准备出售', '改名保留稳定分类 ID');
assert.equal(context.categoryTools.tradeCategoryLabel(custom.id), '准备出售');
confirmed = false;
categoryList.querySelectorAll('[data-trade-category-delete]')[0].onclick();
assert.equal(inventory[0].category, custom.id, '取消删除不移动材料');
confirmed = true;
categoryList.querySelectorAll('[data-trade-category-delete]')[0].onclick();
assert.equal(inventory[0].category, 'other', '删除自建分类后材料转入其他');
assert.equal(inventory[0].groups, 90);
assert.equal(inventory[0].unitPrice, 100);
assert.equal(context.tradeWarehouseSettings.customCategories.length, 0);
element('#trade-listing-dialog').open = true;
element('#trade-listing-item-id').value = '1';
context.tradeMaterial = id => ({ uid: id, n: '云杉原木' });
context.renderTradeCategorySelect = (_material, id) => { context.selectedNewCategory = id; };
context.openTradeCategoryDialog(true);
element('#trade-category-new-name').value = '分类二';
element('#trade-category-create-form').onsubmit({ preventDefault() {} });
assert.equal(context.selectedNewCategory, context.tradeWarehouseSettings.customCategories[0].id, '从材料编辑窗新建后立即选中新分类');
assert.equal(element('#trade-category-dialog').open, false);
element('#trade-listing-dialog').open = false;

const listeners = new Map();
const tradeRoot = {
  innerHTML: '', tabs: [],
  querySelector(selector) {
    if (!['#trade-toggle-total', '#trade-refresh-market', '#trade-manage-categories', '#trade-add-listing', '#trade-add-warehouse'].includes(selector)) return null;
    return { addEventListener: (_name, handler) => listeners.set(selector, handler) };
  },
  querySelectorAll(selector) {
    if (selector !== '[data-trade-warehouse]') return [];
    this.tabs = context.tradeWarehouseSettings.warehouses.map(row => ({ dataset: { tradeWarehouse: row.id }, onclick: null, ondblclick: null, onkeydown: null, replaceWith(input) { tradeRoot.renameInput = input; } }));
    return this.tabs;
  }
};
class RenameInput {
  constructor() { this.handlers = {}; }
  setAttribute() {}
  setCustomValidity() {}
  reportValidity() {}
  addEventListener(name, callback) { this.handlers[name] = callback; }
  focus() {}
  select() {}
}
context.document = { querySelector: selector => selector === '#trade' ? tradeRoot : element(selector), createElement: () => new RenameInput() };
context.state = { tradeView: 'inventory', tradeHideTotal: false, marketRefreshing: false };
context.activeTradePopover = null;
context.tradeMaterial = id => ({ uid: id, n: id === '1' ? '云杉原木' : '绿金矿' });
context.itemLabelMarkup = (_id, name) => name;
context.money = value => `${value} G`;
context.tradeTotal = listing => listing.groups * listing.unitPrice * 1000;
context.tradeMarketReference = () => '参考';
context.tradeListingCategory = listing => listing.category;
context.revalidateTradeInventorySources = () => {};
context.setTimeout = setTimeout;
context.clearTimeout = clearTimeout;
vm.runInContext(between('  let tradeWarehouseClickTimer =', '  // 默认方案一') + '\nthis.renderTrade = renderTrade; this.bindTradeInventoryHelp = bindTradeInventoryHelp;', context);
context.renderTrade();
assert.match(tradeRoot.innerHTML, /仓库一.*仓库二.*仓库三/);
assert.match(tradeRoot.innerHTML, /id="trade-inventory-help-tip"[^>]*hidden/, '使用说明默认隐藏在问号提示内');
assert.match(tradeRoot.innerHTML, /普通材料 999 个 \/ 组/, '保留完整的库存说明');
assert.doesNotMatch(tradeRoot.innerHTML, /<div class="sub">独立的待售材料清单/, '不再常驻显示说明段落');
assert.match(tradeRoot.innerHTML, /云杉原木/);
tradeRoot.tabs[1].onclick({ detail: 0 });
assert.equal(context.tradeWarehouseSettings.activeWarehouseId, 'warehouse-2');
assert.doesNotMatch(tradeRoot.innerHTML, /云杉原木/, '切换仓库不显示其他仓库材料');
listeners.get('#trade-add-warehouse')();
assert.equal(context.tradeWarehouseSettings.activeWarehouseId, 'warehouse-4');
assert.equal(context.tradeWarehouseSettings.warehouses[3].name, '仓库四');
tradeRoot.tabs[3].ondblclick({ preventDefault() {} });
tradeRoot.renameInput.value = '材料仓';
tradeRoot.renameInput.handlers.keydown({ key: 'Enter', preventDefault() {} });
assert.equal(context.tradeWarehouseSettings.warehouses[3].name, '材料仓', '双击仓库标题可改名');
assert.match(tradeRoot.innerHTML, /材料仓/);
tradeRoot.tabs[3].ondblclick({ preventDefault() {} });
tradeRoot.renameInput.value = '临时名称';
tradeRoot.renameInput.handlers.keydown({ key: 'Escape', preventDefault() {} });
assert.equal(context.tradeWarehouseSettings.warehouses[3].name, '材料仓', 'Esc 取消仓库改名');
const restored = context.normalizeTradeWarehouseSettings(JSON.parse(JSON.stringify(context.tradeWarehouseSettings)));
assert.equal(restored.activeWarehouseId, 'warehouse-4', '重载后保留当前仓库');
assert.equal(restored.warehouses[3].name, '材料仓', '重载后保留仓库改名');
assert.equal(restored.customCategories[0].name, '分类二', '重载后保留全局自建分类');
assert.match(css, /\.trade-warehouse-tabs \{[^}]*overflow-x: auto;/, '窄窗口横向滚动仓库标题');
assert.match(css, /\.trade-warehouse-add \{[^}]*margin-left: auto;/, '加号固定在标签行最右侧');
assert.match(css, /\.trade-inventory-help-tip \{[^}]*max-width: min\(480px, calc\(100vw - 32px\)\)/, '提示框限制在窄窗口内');

const helpHandlers = {}, buttonHandlers = {}, documentHandlers = {};
const tip = { hidden: true };
const button = {
  expanded: 'false', focusedByKeyboard: false,
  addEventListener(name, handler) { buttonHandlers[name] = handler; },
  matches() { return this.focusedByKeyboard; },
  setAttribute(name, value) { if (name === 'aria-expanded') this.expanded = value; },
  blur() { buttonHandlers.blur?.(); }
};
const help = {
  addEventListener(name, handler) { helpHandlers[name] = handler; },
  contains(target) { return target === this || target === button || target === tip; }
};
context.AbortController = class { constructor() { this.signal = {}; } abort() { this.aborted = true; } };
context.document = {
  querySelector: selector => ({ '#trade-inventory-help': help, '#trade-inventory-help-button': button, '#trade-inventory-help-tip': tip })[selector],
  addEventListener(name, handler) { documentHandlers[name] = handler; }
};
context.bindTradeInventoryHelp({ querySelector: context.document.querySelector });
helpHandlers.mouseenter();
assert.equal(tip.hidden, false, '鼠标悬停显示提示');
helpHandlers.mouseleave();
assert.equal(tip.hidden, true, '鼠标移开隐藏提示');
button.focusedByKeyboard = true;
buttonHandlers.focus();
assert.equal(tip.hidden, false, '键盘聚焦显示提示');
documentHandlers.keydown({ key: 'Escape' });
assert.equal(tip.hidden, true, 'Esc 关闭提示');
button.focusedByKeyboard = false;
buttonHandlers.click();
assert.equal(tip.hidden, false, '点击固定打开提示');
documentHandlers.pointerdown({ target: {} });
assert.equal(tip.hidden, true, '点击外部关闭提示');
assert.ok(saved >= 6 && rendered >= 3);
console.log('Trade warehouse and custom category checks passed.');
