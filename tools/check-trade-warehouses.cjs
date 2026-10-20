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
  tradeListingCategory: listing => listing.category,
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
assert.equal(context.categoryTools.tradeCategoryIds().at(-1), 'other', '其他始终排在自建分类后面');
assert.match(categoryList.innerHTML, /园艺[\s\S]*采矿[\s\S]*战职[\s\S]*水晶[\s\S]*待上架[\s\S]*其他/, '管理弹窗展示全部内置分类、自建分类和最后的其他');
assert.doesNotMatch(categoryList.innerHTML, /data-trade-category-delete="(?:botanist|miner|combat|crystal|other)"/, '内置分类不可删除');
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
const makeControl = (selector, value = '') => ({ value, selectionStart: value.length, disabled: false, handlers: {},
  addEventListener(name, handler) { this.handlers[name] = handler; }, focus() { this.focused = true; },
  setSelectionRange() {} });
const tradeRoot = {
  innerHTML: '', tabs: [], controls: new Map(),
  querySelector(selector) {
    if (!['#trade-toggle-total', '#trade-refresh-market', '#trade-manage-categories', '#trade-add-listing', '#trade-manage-warehouses', '#trade-global-search', '#trade-warehouse-search'].includes(selector)) return null;
    if (!this.controls.has(selector)) this.controls.set(selector, makeControl(selector));
    const control = this.controls.get(selector);
    control.addEventListener = (name, handler) => listeners.set(`${selector}:${name}`, handler);
    return control;
  },
  querySelectorAll(selector) {
    if (selector !== '[data-trade-warehouse]') return [];
    this.tabs = [{ dataset: { tradeWarehouse: 'overview' }, addEventListener(_name, handler) { this.click = handler; } },
      ...context.tradeWarehouseSettings.warehouses.map(row => ({ dataset: { tradeWarehouse: row.id }, addEventListener(_name, handler) { this.click = handler; } }))];
    return this.tabs;
  }
};
const managerList = { _innerHTML: '', buttonSets: new Map(),
  get innerHTML() { return this._innerHTML; },
  set innerHTML(value) { this._innerHTML = value; this.buttonSets.clear(); managerNames.clear(); context.tradeWarehouseSettings.warehouses.forEach(row => managerNames.set(row.id, { value: row.name, focus() {} })); },
  querySelectorAll(selector) {
    const key = selector.includes('rename') ? 'tradeWarehouseRename' : 'tradeWarehouseDelete';
    if (!this.buttonSets.has(key)) this.buttonSets.set(key, context.tradeWarehouseSettings.warehouses.map(row => ({ dataset: { [key]: row.id }, onclick: null })));
    return this.buttonSets.get(key);
  }, querySelector(selector) {
  const id = /data-trade-warehouse-name="([^"]+)"/.exec(selector)?.[1];
  return managerNames.get(id);
} };
const managerNames = new Map();
const originalQuery = selector => selector === '#trade' ? tradeRoot : selector === '#trade-warehouse-manage-list' ? managerList : tradeRoot.controls.get(selector) || element(selector);
context.document = { querySelector: originalQuery };
context.state = { tradeView: 'inventory', tradeHideTotal: false, tradeGlobalSearch: '', tradeWarehouseSearch: '', marketRefreshing: false };
context.activeTradePopover = null;
context.tradeMaterial = id => ({ uid: id, n: id === '1' ? '云杉原木' : '绿金矿' });
context.itemLabelMarkup = (_id, name) => name;
context.money = value => `${value} G`;
context.tradeTotal = listing => listing.groups * listing.unitPrice * 1000;
context.tradeMarketReference = () => '参考';
context.tradeListingCategory = listing => listing.category;
context.escapeTradeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
context.revalidateTradeInventorySources = () => {};
let compositionCommit;
context.setTimeout = handler => { compositionCommit = handler; };
vm.runInContext(between('  let tradeInventoryHelpListeners =', '  // 默认方案一') + '\nthis.renderTrade = renderTrade; this.openTradeWarehouseDialog = openTradeWarehouseDialog; this.bindTradeInventoryHelp = bindTradeInventoryHelp;', context);
context.renderTrade();
assert.match(tradeRoot.innerHTML, /总览.*仓库一.*仓库二.*仓库三/);
assert.match(tradeRoot.innerHTML, /id="trade-inventory-help-tip"[^>]*hidden/, '使用说明默认隐藏在问号提示内');
assert.match(tradeRoot.innerHTML, /id="trade-global-search".*id="trade-add-listing"/, '全局搜索靠近添加材料');
assert.match(tradeRoot.innerHTML, /id="trade-warehouse-search".*id="trade-manage-warehouses"/, '仓库搜索和管理入口位于标签行');
assert.doesNotMatch(tradeRoot.innerHTML, /id="trade-add-warehouse"|id="trade-delete-warehouse"/, '仓库行不再有单独新增、删除');
assert.match(tradeRoot.innerHTML, /云杉原木/);
tradeRoot.tabs[2].click();
assert.equal(context.tradeWarehouseSettings.activeWarehouseId, 'warehouse-2');
assert.doesNotMatch(tradeRoot.innerHTML, /云杉原木/, '切换仓库不显示其他仓库材料');
const savesBeforeSearch = saved;
tradeRoot.controls.get('#trade-global-search').value = '云杉';
listeners.get('#trade-global-search:input')({ isComposing: false });
assert.equal(context.tradeWarehouseSettings.activeWarehouseId, 'overview', '全局输入自动切换总览');
assert.equal(saved, savesBeforeSearch, '搜索不写入库存数据');
assert.match(tradeRoot.innerHTML, /云杉原木/);
assert.doesNotMatch(tradeRoot.innerHTML, /绿金矿/, '全局搜索筛选匹配记录');
tradeRoot.controls.get('#trade-global-search').value = '';
listeners.get('#trade-global-search:input')({ isComposing: false });
assert.equal(context.tradeWarehouseSettings.activeWarehouseId, 'overview', '清空全局搜索仍停留总览');
const globalInput = tradeRoot.controls.get('#trade-global-search');
listeners.get('#trade-global-search:compositionstart')();
globalInput.value = '云';
listeners.get('#trade-global-search:input')({ isComposing: true });
assert.equal(context.state.tradeGlobalSearch, '', '中文输入法尚在组字时不重绘输入框');
globalInput.value = '云杉';
listeners.get('#trade-global-search:compositionend')();
listeners.get('#trade-global-search:input')({ isComposing: false });
assert.equal(context.state.tradeGlobalSearch, '', '中文上屏的末次输入事件不会提前重建输入框');
compositionCommit();
assert.equal(context.state.tradeGlobalSearch, '云杉', '中文上屏后执行全局搜索');
assert.match(tradeRoot.innerHTML, /云杉原木/);
tradeRoot.controls.get('#trade-global-search').value = '';
listeners.get('#trade-global-search:input')({ isComposing: false });
assert.match(tradeRoot.innerHTML, /id="trade-warehouse-search"[^>]*placeholder="搜索总览材料或备注"/, '总览中直接提供可输入的视图搜索');
assert.doesNotMatch(tradeRoot.innerHTML, /id="trade-warehouse-search"[^>]*(readonly|disabled)/, '总览搜索不得锁定');
const warehouseInput = tradeRoot.controls.get('#trade-warehouse-search');
listeners.get('#trade-warehouse-search:compositionstart')();
warehouseInput.value = '云';
listeners.get('#trade-warehouse-search:input')({ isComposing: true });
assert.equal(context.state.tradeWarehouseSearch, '', '视图搜索组字期间保持输入框');
warehouseInput.value = '云杉';
listeners.get('#trade-warehouse-search:compositionend')();
listeners.get('#trade-warehouse-search:input')({ isComposing: false });
compositionCommit();
assert.equal(context.state.tradeWarehouseSearch, '云杉', '总览搜索支持中文上屏');
assert.equal(context.tradeWarehouseSettings.activeWarehouseId, 'overview', '总览内搜索不切换仓库');
assert.equal((tradeRoot.innerHTML.match(/云杉原木<\/button>/g) || []).length, 2, '总览搜索命中所有仓库的独立记录');
tradeRoot.tabs[2].click();
assert.equal(context.state.tradeWarehouseSearch, '云杉', '切换仓库保留视图搜索词');
assert.doesNotMatch(tradeRoot.innerHTML, /云杉原木<\/button>/, '同一关键词只筛选当前仓库');
tradeRoot.tabs[0].click();
assert.equal(context.state.tradeWarehouseSearch, '云杉', '回到总览继续使用同一关键词');
assert.equal((tradeRoot.innerHTML.match(/云杉原木<\/button>/g) || []).length, 2);
warehouseInput.value = '';
listeners.get('#trade-warehouse-search:input')({ isComposing: false });
tradeRoot.tabs[1].click();
assert.equal(context.state.tradeGlobalSearch, '', '点击具体仓库清空全局搜索');
tradeRoot.controls.get('#trade-warehouse-search').value = '无结果';
listeners.get('#trade-warehouse-search:input')({ isComposing: false });
assert.match(tradeRoot.innerHTML, /没有匹配的材料或备注/);
tradeRoot.tabs[2].click();
assert.equal(context.state.tradeWarehouseSearch, '无结果', '仓库搜索词跨仓库保持');
tradeRoot.tabs[0].click();
assert.equal(context.state.tradeWarehouseSearch, '无结果', '总览保留视图搜索词');
assert.match(tradeRoot.innerHTML, /没有匹配的材料或备注/);
const savesBeforeExclusive = saved;
tradeRoot.controls.get('#trade-global-search').value = '云杉';
listeners.get('#trade-global-search:input')({ isComposing: false });
assert.equal(context.state.tradeWarehouseSearch, '', '上方搜索清空下方关键词');
tradeRoot.controls.get('#trade-warehouse-search').value = '找不到';
listeners.get('#trade-warehouse-search:input')({ isComposing: false });
assert.equal(context.state.tradeGlobalSearch, '', '下方搜索清空上方关键词');
assert.equal(saved, savesBeforeExclusive, '输入搜索词不额外保存库存');
tradeRoot.controls.get('#trade-warehouse-search').value = '';
listeners.get('#trade-warehouse-search:input')({ isComposing: false });

