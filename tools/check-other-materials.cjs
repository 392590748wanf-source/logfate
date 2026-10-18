// 模拟“其他材料”移除；不读取或修改真实账本。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'fantasy.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
assert.match(source, /other-search-results/, '左侧搜索结果应使用窄栏布局');
assert.match(source, /materialTable\(materials, '', true\)/, '已加入材料需要移除入口');
assert.match(source, /joined \? '移除'/, '已加入的搜索结果也应显示移除入口');
assert.match(css, /\.other-search-results \.ledger \{[^}]*min-width: 0/, '搜索结果不应继承通用表格最小宽度');

const start = source.indexOf('  const removeOtherMaterial = uid => {');
const end = source.indexOf('  async function refreshMarket(', start);
assert(start >= 0 && end > start, '未找到其他材料移除逻辑');
const otherMaterialIds = ['36115', '12345'];
const material = { uid: 36115, n: '巨匠药酒' };
const data = { m: [material] };
let confirmed = false, saves = 0, renders = 0;
const context = vm.createContext({
  otherMaterialIds, data,
  confirm: () => confirmed,
  save: () => { saves++; },
  renderGuide: () => { renders++; }
});
vm.runInContext(source.slice(start, end) + '\nthis.remove = removeOtherMaterial;', context);

context.remove('36115');
assert.deepEqual(otherMaterialIds, ['36115', '12345'], '取消移除时清单应保持原样');
assert.equal(saves, 0);
confirmed = true;
context.remove('36115');
assert.deepEqual(otherMaterialIds, ['12345'], '仅从其他材料清单移除目标 ID');
assert.equal(data.m[0], material, '不应删除材料资料或其历史数据');
assert.equal(saves, 1);
assert.equal(renders, 1);
context.remove('36115');
assert.equal(saves, 1, '重复移除不应改写账本');

console.log('Other material search layout and removal checks passed.');
