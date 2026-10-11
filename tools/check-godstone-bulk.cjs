// 使用内存账本执行真实的一键采购逻辑，不读取或修改用户数据。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'fantasy.js'), 'utf8');
assert.match(source, /id="godstone-card-tier"[^`]+战职 770[^`]+生产采集 750/, '卡片提供两种装备类型');
assert.doesNotMatch(source, /770 \/ 750 独立预设单价与数量/, '卡片不再显示旧说明文字');
const globals = { window: {}, atob, TextDecoder, localStorage: { getItem: () => null, setItem: () => {} } };
vm.createContext(globals);
for (const file of ['nbb-preset.js', 'base-materials.js', 'material-sources.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), globals);
}
const data = globals.nbbData;
const base = globals.window.FF14_BASE_MATERIALS;
const sources = globals.window.FF14_MATERIAL_SOURCES;
for (const [uid, name] of Object.entries(base.n)) {
  if (!data.m.some(material => String(material.uid) === uid)) data.m.push({ id: `base-${uid}`, uid, n: name });
}

const storage = new Map();
const elements = new Map();
for (const id of ['#godstone-card-tier', '#godstone-bulk-dialog', '#godstone-bulk-confirm', '#godstone-bulk-error', '#godstone-bulk-content', '#godstone-bulk-summary', '#godstone-bulk-tier', '.godstone-bulk-total']) {
  elements.set(id, { innerHTML: '', textContent: '', hidden: false, disabled: false, open: false });
}
elements.get('#godstone-bulk-dialog').showModal = function () { this.open = true; };
elements.get('#godstone-bulk-dialog').close = function () { this.open = false; };
const purchases = [];
const presets = { '770': { unitPrice: 200, quantity: 3 }, '750': { unitPrice: 150, quantity: 4 } };
let failSave = false;
const context = {
  data, godstonePurchasePresets: presets, godstonePresetStorageKey: 'ff14-godstone-purchase-presets', purchases,
  baseIngredients: recipe => {
    const pairs = base.b[String(recipe.itemId)] || [];
    return pairs.filter((_, index) => index % 2 === 0).map(uid => ({ material: data.m.find(material => String(material.uid) === String(uid)) }));
  },
  basicKind: material => sources[String(material.uid)]?.verified?.equipment || sources[String(material.uid)]?.equipmentKinds?.[0] || base.k[String(material.uid)] || '常规采集品',
  document: { querySelector: selector => elements.get(selector), querySelectorAll: () => [] },
  itemLabelMarkup: (_uid, name) => name, marketPriceLabel: () => '123 G', money: value => `${value} G`, today: () => '2026-10-08',
  backupStorageKeys: ['ff14-material-purchases', 'ff14-godstone-purchase-presets'],
  localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
  refreshNpcRecommendations: () => {}, renderGuide: () => {},
  save: () => {
    storage.set('ff14-material-purchases', JSON.stringify(purchases));
    if (failSave) throw new Error('模拟保存失败');
  }
};
const tierStart = source.indexOf('  const godstoneMaterialsForTier = tier => {');
const tierEnd = source.indexOf('  // 潜水艇推荐材料按业务约定', tierStart);
const bulkStart = source.indexOf("  let godstoneActiveTier = '770';");
const bulkEnd = source.indexOf('  function openCraftScripExchangeDetail(uid)', bulkStart);
assert.ok(tierStart > 0 && tierEnd > tierStart && bulkStart > 0 && bulkEnd > bulkStart);
vm.runInNewContext(source.slice(tierStart, tierEnd) + source.slice(bulkStart, bulkEnd) + '\nthis.api = { godstoneMaterialsForTier, saveGodstonePreset, openGodstoneBulkDialog, confirmGodstoneBulkPurchase, selected: () => godstoneBulkSelections, presets: () => godstonePurchasePresets };', context);
const { api } = context;

const materialIds = tier => Array.from(api.godstoneMaterialsForTier(tier), material => String(material.uid));
assert.deepEqual(materialIds('770'), ['49223', '49224', '49225', '49226', '49227']);
assert.deepEqual(materialIds('750'), ['45984', '45985', '45986', '45987', '45988']);
assert.deepEqual(materialIds('770').filter(uid => materialIds('750').includes(uid)), []);

api.openGodstoneBulkDialog('770');
assert.equal(api.selected()['770'].size, 5, '首次打开默认全选');
assert.equal(elements.get('#godstone-card-tier').value, '770', '卡片显示当前采购档位');
assert.match(elements.get('#godstone-bulk-content').innerHTML, /123 G/, '市场价只作展示');
for (const uid of materialIds('770').slice(1)) api.selected()['770'].delete(uid);
api.confirmGodstoneBulkPurchase();
assert.equal(purchases.length, 1, '仅录入已选材料');
assert.equal(purchases[0].materialId, data.m.find(material => String(material.uid) === '49223').id);
assert.equal(purchases[0].date, '2026-10-08');
assert.equal(purchases[0].time, undefined, '批量记录不写入时间');
assert.equal(purchases[0].tax, 0, '不额外计税');
assert.equal(purchases[0].total, 600);
api.confirmGodstoneBulkPurchase();
assert.equal(purchases.length, 1, '弹窗关闭后重复触发不会再次入账');

api.openGodstoneBulkDialog('750');
assert.equal(api.selected()['750'].size, 5, '切换档位默认全选');
assert.equal(elements.get('#godstone-card-tier').value, '750', '弹窗切换档位后卡片同步显示');
api.selected()['750'].clear();
api.confirmGodstoneBulkPurchase();
assert.equal(purchases.length, 1, '未勾选材料时账本不变');
assert.match(elements.get('#godstone-bulk-error').textContent, /至少勾选/);

api.openGodstoneBulkDialog('750');
presets['750'].unitPrice = 0;
api.confirmGodstoneBulkPurchase();
assert.equal(purchases.length, 1, '无效预设不得入账');
presets['750'].unitPrice = 150;
api.openGodstoneBulkDialog('750');
failSave = true;
api.confirmGodstoneBulkPurchase();
assert.equal(purchases.length, 1, '保存失败后恢复内存账本');
assert.equal(JSON.parse(storage.get('ff14-material-purchases')).length, 1, '保存失败后恢复磁盘账本');
assert.match(elements.get('#godstone-bulk-error').textContent, /原账本已保留/);

failSave = false;
const purchaseCount = purchases.length;
api.saveGodstonePreset('770', 250, 2);
assert.deepEqual(JSON.parse(storage.get('ff14-godstone-purchase-presets')), {
  '770': { unitPrice: 250, quantity: 2 }, '750': { unitPrice: 150, quantity: 4 }
}, '两个档位独立保存，重启可从本机读取');
assert.equal(purchases.length, purchaseCount, '保存预设不产生采购记录');
assert.throws(() => api.saveGodstonePreset('750', 0, 2), /大于 0 的整数/);
assert.throws(() => api.saveGodstonePreset('750', 1.5, 2), /大于 0 的整数/);
assert.equal(api.presets()['750'].unitPrice, 150, '无效预设不覆盖已有设置');

console.log('Godstone bulk purchase checks passed (in-memory only).');
