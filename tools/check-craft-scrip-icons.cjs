const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const context = vm.createContext({
  window: {}, exchangeSources: {}, garlandIconIndex: {}, garlandIconCache: {},
  localSubmarinePartIconIds: new Set()
});
for (const file of ['craft-scrip-data.js', 'craft-scrips.js', 'craft-scrip-icons.js']) {
  vm.runInContext(read(file), context, { filename: file });
}

const routes = context.window.FF14_CRAFT_SCRIPS.exchanges;
const icons = context.window.FF14_CRAFT_SCRIP_EXCHANGE_ICONS;
for (const route of routes) {
  assert(Number.isInteger(icons[route.itemId]) && icons[route.itemId] > 0,
    `工票兑换材料 ${route.name} (${route.itemId}) 缺少图标编号`);
}
assert.deepEqual(Object.keys(icons).sort(), [...new Set(routes.map(route => route.itemId))].sort(),
  '工票图标清单应与固定兑换材料目录一致');

const html = read('index.html');
assert(html.indexOf('craft-scrip-icons.js') > html.indexOf('craft-scrips.js'));
assert(html.indexOf('craft-scrip-icons.js') < html.indexOf('fantasy.js'));
const renderer = read('fantasy.js');
const itemIconId = renderer.match(/  const itemIconId = uid => \{[\s\S]*?\n  \};/)?.[0];
const itemIconMarkup = renderer.match(/  const itemIconMarkup = \(uid, options = \{\}\) => \{[\s\S]*?\n  \};/)?.[0];
assert(itemIconId && itemIconMarkup, '无法找到物品图标渲染函数');
vm.runInContext(`${itemIconId}\n${itemIconMarkup}\nwindow.renderScripIcon = itemIconMarkup;`, context);
for (const route of routes) {
  const markup = context.window.renderScripIcon(route.itemId);
  assert(markup.includes(`/files/icons/item/${icons[route.itemId]}.png`),
    `工票兑换材料 ${route.name} 未渲染正确图标`);
}
assert(renderer.includes("state.basicCategory === 'scrip') loadItemIconIndex()"));
console.log(`工票图标校验通过：${routes.length} 项兑换材料均有图标。`);