context.openTradeWarehouseDialog();
assert.equal(element('#trade-warehouse-dialog').open, true);
assert.match(managerList.innerHTML, /仓库一.*仓库二.*仓库三/);
element('#trade-warehouse-create').onclick();
assert.equal(context.tradeWarehouseSettings.warehouses[3].name, '仓库四');
assert.equal(context.tradeWarehouseSettings.activeWarehouseId, 'warehouse-4');
managerNames.set('warehouse-4', { value: '材料仓', focus() {} });
managerList.querySelectorAll('[data-trade-warehouse-rename]')[3].onclick();
assert.equal(context.tradeWarehouseSettings.warehouses[3].name, '材料仓');
inventory[1].warehouseId = 'warehouse-4';
inventory[1].note = '多行\n备注';
managerList.querySelectorAll('[data-trade-warehouse-delete]')[3].onclick();
assert.match(element('#trade-warehouse-delete-summary').textContent, /1 条材料/);
element('#trade-warehouse-delete-confirm').onclick();
assert.equal(inventory[1].warehouseId, 'warehouse-4', '非空仓库未选择接收方不能删除');
element('#trade-warehouse-delete-target').value = 'warehouse-2';
element('#trade-warehouse-delete-confirm').onclick();
assert.equal(inventory[1].warehouseId, 'warehouse-2');
assert.equal(inventory[1].note, '多行\n备注', '迁移保留备注');
assert.deepEqual([inventory[1].groups, inventory[1].unitPrice], [25, 120]);
assert.equal(context.tradeWarehouseSettings.activeWarehouseId, 'warehouse-2');
assert.equal(context.tradeWarehouseSettings.warehouses.length, 3);
tradeRoot.tabs[0].click();
assert.equal((tradeRoot.innerHTML.match(/云杉原木<\/button>/g) || []).length, 2, '总览不合并不同仓库中的同种材料');
tradeRoot.controls.get('#trade-warehouse-search').value = '多行';
listeners.get('#trade-warehouse-search:input')({ isComposing: false });
assert.equal((tradeRoot.innerHTML.match(/云杉原木<\/button>/g) || []).length, 1, '总览下方搜索可按备注筛选所有仓库');
assert.equal(context.tradeWarehouseSettings.activeWarehouseId, 'overview');
tradeRoot.tabs[2].click();
assert.match(tradeRoot.innerHTML, /云杉原木/, '当前仓库搜索可按备注筛选');
tradeRoot.tabs[1].click();
assert.doesNotMatch(tradeRoot.innerHTML, /云杉原木<\/button>/, '仓库搜索不会查找其他仓库');
tradeRoot.controls.get('#trade-global-search').value = '多行';
listeners.get('#trade-global-search:input')({ isComposing: false });
assert.equal(context.tradeWarehouseSettings.activeWarehouseId, 'overview');
assert.equal(context.state.tradeWarehouseSearch, '', '全局搜索清空视图搜索');
assert.equal((tradeRoot.innerHTML.match(/云杉原木<\/button>/g) || []).length, 1, '全局搜索也可按备注筛选');
tradeRoot.tabs[1].click();
const restored = context.normalizeTradeWarehouseSettings(JSON.parse(JSON.stringify(context.tradeWarehouseSettings)));
assert.equal(restored.activeWarehouseId, 'warehouse-1');
assert.equal(restored.customCategories[0].name, '分类二');
assert.equal(context.normalizeTradeWarehouseSettings({ warehouses: [{ id: 'warehouse-3', name: '唯一仓库' }] }).warehouses.length, 1);
context.tradeWarehouseSettings.warehouses = [context.tradeWarehouseSettings.warehouses[0]];
context.openTradeWarehouseDialog();
assert.match(managerList.innerHTML, /至少保留一个仓库/, '最后一个仓库不可删除');
assert.match(css, /\.trade-warehouse-tabs \{[^}]*overflow-x: auto;/, '窄窗口横向滚动仓库标题');
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
