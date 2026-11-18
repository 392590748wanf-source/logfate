import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const source = {
  repository: 'https://github.com/InfSein/hqhelper',
  branch: 'evercold',
  commit: 'd7bf0f40fb589c2e93817f6d1bcb1c92eb102434',
  path: 'src/assets/data/unpacks/recipes.json',
  sha256: '627b2d5b097d3138202fb8f02fd02b25995337cdc556f1eadb652db65a9dce31',
  license: 'MIT, Copyright (c) 2024-2027 InfSein'
};
const sourceUrl = `https://raw.githubusercontent.com/InfSein/hqhelper/${source.commit}/${source.path}`;

// XIVAPI 的 CraftType 是 0–7。Garland 职业编号是 8–15，现有配方资料两种都有。
const localGroups = [
  ['equipment', 'base-materials.js', 'FF14_BASE_MATERIALS', 'g', 0],
  ['submarine', 'submarine-data.js', 'FF14_SUBMARINE_DATA', 'g', 0],
  ['fallback', 'hqhelper-fallback.js', 'FF14_HQHELPER_FALLBACK', 'recipes', 0],
  ['craftScrips', 'craft-scrips.js', 'FF14_CRAFT_SCRIPS', 'recipes', 8],
  ['levequests', 'levequest-recipes.js', 'FF14_LEVEQUEST_RECIPES', 'recipes', 8]
];
const root = new URL('../', import.meta.url);

export async function localRecipes() {
  const sandbox = vm.createContext({ window: {} });
  const load = async filename => vm.runInContext(await readFile(new URL(filename, root), 'utf8'), sandbox, { filename });
  await load('craft-scrip-data.js');
  const groups = await Promise.all(localGroups.map(async ([group, filename, globalName, key, jobOffset]) => {
    await load(filename);
    const recipes = sandbox.window[globalName]?.[key];
    if (!recipes) throw new Error(`缺少 ${group} 配方资料`);
    return Object.entries(recipes).flatMap(([itemId, rows]) => rows.map(row => ({
      group, itemId: Number(itemId), localId: String(row.id ?? ''), job: row.j - jobOffset
    })));
  }));
  return groups.flat();
}

// 这些样例已用 XIVAPI 的 Recipe 表逐条交叉核验，构建与运行时可离线。
const crossCheck = {
  source: 'https://v2.xivapi.com/api/sheet/Recipe',
  version: 'a72e645591e5bf8b',
  examples: [
    { recipeId: 37808, itemId: 49213, job: 0, canQuickSynth: false, thresholds: [5620, 5080, 0, 0] },
    { recipeId: 36094, itemId: 46016, job: 0, canQuickSynth: false, thresholds: [5380, 4650, 0, 0] },
    { recipeId: 153, itemId: 5059, job: 1, canQuickSynth: true, thresholds: [0, 0, 0, 0] },
    { recipeId: 273, itemId: 5059, job: 2, canQuickSynth: true, thresholds: [0, 0, 0, 0] },
    { recipeId: 1207, itemId: 5061, job: 1, canQuickSynth: true, thresholds: [275, 0, 347, 0] },
    { recipeId: 1210, itemId: 5571, job: 1, canQuickSynth: true, thresholds: [0, 318, 0, 374] }
  ]
};

