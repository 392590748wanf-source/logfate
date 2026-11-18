const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'fantasy.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
const columns = ['level', 'quest', 'item', 'quantity', 'allowance', 'experience', 'cost', 'place'];
const widths = { level: 64, quest: 240, item: 230, quantity: 104, allowance: 104, experience: 144, cost: 140, place: 190, edit: 140 };

const colgroup = source.match(/const leveLedgerColumns = `(<colgroup>[^`]+<\/colgroup>)`;/)?.[1];
assert.ok(colgroup, '推荐售卖表格应定义列组');
assert.deepEqual([...colgroup.matchAll(/<col class="leve-col-([a-z]+)">/g)].map(match => match[1]), [...columns, 'edit'], '八列与可选操作列的顺序保持稳定');
assert.match(colgroup, /leveLedgerEditing \? '<col class="leve-col-edit">' : ''/, '编辑模式增加专用列');
assert.match(source, /const leveLedgerEditing = state\.levePlanEditing && Boolean\(rows\)/, '仅在有可编辑行时增加操作列');
assert.match(source, /class="ledger leve-ledger\$\{leveLedgerEditing \? ' is-editing' : ''\}"/, '编辑列与宽度样式同步');
assert.match(css, /\.leve-ledger \{[^}]*table-layout:fixed;/, '表格不依职业内容重新计算列宽');

for (const [column, width] of Object.entries(widths)) {
  const rule = column === 'quantity' || column === 'allowance'
    ? /\.leve-ledger \.leve-col-quantity, \.leve-ledger \.leve-col-allowance \{ width:104px; \}/
    : new RegExp(`\\.leve-ledger \\.leve-col-${column} \\{ width:${width}px; \\}`);
  assert.match(css, rule, `${column} 列使用固定宽度`);
}
const baseWidth = columns.reduce((sum, column) => sum + widths[column], 0);
assert.match(css, new RegExp(`\\.leve-ledger \\{[^}]*min-width:${baseWidth}px;`), '基础表格最小宽度容纳八列');
assert.match(css, new RegExp(`\\.leve-ledger\\.is-editing \\{ min-width:${baseWidth + widths.edit}px;`), '编辑表格最小宽度容纳九列');
assert.match(css, /\.leve-ledger td\.label \{[^}]*white-space:normal;[^}]*overflow-wrap:anywhere;/, '长任务、道具和地点在列内换行');
console.log('Leve recommendation fixed-column layout checks passed.');
