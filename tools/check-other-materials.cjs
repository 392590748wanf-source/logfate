// 旧“其他材料”迁入价格监控；移出监控不得删除共享材料或采购账本。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'fantasy.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const watch = require(path.join(root, 'market-watch.js'));

assert.ok(html.indexOf('market-watch.js') < html.indexOf('fantasy.js'), '监控工具脚本必须先于主脚本载入');
assert.match(source, /data-page="watch">价格监控/, '应有独立价格监控导航');
assert.match(source, /id="watch" class="view"/, '应有独立价格监控页面');
assert.doesNotMatch(source, /data-basic-category="other"/, '材料指导价不再显示其他材料标签');
assert.match(source, /const watchSettings = window\.MarketWatch\.normalizeSettings\([^\n]*otherMaterialIds\)/, '旧清单应迁入监控');
assert.match(source, /delete watchSettings\.items\[uid\]; delete watchSnapshots\[uid\]/, '移出时只删监控设置和行情缓存');
assert.match(source, /采购记录不会删除/, '移出提示应说明采购记录保留');

const settings = watch.normalizeSettings(null, ['36115', '36115', '12345']);
assert.deepEqual(Object.keys(settings.items), ['12345', '36115']);
assert.equal(settings.items['36115'].categoryId, 'other');
assert.equal(settings.items['36115'].quality, 'all');
assert.equal(settings.items['36115'].priority, 'medium');
console.log('Legacy other-material migration and independent watch checks passed.');
