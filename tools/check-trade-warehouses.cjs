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
const context = vm.createContext({
  localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  tradeInventory: inventory, tradeInventoryStorageKey: 'ff14-trade-inventory', data: { m: [] }, Date, Math
});
vm.runInContext(between('  const tradeWarehouseStorageKey =', '  const tradeSourceCacheStorageKey =') + '\nthis.settings = tradeWarehouseSettings; this.normalize = normalizeTradeWarehouseSettings;', context);
assert.deepEqual(Array.from(context.settings.warehouses, row => row.name), ['角色一', '角色二', '角色三']);
assert.ok(inventory.every(row => row.warehouseId === 'warehouse-1' && row.locationId === 'bag'), '旧库存放入角色一背包');
assert.deepEqual(inventory.map(row => [row.groups, row.unitPrice]), [[90, 100], [25, 120]], '迁移保留独立记录和金额');
assert.deepEqual(inventory.map(row => row.quantity), [90 * 999, 25 * 999], '旧组数同时换算为实际材料数量');
assert.equal(JSON.parse(storage.get('ff14-trade-inventory'))[0].locationId, 'bag', '迁移立即持久化');
assert.deepEqual(Array.from(context.normalize({ warehouses: [{ id: 'warehouse-1', name: '仓库一' }, { id: 'warehouse-2', name: '我的小号' }] }).warehouses, row => row.name), ['角色一', '我的小号'], '只迁移默认名称，自定义名称保留');
const restored = context.normalize({ warehouses: [{ id: 'warehouse-2', name: '小号' }], retainers: { 'warehouse-2': [{ id: 'retainer:abc', name: '雇员甲' }] }, activeWarehouseId: 'warehouse-2', activeLocationId: 'retainer:abc', customCategories: [{ id: 'custom:x', name: '收藏' }], categoryNames: { botanist: '采集' }, deletedBuiltIns: ['miner'] });
assert.equal(restored.activeLocationId, 'retainer:abc');
assert.equal(restored.retainers['warehouse-2'][0].name, '雇员甲');
assert.equal(restored.categoryNames.botanist, '采集');
assert.deepEqual(Array.from(restored.deletedBuiltIns), ['miner']);

const modelContext = vm.createContext({ tradeWarehouseSettings: restored, tradeFixedLocations: [{ id: 'bag', name: '背包' }, { id: 'saddlebag', name: '陆行鸟囊' }, { id: 'fc-chest', name: '部队箱' }], data: { m: [] } });
vm.runInContext(between('  const tradeCategoryOrder =', '  const tradeDisplayName =') + '\nthis.model = { tradeCategoryIds, tradeCategoryLabel, tradeLocations, tradeLocationId, validTradeName };', modelContext);
assert.equal(modelContext.model.tradeCategoryIds().at(-1), 'other', '其他始终最后');
assert.ok(!modelContext.model.tradeCategoryIds().includes('miner'), '已删除的内置分类不会复活');
assert.equal(modelContext.model.tradeCategoryLabel('botanist'), '采集', '内置分类可改名');
assert.equal(modelContext.model.tradeLocations('warehouse-2').length, 4, '固定三个位置与独立雇员');
assert.equal(modelContext.model.tradeLocationId({ warehouseId: 'warehouse-2', locationId: 'retainer:abc' }), 'retainer:abc');
assert.throws(() => modelContext.model.validTradeName('采集', [{ id: 'botanist', name: '采集' }]), /已存在/);

