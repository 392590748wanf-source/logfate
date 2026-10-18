const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'fantasy.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
const elements = new Map();
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
let saves = 0, renders = 0;
const context = vm.createContext({
  document: { querySelector: element, querySelectorAll: () => [] },
  state: { tradeEditingId: null, tradeSearch: '' },
  tradeInventory: inventory,
  tradeMaterial: id => materials.find(material => material.uid === String(id)),
  tradeListingCategory: listing => listing.category || 'other',
  tradeSourceResolution: () => resolution,
  tradeCategoryOrder: ['botanist', 'miner', 'combat', 'crystal', 'other'],
  tradeCategoryLabels: { botanist: '园艺', miner: '采矿', combat: '战职', crystal: '水晶', other: '其他' },
  hideTradeContextMenu() {}, loadItemIndex() {}, loadItemIconIndex() {},
  itemLabelMarkup: (_id, name) => name, marketPriceLabel: () => '未获取',
  tradeGroupSize: () => 999, tradePriceMultiplier: () => 1000,
  money: value => `${value} G`, otherSearchResults: () => [],
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

  assert.match(script, /<button type="button" class="trade-context-target trade-name-edit" data-trade-name-context=/, '材料名称使用原生键盘可操作按钮');
  assert.match(script, /target\.onclick = \(\) => \{ if \(listing\) openTradeListingDialog\(listing\); \}/, '点击名称打开现有编辑弹窗');
  assert.match(script, /target\.oncontextmenu = event => listing && showTradeContextMenu\(event, listing, 'name'\)/, '保留右键菜单');
  assert.match(css, /\.trade-market-popover \{[^}]*width: max-content;[^}]*max-width: min\(420px, calc\(100vw - 24px\)\)/, '悬浮框按内容收紧且受视口限制');
  assert.match(css, /\.ledger\.trade-ledger \{[^}]*min-width: 0;/, '库存表必须覆盖通用账本最小宽度');
  assert.match(css, /\.trade-category-section \.table-wrap \{[^}]*overflow-x: auto;/, '狭窄窗口不应直接裁掉库存列');
  assert.match(css, /@media \(max-width: 1280px\) \{\s*\.trade-category-sections \{ grid-template-columns: 1fr; \}/, '客户端小窗口改为单栏库存表');
  assert.match(script, /<th>材料<\/th><th>单价<\/th><th>库存组数<\/th><th>合价<\/th><th>市场参考价<\/th>/, '库存表保留完整五列');
  assert.match(script, /width = popover\.getBoundingClientRect\(\)\.width/, '定位采用实际悬浮框宽度');
  assert.match(script, /target\.ondblclick = \(\) => \{ if \(listing\) editTradeCell\(target, listing, 'groups'\); \}/, '双击组数进入行内编辑');
  assert.match(script, /target\.ondblclick = \(\) => \{ if \(listing\) editTradeCell\(target, listing, 'unitPrice'\); \}/, '双击单价进入行内编辑');
  assert.match(css, /\.trade-inline-input \{[^}]*width: 100%/, '行内输入框适应单元格宽度');

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
  console.log('Trade inventory edit and popover checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