export function collectSynthesis(snapshot, local, examples = crossCheck.examples) {
  const matchedExamples = new Map(examples.map(example => [String(example.recipeId), example]));
  const candidates = new Map();
  const workshop = {};
  const unresolved = [];
  const coverage = {};
  for (const ref of local) {
    const summary = coverage[ref.group] ??= { available: 0, unavailable: 0, unverified: 0, workshop: 0 };
    if (ref.group === 'submarine' && /^workshop-[1-9]\d*$/.test(ref.localId)) {
      workshop[ref.localId] = { itemId: ref.itemId, kind: 'company-workshop' };
      summary.workshop++;
      continue;
    }
    const id = /^(?:garland-)?([1-9]\d*)$/.exec(ref.localId)?.[1];
    if (!id) {
      unresolved.push({ ...ref, status: 'unverified', reason: 'missing-recipe-id' });
      summary.unverified++;
      continue;
    }
    if (!candidates.has(id)) candidates.set(id, []);
    candidates.get(id).push(ref);
  }

  const recipes = {};
  for (const [id, refs] of candidates) {
    const { itemId, job } = refs[0];
    const record = { itemId, job };
    const upstream = snapshot[id];
    const benchmark = matchedExamples.get(id);
    const matchesLocal = refs.every(ref => ref.itemId === itemId && ref.job === job);
    const thresholds = Array.isArray(upstream?.thresholds) ? upstream.thresholds.slice(0, 4) : [];
    let reason;
    if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isInteger(job) || job < 0 || job > 7) reason = 'local-fields-missing';
    else if (!matchesLocal) reason = 'local-identity-conflict';
    else if (!upstream) reason = 'upstream-recipe-missing';
    else if (upstream.id !== Number(id) || upstream.target !== itemId || upstream.job !== job) reason = 'upstream-identity-conflict';
    else if (typeof upstream.qsable !== 'boolean' || thresholds.length !== 4 ||
             !Number.isInteger(upstream.clv) || upstream.clv <= 0 ||
             !Number.isInteger(upstream.srb) || upstream.srb < 0 ||
             !thresholds.every(value => Number.isInteger(value) && value >= 0)) reason = 'upstream-fields-missing';
    else if (benchmark && !matchesExample(upstream, benchmark)) reason = 'cross-check-conflict';

    if (reason) {
      record.status = 'unverified';
      record.reason = reason;
      unresolved.push({ recipeId: Number(id), reason, refs });
    } else {
      record.status = upstream.qsable ? 'available' : 'unavailable';
      const [craftsmanship, control, quickCraftsmanship, quickControl] = thresholds;
      record.requirements = {
        level: upstream.clv, masterBookItemId: upstream.srb || null,
        craftsmanship, control, quickCraftsmanship, quickControl
      };
    }
    recipes[id] = record;
    for (const { group } of refs) coverage[group][record.status]++;
  }
  return { recipes, audit: { coverage, workshop, unresolved } };
}

function matchesExample(upstream, example) {
  return upstream?.id === example.recipeId && upstream.target === example.itemId
    && upstream.job === example.job && upstream.qsable === example.canQuickSynth
    && example.thresholds.every((value, index) => upstream.thresholds?.[index] === value);
}

async function main() {
  const file = process.argv[2];
  const input = file ? await readFile(file) : await fetch(sourceUrl, { signal: AbortSignal.timeout(30_000) }).then(async response => {
    if (!response.ok) throw new Error(`HqHelper 配方下载失败（HTTP ${response.status}）`);
    return Buffer.from(await response.arrayBuffer());
  });
  if (createHash('sha256').update(input).digest('hex') !== source.sha256) {
    throw new Error('配方快照校验失败，请核对 HqHelper 提交及文件内容。');
  }
  const snapshot = JSON.parse(input);
  const { recipes, audit } = collectSynthesis(snapshot, await localRecipes());
  audit.crossCheck = {
    ...crossCheck,
    examples: crossCheck.examples.map(example => ({
      ...example, matches: matchesExample(snapshot[String(example.recipeId)], example)
    }))
  };
  const data = { schema: 1, source, recipes, audit };
  const output = '// 自动生成：tools/sync-recipe-synthesis.mjs。配方 ID 为键，职业使用 CraftType（0–7）。\n'
    + `window.FF14_RECIPE_SYNTHESIS=${JSON.stringify(data)};\n`;
  await writeFile(new URL('recipe-synthesis-data.js', root), output, 'utf8');
  console.log(`已同步 ${Object.keys(recipes).length} 条普通配方，${Object.keys(audit.workshop).length} 条工房节点，${audit.unresolved.length} 项待核验。`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