const controls = new Map();
const element = selector => {
  if (!controls.has(selector)) controls.set(selector, { innerHTML: '', textContent: '', hidden: false, value: '', showModal() { this.open = true; }, close() { this.open = false; } });
  return controls.get(selector);
};
const radio = { value: 'transfer', checked: true };
const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; }, querySelector: () => radio, querySelectorAll: () => [] };
controls.set('#trade-delete-dialog', dialog);
let saves = 0, renders = 0, confirmations = 0, allowConfirm = true, mutations = [];
const deleteContext = vm.createContext({
  document: { querySelector: element }, escapeTradeHtml: value => String(value),
  save: () => { saves++; }, renderTrade: () => { renders++; },
  confirm: () => { confirmations++; return allowConfirm; }
});
vm.runInContext(between('  const openTradeContainerDelete =', '  const renderTradeCategoryDialog =') + '\nthis.openDelete = openTradeContainerDelete;', deleteContext);
const options = { title: '分类“采集”', count: 2, targets: [{ id: 'other', name: '其他' }], onConfirm: (mode, target) => mutations.push([mode, target]) };
deleteContext.openDelete(options);
assert.equal(dialog.open, true);
assert.equal(mutations.length, 0, '打开删除窗口不会修改库存');
element('#trade-delete-cancel').onclick();
assert.equal(mutations.length, 0, '取消删除不修改库存');
deleteContext.openDelete(options);
element('#trade-delete-target').value = 'other';
element('#trade-delete-confirm').onclick();
assert.deepEqual(mutations.pop(), ['transfer', 'other'], '明确确认后才执行转移');
radio.value = 'remove';
deleteContext.openDelete(options);
allowConfirm = false;
element('#trade-delete-confirm').onclick();
assert.equal(mutations.length, 0, '二次确认取消时不删除材料');
allowConfirm = true;
element('#trade-delete-confirm').onclick();
assert.deepEqual(mutations.pop(), ['remove', 'other'], '二次确认后才执行连同材料删除');
deleteContext.openDelete({ ...options, count: 0 });
assert.deepEqual(mutations.pop(), ['remove', ''], '空分类只需普通确认');
assert.equal(saves, 3);
assert.equal(renders, 3);
assert.equal(confirmations, 3);

assert.match(source, /id="trade-location-dialog"/, '雇员管理窗口存在');
assert.match(source, /id="trade-delete-dialog"/, '容器删除选择窗口存在');
assert.match(source, /value="transfer" checked>转移材料/, '删除前默认转移');
assert.match(source, /value="remove">连同这些本机库存材料一起删除/, '明确提供连同材料删除');
assert.match(source, /再次确认：永久删除/, '删除材料需二次确认');
assert.match(source, /retainerMap\.set\(retainer\.id, id\)/, '角色转移映射雇员 ID');
assert.match(source, /listing\.locationId = retainerMap\.get\(oldLocationId\) \|\| oldLocationId/, '固定位置对应转移，雇员独立映射');
assert.match(source, /tradeInventory = tradeInventory\.filter\(listing => tradeWarehouseId\(listing\) !== source\.id\)/, '仅删除源角色的本机库存');
assert.match(source, /tradeInventory = tradeInventory\.filter\(listing => !\(tradeWarehouseId\(listing\) === warehouseId && tradeLocationId\(listing\) === retainer\.id\)\)/, '仅删除该雇员的本机库存');
assert.match(source, /tradeInventory = tradeInventory\.filter\(listing => tradeListingCategory\(listing\) !== id\)/, '仅删除该分类的本机库存');
assert.match(source, /data-trade-location="all"/, '角色默认提供全部位置');
assert.match(source, /角色 · 位置/, '跨角色总览显示双层归属');
assert.match(source, /id="trade-listing-location"/, '材料编辑可选存放位置');
assert.match(source, /if \(!tradeLocations\(warehouseId\)\.some\(location => location\.id === locationId\)\)/, '保存前校验位置归属');
assert.match(source, /id="trade-category-create-form" novalidate hidden/, '新分类输入默认隐藏');
assert.match(source, /id="trade-category-delete-selected"/, '分类删除按钮位于管理界面');
assert.match(source, /button\.ondblclick = \(\) => rename\(button, id\)/, '双击分类重命名');
assert.match(source, /event\.key === 'F2'/, '键盘重命名分类');
assert.match(css, /\.trade-location-tabs \{[^}]*overflow-x: auto;/, '窄窗口位置标签可横向滚动');
assert.match(css, /\.trade-category-manage-row\.selected/, '统一分类列表有选中状态');
console.log('Trade role, location, category and migration checks passed.');
