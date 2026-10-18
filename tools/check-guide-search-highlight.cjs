// 模拟材料搜索定位与列表重绘；不读取或写入真实账本。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'fantasy.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
assert.match(css, /\.guide-material-card\.material-search-hit\s*\{[^}]*outline:[^}]*background:/, '材料卡片需要醒目的高亮样式');
assert.match(css, /\.material-search-hit > td/, '表格材料也需要高亮样式');

const start = source.indexOf('  const basicSearchCategoryKey = result => {');
const end = source.indexOf('  const addOtherMaterial = async material => {', start);
const reapplyStart = source.indexOf('    if (guideSearchHit && guideSearchHit.scope === state.basicCategory', end);
const reapplyEnd = source.indexOf('    const renderedCategory = state.basicCategory;', reapplyStart);
assert(start >= 0 && end > start && reapplyStart > end && reapplyEnd > reapplyStart, '未找到搜索定位和重绘高亮逻辑');

const makeRow = () => {
  const classes = new Set();
  return {
    classes,
    classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
    scrollIntoView(options) { this.scrollOptions = options; }
  };
};
let now = 1000, activeRow = makeRow();
const timers = [];
const document = { querySelector: selector => selector === '[data-guide-material-row="equipment:123"]' ? activeRow : null };
const state = { basicCategory: 'submarine', guideCategories: {}, basicMaterialSearch: '材料' };
const context = vm.createContext({
  state, document, Date: { now: () => now },
  craftScripRoutesFor: () => [],
  requestAnimationFrame: callback => callback(),
  window: { setTimeout: (callback, delay) => timers.push({ callback, delay }) },
  renderGuide: () => context.reapply(document)
});
vm.runInContext(source.slice(start, end) + '\nthis.jump = jumpToBasicMaterial;\nthis.reapply = root => {\n' + source.slice(reapplyStart, reapplyEnd) + '\n};', context);

context.jump({ scope: 'equipment', kind: '常规采集品', material: { uid: 123 } });
assert.equal(state.basicCategory, 'equipment');
assert.equal(state.guideCategories['equipment-常规采集品'], true);
assert.equal(state.basicMaterialSearch, '');
assert(activeRow.classes.has('material-search-hit'), '跳转后目标卡片应高亮');
assert.equal(activeRow.scrollOptions.block, 'center');
assert.equal(timers[0].delay, 4000, '高亮需留足时间供用户找到目标');

activeRow = makeRow();
now = 2000;
context.renderGuide();
assert(activeRow.classes.has('material-search-hit'), '市场价刷新后重绘应保留高亮');
timers[0].callback();
assert(!activeRow.classes.has('material-search-hit'), '高亮到期后应清除');

console.log('Guide material search highlight checks passed.');
