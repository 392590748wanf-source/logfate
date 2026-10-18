const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'fantasy.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
const elements = new Map();
let tradeSelectButtons = [];
const element = id => {
  if (!elements.has(id)) elements.set(id, {
    value: '', textContent: '', innerHTML: '', hidden: false, disabled: false,
    showModal() { this.open = true; }, close() { this.open = false; }, focus() { this.focused = true; }
  });
  return elements.get(id);
};
const original = { id: 'listing-1', itemId: '1', name: '云杉原木', category: 'botanist', categoryOrigin: 'manual', groups: 2, groupSize: 999, unitPrice: 100, createdAt: '原入库时间' };
const inventory = [original];
const materials = [{ uid: '1', n: '云杉原木' }, { uid: '2', n: '绿金矿' }];
let resolution = { ready: false, categories: [], status: 'failed' };
let saves = 0, renders = 0, indexLoads = 0, iconLoads = 0;
const context = vm.createContext({
  document: { querySelector: element, querySelectorAll: selector => {
    if (selector !== '[data-trade-select]') return [];
    tradeSelectButtons = [...element('#trade-listing-results').innerHTML.matchAll(/data-trade-select="([^"]+)"/g)]
      .map(([, id]) => ({ dataset: { tradeSelect: id }, onclick: null }));
    return tradeSelectButtons;
  } },
  state: { tradeEditingId: null, tradeSearch: '' },
  tradeInventory: inventory,
  tradeMaterial: id => materials.find(material => material.uid === String(id)),
  tradeListingCategory: listing => listing.category || 'other',
  tradeSourceResolution: () => resolution,
  tradeCategoryOrder: ['botanist', 'miner', 'combat', 'crystal', 'other'],
  tradeCategoryLabels: { botanist: '园艺', miner: '采矿', combat: '战职', crystal: '水晶', other: '其他' },
  hideTradeContextMenu() {}, loadItemIndex() { indexLoads++; }, loadItemIconIndex() { iconLoads++; },
  itemLabelMarkup: (_id, name) => name, marketPriceLabel: () => '未获取',
  tradeGroupSize: () => 999, tradePriceMultiplier: () => 1000,
  money: value => `${value} G`, otherSearchResults: query => materials.filter(item => item.n.includes(query)),
  ensureTradeMaterial: candidate => candidate,
  fetchTradeSource: async () => resolution, fetchGarlandIcon() {},
  save: () => { saves++; }, renderTrade: () => { renders++; }, refreshMarket: async () => {},
  Date, Math
});
const editorStart = script.indexOf('  const renderTradeCategorySelect =');
const editorEnd = script.indexOf('  const hideTradeContextMenu =', editorStart);
const submitStart = script.indexOf("  document.querySelector('#trade-listing-form').onsubmit =", editorEnd);
const submitEnd = script.indexOf("  document.querySelector('#trade-quantity-form').onsubmit =", submitStart);
assert.ok(editorStart > 0 && editorEnd > editorStart && submitStart > editorEnd && submitEnd > submitStart);
vm.runInContext(script.slice(editorStart, editorEnd), context);
vm.runInContext(script.slice(submitStart, submitEnd), context);

