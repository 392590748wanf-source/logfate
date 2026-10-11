// 在内存中验证装备售价输入与出售记账，不读取或修改用户账本。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'fantasy.js'), 'utf8');
for (const id of ['auto-sale-price', 'custom-price', 'detail-sale-price']) {
  assert.match(source, new RegExp(`id="${id}" type="number" min="0" step="any"`), `${id} 不应再触发整数步长偏移`);
}
assert.match(source, /document\.querySelector\('#auto-sale-price'\)\.value = salePriceInputValue\(bundle\)/);
assert.match(source, /document\.querySelector\('#custom-price'\)\.value = salePriceInputValue\(active\)/);
assert.match(source, /id="detail-sale-price"[^>]+value="\$\{salePriceInputValue\(bundle\)\}"/);

const prices = { knight: 1200000 };
const data = { p: { armor: { q: 2, v: 400000, sold: 0 } }, l: [] };
const bundle = { id: 'knight', label: '骑士', priceKey: 'knight', pricePart: 'total', components: [{ item: { id: 'armor' }, qty: 1 }] };
const context = {
  prices, data, today: () => '2026-10-09',
  stock: id => data.p[id],
  inventory: row => Math.min(...row.components.map(component => Math.floor(data.p[component.item.id].q / component.qty)))
};
const priceStart = source.indexOf('  const priceFor = tableRow =>');
const priceEnd = source.indexOf('  const ledgerRows =', priceStart);
const saleStart = source.indexOf('  function sell(bundle, customPrice,');
const saleEnd = source.indexOf('  function restoreSaleLog(log)', saleStart);
assert.ok(priceStart > 0 && priceEnd > priceStart && saleStart > 0 && saleEnd > saleStart);
vm.runInNewContext(source.slice(priceStart, priceEnd) + source.slice(saleStart, saleEnd) + '\nthis.api = { salePriceInputValue, sell };', context);
const { api } = context;

assert.equal(api.salePriceInputValue(bundle), '1200000', '正的套装价直接作为默认成交价');
prices.knight = 0;
assert.equal(api.salePriceInputValue(bundle), '', '套装价为 0 时必须手动填写');
prices.knight = 1200000;
for (const invalid of ['', 0, -1]) {
  assert.throws(() => api.sell(bundle, invalid), /大于 0/);
  assert.equal(data.l.length, 0, '无效售价不写账');
  assert.equal(data.p.armor.q, 2, '无效售价不扣库存');
}

api.sell(bundle, 111);
assert.equal(data.l[0].amount, 111, '任意正价按实际成交价记账');
assert.equal(data.l[0].cost, 200000, '销售成本仍按原库存账面成本计算');
assert.equal(data.l[0].profit, -199889, '利润仍为成交额减成本');
assert.equal(data.p.armor.q, 1, '只扣除对应库存');
api.sell(bundle, 111.25);
assert.equal(data.l[0].amount, 111.25, '允许非整数正价，不受 HTML 步长限制');
console.log('Equipment sale price checks passed (in-memory only).');
