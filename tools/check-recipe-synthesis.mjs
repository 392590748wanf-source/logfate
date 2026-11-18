import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { collectSynthesis, localRecipes } from './sync-recipe-synthesis.mjs';

const read = filename => readFile(new URL(`../${filename}`, import.meta.url), 'utf8');
const sandbox = vm.createContext({ window: {} });
vm.runInContext(await read('recipe-synthesis-data.js'), sandbox);
const data = JSON.parse(JSON.stringify(sandbox.window.FF14_RECIPE_SYNTHESIS));
const manifest = JSON.parse(await read('data/manifest.json'));
const bundle = JSON.parse(await read(`data/${manifest.bundle.path}`));
assert.deepEqual(bundle.datasets.recipeSynthesis, data);

const local = await localRecipes();
const coverage = {};
const expectedIds = new Set(), workshopIds = new Set();
for (const ref of local) {
  const counts = coverage[ref.group] ??= { available: 0, unavailable: 0, unverified: 0, workshop: 0 };
  if (ref.group === 'submarine' && ref.localId.startsWith('workshop-')) {
    assert.deepEqual(data.audit.workshop[ref.localId], { itemId: ref.itemId, kind: 'company-workshop' });
    workshopIds.add(ref.localId);
    counts.workshop++;
    continue;
  }
  const id = /^(?:garland-)?([1-9]\d*)$/.exec(ref.localId)?.[1];
  if (!id) {
    assert.ok(data.audit.unresolved.some(row => row.localId === ref.localId && row.itemId === ref.itemId && row.group === ref.group));
    counts.unverified++;
    continue;
  }
  const record = data.recipes[id];
  assert.ok(record, `配方 ${id} 应重新同步`);
  if (record.status === 'unverified') {
    assert.ok(data.audit.unresolved.find(row => row.recipeId === Number(id))?.refs.some(row =>
      row.group === ref.group && row.itemId === ref.itemId && row.job === ref.job));
  } else {
    assert.equal(record.itemId, ref.itemId);
    assert.equal(record.job, ref.job);
  }
  expectedIds.add(id);
  counts[record.status]++;
}
assert.deepEqual(new Set(Object.keys(data.recipes)), expectedIds);
assert.deepEqual(new Set(Object.keys(data.audit.workshop)), workshopIds);
assert.deepEqual(coverage, data.audit.coverage);
assert.ok(data.audit.crossCheck.examples.every(example => example.matches));

assert.equal(data.recipes[37808].status, 'unavailable', '雷松木木材');
assert.equal(data.recipes[37808].requirements.craftsmanship, 5620);
assert.equal(data.audit.crossCheck.examples.find(row => row.recipeId === 36094).canQuickSynth, false, '仪仗玉杖作为上游样例核验');
assert.deepEqual([153, 273].map(id => ({
  item: data.recipes[id].itemId, job: data.recipes[id].job, status: data.recipes[id].status
})), [{ item: 5059, job: 1, status: 'available' }, { item: 5059, job: 2, status: 'available' }]);
assert.equal(data.recipes[1207].requirements.quickCraftsmanship, 347);
assert.equal(data.audit.crossCheck.examples.find(row => row.recipeId === 1210).thresholds[3], 374);
assert.equal(data.audit.workshop['workshop-26508'].kind, 'company-workshop');
assert.equal(data.recipes[26508], undefined);

const ordinary = { group: 'equipment', localId: '10', itemId: 100, job: 0 };
const validSource = { id: 10, target: 100, job: 0, qsable: true, clv: 100, srb: 0, thresholds: [0, 318, 0, 374, 325] };
const run = (source, refs = [ordinary], examples = []) => collectSynthesis(source, refs, examples);
assert.deepEqual(run({ 10: validSource }).recipes[10].requirements, {
  level: 100, masterBookItemId: null, craftsmanship: 0, control: 318, quickCraftsmanship: 0, quickControl: 374
});
assert.equal(run({}).recipes[10].reason, 'upstream-recipe-missing');
assert.equal(run({ 10: { ...validSource, qsable: undefined } }).recipes[10].reason, 'upstream-fields-missing');
assert.equal(run({ 10: { ...validSource, thresholds: [0, 0, null, 0] } }).recipes[10].reason, 'upstream-fields-missing');
assert.equal(run({ 10: { ...validSource, target: 101 } }).recipes[10].reason, 'upstream-identity-conflict');
assert.equal(run({ 10: { ...validSource, job: 1 } }).recipes[10].reason, 'upstream-identity-conflict');
assert.equal(run({ 10: validSource }, [ordinary, { ...ordinary, job: 1 }]).recipes[10].reason, 'local-identity-conflict');
assert.equal(run({ 10: validSource }, [ordinary], [{ recipeId: 10, itemId: 100, job: 0, canQuickSynth: false, thresholds: [0, 0, 0, 0] }]).recipes[10].reason, 'cross-check-conflict');
assert.equal(run({}, [{ ...ordinary, localId: 'unknown' }]).audit.unresolved[0].reason, 'missing-recipe-id');
assert.deepEqual(run({ 10: validSource }, [{
  group: 'submarine', localId: 'workshop-100', itemId: 100, job: 0
}]).recipes, {});

const app = await read('fantasy.js');
const macroCode = app.slice(app.indexOf('  const equipmentMacros = '), app.indexOf('  const equipmentTimeEnabled = '));
const macro = vm.runInNewContext(`${macroCode}\nequipmentMacroFor('770', 1, 49213, 'nq');`);
assert.equal(macro.seconds, 16);
assert.equal(macro.scripts.join('\n').match(/<wait\.\d+>/g).reduce((sum, token) => sum + Number(token.match(/\d+/)[0]), 0), 16);

console.log('简易制作资料检查通过：覆盖、本地配方标识、门槛、XIVAPI 样例、冲突、工房节点及 16 秒 NQ 宏。');