(async () => {
  context.openTradeListingDialog(original);
  assert.equal(element('#trade-listing-dialog').open, true);
  assert.equal(element('#trade-listing-delete').hidden, false, '已有材料的详情可删除');
  assert.equal(element('#trade-listing-groups').value, 2);
  assert.equal(element('#trade-listing-unit-price').value, 100);
  assert.equal(element('#trade-listing-category').value, 'botanist');
  assert.match(element('#trade-listing-category-note').textContent, /保留/);
  element('#trade-listing-groups').value = '3';
  element('#trade-listing-unit-price').value = '150';
  await element('#trade-listing-form').onsubmit({ preventDefault() {} });
  assert.equal(saves, 1, '来源暂时不可用时仍保存原材料编辑');
  assert.equal(renders, 1);
  assert.equal(inventory[0].total, 450000);
  assert.equal(inventory[0].groups, 3);
  assert.equal(inventory[0].unitPrice, 150);
  assert.equal(inventory[0].category, 'botanist');
  assert.equal(inventory[0].categoryOrigin, 'manual');
  assert.equal(inventory[0].createdAt, '原入库时间');
  assert.equal(JSON.parse(JSON.stringify(inventory))[0].groups, 3, '重载所用的本机记录保留新组数');

  context.openTradeListingDialog(inventory[0]);
  element('#trade-listing-item-id').value = '2';
  await element('#trade-listing-form').onsubmit({ preventDefault() {} });
  assert.equal(saves, 1, '更换材料时来源未核验不能保存');
  assert.match(element('#trade-listing-error').textContent, /来源查询/);
  resolution = { ready: true, categories: ['miner'], status: 'static' };
  element('#trade-listing-category').value = 'miner';
  await element('#trade-listing-form').onsubmit({ preventDefault() {} });
  assert.equal(saves, 2, '核验后的新材料可保存');
  assert.equal(inventory[0].category, 'miner');

  element('#trade-listing-search').focused = false;
  context.openTradeListingDialog();
  assert.equal(element('#trade-listing-delete').hidden, true, '新增材料时不显示删除按钮');
  const search = element('#trade-listing-search');
  assert.equal(search.focused, true, '添加弹窗打开后搜索框立即获得焦点');
  assert.equal(indexLoads, 0, '打开添加弹窗不立即加载完整道具索引');
  assert.equal(iconLoads, 0, '打开添加弹窗不立即加载图标索引');
  search.value = '矿';
  search.oninput();
  assert.equal(element('#trade-listing-results').innerHTML, '', '输入时不自动重新打开候选列表');
  element('#trade-listing-search-button').onclick();
  assert.equal(indexLoads, 1, '明确搜索时才加载完整道具索引');
  assert.equal(iconLoads, 1, '明确搜索时才加载图标索引');
  assert.match(element('#trade-listing-results').innerHTML, /绿金矿/, '点击搜索才显示候选材料');
  const chosen = tradeSelectButtons[0];
  chosen.onclick();
  assert.equal(element('#trade-listing-item-id').value, '2');
  assert.equal(element('#trade-listing-results').innerHTML, '', '选中后立即收起候选列表');
  context.state.refreshTradeListingDialog();
  assert.equal(element('#trade-listing-results').innerHTML, '', '异步来源刷新不重新打开候选列表');
  search.value = '云';
  search.oninput();
  assert.equal(element('#trade-listing-item-id').value, '', '修改搜索词时不能误保存之前选中的材料');
  search.onkeydown({ key: 'Enter', preventDefault() {} });
  assert.match(element('#trade-listing-results').innerHTML, /云杉原木/, '回车明确搜索后可以再次显示候选列表');
  context.removeTradeListing = () => false;
  context.openTradeListingDialog(inventory[0]);
  element('#trade-listing-delete').onclick();
  assert.equal(element('#trade-listing-dialog').open, true, '取消删除后保持编辑弹窗');
  context.removeTradeListing = () => true;
  element('#trade-listing-delete').onclick();
  assert.equal(element('#trade-listing-dialog').open, false, '确认删除后关闭编辑弹窗');

  assert.match(script, /<button type="button" class="trade-context-target trade-name-edit" data-trade-name-context=/, '材料名称使用原生键盘可操作按钮');
  assert.match(script, /target\.onclick = \(\) => \{ if \(listing\) openTradeListingDialog\(listing\); \}/, '点击名称打开现有编辑弹窗');
  assert.match(script, /target\.oncontextmenu = event => listing && showTradeContextMenu\(event, listing, 'name'\)/, '保留右键菜单');
  assert.match(css, /\.trade-market-popover \{[^}]*width: max-content;[^}]*max-width: min\(420px, calc\(100vw - 24px\)\)/, '悬浮框按内容收紧且受视口限制');
  assert.match(css, /\.ledger\.trade-ledger \{[^}]*min-width: 0;/, '库存表必须覆盖通用账本最小宽度');
  assert.match(css, /\.trade-category-section \.table-wrap \{[^}]*overflow-x: auto;/, '狭窄窗口不应直接裁掉库存列');
  assert.match(css, /@media \(max-width: 1280px\) \{\s*\.trade-category-sections \{ grid-template-columns: 1fr; \}/, '客户端小窗口改为单栏库存表');
  assert.match(script, /<th>材料<\/th><th>单价<\/th><th>库存组数<\/th>\$\{showTotal \? '<th>合价<\/th>' : ''\}<th>市场参考价<\/th>/, '合价列可隐藏');
  assert.match(script, /\$\{showTotal \? `<td class="price">\$\{money\(tradeTotal\(listing\)\)\}<\/td>` : ''\}/, '合价隐藏只影响展示');
  assert.match(script, /id="trade-toggle-total"[^>]*aria-pressed="\$\{state\.tradeHideTotal\}"/, '库存界面有合价显隐按钮');
  assert.match(script, /state\.tradeHideTotal = !state\.tradeHideTotal; renderTrade\(\)/, '切换后重新渲染库存表');
  assert.match(css, /\.trade-ledger-no-total \.trade-col-material \{ width: 35%; \}/, '隐藏合价后重新分配列宽');
  assert.match(script, /id="trade-listing-delete"[^>]*hidden>删除材料<\/button>/, '删除按钮只放在材料详情弹窗');
  assert.match(script, /deleteButton\.hidden = !listing/, '新增材料隐藏删除按钮');
  assert.match(script, /localStorage\.setItem\(tradeSourceCacheStorageKey, JSON\.stringify\(tradeSourceCache\)\)/, '逐项来源核验只写缓存，不重复序列化整本账');
  assert.match(script, /data-trade-context-delete.*removeTradeListing\(listing\.id\)/s, '右键删除沿用相同逻辑');
  assert.match(script, /width = popover\.getBoundingClientRect\(\)\.width/, '定位采用实际悬浮框宽度');
  assert.match(script, /target\.ondblclick = \(\) => \{ if \(listing\) editTradeCell\(target, listing, 'groups'\); \}/, '双击组数进入行内编辑');
  assert.match(script, /target\.ondblclick = \(\) => \{ if \(listing\) editTradeCell\(target, listing, 'unitPrice'\); \}/, '双击单价进入行内编辑');
  assert.match(css, /\.trade-inline-input \{[^}]*width: 100%/, '行内输入框适应单元格宽度');

  const renderStart = script.indexOf('  function renderTrade() {');
  const renderEnd = script.indexOf('  // 默认方案一', renderStart);
  assert.ok(renderStart > 0 && renderEnd > renderStart);
  assert.doesNotMatch(script.slice(renderStart, renderEnd), /data-trade-delete|trade-col-action|<th>操作<\/th>/, '库存表不展示删除入口和操作列');
  const totalToggle = { addEventListener: (_name, handler) => { totalToggle.click = handler; } };
  const tradeRoot = { innerHTML: '', querySelector: selector => selector === '#trade-toggle-total' ? totalToggle : null, querySelectorAll: () => [] };
  const displayState = { tradeView: 'inventory', tradeHideTotal: false, marketRefreshing: false };
  let totalCalculations = 0;
  const displayContext = vm.createContext({
    state: displayState, activeTradePopover: null,
    document: { querySelector: () => tradeRoot },
    tradeCategoryOrder: ['botanist'], tradeCategoryLabels: { botanist: '园艺' },
    tradeInventory: [{ id: 'display', itemId: '1', groups: 2, unitPrice: 100 }],
    tradeListingCategory: () => 'botanist', tradeMaterial: id => materials.find(item => item.uid === String(id)),
    itemLabelMarkup: (_id, name) => name, money: value => `${value} G`,
    tradeTotal: listing => { totalCalculations++; return listing.groups * 1000 * listing.unitPrice; },
    tradeMarketReference: () => '参考', revalidateTradeInventorySources() {}
  });
  vm.runInContext(script.slice(renderStart, renderEnd) + '\nthis.renderTrade = renderTrade;', displayContext);
  displayContext.renderTrade();
  assert.match(tradeRoot.innerHTML, /<th>合价<\/th>/);
  assert.match(tradeRoot.innerHTML, /class="price">200000 G<\/td>/);
  assert.equal(totalCalculations, 1);
  totalToggle.click();
  assert.equal(displayState.tradeHideTotal, true);
  assert.doesNotMatch(tradeRoot.innerHTML, /<th>合价<\/th>|class="price">200000 G<\/td>/);
  assert.match(tradeRoot.innerHTML, /trade-ledger-no-total/);
  assert.match(tradeRoot.innerHTML, /显示合价/);
  assert.equal(totalCalculations, 1, '隐藏合价只改变显示，不修改库存金额');

  const inlineStart = script.indexOf('  const editTradeCell =');
  const inlineEnd = script.indexOf('  const revalidateTradeInventorySources =', inlineStart);
  assert.ok(inlineStart > 0 && inlineEnd > inlineStart);
  class InlineInput {
    constructor() { this.handlers = {}; this.value = ''; }
    setAttribute() {}
    addEventListener(name, handler) { this.handlers[name] = handler; }
    setCustomValidity(message) { this.validationMessage = message; }
    reportValidity() { this.reported = true; }
    focus() { this.focused = true; }
    select() { this.selected = true; }
    fire(name, event = {}) { this.handlers[name](event); }
  }
  class InlineTarget {
    constructor(text) { this._text = text; this.input = null; this.classes = new Set(); this.classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name) }; }
    get textContent() { return this._text; }
    set textContent(text) { this._text = text; this.input = null; }
    querySelector() { return this.input; }
    append(input) { this.input = input; }
    focus() { this.focused = true; }
  }
  let inlineSaves = 0, inlineRenders = 0;
  const inlineContext = vm.createContext({
    document: { createElement: () => new InlineInput() },
    hideTradeContextMenu() {}, tradeMaterial: () => materials[0], tradeGroupSize: () => 999,
    tradeTotal: listing => listing.groups * 1000 * listing.unitPrice,
    save: () => { inlineSaves++; }, renderTrade: () => { inlineRenders++; }, Date, Number
  });
  vm.runInContext(script.slice(inlineStart, inlineEnd) + '\nthis.editTradeCell = editTradeCell;', inlineContext);
  const inlineListing = { itemId: '1', groups: 2, groupSize: 999, unitPrice: 100, total: 200000 };
  const priceTarget = new InlineTarget('100 G');
  inlineContext.editTradeCell(priceTarget, inlineListing, 'unitPrice');
  assert.equal(priceTarget.input.value, '100');
  priceTarget.input.value = '111.5';
  priceTarget.input.fire('keydown', { key: 'Enter', preventDefault() {}, stopPropagation() {} });
  assert.equal(inlineListing.unitPrice, 111.5);
  assert.equal(inlineListing.total, 223000);
  assert.equal(inlineSaves, 1);
  assert.equal(inlineRenders, 1);

  const groupsTarget = new InlineTarget('2 组');
  inlineContext.editTradeCell(groupsTarget, inlineListing, 'groups');
  groupsTarget.input.value = '3.5';
  groupsTarget.input.fire('keydown', { key: 'Enter', preventDefault() {}, stopPropagation() {} });
  assert.equal(inlineListing.groups, 2, '小数组数不能保存');
  assert.equal(inlineSaves, 1);
  assert.equal(groupsTarget.input.reported, true);
  groupsTarget.input.fire('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.equal(groupsTarget.textContent, '2 组', 'Esc 恢复原单元格');
  inlineContext.editTradeCell(groupsTarget, inlineListing, 'groups');
  groupsTarget.input.value = '4';
  groupsTarget.input.fire('blur');
  assert.equal(inlineListing.groups, 4, '失焦时保存有效组数');
  assert.equal(inlineListing.total, 446000);
  assert.equal(inlineSaves, 2);

  inlineContext.editTradeCell(priceTarget, inlineListing, 'unitPrice');
  priceTarget.input.value = '-1';
  priceTarget.input.fire('blur');
  assert.equal(inlineListing.unitPrice, 111.5, '无效单价失焦不写入账本');
  assert.equal(inlineSaves, 2);

  const deleteStart = script.indexOf('  const removeTradeListing =');
  const deleteEnd = script.indexOf('  const showTradeContextMenu =', deleteStart);
  assert.ok(deleteStart > 0 && deleteEnd > deleteStart);
  const deleteInventory = [
    { id: 'target', itemId: '1', name: '云杉原木' },
    { id: 'keep', itemId: '2', name: '绿金矿' }
  ];
  const purchaseLedger = [{ itemId: '1', quantity: 5 }];
  let confirmDelete = false, deleteSaves = 0, deleteRenders = 0, prompts = 0;
  const deleteDialog = { open: true, close() { this.open = false; } };
  const deleteContext = vm.createContext({
    document: { querySelector: () => deleteDialog }, state: { tradeEditingId: 'target' },
    tradeInventory: deleteInventory, tradeMaterial: id => materials.find(item => item.uid === String(id)),
    tradeDisplayName: item => item.n || item.name,
    hideTradeContextMenu() {},
    confirm: message => { prompts++; assert.match(message, /不会删除采购/); return confirmDelete; },
    save: () => { assert.equal(deleteDialog.open, false, '删除后先关闭编辑弹窗再保存和重绘'); deleteSaves++; }, renderTrade: () => { deleteRenders++; }
  });
  vm.runInContext(script.slice(deleteStart, deleteEnd) + '\nthis.removeTradeListing = removeTradeListing;', deleteContext);
  assert.equal(deleteContext.removeTradeListing('target'), false);
  assert.equal(deleteInventory.length, 2, '取消删除时库存不变');
  assert.equal(deleteDialog.open, true, '取消删除保持编辑弹窗');
  assert.equal(deleteSaves, 0);
  confirmDelete = true;
  assert.equal(deleteContext.removeTradeListing('target'), true);
  assert.deepEqual(deleteInventory.map(item => item.id), ['keep'], '只删除选中的库存记录');
  assert.equal(deleteSaves, 1);
  assert.equal(deleteRenders, 1);
  assert.equal(purchaseLedger.length, 1, '采购记录不受库存删除影响');
  assert.equal(deleteContext.removeTradeListing('target'), false);
  assert.equal(prompts, 2, '重复删除不存在记录不再弹确认');

  const sourceStart = script.indexOf('  const tradeMaterial =');
  const sourceEnd = script.indexOf('  const tradeGroupSize =', sourceStart);
  assert.ok(sourceStart > 0 && sourceEnd > sourceStart);
  const sourceContext = vm.createContext({
    data: { m: [{ uid: '44043', n: '珍珠草' }] },
    materialSources: {}, retainerData: {}, tradeSourceCache: { '44043': { verified: true, parserVersion: 2, categories: ['miner'] } },
    state: { tradeSourceLoading: new Set(), tradeSourceFailures: new Map() },
    isCrystal: () => false
  });
  vm.runInContext(script.slice(sourceStart, sourceEnd) + '\nthis.checkTradeSource = { garlandSourceCategories, tradeSourceResolution, tradeListingCategory };', sourceContext);
  const pearlGrass = { uid: '44043', n: '珍珠草' };
  assert.deepEqual(Array.from(sourceContext.checkTradeSource.tradeSourceResolution(pearlGrass).categories), ['botanist'], '珍珠草的园艺来源覆盖旧版错误采矿缓存');
  sourceContext.tradeSourceCache['999'] = { verified: true, parserVersion: 2, categories: ['miner'] };
  assert.equal(sourceContext.checkTradeSource.tradeSourceResolution({ uid: '999', n: '待重验材料' }).status, 'pending', '旧解析版本的其他来源缓存必须重新校验');
  assert.equal(sourceContext.checkTradeSource.tradeListingCategory({ itemId: '44043', category: 'miner' }), 'botanist', '旧库存立即按正确园艺分类展示');
  const parseSource = sourceContext.checkTradeSource.garlandSourceCategories;
  assert.deepEqual(Array.from(parseSource({ item: { category: 48, nodes: [1001] } }, null).categories), [], '物品展示类别不能推断采矿职业');
  assert.deepEqual(Array.from(parseSource({ item: { category: 48, nodes: [1001] } }, null, [{ type: 3 }]).categories), ['botanist'], '茂盛草丛节点归园艺');
  assert.deepEqual(Array.from(parseSource({ item: { nodes: [1002] } }, null, [{ type: 0 }]).categories), ['miner'], '矿脉节点归采矿');
  assert.deepEqual(Array.from(parseSource({ item: { nodes: [1002] } }, null, [{ type: null }]).categories), [], '缺失节点类型不能误判为采矿');
  assert.deepEqual(Array.from(parseSource({ item: { ventures: [1023] } }, { ventureIndex: { 1023: { jobs: 18, lvl: 99 } }, jobCategories: { 18: { name: 'Botanist', jobs: [18] } } }).categories), ['botanist'], '园艺工雇员任务归园艺');

  const auditStart = script.indexOf('  const revalidateTradeInventorySources =');
  const auditEnd = script.indexOf('  function renderTrade() {', auditStart);
  const auditInventory = [
    { id: 'old-wrong', itemId: '44043', category: 'miner', categoryOrigin: 'manual' },
    { id: 'valid-manual', itemId: '2', category: 'botanist', categoryOrigin: 'manual' }
  ];
  let auditSaves = 0, auditRenders = 0;
  const auditContext = vm.createContext({
    tradeInventory: auditInventory, state: { tradeSourceAudited: new Set(), page: 'trade', tradeView: 'inventory' },
    tradeMaterial: id => ({ uid: id }), isTradeCrystal: () => false,
    fetchTradeSource: async () => ({ categories: ['botanist'] }),
    save: () => { auditSaves++; }, renderTrade: () => { auditRenders++; }, Date
  });
  vm.runInContext(script.slice(auditStart, auditEnd) + '\nthis.revalidateTradeInventorySources = revalidateTradeInventorySources;', auditContext);
  auditContext.revalidateTradeInventorySources();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(auditInventory[0].category, 'botanist', '来源重验后修复已保存的错误分类');
  assert.equal(auditInventory[0].categoryOrigin, 'auto');
  assert.equal(auditInventory[1].categoryOrigin, 'manual', '已验证且正确的手动分类保留');
  assert.equal(auditSaves, 1, '分类修正只保存一次');
  assert.equal(auditRenders, 1);
  console.log('Trade inventory edit and popover checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
